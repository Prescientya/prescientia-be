const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middlewares/auth.middleware');

// GET all wifi presence logs
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, user_id, wifi_network_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT wpl.id, wpl.user_id, wpl.wifi_id, wpl.detected_at,
             wpl.created_at, wpl.updated_at
      FROM wifi_presence_logs wpl
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (user_id) {
      query += ` AND wpl.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (wifi_network_id) {
      query += ` AND wpl.wifi_id = $${paramIndex}`;
      params.push(wifi_network_id);
      paramIndex++;
    }

    query += ` ORDER BY wpl.detected_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data wifi presence logs berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching wifi presence logs:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', error: error.message });
  }
});

// POST create wifi presence log
router.post('/', requireAuth, async (req, res) => {
  try {
    const { user_id, wifi_id, detected_at } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: 'user_id harus diisi' });
    }

    const result = await pool.query(
      `INSERT INTO wifi_presence_logs (user_id, wifi_id, detected_at, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
      [user_id, wifi_id || null, detected_at || new Date().toISOString()]
    );

    res.status(201).json({ success: true, message: 'Wifi presence log berhasil disimpan', data: result.rows[0] });
  } catch (error) {
    console.error('Error creating wifi presence log:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', error: error.message });
  }
});

module.exports = router;
