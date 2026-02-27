const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== STUDENT ATTENDANCE SUMMARY CRUD ====================

// GET all student attendance summaries
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT sas.id, sas.student_id, sas.total_hadir, sas.total_izin,
             sas.total_sakit, sas.total_alpha, sas.created_at, sas.updated_at,
             s.name as student_name, s.nis, c.class as class_level
      FROM student_attendance_summary sas
      LEFT JOIN students s ON sas.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      ORDER BY sas.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await pool.query(query, [limit, offset]);
    const countResult = await pool.query('SELECT COUNT(*) FROM student_attendance_summary');
    
    res.json({
      success: true,
      message: 'Data student attendance summary berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching student attendance summary:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student attendance summary',
      error: error.message
    });
  }
});

// GET student attendance summary by ID or student_id
// Supports both: /api/student-attendance-summary/123 (will check if it's student_id first)
// and: /api/student-attendance-summary?student_id=123
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { student_id } = req.query;
    
    // Priority: if we have a student_id query param, use that
    if (student_id) {
      const query = `
        SELECT sas.id, sas.student_id, sas.total_hadir, sas.total_izin,
               sas.total_sakit, sas.total_alpha, sas.created_at, sas.updated_at,
               s.name as student_name, s.nis, c.class as class_level
        FROM student_attendance_summary sas
        LEFT JOIN students s ON sas.student_id = s.id
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE sas.student_id = $1
      `;
      
      const result = await pool.query(query, [student_id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Student attendance summary tidak ditemukan untuk student_id ini'
        });
      }
      
      return res.json({
        success: true,
        message: 'Data student attendance summary berhasil diambil',
        data: result.rows[0]
      });
    }
    
    // Otherwise, treat :id as summary id first, then fallback to student_id
    let query = `
      SELECT sas.id, sas.student_id, sas.total_hadir, sas.total_izin,
             sas.total_sakit, sas.total_alpha, sas.created_at, sas.updated_at,
             s.name as student_name, s.nis, c.class as class_level
      FROM student_attendance_summary sas
      LEFT JOIN students s ON sas.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE sas.id = $1
    `;
    
    let result = await pool.query(query, [id]);
    
    // If not found by summary id, try by student_id
    if (result.rows.length === 0) {
      query = `
        SELECT sas.id, sas.student_id, sas.total_hadir, sas.total_izin,
               sas.total_sakit, sas.total_alpha, sas.created_at, sas.updated_at,
               s.name as student_name, s.nis, c.class as class_level
        FROM student_attendance_summary sas
        LEFT JOIN students s ON sas.student_id = s.id
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE sas.student_id = $1
      `;
      
      result = await pool.query(query, [id]);
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance summary tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data student attendance summary berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching student attendance summary:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student attendance summary',
      error: error.message
    });
  }
});

// CREATE student attendance summary
router.post('/', async (req, res) => {
  try {
    const { student_id, total_hadir = 0, total_izin = 0, total_sakit = 0, total_alpha = 0 } = req.body;
    
    // Validasi input
    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: 'Student ID harus diisi'
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
      'SELECT id FROM student_attendance_summary WHERE student_id = $1',
      [student_id]
    );
    if (checkDuplicate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Summary sudah ada untuk student ini'
      });
    }
    
    const query = `
      INSERT INTO student_attendance_summary (student_id, total_hadir, total_izin, total_sakit, total_alpha, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [student_id, total_hadir, total_izin, total_sakit, total_alpha]);
    
    res.status(201).json({
      success: true,
      message: 'Student attendance summary berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating student attendance summary:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat student attendance summary',
      error: error.message
    });
  }
});

// UPDATE student attendance summary
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { total_hadir, total_izin, total_sakit, total_alpha } = req.body;
    
    // Cek apakah summary ada
    const checkSummary = await pool.query(
      'SELECT id FROM student_attendance_summary WHERE id = $1',
      [id]
    );
    
    if (checkSummary.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance summary tidak ditemukan'
      });
    }
    
    let query = 'UPDATE student_attendance_summary SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (total_hadir !== undefined) {
      query += `, total_hadir = $${paramIndex}`;
      params.push(total_hadir);
      paramIndex++;
    }
    
    if (total_izin !== undefined) {
      query += `, total_izin = $${paramIndex}`;
      params.push(total_izin);
      paramIndex++;
    }
    
    if (total_sakit !== undefined) {
      query += `, total_sakit = $${paramIndex}`;
      params.push(total_sakit);
      paramIndex++;
    }
    
    if (total_alpha !== undefined) {
      query += `, total_alpha = $${paramIndex}`;
      params.push(total_alpha);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Student attendance summary berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating student attendance summary:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate student attendance summary',
      error: error.message
    });
  }
});

// DELETE student attendance summary
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM student_attendance_summary WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student attendance summary tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Student attendance summary berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting student attendance summary:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus student attendance summary',
      error: error.message
    });
  }
});

module.exports = router;
