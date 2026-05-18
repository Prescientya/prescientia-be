const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAdmin } = require('../middlewares/auth.middleware');

// GET all classes
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const query = `
      SELECT id, class, major, created_at, updated_at
      FROM classes
      ORDER BY class ASC, major ASC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);

    const countResult = await pool.query('SELECT COUNT(*) FROM classes');

    res.json({
      success: true,
      message: 'Data classes berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data classes', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET class by ID
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT id, class, major, created_at, updated_at FROM classes WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class tidak ditemukan' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching class:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET students in a class (used by petugas_mbg FE)
// GET /api/classes/:classId/students?q=searchQuery
router.get('/:classId/students', requireAdmin, async (req, res) => {
  try {
    const { classId } = req.params;
    const { q } = req.query;

    let query = `
      SELECT s.id, s.user_id, s.nis, s.name, s.gender, s.date_of_birth,
             s.phone_number, s.address, s.class_id, s.photo_profile
      FROM students s
      WHERE s.class_id = $1
    `;
    const params = [classId];
    let paramIndex = 2;

    if (q) {
      query += ` AND s.name ILIKE $${paramIndex}`;
      params.push(`%${q}%`);
    }

    query += ' ORDER BY s.name ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching class students:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data siswa kelas', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
