const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== WIFI PRESENCE LOGS CRUD ====================

// GET all wifi presence logs
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, user_id, wifi_id, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT wpl.id, wpl.user_id, wpl.wifi_id, wpl.detected_at,
             wpl.created_at, wpl.updated_at,
             u.email, wn.ssid, wn.bssid
      FROM wifi_presence_logs wpl
      LEFT JOIN users u ON wpl.user_id = u.id
      LEFT JOIN wifi_networks wn ON wpl.wifi_id = wn.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (user_id) {
      query += ` AND wpl.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }
    
    if (wifi_id) {
      query += ` AND wpl.wifi_id = $${paramIndex}`;
      params.push(wifi_id);
      paramIndex++;
    }
    
    if (start_date) {
      query += ` AND wpl.detected_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      query += ` AND wpl.detected_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    query += ` ORDER BY wpl.detected_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM wifi_presence_logs WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (user_id) {
      countQuery += ` AND user_id = $${countParamIndex}`;
      countParams.push(user_id);
      countParamIndex++;
    }
    
    if (wifi_id) {
      countQuery += ` AND wifi_id = $${countParamIndex}`;
      countParams.push(wifi_id);
      countParamIndex++;
    }
    
    if (start_date) {
      countQuery += ` AND detected_at >= $${countParamIndex}`;
      countParams.push(start_date);
      countParamIndex++;
    }
    
    if (end_date) {
      countQuery += ` AND detected_at <= $${countParamIndex}`;
      countParams.push(end_date);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data wifi presence logs berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching wifi presence logs:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data wifi presence logs',
      error: error.message
    });
  }
});

// GET wifi presence log by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT wpl.id, wpl.user_id, wpl.wifi_id, wpl.detected_at,
             wpl.created_at, wpl.updated_at,
             u.email, wn.ssid, wn.bssid
      FROM wifi_presence_logs wpl
      LEFT JOIN users u ON wpl.user_id = u.id
      LEFT JOIN wifi_networks wn ON wpl.wifi_id = wn.id
      WHERE wpl.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wifi presence log tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data wifi presence log berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching wifi presence log:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data wifi presence log',
      error: error.message
    });
  }
});

// CREATE wifi presence log
router.post('/', async (req, res) => {
  try {
    const { user_id, wifi_id, detected_at } = req.body;
    
    // Validasi input
    if (!detected_at) {
      return res.status(400).json({
        success: false,
        message: 'Detected at harus diisi'
      });
    }
    
    // Validasi user_id jika diisi
    if (user_id) {
      const checkUser = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
        [user_id]
      );
      if (checkUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User tidak ditemukan'
        });
      }
    }
    
    // Validasi wifi_id jika diisi
    if (wifi_id) {
      const checkWifi = await pool.query(
        'SELECT id FROM wifi_networks WHERE id = $1',
        [wifi_id]
      );
      if (checkWifi.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Wifi network tidak ditemukan'
        });
      }
    }
    
    const query = `
      INSERT INTO wifi_presence_logs (user_id, wifi_id, detected_at, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [user_id, wifi_id, detected_at]);
    
    res.status(201).json({
      success: true,
      message: 'Wifi presence log berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating wifi presence log:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat wifi presence log',
      error: error.message
    });
  }
});

// UPDATE wifi presence log
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, wifi_id, detected_at } = req.body;
    
    // Cek apakah log ada
    const checkLog = await pool.query(
      'SELECT id FROM wifi_presence_logs WHERE id = $1',
      [id]
    );
    
    if (checkLog.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wifi presence log tidak ditemukan'
      });
    }
    
    let query = 'UPDATE wifi_presence_logs SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (user_id !== undefined) {
      query += `, user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }
    
    if (wifi_id !== undefined) {
      query += `, wifi_id = $${paramIndex}`;
      params.push(wifi_id);
      paramIndex++;
    }
    
    if (detected_at) {
      query += `, detected_at = $${paramIndex}`;
      params.push(detected_at);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Wifi presence log berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating wifi presence log:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate wifi presence log',
      error: error.message
    });
  }
});

// DELETE wifi presence log
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM wifi_presence_logs WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wifi presence log tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Wifi presence log berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting wifi presence log:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus wifi presence log',
      error: error.message
    });
  }
});

module.exports = router;
