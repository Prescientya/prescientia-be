const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== HISTORY LOGIN CRUD ====================

// GET all history login
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, user_id, status, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT hl.id, hl.user_id, hl.device_id, hl.wifi_mac, hl.ip_address,
             hl.login_at, hl.logout_at, hl.duration_minutes, hl.location, hl.status,
             hl.created_at, hl.updated_at, u.email
      FROM history_login hl
      LEFT JOIN users u ON hl.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (user_id) {
      query += ` AND hl.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND hl.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (start_date) {
      query += ` AND hl.login_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      query += ` AND hl.login_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    query += ` ORDER BY hl.login_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM history_login WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (user_id) {
      countQuery += ` AND user_id = $${countParamIndex}`;
      countParams.push(user_id);
      countParamIndex++;
    }
    
    if (status) {
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }
    
    if (start_date) {
      countQuery += ` AND login_at >= $${countParamIndex}`;
      countParams.push(start_date);
      countParamIndex++;
    }
    
    if (end_date) {
      countQuery += ` AND login_at <= $${countParamIndex}`;
      countParams.push(end_date);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data history login berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching history login:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data history login',
      error: error.message
    });
  }
});

// GET history login by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT hl.id, hl.user_id, hl.device_id, hl.wifi_mac, hl.ip_address,
             hl.login_at, hl.logout_at, hl.duration_minutes, hl.location, hl.status,
             hl.created_at, hl.updated_at, u.email
      FROM history_login hl
      LEFT JOIN users u ON hl.user_id = u.id
      WHERE hl.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'History login tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data history login berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching history login:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data history login',
      error: error.message
    });
  }
});

// CREATE history login
router.post('/', async (req, res) => {
  try {
    const { user_id, device_id, wifi_mac, ip_address, login_at, location, status } = req.body;
    
    // Validasi input
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status harus diisi'
      });
    }
    
    // Validasi status
    if (!['success', 'failed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus success atau failed'
      });
    }
    
    const query = `
      INSERT INTO history_login (user_id, device_id, wifi_mac, ip_address, login_at, location, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      user_id, device_id, wifi_mac, ip_address, login_at || new Date(), location, status
    ]);
    
    res.status(201).json({
      success: true,
      message: 'History login berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating history login:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat history login',
      error: error.message
    });
  }
});

// UPDATE history login (untuk logout)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { logout_at, duration_minutes } = req.body;
    
    // Cek apakah history ada
    const checkHistory = await pool.query(
      'SELECT id FROM history_login WHERE id = $1',
      [id]
    );
    
    if (checkHistory.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'History login tidak ditemukan'
      });
    }
    
    let query = 'UPDATE history_login SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (logout_at) {
      query += `, logout_at = $${paramIndex}`;
      params.push(logout_at);
      paramIndex++;
    }
    
    if (duration_minutes !== undefined) {
      query += `, duration_minutes = $${paramIndex}`;
      params.push(duration_minutes);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'History login berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating history login:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate history login',
      error: error.message
    });
  }
});

// DELETE history login
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM history_login WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'History login tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'History login berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting history login:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus history login',
      error: error.message
    });
  }
});

module.exports = router;
