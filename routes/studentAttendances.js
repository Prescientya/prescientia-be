const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireStudent, requireAdmin } = require('../middlewares/auth.middleware');

const ALLOWED_SOURCES = ['digital_wifi', 'guru_pengajar', 'wali_kelas', 'self_report', 'manual', 'auto_system'];

function normalizeSource(value, fallback = 'digital_wifi') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return fallback;
  return trimmed;
}

// ==================== STUDENT ATTENDANCES CRUD ====================

// GET recap/summary student attendance by student_id
router.get('/recap/:student_id', requireStudent, async (req, res) => {
  try {
    const { student_id } = req.params;

    if (!student_id) {
      return res.status(400).json({ success: false, message: 'Student ID harus diisi' });
    }

    const query = `
      SELECT
        DATE_FORMAT(COALESCE(DATE(sc.date), DATE(sa.check_in_time), DATE(sa.created_at)), '%Y-%m-%d') as tanggal,
        DAYNAME(COALESCE(DATE(sc.date), DATE(sa.check_in_time), DATE(sa.created_at))) as hari,
        sa.status as status_absensi,
        sa.check_in_time,
        sa.check_out_time
      FROM student_attendances sa
      LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
      WHERE sa.student_id = $1
        AND (sc.status IS NULL OR sc.status != 'libur')
      ORDER BY COALESCE(DATE(sc.date), DATE(sa.check_in_time), DATE(sa.created_at)) ASC
    `;

    const result = await pool.query(query, [student_id]);

    const formatter = new Intl.DateTimeFormat('id-ID', { weekday: 'long' });
    const formatTime = (ts) => {
      if (!ts) return '';
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    const rows = result.rows.map(r => ({
      tanggal: r.tanggal,
      hari: formatter.format(new Date(r.tanggal + 'T00:00:00')),
      waktu: formatTime(r.check_in_time),
      status: r.status_absensi
    }));

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching student attendance recap (list):', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil recap kehadiran siswa', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET all student attendances
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, student_id, class_id, status } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT sa.id, sa.student_id, sa.class_id, sa.calendar_id,
             sa.check_in_time, sa.check_out_time, sa.status, sa.source,
             sa.created_at, sa.updated_at,
             s.name as student_name, s.nis, c.class as class_level,
             sc.date as calendar_date
      FROM student_attendances sa
      LEFT JOIN students s ON sa.student_id = s.id
      LEFT JOIN classes c ON sa.class_id = c.id
      LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (student_id) {
      query += ` AND sa.student_id = $${paramIndex}`;
      params.push(student_id);
      paramIndex++;
    }
    
    if (class_id) {
      query += ` AND sa.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND sa.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY sa.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = `
      SELECT COUNT(*) FROM student_attendances sa
      LEFT JOIN students s ON sa.student_id = s.id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamIndex = 1;
    
    if (student_id) {
      countQuery += ` AND sa.student_id = $${countParamIndex}`;
      countParams.push(student_id);
      countParamIndex++;
    }
    
    if (class_id) {
      countQuery += ` AND sa.class_id = $${countParamIndex}`;
      countParams.push(class_id);
      countParamIndex++;
    }
    
    if (status) {
      countQuery += ` AND sa.status = $${countParamIndex}`;
      countParams.push(status);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data student attendances berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching student attendances:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student attendances',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

// APP: GET student attendances with filters (date, limit)
// Protected: student_id is derived from JWT token; query param student_id is
// accepted only for admin/dashboard use but MUST match the token's student_id.
router.get('/app', requireStudent, async (req, res) => {
  try {
    const { date, limit = 30 } = req.query;

    // Always derive student_id from the authenticated token to prevent IDOR
    const parsedStudentId = Number(req.user.student_id);
    if (!parsedStudentId || isNaN(parsedStudentId) || parsedStudentId <= 0) {
      return res.status(401).json({
        success: false,
        message: 'Token tidak mengandung student_id yang valid'
      });
    }

    // If caller explicitly passes student_id, ensure it matches the token
    if (req.query.student_id !== undefined) {
      const queriedId = parseInt(req.query.student_id, 10);
      if (queriedId !== parsedStudentId) {
        return res.status(403).json({
          success: false,
          message: 'Akses ditolak: student_id tidak sesuai dengan token'
        });
      }
    }

    const parsedLimit = parseInt(limit, 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      return res.status(400).json({
        success: false,
        message: 'limit harus berupa angka positif yang valid'
      });
    }

    let query = `
      SELECT sa.id, sa.student_id, sa.class_id, sa.calendar_id,
             sa.check_in_time, sa.check_out_time, sa.status, sa.source,
             sa.created_at, sa.updated_at,
             s.name as student_name, s.nis, c.class as class_level,
             sc.date as calendar_date
      FROM student_attendances sa
      LEFT JOIN students s ON sa.student_id = s.id
      LEFT JOIN classes c ON sa.class_id = c.id
      LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
      WHERE sa.student_id = $1
    `;
    const params = [parsedStudentId];

    if (date) {
      query += ` AND sc.date = $${params.length + 1}`;
      params.push(date);
    }

    query += ` ORDER BY sa.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parsedLimit);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data student attendances berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching student attendances (app):', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student attendances',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

// GET student attendance by ID
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validasi: pastikan id adalah angka yang valid
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'ID harus berupa angka positif yang valid'
      });
    }
    
    const query = `
      SELECT sa.id, sa.student_id, sa.class_id, sa.calendar_id,
             sa.check_in_time, sa.check_out_time, sa.status, sa.source,
             sa.created_at, sa.updated_at,
             s.name as student_name, s.nis, c.class as class_level,
             sc.date as calendar_date
      FROM student_attendances sa
      LEFT JOIN students s ON sa.student_id = s.id
      LEFT JOIN classes c ON sa.class_id = c.id
      LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
      WHERE sa.id = $1
    `;
    
    const result = await pool.query(query, [parsedId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data student attendance berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching student attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student attendance',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

// CREATE student attendance
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { student_id, class_id, calendar_id, check_in_time, check_out_time, status, source } = req.body;
    
    // Validasi input
    if (!student_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'Student ID dan status harus diisi'
      });
    }
    
    // Validasi status
    if (!['hadir', 'sakit', 'izin', 'alpa', 'terlambat'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus hadir, sakit, izin, alpa, atau terlambat'
      });
    }
    
    // Validasi source jika diisi
    const normalizedSource = source === undefined || source === null || String(source).trim() === ''
      ? null
      : String(source).trim();

    if (normalizedSource && !ALLOWED_SOURCES.includes(normalizedSource)) {
      return res.status(400).json({
        success: false,
        message: 'Source tidak valid'
      });
    }
    
    const query = `
      INSERT INTO student_attendances
      (student_id, class_id, calendar_id, check_in_time, check_out_time, status, source, updated_by_role, updated_by_teacher_id, change_reason, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin', NULL, $8, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      student_id,
      class_id,
      calendar_id,
      check_in_time,
      check_out_time,
      status,
      normalizedSource,
      'Dibuat manual oleh admin'
    ]);
    
    res.status(201).json({
      success: true,
      message: 'Student attendance berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating student attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat student attendance',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

// APP: student login -> create attendance if not exists (used when student opens the app)
// Automatically resolves today's school_calendar if calendar_id not provided.
router.post('/app/login', requireStudent, async (req, res) => {
  try {
    let { calendar_id, source, check_in_time } = req.body;
    source = normalizeSource(source, 'digital_wifi');

    // student_id and class_id will be taken from token (req.user)
    const student_id = req.user && req.user.student_id;
    const class_id = (req.user && req.user.class_id) || req.body.class_id;

    if (!student_id) {
      return res.status(401).json({ success: false, message: 'Token tidak mengandung student_id' });
    }

    if (!class_id) {
      return res.status(400).json({ success: false, message: 'class_id harus diisi (dari token atau body)' });
    }

    // Auto-resolve calendar_id from today's date if not provided
    if (!calendar_id) {
      const calTodayResult = await pool.query(
        `SELECT id, date, status, notes FROM school_calendar WHERE date = CURRENT_DATE LIMIT 1`
      );
      if (calTodayResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Hari ini tidak terdaftar di kalender sekolah. Absensi tidak dapat dilakukan.'
        });
      }
      const todayCal = calTodayResult.rows[0];
      if (todayCal.status === 'libur') {
        return res.status(400).json({
          success: false,
          message: `Hari ini adalah hari libur${todayCal.notes ? ': ' + todayCal.notes : ''}. Absensi tidak dapat dilakukan.`
        });
      }
      calendar_id = todayCal.id;
    }

    if (!ALLOWED_SOURCES.includes(source)) {
      return res.status(400).json({ success: false, message: 'Source tidak valid' });
    }

    // Validate student exists
    const studentCheckQ = 'SELECT id FROM students WHERE id = $1';
    const studentCheckR = await pool.query(studentCheckQ, [student_id]);
    if (studentCheckR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student tidak ditemukan' });
    }

    // Validate class exists
    const classCheckQ = 'SELECT id FROM classes WHERE id = $1';
    const classCheckR = await pool.query(classCheckQ, [class_id]);
    if (classCheckR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class tidak ditemukan' });
    }

    // Validate calendar exists
    const calCheckQ = 'SELECT id FROM school_calendar WHERE id = $1';
    const calCheckR = await pool.query(calCheckQ, [calendar_id]);
    if (calCheckR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Calendar (jadwal) tidak ditemukan' });
    }

    // Check existing attendance (unique constraint student_id + calendar_id)
    const existQ = 'SELECT * FROM student_attendances WHERE student_id = $1 AND calendar_id = $2 LIMIT 1';
    const existR = await pool.query(existQ, [student_id, calendar_id]);
    if (existR.rows.length > 0) {
      const existing = existR.rows[0];
      // Special case: record exists but check_in_time was never set — patch it in
      if (!existing.check_in_time && check_in_time) {
        const upd = await pool.query(
          `UPDATE student_attendances
           SET check_in_time = $1,
               updated_by_role = 'system',
               updated_by_teacher_id = NULL,
               change_reason = 'Auto patch check_in_time saat login app',
               updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [check_in_time, existing.id]
        );
        return res.json({ success: true, message: 'Student attendance updated (check_in_time)', data: upd.rows[0] });
      }
      // True duplicate: attendance for this student + calendar already fully exists
      return res.status(409).json({
        success: false,
        message: 'Attendance untuk hari ini sudah tercatat.',
        data: existing
      });
    }

    const inTime = check_in_time || new Date().toISOString();
    // determine status based on check-in time: after 06:30 -> 'terlambat'
    let status = 'hadir';
    try {
      const dt = new Date(inTime);
      const hr = dt.getHours();
      const min = dt.getMinutes();
      const isAfter0630 = (hr > 6) || (hr === 6 && min > 30);
      if (isAfter0630) {
        status = 'terlambat';
      }
    } catch (e) {
      // if invalid date, keep default 'hadir'
    }

    const insertQ = `
      INSERT INTO student_attendances
      (student_id, class_id, calendar_id, check_in_time, status, source, updated_by_role, updated_by_teacher_id, change_reason, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'system', NULL, 'Auto create attendance saat login app', NOW(), NOW())
      RETURNING *
    `;
    const insertR = await pool.query(insertQ, [student_id, class_id, calendar_id, inTime, status, source]);
    return res.status(201).json({ success: true, message: 'Student attendance created (login)', data: insertR.rows[0] });
  } catch (error) {
    console.error('Error in app login attendance:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat membuat attendance (login)', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// APP: student logout -> update check_out_time (used when student closes the app)
// Protected: student_id is always taken from the JWT token to prevent IDOR.
// Accepts either attendance `id` in body, or `calendar_id` to find the record.
router.patch('/app/logout', requireStudent, async (req, res) => {
  try {
    // student_id is authoritative from token — never trust body for identity
    const student_id = req.user.student_id;
    const { id, calendar_id, check_out_time } = req.body || {};
    let attendanceId = id;

    if (!attendanceId) {
      let resolvedCalendarId = calendar_id;

      // Auto-resolve calendar_id from today's date if not provided
      if (!resolvedCalendarId) {
        const calResult = await pool.query(
          'SELECT id FROM school_calendar WHERE date = CURRENT_DATE LIMIT 1'
        );
        if (calResult.rows.length > 0) {
          resolvedCalendarId = calResult.rows[0].id;
        } else {
          return res.status(400).json({ success: false, message: 'Tidak ada kalender untuk hari ini' });
        }
      }

      const findQ = 'SELECT id FROM student_attendances WHERE student_id = $1 AND calendar_id = $2 LIMIT 1';
      const findR = await pool.query(findQ, [student_id, resolvedCalendarId]);
      if (findR.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Attendance tidak ditemukan untuk student dan calendar tersebut' });
      }
      attendanceId = findR.rows[0].id;
    } else {
      // When `id` is provided directly, verify ownership to prevent IDOR
      const ownerQ = 'SELECT id FROM student_attendances WHERE id = $1 AND student_id = $2 LIMIT 1';
      const ownerR = await pool.query(ownerQ, [attendanceId, student_id]);
      if (ownerR.rows.length === 0) {
        return res.status(403).json({ success: false, message: 'Akses ditolak: attendance tidak dimiliki student ini' });
      }
    }

    const outTime = check_out_time || new Date().toISOString();
    const updQ = `
      UPDATE student_attendances
      SET check_out_time = $1,
          updated_by_role = 'system',
          updated_by_teacher_id = NULL,
          change_reason = 'Auto set check_out_time saat logout app',
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const updR = await pool.query(updQ, [outTime, attendanceId]);
    if (updR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Attendance tidak ditemukan' });
    }
    return res.json({ success: true, message: 'Student attendance updated (logout)', data: updR.rows[0] });
  } catch (error) {
    console.error('Error in app logout attendance:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengupdate attendance (logout)', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET students currently logged in (check_in_time set and check_out_time IS NULL)
router.get('/app/logged', requireAdmin, async (req, res) => {
  try {
    const { class_id, calendar_id, page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT sa.id, sa.student_id, sa.class_id, sa.calendar_id,
             sa.check_in_time, sa.status, sa.source,
             s.name as student_name, s.nis,
             c.class as class_level, sc.date as calendar_date
      FROM student_attendances sa
      LEFT JOIN students s ON sa.student_id = s.id
      LEFT JOIN classes c ON sa.class_id = c.id
      LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
      WHERE sa.check_in_time IS NOT NULL AND sa.check_out_time IS NULL
    `;

    const params = [];
    let idx = 1;
    if (class_id) {
      query += ` AND sa.class_id = $${idx}`;
      params.push(class_id);
      idx++;
    }
    if (calendar_id) {
      query += ` AND sa.calendar_id = $${idx}`;
      params.push(calendar_id);
      idx++;
    }

    query += ` ORDER BY sa.check_in_time DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Daftar siswa yang sedang login berhasil diambil',
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        count: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching logged-in students:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil daftar siswa yang sedang login', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// UPDATE student attendance
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { check_in_time, check_out_time, status, source, change_reason } = req.body;
    
    // Validasi: pastikan id adalah angka yang valid
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'ID harus berupa angka positif yang valid'
      });
    }
    
    // Cek apakah attendance ada
    const checkAttendance = await pool.query(
      'SELECT id FROM student_attendances WHERE id = $1',
      [parsedId]
    );
    
    if (checkAttendance.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance tidak ditemukan'
      });
    }
    
    let query = `
      UPDATE student_attendances
      SET updated_at = NOW(),
          updated_by_role = 'admin',
          updated_by_teacher_id = NULL,
          change_reason = $1
    `;
    const params = [];
    let paramIndex = 2;

    params.push(change_reason || 'Diubah manual oleh admin');
    
    if (check_in_time !== undefined) {
      query += `, check_in_time = $${paramIndex}`;
      params.push(check_in_time);
      paramIndex++;
    }
    
    if (check_out_time !== undefined) {
      query += `, check_out_time = $${paramIndex}`;
      params.push(check_out_time);
      paramIndex++;
    }
    
    if (status) {
      query += `, status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (source !== undefined) {
      const normalizedPatchSource = normalizeSource(source, 'manual');
      if (!ALLOWED_SOURCES.includes(normalizedPatchSource)) {
        return res.status(400).json({ success: false, message: 'Source tidak valid' });
      }
      query += `, source = $${paramIndex}`;
      params.push(normalizedPatchSource);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(parsedId);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Student attendance berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating student attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate student attendance',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

// DELETE student attendance
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validasi: pastikan id adalah angka yang valid
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'ID harus berupa angka positif yang valid'
      });
    }
    
    const query = 'DELETE FROM student_attendances WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [parsedId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Student attendance berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting student attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus student attendance',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

module.exports = router;
