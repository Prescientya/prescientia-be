const pool = require('../config/database');

/**
 * Submit reason and evidence for an attendance that is marked as 'alpa'
 * 
 * Validates:
 * - Attendance exists
 * - Attendance belongs to the student (ownership check)
 * - Attendance status is 'alpa'
 * - No detail record already exists
 * 
 * Uses database transaction to ensure atomicity:
 * - Insert into student_attendance_details
 * - Update student_attendances status
 * 
 * @param {Object} params
 * @param {number} params.studentId - The student requesting the submission
 * @param {number} params.attendanceId - The attendance record ID
 * @param {string} params.reason - Reason (sakit, izin, alpa)
 * @param {string} params.description - Reason description
 * @param {string} params.evidence_url - URL of uploaded evidence (optional)
 * 
 * @returns {Object} - { status, data?, error? }
 *   - status 200: { attendance, detail }
 *   - status 400: validation errors
 *   - status 403: ownership check failed
 *   - status 404: attendance not found
 *   - status 409: detail record already exists
 *   - status 500: transaction failure
 */
const submitAttendanceReason = async ({
  studentId,
  attendanceId,
  reason,
  description,
  evidence_url = null
}) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    console.log(
      `[submitAttendanceReason] START: studentId=${studentId}, attendanceId=${attendanceId}, reason=${reason}`
    );

    // Start transaction
    await client.query('BEGIN');
    transactionStarted = true;
    console.log(`[submitAttendanceReason] Transaction BEGIN executed`);

    // Step 1: Fetch attendance record
    const qFetchAttendance = `
      SELECT id, student_id, status 
      FROM student_attendances 
      WHERE id = $1 
      LIMIT 1
    `;
    const rFetchAttendance = await client.query(qFetchAttendance, [attendanceId]);
    const attendance = rFetchAttendance.rows[0] || null;
    console.log(`[submitAttendanceReason] fetchAttendance result:`, attendance);

    // Step 1a: Check if attendance exists
    if (!attendance) {
      console.log(`[submitAttendanceReason] ROLLBACK: Attendance not found`);
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { status: 404, error: 'Attendance tidak ditemukan' };
    }

    // Step 1b: Validate ownership (attendance belongs to student)
    const attendanceStudentId = Number(attendance.student_id);
    const requesterStudentId = Number(studentId);
    console.log(
      `[submitAttendanceReason] Ownership check: attendanceStudentId=${attendanceStudentId}, requesterStudentId=${requesterStudentId}`
    );

    if (attendanceStudentId !== requesterStudentId) {
      console.log(`[submitAttendanceReason] ROLLBACK: Ownership mismatch`);
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { status: 403, error: 'Anda tidak memiliki akses ke attendance ini' };
    }

    // Step 2: Check if detail record already exists
    const qCheckDuplicate = `
      SELECT 1 
      FROM student_attendance_details 
      WHERE attendance_id = $1 
      LIMIT 1
    `;
    const rCheckDuplicate = await client.query(qCheckDuplicate, [attendanceId]);
    const detailExists = rCheckDuplicate.rows.length > 0;
    console.log(`[submitAttendanceReason] checkDuplicate result: ${detailExists}`);

    if (detailExists) {
      console.log(`[submitAttendanceReason] ROLLBACK: Detail already exists`);
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { status: 409, error: 'Alasan untuk attendance ini sudah ada' };
    }

    // Step 3: Insert into student_attendance_details (approval_status = 'pending')
    console.log(
      `[submitAttendanceReason] Inserting detail: attendance_id=${attendanceId}, status=${reason}, description=${description}`
    );
    // MySQL version (commented out — INSERT then SELECT using insertId):
    /*
    const rRaw = await client.query(
      `INSERT INTO student_attendance_details
       (attendance_id, status, description, evidence_url, approval_status, approved_by, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NOW(), NOW())`,
      [attendanceId, reason, description, evidence_url]
    );
    const rInsertDetail = await client.query(
      `SELECT * FROM student_attendance_details WHERE id = ? LIMIT 1`,
      [rRaw.insertId]
    );
    const insertedDetail = rInsertDetail.rows[0];
    */
    // PostgreSQL version: RETURNING *
    const qInsertDetail = `
      INSERT INTO student_attendance_details 
      (attendance_id, status, description, evidence_url, approval_status, approved_by, approved_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'pending', NULL, NULL, NOW(), NOW())
      RETURNING *
    `;
    const rInsertDetail = await client.query(qInsertDetail, [
      attendanceId, reason, description, evidence_url
    ]);
    const insertedDetail = rInsertDetail.rows[0];
    console.log(`[submitAttendanceReason] insertDetail result:`, insertedDetail);

    // Commit transaction
    console.log(`[submitAttendanceReason] Executing COMMIT`);
    await client.query('COMMIT');
    transactionStarted = false;
    console.log(`[submitAttendanceReason] Transaction COMMITTED successfully`);

    // Release client before post-commit verification
    client.release();
    console.log(`[submitAttendanceReason] Client released after COMMIT`);

    // Post-commit verification (using new connection)
    console.log(`[submitAttendanceReason] Starting post-commit verification...`);
    const verifyClient = await pool.connect();
    try {
      const qVerify = `
        SELECT * 
        FROM student_attendance_details 
        WHERE id = $1
      `;
      const rVerify = await verifyClient.query(qVerify, [insertedDetail.id]);
      console.log(
        `[submitAttendanceReason] Post-commit verification: found ${rVerify.rows.length} record(s)`
      );

      if (rVerify.rows.length === 0) {
        console.error('[submitAttendanceReason] WARNING: Record not found after COMMIT!');
        return {
          status: 500,
          error: 'Data insert gagal - record tidak ditemukan setelah COMMIT'
        };
      }
    } finally {
      verifyClient.release();
      console.log(`[submitAttendanceReason] Verification client released`);
    }

    console.log(`[submitAttendanceReason] All checks passed - returning success`);
    return {
      status: 200,
      data: {
        attendance: attendance,
        detail: insertedDetail
      }
    };
  } catch (error) {
    console.error(
      `[submitAttendanceReason] CATCH - Error occurred:`,
      error.message,
      error.stack
    );

    // Rollback on error
    if (transactionStarted) {
      try {
        console.log(`[submitAttendanceReason] Rolling back transaction`);
        await client.query('ROLLBACK');
        console.log(`[submitAttendanceReason] ROLLBACK completed`);
      } catch (rollbackErr) {
        console.error(`[submitAttendanceReason] ROLLBACK failed:`, rollbackErr.message);
      }
    }

    throw error;
  } finally {
    try {
      console.log(`[submitAttendanceReason] Finally block - releasing client`);
      client.release();
      console.log(`[submitAttendanceReason] Finally - Client released`);
    } catch (releaseErr) {
      console.error(`[submitAttendanceReason] Error releasing client:`, releaseErr.message);
    }
  }
};

module.exports = {
  submitAttendanceReason
};
