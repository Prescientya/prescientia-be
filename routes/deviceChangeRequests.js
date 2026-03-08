const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth } = require('../middlewares/auth.middleware');

// POST - Create new device change request (manual submission)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { user_id, device_id_old, device_id_new, submitted_by } = req.body;
    
    // Validation
    if (!user_id || !device_id_old || !device_id_new) {
      return res.status(400).json({
        success: false,
        message: 'user_id, device_id_old, dan device_id_new harus diisi'
      });
    }
    
    // Check if user exists
    const userCheckQuery = `SELECT id, device_id FROM users WHERE id = $1`;
    const userCheck = await pool.query(userCheckQuery, [user_id]);
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }
    
    // Check if there's already a pending request for this user
    const existingRequestQuery = `
      SELECT id FROM device_change_requests 
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `;
    const existingRequest = await pool.query(existingRequestQuery, [user_id]);
    
    if (existingRequest.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Sudah ada pengajuan pergantian device yang masih pending untuk user ini'
      });
    }
    
    // Create new device change request
    const insertQuery = `
      INSERT INTO device_change_requests 
        (user_id, device_id_old, device_id_new, status, submitted_by, created_at, updated_at)
      VALUES ($1, $2, $3, 'pending', $4, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      user_id,
      device_id_old,
      device_id_new,
      submitted_by || null
    ]);
    
    res.status(201).json({
      success: true,
      message: 'Pengajuan pergantian device berhasil dibuat',
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('Create device change request error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: error.message
    });
  }
});

module.exports = router;
