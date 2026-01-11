const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== TEACHER CLASS ROLES CRUD ====================

// GET all teacher class roles
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, teacher_id, class_id, role } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT tcr.id, tcr.teacher_id, tcr.class_id, tcr.role,
             tcr.created_at, tcr.updated_at,
             t.name as teacher_name, t.nip,
             c.class as class_level, c.major as class_major
      FROM teacher_class_roles tcr
      INNER JOIN teachers t ON tcr.teacher_id = t.id
      INNER JOIN classes c ON tcr.class_id = c.id
      WHERE t.deleted_at IS NULL
    `;
    const params = [];
    let paramIndex = 1;
    
    if (teacher_id) {
      query += ` AND tcr.teacher_id = $${paramIndex}`;
      params.push(teacher_id);
      paramIndex++;
    }
    
    if (class_id) {
      query += ` AND tcr.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }
    
    if (role) {
      query += ` AND tcr.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }
    
    query += ` ORDER BY tcr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = `
      SELECT COUNT(*) FROM teacher_class_roles tcr
      INNER JOIN teachers t ON tcr.teacher_id = t.id
      WHERE t.deleted_at IS NULL
    `;
    const countParams = [];
    let countParamIndex = 1;
    
    if (teacher_id) {
      countQuery += ` AND tcr.teacher_id = $${countParamIndex}`;
      countParams.push(teacher_id);
      countParamIndex++;
    }
    
    if (class_id) {
      countQuery += ` AND tcr.class_id = $${countParamIndex}`;
      countParams.push(class_id);
      countParamIndex++;
    }
    
    if (role) {
      countQuery += ` AND tcr.role = $${countParamIndex}`;
      countParams.push(role);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data teacher class roles berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching teacher class roles:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher class roles',
      error: error.message
    });
  }
});

// GET teacher class role by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT tcr.id, tcr.teacher_id, tcr.class_id, tcr.role,
             tcr.created_at, tcr.updated_at,
             t.name as teacher_name, t.nip,
             c.class as class_level, c.major as class_major
      FROM teacher_class_roles tcr
      INNER JOIN teachers t ON tcr.teacher_id = t.id
      INNER JOIN classes c ON tcr.class_id = c.id
      WHERE tcr.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher class role tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data teacher class role berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching teacher class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher class role',
      error: error.message
    });
  }
});

// CREATE teacher class role
router.post('/', async (req, res) => {
  try {
    const { teacher_id, class_id, role } = req.body;
    
    // Validasi input
    if (!teacher_id || !class_id || !role) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID, Class ID, dan Role harus diisi'
      });
    }
    
    // Validasi role
    if (!['pengajar', 'wali_kelas'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role harus pengajar atau wali_kelas'
      });
    }
    
    // Cek teacher exists
    const checkTeacher = await pool.query(
      'SELECT id FROM teachers WHERE id = $1 AND deleted_at IS NULL',
      [teacher_id]
    );
    if (checkTeacher.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher tidak ditemukan'
      });
    }
    
    // Cek class exists
    const checkClass = await pool.query('SELECT id FROM classes WHERE id = $1', [class_id]);
    if (checkClass.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Class tidak ditemukan'
      });
    }
    
    const query = `
      INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [teacher_id, class_id, role]);
    
    res.status(201).json({
      success: true,
      message: 'Teacher class role berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating teacher class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat teacher class role',
      error: error.message
    });
  }
});

// UPDATE teacher class role
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    // Cek apakah role ada
    const checkRole = await pool.query(
      'SELECT id FROM teacher_class_roles WHERE id = $1',
      [id]
    );
    
    if (checkRole.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher class role tidak ditemukan'
      });
    }
    
    // Validasi role
    if (role && !['pengajar', 'wali_kelas'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role harus pengajar atau wali_kelas'
      });
    }
    
    const query = `
      UPDATE teacher_class_roles 
      SET role = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [role, id]);
    
    res.json({
      success: true,
      message: 'Teacher class role berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating teacher class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate teacher class role',
      error: error.message
    });
  }
});

// DELETE teacher class role
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM teacher_class_roles WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher class role tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Teacher class role berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting teacher class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus teacher class role',
      error: error.message
    });
  }
});

module.exports = router;
