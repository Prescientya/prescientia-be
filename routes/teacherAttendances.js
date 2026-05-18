const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireTeacher, requireAdmin } = require('../middlewares/auth.middleware');
const { localDateStr } = require('../utils/dateHelper');

const ALLOWED_TEACHER_SOURCES = ['digital_wifi', 'manual', 'self_report', 'auto_system'];

function normalizeTeacherSource(value, fallback = 'digital_wifi') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed;
}

// GET teacher attendances (used by prescientia_guru_fe)
// GET /api/teacher-attendances?teacher_id=123
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, teacher_id, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ta.id, ta.teacher_id, ta.calendar_id, ta.check_in_time, ta.check_out_time,
             ta.status, ta.source, ta.created_at, ta.updated_at,
             t.name as teacher_name, t.nip,
             sc.date as calendar_date
      FROM teacher_attendances ta
      LEFT JOIN teachers t ON ta.teacher_id = t.id
      LEFT JOIN school_calendar sc ON ta.calendar_id = sc.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (teacher_id) {
      query += ` AND ta.teacher_id = $${paramIndex}`;
      params.push(teacher_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND ta.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY ta.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data teacher attendances berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching teacher attendances:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET today's known attendance for logged-in teacher (used by prescientia_guru_fe reminder service)
// GET /api/teacher-attendances/my
router.get('/my', requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    const today = localDateStr(new Date());

    const query = `
      SELECT ta.id, ta.teacher_id, ta.calendar_id, ta.check_in_time, ta.check_out_time,
             ta.status, ta.source, ta.created_at, ta.updated_at
      FROM teacher_attendances ta
      LEFT JOIN school_calendar sc ON ta.calendar_id = sc.id
      WHERE ta.teacher_id = $1
        AND (DATE(ta.check_in_time) = $2 OR sc.date = $2)
      ORDER BY ta.created_at DESC
      LIMIT 1
    `;
    const result = await pool.query(query, [teacherId, today]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching my attendance:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET teacher attendance recap (used by prescientia_guru_fe)
// GET /api/teacher-attendances/recap/:teacherId
router.get('/recap/:teacherId', requireTeacher, async (req, res) => {
  try {
    const { teacherId } = req.params;

    const query = `
      SELECT
        ta.id, ta.teacher_id, ta.calendar_id, ta.status,
        ta.check_in_time, ta.check_out_time, ta.source,
        sc.date as calendar_date, sc.status as calendar_status
      FROM teacher_attendances ta
      LEFT JOIN school_calendar sc ON ta.calendar_id = sc.id
      WHERE ta.teacher_id = $1
        AND (sc.status IS NULL OR sc.status != 'libur')
      ORDER BY COALESCE(sc.date, ta.created_at) ASC
    `;
    const result = await pool.query(query, [teacherId]);

    const formatter = new Intl.DateTimeFormat('id-ID', { weekday: 'long' });

    const toDateString = (val) => {
      if (!val) return null;
      if (val instanceof Date) return localDateStr(val);
      return String(val).split('T')[0];
    };

    const formatTime = (ts) => {
      if (!ts) return '';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const rows = result.rows.map(r => {
      const dateStr = toDateString(r.calendar_date) || toDateString(r.check_in_time);
      let hari = '';
      if (dateStr) {
        try { hari = formatter.format(new Date(dateStr + 'T00:00:00')); } catch (_) {}
      }
      return {
        tanggal: dateStr,
        hari,
        waktu: formatTime(r.check_in_time),
        status: r.status
      };
    });

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching teacher attendance recap:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// POST create teacher attendance (used by prescientia_guru_fe)
router.post('/', requireTeacher, async (req, res) => {
  try {
    const { teacher_id, calendar_id, check_in_time, check_out_time, status, source, wifi_ssid, wifi_bssid, ip_address } = req.body;

    const normalizedSource = normalizeTeacherSource(source, 'digital_wifi');
    if (!ALLOWED_TEACHER_SOURCES.includes(normalizedSource)) {
      return res.status(400).json({ success: false, message: 'Source tidak valid' });
    }

    if (!teacher_id || !status) {
      return res.status(400).json({ success: false, message: 'teacher_id dan status harus diisi' });
    }

    const query = `
      INSERT INTO teacher_attendances (teacher_id, calendar_id, check_in_time, check_out_time, status, source, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `;
    const params = [teacher_id, calendar_id || null, check_in_time || new Date().toISOString(), check_out_time || null, status, normalizedSource];
    const result = await pool.query(query, params);

    res.status(201).json({
      success: true,
      message: 'Teacher attendance berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating teacher attendance:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// POST teacher check-in via app (used by prescientia_guru_fe)
// POST /api/teacher-attendances/app/login
router.post('/app/login', requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    const { source, check_in_time } = req.body;
    const normalizedSource = normalizeTeacherSource(source, 'digital_wifi');
    if (!ALLOWED_TEACHER_SOURCES.includes(normalizedSource)) {
      return res.status(400).json({ success: false, message: 'Source tidak valid' });
    }
    const today = localDateStr(new Date());

    // Get today's calendar entry
    const calendarResult = await pool.query('SELECT id FROM school_calendar WHERE date = $1', [today]);
    const calendarId = calendarResult.rows.length > 0 ? calendarResult.rows[0].id : null;

    // Check if already checked in today
    let existingResult;
    if (calendarId !== null && calendarId !== undefined) {
      existingResult = await pool.query(
        `SELECT id, check_in_time, check_out_time, status FROM teacher_attendances WHERE teacher_id = $1 AND calendar_id = $2`,
        [teacherId, calendarId]
      );
    } else {
      // calendar_id is null — fallback: check by date
      existingResult = await pool.query(
        `SELECT ta.id, ta.check_in_time, ta.check_out_time, ta.status FROM teacher_attendances ta
         LEFT JOIN school_calendar sc ON ta.calendar_id = sc.id
         WHERE ta.teacher_id = $1 AND DATE(ta.check_in_time) = $2`,
        [teacherId, today]
      );
    }

    if (existingResult.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Sudah check-in hari ini',
        data: existingResult.rows[0]
      });
    }

    const query = `
      INSERT INTO teacher_attendances (teacher_id, calendar_id, check_in_time, status, source, created_at, updated_at)
      VALUES ($1, $2, $3, 'hadir', $4, NOW(), NOW())
      RETURNING *
    `;
    const result = await pool.query(query, [teacherId, calendarId, check_in_time || new Date().toISOString(), normalizedSource]);

    res.status(201).json({
      success: true,
      message: 'Check-in berhasil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error teacher check-in:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat check-in', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// PATCH teacher check-out via app (used by prescientia_guru_fe)
// PATCH /api/teacher-attendances/app/logout
router.patch('/app/logout', requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    const { calendar_id, check_out_time } = req.body;
    const today = localDateStr(new Date());

    // Find today's attendance record
    let findQuery;
    let findParams;

    if (calendar_id) {
      findQuery = 'SELECT id FROM teacher_attendances WHERE teacher_id = $1 AND calendar_id = $2';
      findParams = [teacherId, calendar_id];
    } else {
      findQuery = `SELECT ta.id FROM teacher_attendances ta
        LEFT JOIN school_calendar sc ON ta.calendar_id = sc.id
        WHERE ta.teacher_id = $1 AND sc.date = $2`;
      findParams = [teacherId, today];
    }

    const existing = await pool.query(findQuery, findParams);

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tidak ada record check-in hari ini' });
    }

    const result = await pool.query(
      `UPDATE teacher_attendances SET check_out_time = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [check_out_time || new Date().toISOString(), existing.rows[0].id]
    );

    res.json({
      success: true,
      message: 'Check-out berhasil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error teacher check-out:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat check-out', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
