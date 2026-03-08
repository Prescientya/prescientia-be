const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireStudent, requireAuth } = require('../middlewares/auth.middleware');

// GET student attendance summary (used by prescientia_fe)
// GET /api/student-attendance-summary/:studentId
router.get('/:studentId', requireAuth, async (req, res) => {
  try {
    const { studentId } = req.params;

    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Student ID harus diisi' });
    }

    // Count attendance by status
    const attendanceQuery = `
      SELECT
        sa.status,
        COUNT(*) as count
      FROM student_attendances sa
      LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
      WHERE sa.student_id = $1
        AND (sc.status IS NULL OR sc.status != 'libur')
      GROUP BY sa.status
    `;
    const attendanceResult = await pool.query(attendanceQuery, [studentId]);

    // Count effective school days (aktif days in calendar)
    const effectiveDaysQuery = `
      SELECT COUNT(*) as total_days_effective
      FROM school_calendar
      WHERE status = 'aktif'
    `;
    const effectiveDaysResult = await pool.query(effectiveDaysQuery);

    // Count holidays
    const holidaysQuery = `
      SELECT COUNT(*) as total_holidays
      FROM school_calendar
      WHERE status = 'libur'
    `;
    const holidaysResult = await pool.query(holidaysQuery);

    // Build summary from attendance counts
    let totalPresent = 0, totalSick = 0, totalPermission = 0, totalAbsent = 0;

    for (const row of attendanceResult.rows) {
      const status = (row.status || '').toLowerCase();
      const count = parseInt(row.count) || 0;
      if (status === 'hadir') totalPresent = count;
      else if (status === 'sakit') totalSick = count;
      else if (status === 'izin') totalPermission = count;
      else if (status === 'alpa' || status === 'alpha') totalAbsent = count;
    }

    const totalDaysEffective = parseInt(effectiveDaysResult.rows[0].total_days_effective) || 0;
    const totalHolidays = parseInt(holidaysResult.rows[0].total_holidays) || 0;

    res.json({
      success: true,
      data: {
        student_id: parseInt(studentId),
        total_present: totalPresent,
        total_hadir: totalPresent,
        total_sick: totalSick,
        total_sakit: totalSick,
        total_permission: totalPermission,
        total_izin: totalPermission,
        total_absent: totalAbsent,
        total_alpha: totalAbsent,
        total_days_effective: totalDaysEffective,
        total_holidays: totalHolidays,
        total_libur: totalHolidays
      }
    });
  } catch (error) {
    console.error('Error fetching student attendance summary:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil summary kehadiran siswa', error: error.message });
  }
});

module.exports = router;
