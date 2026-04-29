const pool = require('../config/database');
const attendanceRepo = require('../repositories/attendanceRepository');
const detailsRepo = require('../repositories/attendanceDetailsRepository');
const notifRepo = require('../repositories/notificationRepository');

/**
 * Build notification objects for client consumption.
 * Each item contains attendance_id, date, day_name, status, message, action label and action url.
 */
const getAlpaNotificationsForStudent = async (studentId) => {
  // Fetch attendances that are 'alpa' and have no details recorded yet
  const rows = await attendanceRepo.findAlpaWithoutDetailsByStudent(studentId);

  // Map to notification shape. If a detail record exists, include its status and approval_status
  return rows.map(r => {
    const hasDetail = r.detail_id || r.status /* keep backwards compatibility if alias */ && (r.detail_status || r.approval_status);
    return {
      attendance_id: r.attendance_id,
      date: r.date,
      day_name: r.day_name,
      status: r.status,
      message: `Pada hari ${r.day_name}, tanggal ${r.date}, anda tidak berangkat sekolah dan tidak memberikan alasan. Silakan berikan alasan ketidakhadiran anda.`,
      action: {
        label: 'Beri Alasan',
        url: `/api/student/attendance/${r.attendance_id}/reason`
      },
      // show action only if there is no detail record for this attendance
      show_action_button: !r.detail_id,
      // expose detail fields if present
      detail: r.detail_id ? {
        id: r.detail_id,
        status: r.detail_status || null,
        approval_status: r.approval_status || null
      } : null
    };
  });
};

/**
 * Submit reason for an attendance. Uses a DB transaction to prevent race conditions
 * and duplicate inserts.
 */
const submitAttendanceReason = async ({ studentId, attendanceId, reason, description = null, evidence_url = null }) => {
  const client = await pool.connect();
  let transactionStarted = false;
  
  try {
    console.log(`[submitAttendanceReason] START: studentId=${studentId}, attendanceId=${attendanceId}, reason=${reason}`);
    await client.query('BEGIN');
    transactionStarted = true;
    console.log(`[submitAttendanceReason] Transaction BEGIN executed`);

    // Validate attendance exists and belongs to student
    let qAttendance = `SELECT id, student_id, status FROM student_attendances WHERE id = $1 LIMIT 1`;
    let rAttendance = await client.query(qAttendance, [attendanceId]);
    const attendance = rAttendance.rows[0] || null;
    console.log(`[submitAttendanceReason] findAttendanceById result:`, attendance);
    
    if (!attendance) {
      console.log(`[submitAttendanceReason] ROLLBACK: Attendance not found`);
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { status: 404, error: 'Attendance tidak ditemukan' };
    }

    // Normalize types to numbers before comparison
    const attendanceStudentId = Number(attendance.student_id);
    const requesterStudentId = Number(studentId);
    console.log(`[submitAttendanceReason] Ownership check: attendanceStudentId=${attendanceStudentId}, requesterStudentId=${requesterStudentId}`);
    
    if (attendanceStudentId !== requesterStudentId) {
      console.log(`[submitAttendanceReason] ROLLBACK: Ownership mismatch`);
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { status: 403, error: 'Anda tidak memiliki akses ke attendance ini' };
    }

    console.log(`[submitAttendanceReason] Attendance status: ${attendance.status}`);
    if (attendance.status !== 'alpa') {
      console.log(`[submitAttendanceReason] ROLLBACK: Status is not 'alpa'`);
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { status: 400, error: 'Hanya attendance dengan status alpa yang dapat diberikan alasan' };
    }

    // Prevent duplicate detail records
    let qExists = `SELECT 1 FROM student_attendance_details WHERE attendance_id = $1 LIMIT 1`;
    let rExists = await client.query(qExists, [attendanceId]);
    const exists = rExists.rows.length > 0;
    console.log(`[submitAttendanceReason] existsByAttendanceId result: ${exists}`);
    
    if (exists) {
      console.log(`[submitAttendanceReason] ROLLBACK: Detail already exists`);
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { status: 409, error: 'Alasan untuk attendance ini sudah ada' };
    }

    // INSERT into student_attendance_details
    console.log(`[submitAttendanceReason] Inserting detail: attendance_id=${attendanceId}, status=${reason}`);
    // MySQL version (commented out — INSERT then SELECT using insertId):
    // let rRawInsert = await client.query(
    //   `INSERT INTO student_attendance_details (attendance_id, status, description, evidence_url, created_at, updated_at)
    //    VALUES (?, ?, ?, ?, NOW(), NOW())`,
    //   [attendanceId, reason, description, evidence_url]
    // );
    // let rInsert = await client.query(
    //   `SELECT * FROM student_attendance_details WHERE id = ? LIMIT 1`,
    //   [rRawInsert.insertId]
    // );
    // const inserted = rInsert.rows[0];
    //
    // PostgreSQL version: RETURNING *
    let qInsert = `INSERT INTO student_attendance_details (attendance_id, status, description, evidence_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`;
    let rInsert = await client.query(qInsert, [attendanceId, reason, description, evidence_url]);
    const inserted = rInsert.rows[0];
    console.log(`[submitAttendanceReason] insertDetails result:`, inserted);

    // UPDATE attendance.status
    console.log(`[submitAttendanceReason] Updating attendance status to: ${reason}`);
    // MySQL version (commented out — UPDATE then SELECT):
    // await client.query(
    //   `UPDATE student_attendances SET status = ?, updated_at = NOW() WHERE id = ?`,
    //   [reason, attendanceId]
    // );
    // let rUpdate = await client.query(
    //   `SELECT * FROM student_attendances WHERE id = ? LIMIT 1`,
    //   [attendanceId]
    // );
    // const updatedAttendance = rUpdate.rows[0];
    //
    // PostgreSQL version: RETURNING *
    let qUpdate = `
      UPDATE student_attendances
      SET status = $1,
          source = 'self_report',
          updated_by_role = 'system',
          updated_by_teacher_id = NULL,
          change_reason = 'Siswa mengirim alasan ketidakhadiran via notifikasi',
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    let rUpdate = await client.query(qUpdate, [reason, attendanceId]);
    const updatedAttendance = rUpdate.rows[0];
    console.log(`[submitAttendanceReason] updateAttendanceStatus result:`, updatedAttendance);

    try {
      let qNotif = `UPDATE notifications SET is_read = TRUE, updated_at = NOW() WHERE attendance_id = $1 AND student_id = $2`;
      await client.query(qNotif, [attendanceId, requesterStudentId]);
      console.log(`[submitAttendanceReason] markNotificationsRead succeeded`);
    } catch (notifErr) {
      // PostgreSQL: '42P01' = undefined_table  |  MySQL: 'ER_NO_SUCH_TABLE'
      if (notifErr && (notifErr.code === '42P01' || notifErr.code === 'ER_NO_SUCH_TABLE')) {
        console.warn('[submitAttendanceReason] notifications table not found; skipping markNotificationsRead');
      } else {
        console.warn('[submitAttendanceReason] markNotificationsRead error:', notifErr.message);
      }
    }

    // COMMIT transaction
    console.log(`[submitAttendanceReason] Executing COMMIT`);
    await client.query('COMMIT');
    transactionStarted = false;
    console.log(`[submitAttendanceReason] Transaction COMMITTED successfully`);

    // === CRITICAL: Release client BEFORE returning ===
    client.release();
    console.log(`[submitAttendanceReason] Client released after COMMIT`);

    // === POST-COMMIT VERIFICATION (with new connection) ===
    console.log(`[submitAttendanceReason] Starting post-commit verification with new connection...`);
    const verifyClient = await pool.connect();
    try {
      const verifyRes = await verifyClient.query(
        'SELECT * FROM student_attendance_details WHERE attendance_id = $1',
        [attendanceId]
      );
      console.log(`[submitAttendanceReason] Post-commit verification: found ${verifyRes.rows.length} record(s):`, verifyRes.rows[0]);
      
      if (verifyRes.rows.length === 0) {
        console.error('[submitAttendanceReason] WARNING: Record not found after COMMIT!');
        return { 
          status: 500, 
          error: 'Data insert gagal - record tidak ditemukan setelah COMMIT. Ini mungkin masalah database.' 
        };
      }
    } finally {
      verifyClient.release();
      console.log(`[submitAttendanceReason] Verification client released`);
    }

    console.log(`[submitAttendanceReason] All verification passed - returning success`);
    return { 
      status: 200, 
      data: { 
        attendance: updatedAttendance, 
        detail: inserted 
      } 
    };
  } catch (error) {
    console.error(`[submitAttendanceReason] CATCH - Error occurred:`, error.message, error.stack);
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
  getAlpaNotificationsForStudent,
  submitAttendanceReason
};
