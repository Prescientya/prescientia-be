const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');

// ==================== USERS CRUD ====================

// GET all users
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, is_active } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT id, email, email_verified_at, device_id, wifi_mac, 
             is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE 1=1
    `;
    const params = [];
    
    if (is_active !== undefined) {
      params.push(is_active === 'true');
      query += ` AND is_active = $${params.length}`;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Get total count
    let countQuery = `SELECT COUNT(*) FROM users WHERE 1=1`;
    if (is_active !== undefined) {
      countQuery += ` AND is_active = ${is_active === 'true'}`;
    }
    const countResult = await pool.query(countQuery);
    
    res.json({
      success: true,
      message: 'Data users berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data users',
      error: error.message
    });
  }
});

// GET user by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT id, email, email_verified_at, device_id, wifi_mac, 
             is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data user berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data user',
      error: error.message
    });
  }
});

// CREATE user (DISABLED)
// Creating accounts must be done via role-specific endpoints (students, teachers, admins).
router.post('/', async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Pembuatan akun Users secara langsung melalui API tidak diizinkan. Gunakan endpoint role-specific (mis. /students, /teachers).'
  });
});

// UPDATE user
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, device_id, wifi_mac, is_active } = req.body;
    
    // Cek apakah user ada
    const checkUser = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [id]
    );
    
    if (checkUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }
    
    // Cek email duplicate jika email diubah
    if (email) {
      const checkEmail = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, id]
      );
      
      if (checkEmail.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Email sudah digunakan user lain'
        });
      }
    }
    
    let query = 'UPDATE users SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (email) {
      query += `, email = $${paramIndex}`;
      params.push(email);
      paramIndex++;
    }
    
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += `, password = $${paramIndex}`;
      params.push(hashedPassword);
      paramIndex++;
    }
    
    if (device_id !== undefined) {
      query += `, device_id = $${paramIndex}`;
      params.push(device_id);
      paramIndex++;
    }
    
    if (wifi_mac !== undefined) {
      query += `, wifi_mac = $${paramIndex}`;
      params.push(wifi_mac);
      paramIndex++;
    }
    
    if (is_active !== undefined) {
      query += `, is_active = $${paramIndex}`;
      params.push(is_active);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex}
      RETURNING id, email, device_id, wifi_mac, is_active, created_at, updated_at`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'User berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate user',
      error: error.message
    });
  }
});

// DELETE user (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Cek apakah user terhubung dengan role manapun (students, teachers, admins)
    const roleCheckQuery = `
      SELECT 'student' as role FROM students WHERE user_id = $1
      UNION ALL
      SELECT 'teacher' as role FROM teachers WHERE user_id = $1
      UNION ALL
      SELECT 'admin' as role FROM admins WHERE user_id = $1
      LIMIT 1
    `;
    const roleCheck = await pool.query(roleCheckQuery, [id]);

    if (roleCheck.rows.length > 0) {
      return res.status(403).json({
        success: false,
        message: 'Tidak dapat menghapus akun yang terhubung dengan role. Hapus record role terlebih dahulu atau hubungi superadmin.'
      });
    }

    const query = `
      DELETE FROM users
      WHERE id = $1
      RETURNING id
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    res.json({
      success: true,
      message: 'User berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus user',
      error: error.message
    });
  }
});

module.exports = router;
