const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAdmin } = require('../middlewares/auth.middleware');

// GET all admins
router.get('/', requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const query = `
      SELECT a.id, a.user_id, a.name, a.photo_profile, a.created_at, a.updated_at,
             u.email, u.is_active
      FROM admins a
      INNER JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);

    const countResult = await pool.query('SELECT COUNT(*) FROM admins');

    res.json({
      success: true,
      message: 'Data admins berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data admins', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET admin by ID
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT a.id, a.user_id, a.name, a.photo_profile, a.created_at, a.updated_at,
              u.email, u.is_active
       FROM admins a
       INNER JOIN users u ON a.user_id = u.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin tidak ditemukan' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching admin:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
