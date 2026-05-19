const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireStudent, requireAuth } = require('../middlewares/auth.middleware');
const { readLimiter } = require('../middlewares/rateLimiter');

// SECURITY: cegah IDOR — siswa hanya boleh melihat ringkasan dirinya sendiri.
// Guru & admin tetap dibolehkan akses lintas-siswa (monitoring).
// Sebelumnya endpoint hanya pakai `requireAuth` sehingga siswa A bisa pass
// studentId siswa B di URL dan dapat data orang lain.
const ensureSummaryAccess = (req, res, studentId) => {
  const u = req.user || {};
  if (u.user_type === 'student') {
    if (String(u.student_id) !== String(studentId)) {
      res.status(403).json({ success: false, message: 'Akses terlarang: tidak boleh melihat ringkasan siswa lain' });
      return false;
    }
  }
  return true;
};

const parsePeriodQuery = (req) => {
  const { year, month } = req.query;

  // If neither provided, caller can treat as all-time.
  if (year == null && month == null) return { hasPeriod: false };

  if (year == null || month == null) {
    return { error: 'Query year dan month harus diisi bersamaan' };
  }

  const yearNum = Number(year);
  const monthNum = Number(month);

  if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum)) {
    return { error: 'year dan month harus berupa angka bulat' };
  }
  if (monthNum < 1 || monthNum > 12) {
    return { error: 'month harus di rentang 1-12' };
  }

  return { hasPeriod: true, year: yearNum, month: monthNum };
};

const buildAttendanceSummary = async ({ studentId, year, month }) => {
  const hasPeriod = year != null && month != null;

  const params = [studentId];
  let paramIndex = 2;

  let whereSql = `
    WHERE sa.student_id = $1
      AND (sc.status IS NULL OR sc.status != 'libur')
  `;

  if (hasPeriod) {
    whereSql += ` AND sc.year = $${paramIndex} AND sc.month = $${paramIndex + 1}`;
    params.push(year, month);
    paramIndex += 2;
  }

  const attendanceQuery = `
    SELECT
      COALESCE(SUM(CASE WHEN LOWER(sa.status) IN ('hadir', 'terlambat') THEN 1 ELSE 0 END), 0)::int AS total_present,
      COALESCE(SUM(CASE WHEN LOWER(sa.status) = 'sakit' THEN 1 ELSE 0 END), 0)::int AS total_sick,
      COALESCE(SUM(CASE WHEN LOWER(sa.status) = 'izin' THEN 1 ELSE 0 END), 0)::int AS total_permission,
      COALESCE(SUM(CASE WHEN LOWER(sa.status) = 'alpa' THEN 1 ELSE 0 END), 0)::int AS total_absent
    FROM student_attendances sa
    LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
    ${whereSql}
  `;

  const daysParams = [];
  let daysWhereSql = '';
  if (hasPeriod) {
    daysWhereSql = ' AND year = $1 AND month = $2';
    daysParams.push(year, month);
  }

  const effectiveDaysQuery = `
    SELECT COUNT(*)::int as total_days_effective
    FROM school_calendar
    WHERE status = 'aktif'${daysWhereSql}
  `;

  const holidaysQuery = `
    SELECT COUNT(*)::int as total_holidays
    FROM school_calendar
    WHERE status = 'libur'${daysWhereSql}
  `;

  const [attendanceResult, effectiveDaysResult, holidaysResult] = await Promise.all([
    pool.query(attendanceQuery, params),
    pool.query(effectiveDaysQuery, daysParams),
    pool.query(holidaysQuery, daysParams)
  ]);

  const totalsRow = attendanceResult.rows[0] || {};
  const totalPresent = Number(totalsRow.total_present) || 0;
  const totalSick = Number(totalsRow.total_sick) || 0;
  const totalPermission = Number(totalsRow.total_permission) || 0;
  const totalAbsent = Number(totalsRow.total_absent) || 0;

  const totalDaysEffective = Number(effectiveDaysResult.rows[0] && effectiveDaysResult.rows[0].total_days_effective) || 0;
  const totalHolidays = Number(holidaysResult.rows[0] && holidaysResult.rows[0].total_holidays) || 0;

  return {
    student_id: Number(studentId),
    period: hasPeriod ? { year, month } : null,
    total_present: totalPresent,
    total_hadir: totalPresent,
    total_sick: totalSick,
    total_sakit: totalSick,
    total_permission: totalPermission,
    total_izin: totalPermission,
    total_absent: totalAbsent,
    total_alpa: totalAbsent,
    total_days_effective: totalDaysEffective,
    total_holidays: totalHolidays,
    total_libur: totalHolidays
  };
};

// GET student attendance summary (used by prescientia_fe)
// GET /api/student-attendance-summary/:studentId
// Also supports monthly period:
// - GET /api/student-attendance-summary/:studentId?year=2026&month=3
// - GET /api/student-attendance-summary/:studentId/monthly?year=2026&month=3

router.get('/:studentId/monthly', requireAuth, readLimiter, async (req, res) => {
  try {
    const { studentId } = req.params;
    if (!studentId) return res.status(400).json({ success: false, message: 'Student ID harus diisi' });
    if (!ensureSummaryAccess(req, res, studentId)) return;

    const period = parsePeriodQuery(req);
    if (period.error) return res.status(400).json({ success: false, message: period.error });
    if (!period.hasPeriod) return res.status(400).json({ success: false, message: 'Query year dan month wajib diisi untuk endpoint monthly' });

    const data = await buildAttendanceSummary({ studentId, year: period.year, month: period.month });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching student attendance summary (monthly):', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil summary kehadiran siswa', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

router.get('/:studentId', requireAuth, readLimiter, async (req, res) => {
  try {
    const { studentId } = req.params;

    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Student ID harus diisi' });
    }
    if (!ensureSummaryAccess(req, res, studentId)) return;

    const period = parsePeriodQuery(req);
    if (period.error) return res.status(400).json({ success: false, message: period.error });

    const data = period.hasPeriod
      ? await buildAttendanceSummary({ studentId, year: period.year, month: period.month })
      : await buildAttendanceSummary({ studentId });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching student attendance summary:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil summary kehadiran siswa', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
