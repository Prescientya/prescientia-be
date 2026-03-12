const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const { requireAuth } = require('../middlewares/auth.middleware');

// POST - Create device change request from login screen (no auth required, verifies credentials)
// Used when student is on login page and device_id mismatch occurs — they have no token yet.
router.post('/from-login', async (req, res) => {
  try {
    const { nis, password, device_id_old, device_id_new } = req.body;

    // Validation
    if (!nis || !password || !device_id_old || !device_id_new) {
      return res.status(400).json({
        success: false,
        message: 'nis, password, device_id_old, dan device_id_new harus diisi'
      });
    }

    // Verify student credentials
    const studentQuery = `
      SELECT s.id as student_id, s.nis, s.name,
             u.id as user_id, u.password, u.is_active, u.device_id
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.nis COLLATE "C" = $1 COLLATE "C"
    `;
    const studentResult = await pool.query(studentQuery, [nis]);

    if (studentResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'NIS atau password salah'
      });
    }

    const student = studentResult.rows[0];

    if (!student.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Akun tidak aktif. Silakan hubungi admin.'
      });
    }

    // Verify password
    let hashedPassword = student.password || '';
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }

    const isPasswordValid = await bcrypt.compare(password, hashedPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'NIS atau password salah'
      });
    }

    // Check for existing pending request
    const existingRequestQuery = `
      SELECT id FROM device_change_requests 
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `;
    const existingRequest = await pool.query(existingRequestQuery, [student.user_id]);

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
      student.user_id,
      device_id_old,
      device_id_new,
      student.name
    ]);

    res.status(201).json({
      success: true,
      message: 'Pengajuan pergantian device berhasil dibuat',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Create device change request (from-login) error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: error.message
    });
  }
});

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
