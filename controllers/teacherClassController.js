const pool = require('../config/database');
const { localDateStr } = require('../utils/dateHelper');

/**
 * SQL fragment: formats class name as "X RPL 1" (Roman grade + major).
 * Uses CONCAT() for MySQL compatibility.
 */
function classNameSQL(classAlias) {
  return `CONCAT(CASE ${classAlias}.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
           ELSE ${classAlias}.class END, ' ', COALESCE(${classAlias}.major, ''))`;
}

const ATTENDANCE_STATUSES = ['hadir', 'sakit', 'izin', 'alpa', 'terlambat'];
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];

function toPositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

function getDayNameIdFromDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const daysIndonesian = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  return daysIndonesian[d.getDay()];
}

/**
 * GET /api/teachers/my-classes
 *
 * Returns all classes the authenticated teacher teaches (via teacher_schedules),
 * along with total student count per class and today's attendance summary.
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 */
const getTeacherClasses = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: teacher_id tidak ditemukan di token'
      });
    }

    // Get distinct classes from teacher_schedules — single pass with conditional aggregation
    const classesQuery = `
      SELECT
        ts.class_id,
        ${classNameSQL('c')} AS class_name,
        c.class AS grade,
        c.major,
        c.homeroom_teacher_id,
        ht.name AS homeroom_teacher_name,
        COUNT(DISTINCT s.id) AS total_students,
        COALESCE(SUM(CASE WHEN sa.status = 'hadir'     THEN 1 ELSE 0 END), 0) AS total_hadir,
        COALESCE(SUM(CASE WHEN sa.status = 'sakit'     THEN 1 ELSE 0 END), 0) AS total_sakit,
        COALESCE(SUM(CASE WHEN sa.status = 'izin'      THEN 1 ELSE 0 END), 0) AS total_izin,
        COALESCE(SUM(CASE WHEN sa.status = 'alpa'      THEN 1 ELSE 0 END), 0) AS total_alpa,
        COALESCE(SUM(CASE WHEN sa.status = 'terlambat'  THEN 1 ELSE 0 END), 0) AS total_terlambat
      FROM teacher_schedules ts
      INNER JOIN classes c ON c.id = ts.class_id
      LEFT JOIN teachers ht ON ht.id = c.homeroom_teacher_id
      LEFT JOIN students s ON s.class_id = c.id
      LEFT JOIN student_attendances sa
        ON sa.student_id = s.id
        AND sa.calendar_id IN (SELECT sc.id FROM school_calendar sc WHERE sc.date = CURRENT_DATE)
      WHERE ts.teacher_id = $1
      GROUP BY ts.class_id, c.class, c.major, c.homeroom_teacher_id, ht.name
      ORDER BY c.class ASC, c.major ASC
    `;

    const result = await pool.query(classesQuery, [teacherId]);

    const classes = result.rows.map(row => ({
      class_id: row.class_id,
      class_name: row.class_name.trim(),
      grade: row.grade,
      major: row.major,
      homeroom_teacher_name: row.homeroom_teacher_name || null,
      total_students: parseInt(row.total_students),
      today_attendance: {
        hadir: parseInt(row.total_hadir),
        sakit: parseInt(row.total_sakit),
        izin: parseInt(row.total_izin),
        alpa: parseInt(row.total_alpa),
        terlambat: parseInt(row.total_terlambat),
      }
    }));

    res.json({
      success: true,
      message: `Ditemukan ${classes.length} kelas yang diajar`,
      data: {
        teacher_id: teacherId,
        total_classes: classes.length,
        classes
      }
    });

  } catch (error) {
    console.error('getTeacherClasses error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/teachers/class/:classId/students
 *
 * Returns all students in a specific class with their TODAY's attendance status.
 * If no attendance record exists for today, status will be null (belum absen).
 *
 * Optional query params:
 *   ?date=YYYY-MM-DD  — fetch attendance for a specific date (default: today)
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 */
const getClassStudents = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: teacher_id tidak ditemukan di token'
      });
    }

    const classId = Number.parseInt(req.params.classId, 10);
    if (!classId || Number.isNaN(classId)) {
      return res.status(400).json({
        success: false,
        message: 'class_id harus berupa angka yang valid'
      });
    }

    const dateParam = req.query.date || localDateStr(new Date());
    if (!isValidDateString(dateParam)) {
      return res.status(400).json({
        success: false,
        message: 'Format date tidak valid. Gunakan YYYY-MM-DD'
      });
    }

    const scheduleId = toPositiveInt(req.query.schedule_id);
    const periodId = toPositiveInt(req.query.period_id);
    const subjectId = toPositiveInt(req.query.subject_id);

    if (req.query.schedule_id !== undefined && !scheduleId) {
      return res.status(400).json({ success: false, message: 'schedule_id harus berupa angka positif yang valid' });
    }
    if (req.query.period_id !== undefined && !periodId) {
      return res.status(400).json({ success: false, message: 'period_id harus berupa angka positif yang valid' });
    }
    if (req.query.subject_id !== undefined && !subjectId) {
      return res.status(400).json({ success: false, message: 'subject_id harus berupa angka positif yang valid' });
    }

    // Verify teacher teaches this class
    const teachCheck = await pool.query(
      `SELECT 1 FROM teacher_schedules WHERE teacher_id = $1 AND class_id = $2 LIMIT 1`,
      [teacherId, classId]
    );

    if (teachCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak mengajar di kelas ini'
      });
    }

    // Get class info
    const classInfo = await pool.query(
      `SELECT id, ${classNameSQL('classes')} AS class_name, class AS grade, major
       FROM classes WHERE id = $1`,
      [classId]
    );

    if (classInfo.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kelas tidak ditemukan'
      });
    }

    const dayName = getDayNameIdFromDate(dateParam);
    if (!dayName || dayName === 'minggu' || dayName === 'sabtu') {
      return res.json({
        success: true,
        data: {
          meta: {
            class_id: classId,
            class_name: classInfo.rows[0].class_name.trim(),
            date: dateParam
          },
          period: null,
          summary_per_period: {
            total: 0,
            hadir: 0,
            sakit: 0,
            izin: 0,
            alpa: 0,
            terlambat: 0,
            belum_absen: 0
          },
          students: []
        }
      });
    }

    const periodParams = [teacherId, classId, dayName, dateParam];
    let periodIdx = 5;

    let periodWhere = `
      WHERE ts.teacher_id = $1
        AND ts.class_id = $2
        AND cp.day = $3
    `;

    if (scheduleId) {
      periodWhere += ` AND ts.id = $${periodIdx}`;
      periodParams.push(scheduleId);
      periodIdx += 1;
    }
    if (periodId) {
      periodWhere += ` AND ts.class_period_id = $${periodIdx}`;
      periodParams.push(periodId);
      periodIdx += 1;
    }
    if (subjectId) {
      periodWhere += ` AND ts.subject_id = $${periodIdx}`;
      periodParams.push(subjectId);
      periodIdx += 1;
    }

    const periodQuery = `
      SELECT
        ts.id AS schedule_id,
        ts.class_period_id AS period_id,
        ts.subject_id,
        subj.name AS subject_name,
        cp.start_time,
        cp.end_time,
        EXISTS (
          SELECT 1
          FROM submit_teacher_periods stp
          WHERE stp.teacher_id = ts.teacher_id
            AND stp.class_id = ts.class_id
            AND stp.subject_id = ts.subject_id
            AND stp.period_id = ts.class_period_id
            AND stp.day = cp.day
            AND DATE(CONVERT_TZ(stp.submitted_at, '+00:00', '+07:00')) = $4::date
        ) AS is_submitted
      FROM teacher_schedules ts
      INNER JOIN class_periods cp ON cp.id = ts.class_period_id
      LEFT JOIN subjects subj ON subj.id = ts.subject_id
      ${periodWhere}
      ORDER BY cp.sequence ASC, ts.id ASC
      LIMIT 1
    `;

    const periodResult = await pool.query(periodQuery, periodParams);
    if (periodResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jadwal/period yang diminta tidak ditemukan untuk class dan tanggal tersebut'
      });
    }

    const period = periodResult.rows[0];

    const studentsQuery = `
      SELECT
        s.id AS student_id,
        s.nis,
        s.name AS student_name,
        s.gender,
        s.photo_profile,
        sa.id AS attendance_id,
        COALESCE(ascp.new_status, sa.status) AS attendance_status,
        COALESCE(ascp.changed_by_type, sa.source) AS attendance_source,
        sa.check_in_time,
        sa.check_out_time,
        sad.description AS attendance_description,
        sad.approval_status
      FROM students s
      LEFT JOIN (
        SELECT
          sa2.id,
          sa2.student_id,
          sa2.status,
          sa2.source,
          sa2.check_in_time,
          sa2.check_out_time,
          ROW_NUMBER() OVER (
            PARTITION BY sa2.student_id
            ORDER BY (sa2.updated_at IS NULL), sa2.updated_at DESC, sa2.id DESC
          ) AS rn
        FROM student_attendances sa2
        INNER JOIN school_calendar sc2 ON sc2.id = sa2.calendar_id
        WHERE sa2.class_id = $1
          AND sc2.date = $2::date
      ) sa ON sa.student_id = s.id AND sa.rn = 1
      LEFT JOIN (
        SELECT
          asc2.attendance_id,
          asc2.new_status,
          asc2.changed_by_type,
          ROW_NUMBER() OVER (
            PARTITION BY asc2.attendance_id
            ORDER BY asc2.created_at DESC
          ) AS rn
        FROM attendance_status_changes asc2
        WHERE asc2.class_period_id = $3
      ) ascp ON ascp.attendance_id = sa.id AND ascp.rn = 1
      LEFT JOIN student_attendance_details sad ON sad.attendance_id = sa.id
      WHERE s.class_id = $1
      ORDER BY s.name ASC
    `;

    const studentsResult = await pool.query(studentsQuery, [classId, dateParam, period.period_id]);

    const cls = classInfo.rows[0];

    const students = studentsResult.rows.map(row => ({
      student_id: row.student_id,
      nis: row.nis,
      student_name: row.student_name,
      gender: row.gender,
      photo_profile: row.photo_profile || null,
      attendance: row.attendance_id ? {
        attendance_id: row.attendance_id,
        status: row.attendance_status,
        source: row.attendance_source,
        check_in_time: row.check_in_time,
        check_out_time: row.check_out_time,
        description: row.attendance_description || null,
        approval_status: row.approval_status || null
      } : null
    }));

    const summaryPerPeriod = {
      total: students.length,
      hadir: students.filter(s => s.attendance && s.attendance.status === 'hadir').length,
      sakit: students.filter(s => s.attendance && s.attendance.status === 'sakit').length,
      izin: students.filter(s => s.attendance && s.attendance.status === 'izin').length,
      alpa: students.filter(s => s.attendance && s.attendance.status === 'alpa').length,
      terlambat: students.filter(s => s.attendance && s.attendance.status === 'terlambat').length,
      belum_absen: students.filter(s => !s.attendance).length
    };

    res.json({
      success: true,
      data: {
        meta: {
          class_id: classId,
          class_name: cls.class_name.trim(),
          date: dateParam
        },
        period: {
          schedule_id: period.schedule_id,
          period_id: period.period_id,
          subject_id: period.subject_id,
          subject_name: period.subject_name,
          start_time: period.start_time,
          end_time: period.end_time,
          is_submitted: period.is_submitted
        },
        summary_per_period: summaryPerPeriod,
        students
      }
    });

  } catch (error) {
    console.error('getClassStudents error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== HOMEROOM (WALI KELAS) ENDPOINTS ====================

/**
 * GET /api/teachers/homeroom/students
 *
 * Returns students in the homeroom class of the authenticated teacher,
 * with their attendance status for a given date (defaults to today).
 *
 * Optional query: ?date=YYYY-MM-DD
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 * Requires: Teacher must be wali_kelas of a class
 */
const getHomeroomStudents = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    // Find the class where this teacher is homeroom teacher
    const homeroomQuery = await pool.query(
      `SELECT id, ${classNameSQL('classes')} AS class_name, class AS grade, major
       FROM classes WHERE homeroom_teacher_id = $1 LIMIT 1`,
      [teacherId]
    );

    if (homeroomQuery.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda bukan wali kelas dari kelas manapun'
      });
    }

    const cls = homeroomQuery.rows[0];
    const classId = cls.id;
    const dateParam = req.query.date || null;
    // MySQL version: sc.date = ?  (no ::date cast)
    // PostgreSQL version: sc.date = $2::date
    const dateCondition = dateParam ? `sc.date = $2::date` : `sc.date = CURRENT_DATE`;
    const dateParams = dateParam ? [classId, dateParam] : [classId];

    const studentsQuery = `
      SELECT
        s.id AS student_id, s.nis, s.name AS student_name, s.gender, s.photo_profile,
        sa.id AS attendance_id, sa.status AS attendance_status, sa.source AS attendance_source,
        sa.check_in_time, sa.check_out_time,
        sad.description AS attendance_description, sad.approval_status
      FROM students s
      LEFT JOIN (
        SELECT sa2.* FROM student_attendances sa2
        INNER JOIN school_calendar sc ON sc.id = sa2.calendar_id AND ${dateCondition}
      ) sa ON sa.student_id = s.id
      LEFT JOIN student_attendance_details sad ON sad.attendance_id = sa.id
      WHERE s.class_id = $1
      ORDER BY s.name ASC
    `;

    const studentsResult = await pool.query(studentsQuery, dateParams);

    const students = studentsResult.rows.map(row => ({
      student_id: row.student_id, nis: row.nis, student_name: row.student_name,
      gender: row.gender, photo_profile: row.photo_profile || null,
      attendance: row.attendance_id ? {
        attendance_id: row.attendance_id, status: row.attendance_status,
        source: row.attendance_source, check_in_time: row.check_in_time,
        check_out_time: row.check_out_time,
        description: row.attendance_description || null,
        approval_status: row.approval_status || null,
      } : null
    }));

    const summary = {
      total: students.length,
      hadir: students.filter(s => s.attendance && s.attendance.status === 'hadir').length,
      sakit: students.filter(s => s.attendance && s.attendance.status === 'sakit').length,
      izin: students.filter(s => s.attendance && s.attendance.status === 'izin').length,
      alpa: students.filter(s => s.attendance && s.attendance.status === 'alpa').length,
      terlambat: students.filter(s => s.attendance && s.attendance.status === 'terlambat').length,
      belum_absen: students.filter(s => !s.attendance).length,
    };

    const displayDate = dateParam || localDateStr(new Date());

    res.json({
      success: true,
      message: `Ditemukan ${students.length} siswa di kelas ${cls.class_name.trim()}`,
      data: {
        class_id: classId, class_name: cls.class_name.trim(), grade: cls.grade, major: cls.major,
        date: displayDate,
        summary, students
      }
    });

  } catch (error) {
    console.error('getHomeroomStudents error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * PATCH /api/teachers/homeroom/attendance
 *
 * Allows the homeroom teacher (wali kelas) to update (or create) student
 * attendance status for their homeroom class.
 *
 * Body:
 * {
 *   "student_id": <number>,
 *   "status": "hadir" | "sakit" | "izin" | "alpa" | "terlambat",
 *   "description": <string>   (optional, reason/notes)
 * }
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 * Requires: Teacher must be wali_kelas of the student's class
 */
const updateHomeroomAttendance = async (req, res) => {
  const client = await pool.connect();
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const { student_id, status, description, date } = req.body;

    if (!student_id || !status) {
      return res.status(400).json({ success: false, message: 'student_id dan status harus diisi' });
    }

    const validStatuses = ['hadir', 'sakit', 'izin', 'alpa', 'terlambat'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status tidak valid. Gunakan: ${validStatuses.join(', ')}`
      });
    }

    // Verify teacher is homeroom of this student's class
    const homeroomCheck = await client.query(
      `SELECT c.id AS class_id FROM classes c
       INNER JOIN students s ON s.class_id = c.id
       WHERE c.homeroom_teacher_id = $1 AND s.id = $2`,
      [teacherId, student_id]
    );

    if (homeroomCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda bukan wali kelas dari siswa ini'
      });
    }

    const classId = homeroomCheck.rows[0].class_id;

    // Get calendar entry for the target date (today or specified date)
    // Wali kelas can update attendance for previous active days
    const calendarQuery = date
      ? await client.query(
          `SELECT id, status AS cal_status FROM school_calendar WHERE date = $1::date LIMIT 1`,
          [date]
        )
      : await client.query(
          `SELECT id, status AS cal_status FROM school_calendar WHERE date = CURRENT_DATE LIMIT 1`
        );

    if (date) {
      // Validate the date is not in the future
      const targetDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      targetDate.setHours(0, 0, 0, 0);
      if (targetDate > today) {
        return res.status(400).json({
          success: false,
          message: 'Tidak dapat mengubah kehadiran untuk tanggal di masa depan'
        });
      }
    }

    if (calendarQuery.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: date
          ? `Tanggal ${date} tidak terdaftar di kalender sekolah`
          : 'Hari ini tidak terdaftar di kalender sekolah'
      });
    }

    const calendarId = calendarQuery.rows[0].id;

    await client.query('BEGIN');

    // Check if attendance record already exists for today
    const existingQuery = await client.query(
      `SELECT id, status FROM student_attendances
       WHERE student_id = $1 AND calendar_id = $2`,
      [student_id, calendarId]
    );

    let attendanceId;
    let oldStatus = null;

    if (existingQuery.rows.length > 0) {
      // Update existing
      attendanceId = existingQuery.rows[0].id;
      oldStatus = existingQuery.rows[0].status;

      await client.query(
        `UPDATE student_attendances
         SET status = $1,
             source = 'wali_kelas',
             updated_by_role = 'wali_kelas',
             updated_by_teacher_id = $3,
             change_reason = $4,
             updated_at = NOW()
         WHERE id = $2`,
        [status, attendanceId, teacherId, description || null]
      );
    } else {
      // Create new attendance record
      // MySQL version (commented out — uses insertId from ResultSetHeader):
      // const insertResult = await client.query(
      //   `INSERT INTO student_attendances (student_id, class_id, calendar_id, status, source, created_at, updated_at)
      //    VALUES (?, ?, ?, ?, 'wali_kelas', NOW(), NOW())`,
      //   [student_id, classId, calendarId, status]
      // );
      // attendanceId = insertResult.insertId;
      //
      // PostgreSQL version: RETURNING id
      const insertResult = await client.query(
        `INSERT INTO student_attendances
         (student_id, class_id, calendar_id, status, source, updated_by_role, updated_by_teacher_id, change_reason, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'wali_kelas', 'wali_kelas', $5, $6, NOW(), NOW())
         RETURNING id`,
        [student_id, classId, calendarId, status, teacherId, description || null]
      );
      attendanceId = insertResult.rows[0].id;
    }

    // Handle attendance details (description/reason)
    if (description) {
      const detailCheck = await client.query(
        'SELECT id FROM student_attendance_details WHERE attendance_id = $1',
        [attendanceId]
      );

      if (detailCheck.rows.length > 0) {
        await client.query(
          `UPDATE student_attendance_details SET status = $1, description = $2, approved_by = $3, approval_status = 'approved', updated_at = NOW()
           WHERE attendance_id = $4`,
          [status, description, teacherId, attendanceId]
        );
      } else {
        await client.query(
          `INSERT INTO student_attendance_details (attendance_id, status, description, approved_by, approval_status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'approved', NOW(), NOW())`,
          [attendanceId, status, description, teacherId]
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: oldStatus
        ? `Status kehadiran siswa berhasil diubah dari ${oldStatus} ke ${status}`
        : `Status kehadiran siswa berhasil ditambahkan: ${status}`,
      data: {
        attendance_id: attendanceId,
        student_id,
        old_status: oldStatus,
        new_status: status,
        source: 'wali_kelas',
        description: description || null,
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('updateHomeroomAttendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// ==================== HOMEROOM APPROVAL ENDPOINTS ====================

/**
 * GET /api/teachers/homeroom-classes
 *
 * Returns the classes where the authenticated teacher is the homeroom teacher (wali kelas).
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 */
const getHomeroomClasses = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const result = await pool.query(
      `SELECT id AS class_id, ${classNameSQL('classes')} AS class_name, class AS grade, major
       FROM classes WHERE homeroom_teacher_id = $1
       ORDER BY class ASC, major ASC`,
      [teacherId]
    );

    res.json({
      success: true,
      message: `Ditemukan ${result.rows.length} kelas wali`,
      data: result.rows.map(row => ({
        class_id: row.class_id,
        class_name: row.class_name.trim(),
        grade: row.grade,
        major: row.major
      }))
    });
  } catch (error) {
    console.error('getHomeroomClasses error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/teachers/homeroom/pending?class_id=<id>
 *
 * Returns pending attendance detail records for a homeroom class.
 * These are records where approval_status = 'pending' and the attendance
 * belongs to a student in the homeroom class.
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 * Requires: Teacher must be wali_kelas of the class
 */
const getPendingAttendances = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    let classId = req.query.class_id ? parseInt(req.query.class_id) : null;

    // If no class_id provided, auto-detect from homeroom
    if (!classId) {
      const homeroomQuery = await pool.query(
        'SELECT id FROM classes WHERE homeroom_teacher_id = $1 LIMIT 1',
        [teacherId]
      );
      if (homeroomQuery.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Anda bukan wali kelas dari kelas manapun'
        });
      }
      classId = homeroomQuery.rows[0].id;
    }

    // Verify teacher is homeroom of this class
    const homeroomCheck = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND homeroom_teacher_id = $2',
      [classId, teacherId]
    );

    if (homeroomCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda bukan wali kelas dari kelas ini'
      });
    }

    // Get all pending attendance details for students in this class
    const query = `
      SELECT
        sad.id AS detail_id,
        lc.class_period_id AS period_id,
        scd.subject_id,
        scd.schedule_id,
        cp.start_time,
        cp.end_time,
        sa.class_id,
        sa.student_id,
        s.nis,
        s.name AS student_name,
        s.photo_profile AS student_photo,
        sc.date::text AS date,
        sad.status,
        sad.description AS reason,
        sad.evidence_url,
        sad.approval_status,
        sad.created_at
      FROM student_attendance_details sad
      INNER JOIN student_attendances sa ON sa.id = sad.attendance_id
      INNER JOIN students s ON s.id = sa.student_id
      LEFT JOIN school_calendar sc ON sc.id = sa.calendar_id
      LEFT JOIN LATERAL (
        SELECT asc2.class_period_id
        FROM attendance_status_changes asc2
        WHERE asc2.attendance_id = sa.id
          AND asc2.class_period_id IS NOT NULL
        ORDER BY asc2.created_at DESC
        LIMIT 1
      ) lc ON TRUE
      LEFT JOIN class_periods cp ON cp.id = lc.class_period_id
      LEFT JOIN LATERAL (
        SELECT ts1.id AS schedule_id, ts1.subject_id
        FROM teacher_schedules ts1
        WHERE ts1.class_id = sa.class_id
          AND ts1.class_period_id = lc.class_period_id
        ORDER BY ts1.id ASC
        LIMIT 1
      ) scd ON TRUE
      WHERE sa.class_id = $1
        AND sad.approval_status = 'pending'
      ORDER BY sad.created_at DESC
    `;

    const result = await pool.query(query, [classId]);

    res.json({
      success: true,
      message: `Ditemukan ${result.rows.length} laporan menunggu konfirmasi`,
      data: result.rows
    });
  } catch (error) {
    console.error('getPendingAttendances error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * POST /api/teachers/homeroom/attendance/:detailId/approve
 *
 * Approves a pending attendance detail. Updates the detail's approval_status to 'approved',
 * sets approved_by and approved_at, and then updates the student_attendances.status
 * to the requested status from the detail.
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 * Requires: Teacher must be wali_kelas of the student's class
 */
const approveAttendance = async (req, res) => {
  const client = await pool.connect();
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const detailId = parseInt(req.params.detailId);
    if (!detailId || isNaN(detailId)) {
      return res.status(400).json({ success: false, message: 'detail_id tidak valid' });
    }

    // Get the detail record with attendance and student info
    const detailQuery = await client.query(
      `SELECT sad.id, sad.attendance_id, sad.status AS requested_status, sad.approval_status,
              sa.student_id, sa.class_id, sa.status AS current_attendance_status
       FROM student_attendance_details sad
       INNER JOIN student_attendances sa ON sa.id = sad.attendance_id
       WHERE sad.id = $1`,
      [detailId]
    );

    if (detailQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Detail tidak ditemukan' });
    }

    const detail = detailQuery.rows[0];

    if (detail.approval_status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Detail ini sudah di-${detail.approval_status}, tidak bisa diubah lagi`
      });
    }

    // Verify teacher is homeroom of this student's class
    const homeroomCheck = await client.query(
      'SELECT id FROM classes WHERE id = $1 AND homeroom_teacher_id = $2',
      [detail.class_id, teacherId]
    );

    if (homeroomCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda bukan wali kelas dari siswa ini'
      });
    }

    await client.query('BEGIN');

    // Update detail: approved
    await client.query(
      `UPDATE student_attendance_details
       SET approval_status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [teacherId, detailId]
    );

    // Update attendance status to the requested status
    await client.query(
      `UPDATE student_attendances
       SET status = $1,
           source = 'wali_kelas',
           updated_by_role = 'wali_kelas',
           updated_by_teacher_id = $3,
           change_reason = $4,
           updated_at = NOW()
       WHERE id = $2`,
      [detail.requested_status, detail.attendance_id, teacherId, 'Disetujui wali_kelas dari pengajuan pending']
    );

    // Log the status change
    try {
      const studentQuery = await client.query('SELECT name FROM students WHERE id = $1', [detail.student_id]);
      const teacherQuery = await client.query('SELECT name FROM teachers WHERE id = $1', [teacherId]);

      await client.query(
        `INSERT INTO attendance_status_changes
         (attendance_id, student_id, old_status, new_status, changed_by_type, changed_by_id, changed_by_name, note, created_at)
         VALUES ($1, $2, $3, $4, 'wali_kelas', $5, $6, $7, NOW())`,
        [
          detail.attendance_id,
          detail.student_id,
          detail.current_attendance_status,
          detail.requested_status,
          teacherId,
          teacherQuery.rows[0]?.name || 'Wali Kelas',
          `Disetujui oleh wali kelas`
        ]
      );
    } catch (logError) {
      console.error('Warning: failed to log status change:', logError.message);
      // Don't fail the whole transaction for a logging error
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Status kehadiran disetujui: ${detail.requested_status}`,
      data: {
        detail_id: detailId,
        attendance_id: detail.attendance_id,
        student_id: detail.student_id,
        old_status: detail.current_attendance_status,
        new_status: detail.requested_status,
        approval_status: 'approved'
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('approveAttendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * POST /api/teachers/homeroom/attendance/:detailId/reject
 *
 * Rejects a pending attendance detail. Updates the detail's approval_status to 'rejected',
 * sets approved_by and approved_at. The student_attendances.status stays unchanged (remains 'alpa').
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 * Requires: Teacher must be wali_kelas of the student's class
 */
const rejectAttendance = async (req, res) => {
  const client = await pool.connect();
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const detailId = parseInt(req.params.detailId);
    if (!detailId || isNaN(detailId)) {
      return res.status(400).json({ success: false, message: 'detail_id tidak valid' });
    }

    // Get the detail record
    const detailQuery = await client.query(
      `SELECT sad.id, sad.attendance_id, sad.status AS requested_status, sad.approval_status,
              sa.student_id, sa.class_id, sa.status AS current_attendance_status
       FROM student_attendance_details sad
       INNER JOIN student_attendances sa ON sa.id = sad.attendance_id
       WHERE sad.id = $1`,
      [detailId]
    );

    if (detailQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Detail tidak ditemukan' });
    }

    const detail = detailQuery.rows[0];

    if (detail.approval_status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Detail ini sudah di-${detail.approval_status}, tidak bisa diubah lagi`
      });
    }

    // Verify teacher is homeroom of this student's class
    const homeroomCheck = await client.query(
      'SELECT id FROM classes WHERE id = $1 AND homeroom_teacher_id = $2',
      [detail.class_id, teacherId]
    );

    if (homeroomCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda bukan wali kelas dari siswa ini'
      });
    }

    await client.query('BEGIN');

    // Update detail: rejected
    await client.query(
      `UPDATE student_attendance_details
       SET approval_status = 'rejected', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [teacherId, detailId]
    );

    // Log the rejection
    try {
      const teacherQuery = await client.query('SELECT name FROM teachers WHERE id = $1', [teacherId]);

      await client.query(
        `INSERT INTO attendance_status_changes
         (attendance_id, student_id, old_status, new_status, changed_by_type, changed_by_id, changed_by_name, note, created_at)
         VALUES ($1, $2, $3, $4, 'wali_kelas', $5, $6, $7, NOW())`,
        [
          detail.attendance_id,
          detail.student_id,
          detail.current_attendance_status,
          detail.current_attendance_status, // status stays the same
          teacherId,
          teacherQuery.rows[0]?.name || 'Wali Kelas',
          `Ditolak oleh wali kelas (permintaan: ${detail.requested_status})`
        ]
      );
    } catch (logError) {
      console.error('Warning: failed to log rejection:', logError.message);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Permintaan status ${detail.requested_status} ditolak`,
      data: {
        detail_id: detailId,
        attendance_id: detail.attendance_id,
        student_id: detail.student_id,
        status: detail.current_attendance_status,
        approval_status: 'rejected'
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('rejectAttendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

/**
 * GET /api/teachers/homeroom/period-monitor?class_id=<id>&date=YYYY-MM-DD
 *
 * Homeroom teacher monitoring view per period for a specific class and date.
 */
const getHomeroomPeriodMonitor = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || Number.isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const classId = toPositiveInt(req.query.class_id);
    const dateParam = req.query.date;

    if (!classId) {
      return res.status(400).json({ success: false, message: 'class_id harus berupa angka positif yang valid' });
    }
    if (!dateParam || !isValidDateString(dateParam)) {
      return res.status(400).json({ success: false, message: 'date wajib diisi dengan format YYYY-MM-DD' });
    }

    const homeroomCheck = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND homeroom_teacher_id = $2 LIMIT 1',
      [classId, teacherId]
    );

    if (homeroomCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Anda bukan wali kelas dari kelas ini' });
    }

    const dayName = getDayNameIdFromDate(dateParam);
    if (!dayName || dayName === 'minggu' || dayName === 'sabtu') {
      return res.json({ success: true, data: [] });
    }

    const periodsResult = await pool.query(
      `SELECT
         ts.id AS schedule_id,
         ts.class_period_id AS period_id,
         ts.subject_id,
         subj.name AS subject_name,
         cp.start_time,
         cp.end_time,
         cp.sequence
       FROM teacher_schedules ts
       INNER JOIN class_periods cp ON cp.id = ts.class_period_id
       LEFT JOIN subjects subj ON subj.id = ts.subject_id
       WHERE ts.class_id = $1
         AND cp.day = $2
       ORDER BY cp.sequence ASC, ts.id ASC`,
      [classId, dayName]
    );

    const periodRows = periodsResult.rows;
    if (periodRows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const summaryQuery = `
      WITH class_students AS (
        SELECT s.id AS student_id
        FROM students s
        WHERE s.class_id = $1
      ),
      attendance_base AS (
        SELECT
          cs.student_id,
          sa.id AS attendance_id,
          sa.status AS base_status
        FROM class_students cs
        LEFT JOIN LATERAL (
          SELECT sa2.id, sa2.status
          FROM student_attendances sa2
          INNER JOIN school_calendar sc2 ON sc2.id = sa2.calendar_id
          WHERE sa2.student_id = cs.student_id
            AND sa2.class_id = $1
            AND sc2.date = $2::date
          ORDER BY sa2.updated_at DESC NULLS LAST, sa2.id DESC
          LIMIT 1
        ) sa ON TRUE
      ),
      effective_statuses AS (
        SELECT
          ab.student_id,
          COALESCE(
            (
              SELECT asc2.new_status
              FROM attendance_status_changes asc2
              WHERE asc2.attendance_id = ab.attendance_id
                AND asc2.class_period_id = $3
              ORDER BY asc2.created_at DESC
              LIMIT 1
            ),
            ab.base_status
          ) AS effective_status
        FROM attendance_base ab
      )
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN effective_status = 'hadir' THEN 1 ELSE 0 END), 0)::int AS hadir,
        COALESCE(SUM(CASE WHEN effective_status = 'sakit' THEN 1 ELSE 0 END), 0)::int AS sakit,
        COALESCE(SUM(CASE WHEN effective_status = 'izin' THEN 1 ELSE 0 END), 0)::int AS izin,
        COALESCE(SUM(CASE WHEN effective_status = 'alpa' THEN 1 ELSE 0 END), 0)::int AS alpa,
        COALESCE(SUM(CASE WHEN effective_status = 'terlambat' THEN 1 ELSE 0 END), 0)::int AS terlambat,
        COALESCE(SUM(CASE WHEN effective_status IS NULL THEN 1 ELSE 0 END), 0)::int AS belum_absen
      FROM effective_statuses
    `;

    const monitorRows = await Promise.all(periodRows.map(async (period) => {
      const summaryResult = await pool.query(summaryQuery, [classId, dateParam, period.period_id]);
      const summary = summaryResult.rows[0];

      return {
        period: {
          schedule_id: period.schedule_id,
          period_id: period.period_id,
          subject_id: period.subject_id,
          subject_name: period.subject_name,
          start_time: period.start_time,
          end_time: period.end_time
        },
        summary: {
          total: Number(summary.total) || 0,
          hadir: Number(summary.hadir) || 0,
          sakit: Number(summary.sakit) || 0,
          izin: Number(summary.izin) || 0,
          alpa: Number(summary.alpa) || 0,
          terlambat: Number(summary.terlambat) || 0,
          belum_absen: Number(summary.belum_absen) || 0
        }
      };
    }));

    return res.json({ success: true, data: monitorRows });
  } catch (error) {
    console.error('getHomeroomPeriodMonitor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * PATCH /api/teachers/attendance/:attendanceId
 *
 * Update attendance with explicit period/schedule context to avoid ambiguous edits.
 */
const updateTeacherAttendanceWithPeriodContext = async (req, res) => {
  const client = await pool.connect();
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || Number.isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const attendanceId = toPositiveInt(req.params.attendanceId);
    if (!attendanceId) {
      return res.status(400).json({ success: false, message: 'attendanceId harus berupa angka positif yang valid' });
    }

    const {
      schedule_id,
      period_id,
      status,
      description,
      approval_status,
      change_reason
    } = req.body || {};

    const scheduleId = toPositiveInt(schedule_id);
    const periodId = toPositiveInt(period_id);

    if (!scheduleId || !periodId) {
      return res.status(400).json({
        success: false,
        message: 'schedule_id dan period_id wajib diisi dan harus berupa angka positif'
      });
    }

    if (status !== undefined && !ATTENDANCE_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status tidak valid. Gunakan: ${ATTENDANCE_STATUSES.join(', ')}`
      });
    }

    if (approval_status !== undefined && !APPROVAL_STATUSES.includes(approval_status)) {
      return res.status(400).json({
        success: false,
        message: `approval_status tidak valid. Gunakan: ${APPROVAL_STATUSES.join(', ')}`
      });
    }

    await client.query('BEGIN');

    const attendanceResult = await client.query(
      `SELECT id, student_id, class_id, status
       FROM student_attendances
       WHERE id = $1
       LIMIT 1`,
      [attendanceId]
    );

    if (attendanceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Attendance tidak ditemukan' });
    }

    const attendance = attendanceResult.rows[0];

    const scheduleResult = await client.query(
      `SELECT id, class_id, class_period_id, subject_id
       FROM teacher_schedules
       WHERE id = $1
         AND class_period_id = $2
         AND teacher_id = $3
       LIMIT 1`,
      [scheduleId, periodId, teacherId]
    );

    if (scheduleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak: schedule_id/period_id tidak sesuai dengan jadwal mengajar Anda'
      });
    }

    const schedule = scheduleResult.rows[0];
    if (Number(schedule.class_id) !== Number(attendance.class_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Context period/schedule tidak sesuai dengan class pada attendance ini'
      });
    }

    const oldStatus = attendance.status;
    const nextStatus = status || oldStatus;

    const updateAttendance = await client.query(
      `UPDATE student_attendances
       SET status = $1,
           source = 'guru_pengajar',
           updated_by_role = 'guru_pengajar',
           updated_by_teacher_id = $2,
           change_reason = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [nextStatus, teacherId, change_reason || description || null, attendanceId]
    );

    let detailRow = null;
    if (['sakit', 'izin', 'alpa', 'terlambat'].includes(nextStatus)) {
      const nextApprovalStatus = approval_status || 'approved';
      const approvedBy = nextApprovalStatus === 'approved' ? teacherId : null;

      const detailResult = await client.query(
        `INSERT INTO student_attendance_details
         (attendance_id, status, description, approval_status, approved_by, approved_at, created_at, updated_at)
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           CASE WHEN $4 = 'approved' THEN NOW() ELSE NULL END,
           NOW(),
           NOW()
         )
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           description = VALUES(description),
           approval_status = VALUES(approval_status),
           approved_by = VALUES(approved_by),
           approved_at = VALUES(approved_at),
           updated_at = NOW()
         RETURNING *`,
        [attendanceId, nextStatus, description || null, nextApprovalStatus, approvedBy]
      );
      detailRow = detailResult.rows[0];
    }

    const teacherResult = await client.query('SELECT name FROM teachers WHERE id = $1 LIMIT 1', [teacherId]);
    const teacherName = teacherResult.rows[0] ? teacherResult.rows[0].name : 'Guru Pengajar';

    await client.query(
      `INSERT INTO attendance_status_changes
       (attendance_id, student_id, class_period_id, old_status, new_status,
        changed_by_type, changed_by_id, changed_by_name, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'guru_pengajar', $6, $7, $8, NOW(), NOW())`,
      [
        attendanceId,
        attendance.student_id,
        periodId,
        oldStatus,
        nextStatus,
        teacherId,
        teacherName,
        change_reason || description || null
      ]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Attendance berhasil diperbarui dengan context period/schedule',
      data: {
        attendance: updateAttendance.rows[0],
        detail: detailRow,
        period_context: {
          schedule_id: schedule.id,
          period_id: schedule.class_period_id,
          subject_id: schedule.subject_id
        }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('updateTeacherAttendanceWithPeriodContext error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getTeacherClasses,
  getClassStudents,
  getHomeroomStudents,
  getHomeroomPeriodMonitor,
  updateTeacherAttendanceWithPeriodContext,
  updateHomeroomAttendance,
  getHomeroomClasses,
  getPendingAttendances,
  approveAttendance,
  rejectAttendance
};
