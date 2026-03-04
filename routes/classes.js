const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== CLASSES CRUD ====================

// GET all classes
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, class: classLevel, major } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT c.id, c.class, c.major, c.homeroom_teacher_id,
             c.created_at, c.updated_at,
             t.name as homeroom_teacher_name, t.nip as homeroom_teacher_nip
      FROM classes c
      LEFT JOIN teachers t ON c.homeroom_teacher_id = t.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (classLevel) {
      query += ` AND c.class = $${paramIndex}`;
      params.push(classLevel);
      paramIndex++;
    }
    
    if (major) {
      query += ` AND c.major ILIKE $${paramIndex}`;
      params.push(`%${major}%`);
      paramIndex++;
    }
    
    query += ` ORDER BY c.class, c.major LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM classes WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (classLevel) {
      countQuery += ` AND class = $${countParamIndex}`;
      countParams.push(classLevel);
      countParamIndex++;
    }
    
    if (major) {
      countQuery += ` AND major ILIKE $${countParamIndex}`;
      countParams.push(`%${major}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data classes berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data classes',
      error: error.message
    });
  }
});

// GET class by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT c.id, c.class, c.major, c.homeroom_teacher_id,
             c.created_at, c.updated_at,
             t.name as homeroom_teacher_name, t.nip as homeroom_teacher_nip
      FROM classes c
      LEFT JOIN teachers t ON c.homeroom_teacher_id = t.id
      WHERE c.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Class tidak ditemukan'
      });
    }
    
    // Get students in this class
    const studentsQuery = `
      SELECT id, nis, name, gender
      FROM students
      WHERE class_id = $1
      ORDER BY name
    `;
    const studentsResult = await pool.query(studentsQuery, [id]);
    
    res.json({
      success: true,
      message: 'Data class berhasil diambil',
      data: {
        ...result.rows[0],
        students: studentsResult.rows
      }
    });
  } catch (error) {
    console.error('Error fetching class:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data class',
      error: error.message
    });
  }
});

// GET students in a class, optionally filtered by name-start prefix
router.get('/:id/students', async (req, res) => {
  try {
    const { id } = req.params;
    const { q, page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;

    // basic class existence check
    const classCheck = await pool.query('SELECT id FROM classes WHERE id = $1', [id]);
    if (classCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class tidak ditemukan' });
    }

    let query = `
      SELECT id, nis, name, gender
      FROM students
      WHERE class_id = $1
    `;
    const params = [id];

    if (q && q.trim() !== '') {
      // match names where any word starts with the provided prefix (case-insensitive)
      // pattern1: name starts with q -> q%
      // pattern2: a word after a space starts with q -> % q%
      query += ` AND (name ILIKE $2 OR name ILIKE $3)`;
      params.push(`${q}%`, `% ${q}%`);
    }

    query += ` ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data siswa dalam kelas berhasil diambil',
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        count: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching students for class:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data siswa', error: error.message });
  }
});

// CREATE class
router.post('/', async (req, res) => {
  try {
    const { class: classLevel, major, homeroom_teacher_id } = req.body;
    
    // Validasi input
    if (!classLevel) {
      return res.status(400).json({
        success: false,
        message: 'Class level harus diisi'
      });
    }
    
    // Validasi homeroom_teacher_id jika diisi
    if (homeroom_teacher_id) {
      const checkTeacher = await pool.query(
        'SELECT id FROM teachers WHERE id = $1',
        [homeroom_teacher_id]
      );
      
      if (checkTeacher.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Teacher tidak ditemukan'
        });
      }
    }
    
    const query = `
      INSERT INTO classes (class, major, homeroom_teacher_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id, class, major, homeroom_teacher_id, created_at, updated_at
    `;
    
    const result = await pool.query(query, [classLevel, major, homeroom_teacher_id]);
    const newClass = result.rows[0];

    // Sync teacher_class_roles when homeroom_teacher_id is set
    if (homeroom_teacher_id && newClass.id) {
      try {
        // Insert wali_kelas role (or update if row already exists for this teacher+class)
        await pool.query(`
          INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at)
          VALUES ($1, $2, 'wali_kelas', NOW(), NOW())
          ON CONFLICT (teacher_id, class_id) WHERE role = 'wali_kelas'
          DO UPDATE SET updated_at = NOW()
        `, [homeroom_teacher_id, newClass.id]);
      } catch (syncErr) {
        // Fallback: try without ON CONFLICT (table may lack unique constraint)
        try {
          const existing = await pool.query(
            `SELECT id FROM teacher_class_roles WHERE teacher_id = $1 AND class_id = $2 AND role = 'wali_kelas'`,
            [homeroom_teacher_id, newClass.id]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at) VALUES ($1, $2, 'wali_kelas', NOW(), NOW())`,
              [homeroom_teacher_id, newClass.id]
            );
          }
        } catch (fallbackErr) {
          console.warn('Could not sync teacher_class_roles on class create:', fallbackErr.message);
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Class berhasil dibuat',
      data: newClass
    });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat class',
      error: error.message
    });
  }
});

// UPDATE class
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { class: classLevel, major, homeroom_teacher_id } = req.body;
    
    // Cek apakah class ada
    const checkClass = await pool.query(
      'SELECT id FROM classes WHERE id = $1',
      [id]
    );
    
    if (checkClass.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Class tidak ditemukan'
      });
    }
    
    // Validasi homeroom_teacher_id jika diisi
    if (homeroom_teacher_id) {
      const checkTeacher = await pool.query(
        'SELECT id FROM teachers WHERE id = $1',
        [homeroom_teacher_id]
      );
      
      if (checkTeacher.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Teacher tidak ditemukan'
        });
      }
    }
    
    let query = 'UPDATE classes SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (classLevel !== undefined) {
      query += `, class = $${paramIndex}`;
      params.push(classLevel);
      paramIndex++;
    }
    
    if (major !== undefined) {
      query += `, major = $${paramIndex}`;
      params.push(major);
      paramIndex++;
    }
    
    if (homeroom_teacher_id !== undefined) {
      query += `, homeroom_teacher_id = $${paramIndex}`;
      params.push(homeroom_teacher_id);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex}
      RETURNING id, class, major, homeroom_teacher_id, created_at, updated_at`;
    params.push(id);
    
    const result = await pool.query(query, params);
    const updatedClass = result.rows[0];

    // Sync teacher_class_roles when homeroom_teacher_id is changed
    if (homeroom_teacher_id !== undefined && updatedClass) {
      try {
        // Remove old wali_kelas role(s) for this class
        await pool.query(
          `DELETE FROM teacher_class_roles WHERE class_id = $1 AND role = 'wali_kelas'`,
          [id]
        );

        // If a new homeroom teacher is assigned, add wali_kelas role
        if (homeroom_teacher_id) {
          const existing = await pool.query(
            `SELECT id FROM teacher_class_roles WHERE teacher_id = $1 AND class_id = $2 AND role = 'wali_kelas'`,
            [homeroom_teacher_id, id]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at) VALUES ($1, $2, 'wali_kelas', NOW(), NOW())`,
              [homeroom_teacher_id, id]
            );
          }
        }
      } catch (syncErr) {
        console.warn('Could not sync teacher_class_roles on class update:', syncErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Class berhasil diupdate',
      data: updatedClass
    });
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate class',
      error: error.message
    });
  }
});

// DELETE class
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Cek apakah ada students di class ini
    const checkStudents = await pool.query(
      'SELECT COUNT(*) FROM students WHERE class_id = $1',
      [id]
    );
    
    if (parseInt(checkStudents.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat menghapus class yang masih memiliki siswa'
      });
    }
    
    const query = 'DELETE FROM classes WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Class tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Class berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus class',
      error: error.message
    });
  }
});

module.exports = router;
