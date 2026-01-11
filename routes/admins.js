const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');

// ==================== ADMINS CRUD ====================

// GET all admins
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT a.id, a.user_id, a.name, a.nip, a.phone_number, a.photo_profile,
             a.created_at, a.updated_at, u.email, u.is_active
      FROM admins a
      INNER JOIN users u ON a.user_id = u.id
      WHERE a.deleted_at IS NULL
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await pool.query(query, [limit, offset]);
    
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM admins WHERE deleted_at IS NULL'
    );
    
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
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data admins',
      error: error.message
    });
  }
});

// GET admin by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT a.id, a.user_id, a.name, a.nip, a.phone_number, a.photo_profile,
             a.created_at, a.updated_at, u.email, u.is_active
      FROM admins a
      INNER JOIN users u ON a.user_id = u.id
      WHERE a.id = $1 AND a.deleted_at IS NULL
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data admin berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching admin:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data admin',
      error: error.message
    });
  }
});



// UPDATE admin
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, nip, phone_number, photo_profile } = req.body;
    
    // Cek apakah admin ada
    const checkAdmin = await pool.query(
      'SELECT id FROM admins WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    
    if (checkAdmin.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin tidak ditemukan'
      });
    }
    
    let query = 'UPDATE admins SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (name) {
      query += `, name = $${paramIndex}`;
      params.push(name);
      paramIndex++;
    }
    
    if (nip !== undefined) {
      query += `, nip = $${paramIndex}`;
      params.push(nip);
      paramIndex++;
    }
    
    if (phone_number !== undefined) {
      query += `, phone_number = $${paramIndex}`;
      params.push(phone_number);
      paramIndex++;
    }
    
    if (photo_profile !== undefined) {
      query += `, photo_profile = $${paramIndex}`;
      params.push(photo_profile);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, user_id, name, nip, phone_number, photo_profile, created_at, updated_at`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Admin berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate admin',
      error: error.message
    });
  }
});

module.exports = router;
