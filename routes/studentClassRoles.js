const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== STUDENT CLASS ROLES CRUD ====================

// GET all student class roles
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, class_id, role } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT scr.id, scr.class_id, scr.student_id, scr.role,
             scr.created_at, scr.updated_at,
             s.name as student_name, s.nis,
             c.class as class_level, c.major as class_major
      FROM student_class_roles scr
      INNER JOIN students s ON scr.student_id = s.id
      INNER JOIN classes c ON scr.class_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (class_id) {
      query += ` AND scr.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }
    
    if (role) {
      query += ` AND scr.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }
    
    query += ` ORDER BY scr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = `
      SELECT COUNT(*) FROM student_class_roles scr
      INNER JOIN students s ON scr.student_id = s.id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamIndex = 1;
    
    if (class_id) {
      countQuery += ` AND scr.class_id = $${countParamIndex}`;
      countParams.push(class_id);
      countParamIndex++;
    }
    
    if (role) {
      countQuery += ` AND scr.role = $${countParamIndex}`;
      countParams.push(role);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data student class roles berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching student class roles:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student class roles',
      error: error.message
    });
  }
});

// GET student class role by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT scr.id, scr.class_id, scr.student_id, scr.role,
             scr.created_at, scr.updated_at,
             s.name as student_name, s.nis,
             c.class as class_level, c.major as class_major
      FROM student_class_roles scr
      INNER JOIN students s ON scr.student_id = s.id
      INNER JOIN classes c ON scr.class_id = c.id
      WHERE scr.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student class role tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data student class role berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching student class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student class role',
      error: error.message
    });
  }
});

// CREATE student class role
router.post('/', async (req, res) => {
  try {
    const { class_id, student_id, role } = req.body;
    
    // Validasi input
    if (!class_id || !student_id || !role) {
      return res.status(400).json({
        success: false,
        message: 'Class ID, Student ID, dan Role harus diisi'
      });
    }
    
    // Validasi role
    if (!['KM', 'WKM', 'Sekretaris'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role harus KM, WKM, atau Sekretaris'
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
    
    // Cek student exists
    const checkStudent = await pool.query(
      'SELECT id FROM students WHERE id = $1',
      [student_id]
    );
    if (checkStudent.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student tidak ditemukan'
      });
    }
    
    // Cek duplicate
    const checkDuplicate = await pool.query(
      'SELECT id FROM student_class_roles WHERE class_id = $1 AND student_id = $2',
      [class_id, student_id]
    );
    if (checkDuplicate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Student sudah memiliki role di class ini'
      });
    }
    
    const query = `
      INSERT INTO student_class_roles (class_id, student_id, role, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [class_id, student_id, role]);
    
    res.status(201).json({
      success: true,
      message: 'Student class role berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating student class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat student class role',
      error: error.message
    });
  }
});

// UPDATE student class role
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    // Cek apakah role ada
    const checkRole = await pool.query(
      'SELECT id FROM student_class_roles WHERE id = $1',
      [id]
    );
    
    if (checkRole.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student class role tidak ditemukan'
      });
    }
    
    // Validasi role
    if (role && !['KM', 'WKM', 'Sekretaris'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role harus KM, WKM, atau Sekretaris'
      });
    }
    
    const query = `
      UPDATE student_class_roles 
      SET role = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [role, id]);
    
    res.json({
      success: true,
      message: 'Student class role berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating student class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate student class role',
      error: error.message
    });
  }
});

// DELETE student class role
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM student_class_roles WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student class role tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Student class role berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting student class role:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus student class role',
      error: error.message
    });
  }
});

module.exports = router;
