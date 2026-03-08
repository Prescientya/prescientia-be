const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireStudent, requireAdmin } = require('../middlewares/auth.middleware');

// POST create history login (used by prescientia_fe)
router.post('/', requireStudent, async (req, res) => {
  try {
    const { user_id, device_id, wifi_mac, ip_address, login_at, logout_at, duration_minutes, location, status } = req.body;

    if (!user_id || !login_at || !status) {
      return res.status(400).json({ success: false, message: 'user_id, login_at, dan status harus diisi' });
    }

    const query = `
      INSERT INTO history_login (user_id, device_id, wifi_mac, ip_address, login_at, logout_at, duration_minutes, location, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING *
    `;
    const params = [user_id, device_id || null, wifi_mac || null, ip_address || null, login_at, logout_at || null, duration_minutes || null, location || null, status];
    const result = await pool.query(query, params);

    res.status(201).json({
      success: true,
      message: 'History login berhasil disimpan',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating history login:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat menyimpan history login', error: error.message });
  }
});

// GET all history logins
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, user_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT hl.id, hl.user_id, hl.device_id, hl.wifi_mac, hl.ip_address,
             hl.login_at, hl.logout_at, hl.duration_minutes, hl.location, hl.status,
             hl.created_at, hl.updated_at
      FROM history_login hl
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (user_id) {
      query += ` AND hl.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    query += ` ORDER BY hl.login_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const countQuery = user_id
      ? await pool.query('SELECT COUNT(*) FROM history_login WHERE user_id = $1', [user_id])
      : await pool.query('SELECT COUNT(*) FROM history_login');

    res.json({
      success: true,
      message: 'Data history login berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countQuery.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countQuery.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching history logins:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data history login', error: error.message });
  }
});

module.exports = router;
