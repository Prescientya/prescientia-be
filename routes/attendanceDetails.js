const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middlewares/auth.middleware');

// GET all attendance details
router.get('/', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, attendance_id, student_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ad.id, ad.attendance_id, sa.student_id, ad.status, ad.description as reason,
             ad.evidence_url, ad.approved_by, ad.approved_at,
             ad.created_at, ad.updated_at,
             s.name as student_name, s.nis
      FROM student_attendance_details ad
      LEFT JOIN student_attendances sa ON ad.attendance_id = sa.id
      LEFT JOIN students s ON sa.student_id = s.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (attendance_id) {
      query += ` AND ad.attendance_id = $${paramIndex}`;
      params.push(attendance_id);
      paramIndex++;
    }

    if (student_id) {
      query += ` AND sa.student_id = $${paramIndex}`;
      params.push(student_id);
      paramIndex++;
    }

    query += ` ORDER BY ad.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data attendance details berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching attendance details:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET attendance detail by ID
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT ad.id, ad.attendance_id, sa.student_id, ad.status, ad.description as reason,
              ad.evidence_url, ad.approved_by, ad.approved_at,
              ad.created_at, ad.updated_at,
              s.name as student_name, s.nis
       FROM student_attendance_details ad
       LEFT JOIN student_attendances sa ON ad.attendance_id = sa.id
       LEFT JOIN students s ON sa.student_id = s.id
       WHERE ad.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Attendance detail tidak ditemukan' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching attendance detail:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// POST create attendance detail
router.post('/', requireAuth, async (req, res) => {
  try {
    const { attendance_id, student_id, status, reason, evidence_url } = req.body;

    if (!attendance_id || !student_id || !status) {
      return res.status(400).json({ success: false, message: 'attendance_id, student_id, dan status harus diisi' });
    }

    const result = await pool.query(
      `INSERT INTO student_attendance_details (attendance_id, status, description, evidence_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
      [attendance_id, status, reason || null, evidence_url || null]
    );

    res.status(201).json({ success: true, message: 'Attendance detail berhasil dibuat', data: result.rows[0] });
  } catch (error) {
    console.error('Error creating attendance detail:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// PATCH update attendance detail (approve/reject)
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approved_by } = req.body;

    const result = await pool.query(
      `UPDATE student_attendance_details SET status = COALESCE($1, status), approved_by = COALESCE($2, approved_by),
       approved_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE approved_at END,
       updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status, approved_by, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Attendance detail tidak ditemukan' });
    }

    res.json({ success: true, message: 'Attendance detail berhasil diupdate', data: result.rows[0] });
  } catch (error) {
    console.error('Error updating attendance detail:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
