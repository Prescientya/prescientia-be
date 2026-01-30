const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== TEACHER ATTENDANCE DETAILS CRUD ====================

// GET all teacher attendance details
router.get('/teacher/', async (req, res) => {
  try {
    const { page = 1, limit = 10, attendance_id, reason } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT tad.id, tad.attendance_id, tad.reason, tad.description,
             tad.evidence_url, tad.created_at, tad.updated_at,
             ta.teacher_id, t.name as teacher_name
      FROM teacher_attendance_details tad
      LEFT JOIN teacher_attendances ta ON tad.attendance_id = ta.id
      LEFT JOIN teachers t ON ta.teacher_id = t.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (attendance_id) {
      query += ` AND tad.attendance_id = $${paramIndex}`;
      params.push(attendance_id);
      paramIndex++;
    }
    
    if (reason) {
      query += ` AND tad.reason = $${paramIndex}`;
      params.push(reason);
      paramIndex++;
    }
    
    query += ` ORDER BY tad.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM teacher_attendance_details WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (attendance_id) {
      countQuery += ` AND attendance_id = $${countParamIndex}`;
      countParams.push(attendance_id);
      countParamIndex++;
    }
    
    if (reason) {
      countQuery += ` AND reason = $${countParamIndex}`;
      countParams.push(reason);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data teacher attendance details berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching teacher attendance details:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher attendance details',
      error: error.message
    });
  }
});

// GET teacher attendance detail by ID
router.get('/teacher/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT tad.id, tad.attendance_id, tad.reason, tad.description,
             tad.evidence_url, tad.created_at, tad.updated_at,
             ta.teacher_id, t.name as teacher_name
      FROM teacher_attendance_details tad
      LEFT JOIN teacher_attendances ta ON tad.attendance_id = ta.id
      LEFT JOIN teachers t ON ta.teacher_id = t.id
      WHERE tad.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher attendance detail tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data teacher attendance detail berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching teacher attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher attendance detail',
      error: error.message
    });
  }
});

// CREATE teacher attendance detail
router.post('/teacher', async (req, res) => {
  try {
    const { attendance_id, reason, description, evidence_url } = req.body;
    
    // Validasi input
    if (!attendance_id || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Attendance ID dan reason harus diisi'
      });
    }
    
    // Validasi reason
    if (!['sakit', 'izin', 'dinas', 'alpa', 'terlambat'].includes(reason)) {
      return res.status(400).json({
        success: false,
        message: 'Reason tidak valid'
      });
    }
    
    // Cek attendance exists
    const checkAttendance = await pool.query(
      'SELECT id FROM teacher_attendances WHERE id = $1',
      [attendance_id]
    );
    if (checkAttendance.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher attendance tidak ditemukan'
      });
    }
    
    const query = `
      INSERT INTO teacher_attendance_details (attendance_id, reason, description, evidence_url, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [attendance_id, reason, description, evidence_url]);
    
    res.status(201).json({
      success: true,
      message: 'Teacher attendance detail berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating teacher attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat teacher attendance detail',
      error: error.message
    });
  }
});

// UPDATE teacher attendance detail
router.patch('/teacher/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, description, evidence_url } = req.body;
    
    // Cek apakah detail ada
    const checkDetail = await pool.query(
      'SELECT id FROM teacher_attendance_details WHERE id = $1',
      [id]
    );
    
    if (checkDetail.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher attendance detail tidak ditemukan'
      });
    }
    
    let query = 'UPDATE teacher_attendance_details SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (reason) {
      query += `, reason = $${paramIndex}`;
      params.push(reason);
      paramIndex++;
    }
    
    if (description !== undefined) {
      query += `, description = $${paramIndex}`;
      params.push(description);
      paramIndex++;
    }
    
    if (evidence_url !== undefined) {
      query += `, evidence_url = $${paramIndex}`;
      params.push(evidence_url);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Teacher attendance detail berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating teacher attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate teacher attendance detail',
      error: error.message
    });
  }
});

// DELETE teacher attendance detail
router.delete('/teacher/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM teacher_attendance_details WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher attendance detail tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Teacher attendance detail berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting teacher attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus teacher attendance detail',
      error: error.message
    });
  }
});

// ==================== STUDENT ATTENDANCE DETAILS CRUD ====================

// GET all student attendance details
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, attendance_id, status } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
            SELECT sad.id, sad.attendance_id, sad.status, sad.description,
             sad.evidence_url, sad.created_at, sad.updated_at,
             sa.student_id, s.name as student_name
      FROM student_attendance_details sad
      LEFT JOIN student_attendances sa ON sad.attendance_id = sa.id
      LEFT JOIN students s ON sa.student_id = s.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (attendance_id) {
      query += ` AND sad.attendance_id = $${paramIndex}`;
      params.push(attendance_id);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND sad.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY sad.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM student_attendance_details WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (attendance_id) {
      countQuery += ` AND attendance_id = $${countParamIndex}`;
      countParams.push(attendance_id);
      countParamIndex++;
    }
    
    if (status) {
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data student attendance details berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching student attendance details:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student attendance details',
      error: error.message
    });
  }
});

// GET student attendance detail by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT sad.id, sad.attendance_id, sad.status, sad.description,
             sad.evidence_url, sad.created_at, sad.updated_at,
             sa.student_id, s.name as student_name
      FROM student_attendance_details sad
      LEFT JOIN student_attendances sa ON sad.attendance_id = sa.id
      LEFT JOIN students s ON sa.student_id = s.id
      WHERE sad.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance detail tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data student attendance detail berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching student attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student attendance detail',
      error: error.message
    });
  }
});

// CREATE student attendance detail
router.post('/', async (req, res) => {
  try {
    const { attendance_id, status, description, evidence_url } = req.body;
    
    // Validasi input
    if (!attendance_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'Attendance ID dan status harus diisi'
      });
    }
    
    // Validasi reason
    if (!['sakit', 'izin', 'alpa', 'terlambat'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Reason harus sakit, izin, alpa, atau terlambat'
      });
    }
    
    // Cek attendance exists
    const checkAttendance = await pool.query(
      'SELECT id FROM student_attendances WHERE id = $1',
      [attendance_id]
    );
    if (checkAttendance.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance tidak ditemukan'
      });
    }
    
    const query = `
      INSERT INTO student_attendance_details (attendance_id, status, description, evidence_url, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `;

    const result = await pool.query(query, [attendance_id, status, description, evidence_url]);
    
    res.status(201).json({
      success: true,
      message: 'Student attendance detail berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating student attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat student attendance detail',
      error: error.message
    });
  }
});

// UPDATE student attendance detail
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, description, evidence_url } = req.body;
    
    // Cek apakah detail ada
    const checkDetail = await pool.query(
      'SELECT id FROM student_attendance_details WHERE id = $1',
      [id]
    );
    
    if (checkDetail.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance detail tidak ditemukan'
      });
    }
    
    let query = 'UPDATE student_attendance_details SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (status) {
      query += `, status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (description !== undefined) {
      query += `, description = $${paramIndex}`;
      params.push(description);
      paramIndex++;
    }
    
    if (evidence_url !== undefined) {
      query += `, evidence_url = $${paramIndex}`;
      params.push(evidence_url);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Student attendance detail berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating student attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate student attendance detail',
      error: error.message
    });
  }
});

// DELETE student attendance detail
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM student_attendance_details WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance detail tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Student attendance detail berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting student attendance detail:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus student attendance detail',
      error: error.message
    });
  }
});

module.exports = router;
