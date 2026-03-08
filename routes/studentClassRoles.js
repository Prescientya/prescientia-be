const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAdmin } = require('../middlewares/auth.middleware');

// GET all student class roles
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, class_id, student_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT scr.id, scr.student_id, scr.class_id, scr.role, scr.created_at, scr.updated_at,
             s.name as student_name, s.nis, c.class as class_level, c.major as class_major
      FROM student_class_roles scr
      LEFT JOIN students s ON scr.student_id = s.id
      LEFT JOIN classes c ON scr.class_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (class_id) {
      query += ` AND scr.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }

    if (student_id) {
      query += ` AND scr.student_id = $${paramIndex}`;
      params.push(student_id);
      paramIndex++;
    }

    query += ` ORDER BY scr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data student class roles berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching student class roles:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', error: error.message });
  }
});

// POST create student class role
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { student_id, class_id, role } = req.body;

    if (!student_id || !class_id || !role) {
      return res.status(400).json({ success: false, message: 'student_id, class_id, dan role harus diisi' });
    }

    const result = await pool.query(
      `INSERT INTO student_class_roles (student_id, class_id, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
      [student_id, class_id, role]
    );

    res.status(201).json({ success: true, message: 'Student class role berhasil dibuat', data: result.rows[0] });
  } catch (error) {
    console.error('Error creating student class role:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', error: error.message });
  }
});

// DELETE student class role
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM student_class_roles WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student class role tidak ditemukan' });
    }

    res.json({ success: true, message: 'Student class role berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting student class role:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', error: error.message });
  }
});

module.exports = router;
