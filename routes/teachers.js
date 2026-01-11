const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');

// ==================== TEACHERS CRUD ====================

// GET all teachers
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, department, name } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT t.id, t.user_id, t.nip, t.name, t.gender, t.date_of_birth,
             t.phone_number, t.address, t.department, t.photo_profile,
             t.created_at, t.updated_at, u.email, u.is_active
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE t.deleted_at IS NULL
    `;
    const params = [];
    let paramIndex = 1;
    
    if (department) {
      query += ` AND t.department ILIKE $${paramIndex}`;
      params.push(`%${department}%`);
      paramIndex++;
    }
    
    if (name) {
      query += ` AND t.name ILIKE $${paramIndex}`;
      params.push(`%${name}%`);
      paramIndex++;
    }
    
    query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM teachers WHERE deleted_at IS NULL';
    const countParams = [];
    let countParamIndex = 1;
    
    if (department) {
      countQuery += ` AND department ILIKE $${countParamIndex}`;
      countParams.push(`%${department}%`);
      countParamIndex++;
    }
    
    if (name) {
      countQuery += ` AND name ILIKE $${countParamIndex}`;
      countParams.push(`%${name}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data teachers berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teachers',
      error: error.message
    });
  }
});

// GET teacher by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT t.id, t.user_id, t.nip, t.name, t.gender, t.date_of_birth,
             t.phone_number, t.address, t.department, t.photo_profile,
             t.created_at, t.updated_at, u.email, u.is_active
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE t.id = $1 AND t.deleted_at IS NULL
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data teacher berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher',
      error: error.message
    });
  }
});

// CREATE teacher (with user)
router.post('/', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      email, password, nip, name, gender, date_of_birth,
      phone_number, address, department, photo_profile 
    } = req.body;
    
    // Validasi input
    if (!email || !password || !nip || !name || !gender || !date_of_birth) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, NIP, nama, gender, dan tanggal lahir harus diisi'
      });
    }
    
    // Validasi gender
    if (!['L', 'P'].includes(gender)) {
      return res.status(400).json({
        success: false,
        message: 'Gender harus L atau P'
      });
    }
    
    await client.query('BEGIN');
    
    // Cek email duplicate
    const checkEmail = await client.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email]
    );
    
    if (checkEmail.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Email sudah terdaftar'
      });
    }
    
    // Cek NIP duplicate
    const checkNip = await client.query(
      'SELECT id FROM teachers WHERE nip = $1 AND deleted_at IS NULL',
      [nip]
    );
    
    if (checkNip.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'NIP sudah terdaftar'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const userQuery = `
      INSERT INTO users (email, password, is_active, created_at, updated_at)
      VALUES ($1, $2, true, NOW(), NOW())
      RETURNING id
    `;
    const userResult = await client.query(userQuery, [email, hashedPassword]);
    const userId = userResult.rows[0].id;
    
    // Create teacher
    const teacherQuery = `
      INSERT INTO teachers (user_id, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id, user_id, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile, created_at, updated_at
    `;
    const teacherResult = await client.query(teacherQuery, [
      userId, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile
    ]);
    
    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      message: 'Teacher berhasil dibuat',
      data: { ...teacherResult.rows[0], email }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat teacher',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// UPDATE teacher
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nip, name, gender, date_of_birth, phone_number, address, department, photo_profile } = req.body;
    
    // Cek apakah teacher ada
    const checkTeacher = await pool.query(
      'SELECT id FROM teachers WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    
    if (checkTeacher.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher tidak ditemukan'
      });
    }
    
    // Cek NIP duplicate jika NIP diubah
    if (nip) {
      const checkNip = await pool.query(
        'SELECT id FROM teachers WHERE nip = $1 AND id != $2 AND deleted_at IS NULL',
        [nip, id]
      );
      
      if (checkNip.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'NIP sudah digunakan teacher lain'
        });
      }
    }
    
    // Validasi gender jika diubah
    if (gender && !['L', 'P'].includes(gender)) {
      return res.status(400).json({
        success: false,
        message: 'Gender harus L atau P'
      });
    }
    
    let query = 'UPDATE teachers SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (nip) {
      query += `, nip = $${paramIndex}`;
      params.push(nip);
      paramIndex++;
    }
    
    if (name) {
      query += `, name = $${paramIndex}`;
      params.push(name);
      paramIndex++;
    }
    
    if (gender) {
      query += `, gender = $${paramIndex}`;
      params.push(gender);
      paramIndex++;
    }
    
    if (date_of_birth) {
      query += `, date_of_birth = $${paramIndex}`;
      params.push(date_of_birth);
      paramIndex++;
    }
    
    if (phone_number !== undefined) {
      query += `, phone_number = $${paramIndex}`;
      params.push(phone_number);
      paramIndex++;
    }
    
    if (address !== undefined) {
      query += `, address = $${paramIndex}`;
      params.push(address);
      paramIndex++;
    }
    
    if (department !== undefined) {
      query += `, department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }
    
    if (photo_profile !== undefined) {
      query += `, photo_profile = $${paramIndex}`;
      params.push(photo_profile);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, user_id, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile, created_at, updated_at`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Teacher berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate teacher',
      error: error.message
    });
  }
});

// DELETE teacher (soft delete)
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');
    
    // Get user_id first
    const teacherResult = await client.query(
      'SELECT user_id FROM teachers WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    
    if (teacherResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Teacher tidak ditemukan'
      });
    }
    
    const userId = teacherResult.rows[0].user_id;
    
    // Soft delete teacher
    await client.query(
      'UPDATE teachers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [id]
    );
    
    // Soft delete user
    await client.query(
      'UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [userId]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Teacher berhasil dihapus'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus teacher',
      error: error.message
    });
  } finally {
    client.release();
  }
});

module.exports = router;
