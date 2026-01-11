const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== TEACHER ATTENDANCES CRUD ====================

// GET recap/summary teacher attendance by teacher_id
router.get('/recap/:teacher_id', async (req, res) => {
  try {
    const { teacher_id } = req.params;

    if (!teacher_id) {
      return res.status(400).json({ success: false, message: 'Teacher ID harus diisi' });
    }

    const query = `
      SELECT
        to_char(COALESCE(sc.date::date, ta.check_in_time::timestamp::date, ta.created_at::timestamp::date), 'YYYY-MM-DD') as tanggal,
        to_char(COALESCE(sc.date::date, ta.check_in_time::timestamp::date, ta.created_at::timestamp::date), 'FMDay') as hari,
        ta.status as status_absensi,
        ta.check_in_time,
        ta.check_out_time
      FROM teacher_attendances ta
      LEFT JOIN school_calendar sc ON ta.calendar_id = sc.id
      WHERE ta.teacher_id = $1
        AND (sc.status IS NULL OR sc.status != 'libur')
      ORDER BY COALESCE(sc.date::date, ta.check_in_time::timestamp::date, ta.created_at::timestamp::date) ASC
    `;

    const result = await pool.query(query, [teacher_id]);

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
    console.error('Error fetching teacher attendance recap (list):', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil recap kehadiran guru', error: error.message });
  }
});

// GET all teacher attendances
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, teacher_id, status } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT ta.id, ta.teacher_id, ta.calendar_id,
             ta.check_in_time, ta.check_out_time, ta.status, ta.source,
             ta.created_at, ta.updated_at,
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
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM teacher_attendances WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (teacher_id) {
      countQuery += ` AND teacher_id = $${countParamIndex}`;
      countParams.push(teacher_id);
      countParamIndex++;
    }
    
    if (status) {
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data teacher attendances berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching teacher attendances:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher attendances',
      error: error.message
    });
  }
});

// GET teacher attendance by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT ta.id, ta.teacher_id, ta.calendar_id,
             ta.check_in_time, ta.check_out_time, ta.status, ta.source,
             ta.created_at, ta.updated_at,
             t.name as teacher_name, t.nip,
             sc.date as calendar_date
      FROM teacher_attendances ta
      LEFT JOIN teachers t ON ta.teacher_id = t.id
      LEFT JOIN school_calendar sc ON ta.calendar_id = sc.id
      WHERE ta.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher attendance tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data teacher attendance berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching teacher attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher attendance',
      error: error.message
    });
  }
});

// CREATE teacher attendance
router.post('/', async (req, res) => {
  try {
    const { teacher_id, calendar_id, check_in_time, check_out_time, status, source } = req.body;
    
    // Validasi input
    if (!teacher_id || !status || !source) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID, status, dan source harus diisi'
      });
    }
    
    // Validasi status
    if (!['hadir', 'sakit', 'izin', 'dinas', 'alpa', 'terlambat'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status tidak valid'
      });
    }
    
    // Validasi source
    if (!['digital_wifi', 'manual', 'self_report'].includes(source)) {
      return res.status(400).json({
        success: false,
        message: 'Source tidak valid'
      });
    }
    
    const query = `
      INSERT INTO teacher_attendances (teacher_id, calendar_id, check_in_time, check_out_time, status, source, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      teacher_id, calendar_id, check_in_time, check_out_time, status, source
    ]);
    
    res.status(201).json({
      success: true,
      message: 'Teacher attendance berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating teacher attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat teacher attendance',
      error: error.message
    });
  }
});

// UPDATE teacher attendance
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { check_in_time, check_out_time, status, source } = req.body;
    
    // Cek apakah attendance ada
    const checkAttendance = await pool.query(
      'SELECT id FROM teacher_attendances WHERE id = $1',
      [id]
    );
    
    if (checkAttendance.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher attendance tidak ditemukan'
      });
    }
    
    let query = 'UPDATE teacher_attendances SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
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
    
    if (source) {
      query += `, source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Teacher attendance berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating teacher attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate teacher attendance',
      error: error.message
    });
  }
});

// DELETE teacher attendance
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM teacher_attendances WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher attendance tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Teacher attendance berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting teacher attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus teacher attendance',
      error: error.message
    });
  }
});

// APP: teacher login -> create attendance if not exists (used when teacher opens the app)
router.post('/app/login', async (req, res) => {
  try {
    const { teacher_id, calendar_id, source = 'digital_wifi', check_in_time } = req.body;

    if (!teacher_id || !calendar_id) {
      return res.status(400).json({ success: false, message: 'teacher_id dan calendar_id harus diisi' });
    }

    if (!['digital_wifi', 'guru_pengajar', 'wali_kelas', 'self_report', 'manual'].includes(source)) {
      return res.status(400).json({ success: false, message: 'Source tidak valid' });
    }

    // Check existing attendance (unique constraint teacher_id + calendar_id if exists)
    const existQ = 'SELECT * FROM teacher_attendances WHERE teacher_id = $1 AND calendar_id = $2 LIMIT 1';
    const existR = await pool.query(existQ, [teacher_id, calendar_id]);
    if (existR.rows.length > 0) {
      // If exists, return it (optionally update check_in_time if missing)
      const existing = existR.rows[0];
      if (!existing.check_in_time && check_in_time) {
        const upd = await pool.query('UPDATE teacher_attendances SET check_in_time = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [check_in_time, existing.id]);
        return res.json({ success: true, message: 'Teacher attendance updated (check_in_time)', data: upd.rows[0] });
      }
      return res.json({ success: true, message: 'Teacher attendance sudah ada', data: existing });
    }

    // default status to 'hadir'
    const status = 'hadir';
    const inTime = check_in_time || new Date().toISOString();

    const insertQ = `
      INSERT INTO teacher_attendances (teacher_id, calendar_id, check_in_time, status, source, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    const insertR = await pool.query(insertQ, [teacher_id, calendar_id, inTime, status, source]);
    return res.status(201).json({ success: true, message: 'Teacher attendance created (login)', data: insertR.rows[0] });
  } catch (error) {
    console.error('Error in app login attendance:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat membuat attendance (login)', error: error.message });
  }
});

// APP: teacher logout -> update check_out_time (used when teacher closes the app)
// Route: PATCH /api/teacher-attendances/app/logout/:teacher_id
router.patch('/app/logout/:teacher_id', async (req, res) => {
  try {
    const { teacher_id } = req.params;
    const { calendar_id, check_out_time } = req.body || {};

    if (!teacher_id) {
      return res.status(400).json({ success: false, message: 'teacher_id harus diisi di URL path' });
    }

    if (!calendar_id) {
      return res.status(400).json({ success: false, message: 'calendar_id harus diisi di request body' });
    }

    // Find attendance by teacher_id + calendar_id
    const findQ = 'SELECT id FROM teacher_attendances WHERE teacher_id = $1 AND calendar_id = $2 LIMIT 1';
    const findR = await pool.query(findQ, [teacher_id, calendar_id]);
    if (findR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Attendance tidak ditemukan untuk teacher_id + calendar_id tersebut' });
    }

    const attendanceId = findR.rows[0].id;
    const outTime = check_out_time || new Date().toISOString();
    const updQ = 'UPDATE teacher_attendances SET check_out_time = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
    const updR = await pool.query(updQ, [outTime, attendanceId]);
    if (updR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Attendance tidak ditemukan' });
    }
    return res.json({ success: true, message: 'Teacher attendance updated (logout)', data: updR.rows[0] });
  } catch (error) {
    console.error('Error in app logout attendance:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengupdate attendance (logout)', error: error.message });
  }
});

module.exports = router;
