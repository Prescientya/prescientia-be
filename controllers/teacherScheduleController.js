const pool = require('../config/database');

/**
 * Helper: convert numeric grade (10/11/12) to Roman numeral string used in class names.
 * Used inside SQL CASE expressions and in JS formatting.
 */
function gradeToRoman(grade) {
  switch (Number(grade)) {
    case 10: return 'X';
    case 11: return 'XI';
    case 12: return 'XII';
    default: return String(grade);
  }
}

/**
 * SQL fragment: formats class name as "X RPL 1" (Roman grade + major).
 * @param {string} classAlias - table alias for the classes table (e.g. 'c')
 *
 * Uses CONCAT() for MySQL compatibility.
 */
function classNameSQL(classAlias) {
  return `CONCAT(CASE ${classAlias}.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
           ELSE ${classAlias}.class END, ' ', COALESCE(${classAlias}.major, ''))`;
}


/**
 * POST /api/teachers/submit-period
 *
 * Teacher submits evidence of teaching for a specific period TODAY.
 * Uses UPSERT so the same period can be re-submitted each week
 * (the unique DB constraint has no date, so we overwrite the last record).
 *
 * Body:
 * {
 *   "class_id":   <number>   (required)
 *   "subject_id": <number>   (required)
 *   "period_id":  <number>   (required)
 *   "photo_url":  <string>   (required)
 *   "is_present": <boolean>  (optional, default true)
 * }
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 */
const submitTeacherPeriod = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: teacher_id tidak ditemukan di token'
      });
    }

    const { class_id, subject_id, period_id, photo_url, is_present = true } = req.body;

    if (!class_id || !subject_id || !period_id) {
      return res.status(400).json({
        success: false,
        message: 'class_id, subject_id, dan period_id harus diisi'
      });
    }

    // photo_url is now optional (simplified submit without photo)
    const photoValue = (photo_url && typeof photo_url === 'string' && photo_url.trim() !== '')
      ? photo_url.trim()
      : null;

    // Derive today's day name in Indonesian
    const daysIndonesian = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const todayDay = daysIndonesian[new Date().getDay()];

    if (todayDay === 'minggu' || todayDay === 'sabtu') {
      return res.status(400).json({ success: false, message: 'Tidak dapat submit absensi pada hari libur' });
    }

    // Validate that teacher actually has this period scheduled today
    const scheduleCheck = await pool.query(
      `SELECT id FROM teacher_class_schedules
       WHERE teacher_id = $1 AND class_id = $2
         AND subject_id = $3 AND period_id = $4
         AND day = $5
       LIMIT 1`,
      [teacherId, class_id, subject_id, period_id, todayDay]
    );

    if (scheduleCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki jadwal mengajar untuk periode ini hari ini'
      });
    }

    // Validate time window: teacher can only submit during the period time
    const periodTimeCheck = await pool.query(
      `SELECT cp.start_time, cp.end_time
       FROM class_periods cp
       WHERE cp.id = $1 AND cp.day = $2
       LIMIT 1`,
      [period_id, todayDay]
    );

    if (periodTimeCheck.rows.length > 0) {
      const currentTime = new Date().toTimeString().slice(0, 8); // HH:MM:SS
      const { start_time, end_time } = periodTimeCheck.rows[0];
      if (currentTime < start_time || currentTime > end_time) {
        return res.status(400).json({
          success: false,
          message: `Anda hanya dapat submit kehadiran saat jam pelajaran berlangsung (${start_time} - ${end_time})`
        });
      }
    }

    // Check today's school calendar is active
    const calendarCheck = await pool.query(
      `SELECT id, status FROM school_calendar WHERE date = CURRENT_DATE LIMIT 1`
    );
    if (calendarCheck.rows.length === 0 || calendarCheck.rows[0].status === 'libur') {
      return res.status(400).json({ success: false, message: 'Tidak dapat submit absensi pada hari libur kalender' });
    }

    // MySQL version (commented out — ON DUPLICATE KEY UPDATE):
    /*
    const upsertQuery = `
      INSERT INTO submit_teacher_periods
        (teacher_id, class_id, subject_id, period_id, day, photo_url, is_present, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        photo_url    = VALUES(photo_url),
        is_present   = VALUES(is_present),
        submitted_at = NOW(),
        updated_at   = NOW()
    `;
    await pool.query(upsertQuery, [
      teacherId, class_id, subject_id, period_id, todayDay,
      photo_url.trim(), Boolean(is_present)
    ]);
    const result = await pool.query(
      `SELECT * FROM submit_teacher_periods
       WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND period_id = ? AND day = ?
       LIMIT 1`,
      [teacherId, class_id, subject_id, period_id, todayDay]
    );
    */

    // PostgreSQL version: ON CONFLICT + RETURNING *
    const upsertQuery = `
      INSERT INTO submit_teacher_periods
        (teacher_id, class_id, subject_id, period_id, day, photo_url, is_present, submitted_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
      ON CONFLICT (teacher_id, class_id, subject_id, period_id, day)
      DO UPDATE SET
        photo_url    = EXCLUDED.photo_url,
        is_present   = EXCLUDED.is_present,
        submitted_at = NOW(),
        updated_at   = NOW()
      RETURNING *
    `;
    const result = await pool.query(upsertQuery, [
      teacherId, class_id, subject_id, period_id, todayDay,
      photoValue, Boolean(is_present)
    ]);

    res.status(200).json({
      success: true,
      message: 'Absensi periode berhasil disubmit',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('submitTeacherPeriod error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/teachers/schedule/classes
 *
 * Returns ALL classes taught by the authenticated teacher (from teacher_schedules),
 * grouped by class → subject → schedule days.
 * Day info is derived from class_periods.day.
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 */
const getScheduleClasses = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: teacher_id tidak ditemukan di token'
      });
    }

    const query = `
      SELECT
        ts.class_id,
        ${classNameSQL('c')} AS class_name,
        c.class  AS grade,
        c.major,
        ts.subject_id,
        s.name   AS subject_name,
        cp.day,
        cp.id    AS period_id,
        cp.start_time,
        cp.end_time,
        cp.sequence,
        cp.activity_type
      FROM teacher_schedules ts
      INNER JOIN classes      c  ON c.id  = ts.class_id
      INNER JOIN subjects     s  ON s.id  = ts.subject_id
      INNER JOIN class_periods cp ON cp.id = ts.class_period_id
      WHERE ts.teacher_id = $1
      ORDER BY
        ts.class_id ASC,
        ts.subject_id ASC,
        CASE cp.day
          WHEN 'senin'  THEN 1 WHEN 'selasa' THEN 2 WHEN 'rabu'   THEN 3
          WHEN 'kamis'  THEN 4 WHEN 'jumat'  THEN 5 ELSE 6
        END,
        cp.sequence ASC
    `;

    const result = await pool.query(query, [teacherId]);

    // Group: class → subject → schedule (days + times)
    const classesMap = new Map();
    result.rows.forEach(row => {
      if (!classesMap.has(row.class_id)) {
        classesMap.set(row.class_id, {
          class_id: row.class_id,
          class_name: row.class_name.trim(),
          grade: row.grade,
          major: row.major,
          subjects: new Map()
        });
      }
      const cls = classesMap.get(row.class_id);

      if (!cls.subjects.has(row.subject_id)) {
        cls.subjects.set(row.subject_id, {
          subject_id: row.subject_id,
          subject_name: row.subject_name,
          schedule: []
        });
      }
      cls.subjects.get(row.subject_id).schedule.push({
        period_id: row.period_id,
        day: row.day,
        sequence: row.sequence,
        start_time: row.start_time,
        end_time: row.end_time,
        activity_type: row.activity_type
      });
    });

    const classes = Array.from(classesMap.values()).map(c => ({
      class_id: c.class_id,
      class_name: c.class_name,
      grade: c.grade,
      major: c.major,
      subjects: Array.from(c.subjects.values()).map(sub => ({
        ...sub,
        total_periods: sub.schedule.length
      }))
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
    console.error('getScheduleClasses error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/teachers/schedule/today
 *
 * Returns the teacher's schedule for TODAY from teacher_schedules,
 * with submission status and holiday guard via school_calendar.
 *
 * Requires: Authorization: Bearer <teacher-JWT>
 */
const getScheduleToday = async (req, res) => {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: teacher_id tidak ditemukan di token'
      });
    }

    const daysIndonesian = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const todayDay = daysIndonesian[new Date().getDay()];

    if (todayDay === 'minggu' || todayDay === 'sabtu') {
      return res.json({
        success: true,
        message: 'Tidak ada jadwal mengajar pada hari ini',
        data: { day: todayDay, teacher_id: teacherId, calendar: null, schedules: [] }
      });
    }

    // Check today's school calendar
    const calendarResult = await pool.query(
      `SELECT id, date, status, notes FROM school_calendar WHERE date = CURRENT_DATE LIMIT 1`
    );

    if (calendarResult.rows.length === 0) {
      return res.json({
        success: true,
        message: 'Hari ini tidak terdaftar di kalender sekolah',
        data: { day: todayDay, teacher_id: teacherId, calendar: null, schedules: [] }
      });
    }

    const calendarRow = calendarResult.rows[0];
    if (calendarRow.status === 'libur') {
      return res.json({
        success: true,
        message: `Hari ini adalah hari libur${calendarRow.notes ? ': ' + calendarRow.notes : ''}`,
        data: {
          day: todayDay,
          teacher_id: teacherId,
          calendar: { id: calendarRow.id, date: calendarRow.date, status: calendarRow.status, notes: calendarRow.notes },
          schedules: []
        }
      });
    }

    const scheduleQuery = `
      SELECT
        ts.id        AS schedule_id,
        ts.class_id,
        ${classNameSQL('c')} AS class_name,
        c.class  AS grade,
        c.major,
        ts.subject_id,
        s.name   AS subject_name,
        cp.id    AS period_id,
        cp.start_time,
        cp.end_time,
        cp.sequence,
        cp.activity_type,
        EXISTS (
          SELECT 1
          FROM submit_teacher_periods stp
          WHERE stp.teacher_id  = ts.teacher_id
            AND stp.class_id    = ts.class_id
            AND stp.subject_id  = ts.subject_id
            AND stp.period_id   = ts.class_period_id
            AND stp.day         = cp.day
            AND DATE(CONVERT_TZ(stp.submitted_at, '+00:00', '+07:00')) = CURDATE()
        ) AS is_submitted
      FROM teacher_schedules ts
      INNER JOIN classes      c  ON c.id  = ts.class_id
      INNER JOIN subjects     s  ON s.id  = ts.subject_id
      INNER JOIN class_periods cp ON cp.id = ts.class_period_id
      WHERE ts.teacher_id = $1
        AND cp.day = $2
      ORDER BY cp.sequence ASC, ts.class_id ASC
    `;

    const scheduleResult = await pool.query(scheduleQuery, [teacherId, todayDay]);

    const schedules = scheduleResult.rows.map(row => ({
      schedule_id: row.schedule_id,
      class_id: row.class_id,
      class_name: row.class_name.trim(),
      grade: row.grade,
      major: row.major,
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      period_id: row.period_id,
      start_time: row.start_time,
      end_time: row.end_time,
      sequence: row.sequence,
      activity_type: row.activity_type,
      is_submitted: row.is_submitted
    }));

    res.json({
      success: true,
      message: `Ditemukan ${schedules.length} jadwal mengajar hari ${todayDay}`,
      data: {
        day: todayDay,
        teacher_id: teacherId,
        calendar: {
          id: calendarRow.id,
          date: calendarRow.date,
          status: calendarRow.status,
          notes: calendarRow.notes
        },
        total_schedules: schedules.length,
        schedules
      }
    });

  } catch (error) {
    console.error('getScheduleToday error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  submitTeacherPeriod,
  getScheduleClasses,
  getScheduleToday
};

