const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');

// ==================== PETUGAS MBG CRUD ====================

// GET all petugas mbg
router.get('/petugas', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT id, username, created_at, updated_at
      FROM petugas_mbg
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await pool.query(query, [limit, offset]);
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM petugas_mbg'
    );
    
    res.json({
      success: true,
      message: 'Data petugas MBG berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching petugas mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data petugas MBG',
      error: error.message
    });
  }
});

// GET petugas mbg by ID
router.get('/petugas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT id, username, created_at, updated_at
      FROM petugas_mbg
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Petugas MBG tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data petugas MBG berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching petugas mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data petugas MBG',
      error: error.message
    });
  }
});

// CREATE petugas mbg
router.post('/petugas', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validasi input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username dan password harus diisi'
      });
    }
    
    // Cek duplicate username
    const checkUsername = await pool.query(
      'SELECT id FROM petugas_mbg WHERE username = $1',
      [username]
    );
    
    if (checkUsername.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Username sudah terdaftar'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const query = `
      INSERT INTO petugas_mbg (username, password, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING id, username, created_at, updated_at
    `;
    
    const result = await pool.query(query, [username, hashedPassword]);
    
    res.status(201).json({
      success: true,
      message: 'Petugas MBG berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating petugas mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat petugas MBG',
      error: error.message
    });
  }
});

// UPDATE petugas mbg
router.patch('/petugas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password } = req.body;

    // Cek apakah petugas ada
    const checkPetugas = await pool.query(
      'SELECT id, username FROM petugas_mbg WHERE id = $1',
      [id]
    );

    if (checkPetugas.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Petugas MBG tidak ditemukan'
      });
    }

    // Build dynamic update
    const updates = [];
    const params = [];
    let idx = 1;

    if (username !== undefined) {
      // check duplicate username (exclude current)
      const dup = await pool.query(
        'SELECT id FROM petugas_mbg WHERE username = $1 AND id != $2',
        [username, id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Username sudah terdaftar' });
      }
      updates.push(`username = $${idx}`);
      params.push(username);
      idx++;
    }

    if (password !== undefined) {
      if (!password) {
        return res.status(400).json({ success: false, message: 'Password tidak boleh kosong' });
      }
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${idx}`);
      params.push(hashed);
      idx++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada field untuk diupdate' });
    }

    // always update updated_at
    const setClause = updates.join(', ') + `, updated_at = NOW()`;
    const query = `UPDATE petugas_mbg SET ${setClause} WHERE id = $${idx} RETURNING id, username, created_at, updated_at`;
    params.push(id);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Petugas MBG berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating petugas mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate petugas MBG',
      error: error.message
    });
  }
});

// DELETE petugas mbg (soft delete)
router.delete('/petugas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      DELETE FROM petugas_mbg
      WHERE id = $1
      RETURNING id
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Petugas MBG tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Petugas MBG berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting petugas mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus petugas MBG',
      error: error.message
    });
  }
});

// ==================== PIRING MBG CRUD ====================

// GET all piring mbg
router.get('/piring', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT id, stok, tanggal_distribusi, created_at, updated_at
      FROM piring_mbg
      ORDER BY tanggal_distribusi DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await pool.query(query, [limit, offset]);
    const countResult = await pool.query('SELECT COUNT(*) FROM piring_mbg');
    
    res.json({
      success: true,
      message: 'Data piring MBG berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching piring mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data piring MBG',
      error: error.message
    });
  }
});

// GET piring mbg by ID
router.get('/piring/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT id, stok, tanggal_distribusi, created_at, updated_at
      FROM piring_mbg
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Piring MBG tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data piring MBG berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching piring mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data piring MBG',
      error: error.message
    });
  }
});

// CREATE piring mbg
router.post('/piring', async (req, res) => {
  try {
    const { stok = 0, tanggal_distribusi } = req.body;
    
    const query = `
      INSERT INTO piring_mbg (stok, tanggal_distribusi, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [stok, tanggal_distribusi]);
    
    res.status(201).json({
      success: true,
      message: 'Piring MBG berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating piring mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat piring MBG',
      error: error.message
    });
  }
});

// UPDATE piring mbg
router.patch('/piring/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { stok, tanggal_distribusi } = req.body;
    
    // Cek apakah piring ada
    const checkPiring = await pool.query(
      'SELECT id FROM piring_mbg WHERE id = $1',
      [id]
    );
    
    if (checkPiring.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Piring MBG tidak ditemukan'
      });
    }
    
    let query = 'UPDATE piring_mbg SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (stok !== undefined) {
      query += `, stok = $${paramIndex}`;
      params.push(stok);
      paramIndex++;
    }
    
    if (tanggal_distribusi !== undefined) {
      query += `, tanggal_distribusi = $${paramIndex}`;
      params.push(tanggal_distribusi);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Piring MBG berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating piring mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate piring MBG',
      error: error.message
    });
  }
});

// DELETE piring mbg
router.delete('/piring/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM piring_mbg WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Piring MBG tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Piring MBG berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting piring mbg:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus piring MBG',
      error: error.message
    });
  }
});

// ==================== MBG CLASS DAILY CRUD ====================

// GET all mbg class daily
router.get('/class-daily', async (req, res) => {
  try {
    const { page = 1, limit = 10, piring_mbg_id, class_id } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT mcd.id, mcd.piring_mbg_id, mcd.class_id, mcd.total_students,
             mcd.attended_students, mcd.returned_plates, mcd.class_code,
             mcd.student_representative, mcd.created_at, mcd.updated_at,
             p.stok, p.tanggal_distribusi,
             c.class as class_level, c.major as class_major
      FROM mbg_class_daily mcd
      LEFT JOIN piring_mbg p ON mcd.piring_mbg_id = p.id
      LEFT JOIN classes c ON mcd.class_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (piring_mbg_id) {
      query += ` AND mcd.piring_mbg_id = $${paramIndex}`;
      params.push(piring_mbg_id);
      paramIndex++;
    }
    
    if (class_id) {
      query += ` AND mcd.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }
    
    query += ` ORDER BY mcd.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM mbg_class_daily WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (piring_mbg_id) {
      countQuery += ` AND piring_mbg_id = $${countParamIndex}`;
      countParams.push(piring_mbg_id);
      countParamIndex++;
    }
    
    if (class_id) {
      countQuery += ` AND class_id = $${countParamIndex}`;
      countParams.push(class_id);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data MBG class daily berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching mbg class daily:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data MBG class daily',
      error: error.message
    });
  }
});

// GET mbg class daily by ID
router.get('/class-daily/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT mcd.id, mcd.piring_mbg_id, mcd.class_id, mcd.total_students,
             mcd.attended_students, mcd.returned_plates, mcd.class_code,
             mcd.student_representative, mcd.created_at, mcd.updated_at,
             p.stok, p.tanggal_distribusi,
             c.class as class_level, c.major as class_major
      FROM mbg_class_daily mcd
      LEFT JOIN piring_mbg p ON mcd.piring_mbg_id = p.id
      LEFT JOIN classes c ON mcd.class_id = c.id
      WHERE mcd.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'MBG class daily tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data MBG class daily berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching mbg class daily:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data MBG class daily',
      error: error.message
    });
  }
});

// CREATE mbg class daily
router.post('/class-daily', async (req, res) => {
  try {
    let { piring_mbg_id, class_id, total_students, attended_students = 0, returned_plates = 0, class_code, student_representative } = req.body || {};

    // Validasi input
    if (!piring_mbg_id || !class_id) {
      return res.status(400).json({ success: false, message: 'Piring MBG ID dan Class ID harus diisi' });
    }

    // Cek apakah kelas ada dan hitung total students
    const classCheck = `
      SELECT c.id, c.major, c.class, COUNT(s.id) as total_students
      FROM classes c
      LEFT JOIN students s ON c.id = s.class_id
      WHERE c.id = $1
      GROUP BY c.id, c.major, c.class
    `;
    const classResult = await pool.query(classCheck, [class_id]);
    if (classResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan' });
    }
    const classData = classResult.rows[0];
    const computedTotalStudents = parseInt(classData.total_students || 0);

    // If total_students not provided, use computed
    total_students = (total_students === undefined || total_students === null) ? computedTotalStudents : parseInt(total_students);
    if (isNaN(total_students) || total_students < 0) total_students = computedTotalStudents;

    // Normalize attended_students
    attended_students = parseInt(attended_students) || 0;
    if (attended_students < 0) attended_students = 0;
    // Prevent attended_students exceeding total_students
    if (attended_students > total_students) {
      attended_students = total_students;
    }

    // Cek duplicate: same piring_mbg_id + class_id
    const dupQ = 'SELECT id FROM mbg_class_daily WHERE piring_mbg_id = $1 AND class_id = $2';
    const dupR = await pool.query(dupQ, [piring_mbg_id, class_id]);
    if (dupR.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Data MBG untuk kelas ini pada piring_mbg yang sama sudah ada' });
    }

    const insertQ = `
      INSERT INTO mbg_class_daily (piring_mbg_id, class_id, total_students, attended_students, returned_plates, class_code, student_representative, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, piring_mbg_id, class_id, total_students, attended_students, returned_plates, student_representative, created_at, updated_at
    `;

    const insertR = await pool.query(insertQ, [piring_mbg_id, class_id, total_students, attended_students, returned_plates, class_code, student_representative]);
    const dailyData = insertR.rows[0];

    // Kurangi stok piring_mbg sesuai attended_students (tidak boleh negatif)
    try {
      const updateStockQuery = `
        UPDATE piring_mbg
        SET stok = GREATEST(stok - $1, 0), updated_at = NOW()
        WHERE id = $2
        RETURNING stok
      `;
      const stockResult = await pool.query(updateStockQuery, [attended_students, piring_mbg_id]);
      var stokAfter = stockResult.rows[0] ? stockResult.rows[0].stok : null;
    } catch (err) {
      console.error('Error updating piring_mbg stok after creating daily record:', err);
      var stokAfter = null;
    }

    res.status(201).json({
      success: true,
      message: 'MBG class daily berhasil dibuat',
      data: {
        id: dailyData.id,
        piring_mbg_id: dailyData.piring_mbg_id,
        class_id: dailyData.class_id,
        jurusan: classData.major || null,
        kelas: classData.class || null,
        total_students: dailyData.total_students,
        attended_students: dailyData.attended_students,
        returned_plates: dailyData.returned_plates,
        student_representative: dailyData.student_representative,
        stok_after: stokAfter,
        created_at: dailyData.created_at,
        updated_at: dailyData.updated_at
      }
    });
  } catch (error) {
    console.error('Error creating mbg class daily:', error);
    if (error && error.message && /does not exist|column .* does not exist/i.test(error.message)) {
      return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada struktur database. Silakan hubungi administrator.' });
    }
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat membuat MBG class daily' });
  }
});

// UPDATE mbg class daily
router.patch('/class-daily/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { total_students, attended_students, returned_plates, class_code, student_representative } = req.body;
    
    // Cek apakah data ada
    const checkData = await pool.query(
      'SELECT id FROM mbg_class_daily WHERE id = $1',
      [id]
    );
    
    if (checkData.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'MBG class daily tidak ditemukan'
      });
    }
    
    let query = 'UPDATE mbg_class_daily SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (total_students !== undefined) {
      query += `, total_students = $${paramIndex}`;
      params.push(total_students);
      paramIndex++;
    }
    
    if (attended_students !== undefined) {
      query += `, attended_students = $${paramIndex}`;
      params.push(attended_students);
      paramIndex++;
    }
    
    if (returned_plates !== undefined) {
      query += `, returned_plates = $${paramIndex}`;
      params.push(returned_plates);
      paramIndex++;
    }
    
    if (class_code !== undefined) {
      query += `, class_code = $${paramIndex}`;
      params.push(class_code);
      paramIndex++;
    }
    
    if (student_representative !== undefined) {
      query += `, student_representative = $${paramIndex}`;
      params.push(student_representative);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'MBG class daily berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating mbg class daily:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate MBG class daily',
      error: error.message
    });
  }
});

// DELETE mbg class daily
router.delete('/class-daily/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM mbg_class_daily WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'MBG class daily tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'MBG class daily berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting mbg class daily:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus MBG class daily',
      error: error.message
    });
  }
});

// ==================== MBG TEACHER EXCESS CRUD ====================

// GET all mbg teacher excess
router.get('/teacher-excess', async (req, res) => {
  try {
    const { page = 1, limit = 10, piring_mbg_id, teacher_id } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT mte.id, mte.piring_mbg_id, mte.teacher_id, mte.quantity,
             mte.location, mte.notes, mte.created_at, mte.updated_at,
             p.stok, p.tanggal_distribusi,
             t.name as teacher_name, t.nip
      FROM mbg_teacher_excess mte
      LEFT JOIN piring_mbg p ON mte.piring_mbg_id = p.id
      LEFT JOIN teachers t ON mte.teacher_id = t.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (piring_mbg_id) {
      query += ` AND mte.piring_mbg_id = $${paramIndex}`;
      params.push(piring_mbg_id);
      paramIndex++;
    }
    
    if (teacher_id) {
      query += ` AND mte.teacher_id = $${paramIndex}`;
      params.push(teacher_id);
      paramIndex++;
    }
    
    query += ` ORDER BY mte.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM mbg_teacher_excess WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (piring_mbg_id) {
      countQuery += ` AND piring_mbg_id = $${countParamIndex}`;
      countParams.push(piring_mbg_id);
      countParamIndex++;
    }
    
    if (teacher_id) {
      countQuery += ` AND teacher_id = $${countParamIndex}`;
      countParams.push(teacher_id);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data MBG teacher excess berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching mbg teacher excess:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data MBG teacher excess',
      error: error.message
    });
  }
});

// GET mbg teacher excess by ID
router.get('/teacher-excess/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT mte.id, mte.piring_mbg_id, mte.teacher_id, mte.quantity,
             mte.location, mte.notes, mte.created_at, mte.updated_at,
             p.stok, p.tanggal_distribusi,
             t.name as teacher_name, t.nip
      FROM mbg_teacher_excess mte
      LEFT JOIN piring_mbg p ON mte.piring_mbg_id = p.id
      LEFT JOIN teachers t ON mte.teacher_id = t.id
      WHERE mte.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'MBG teacher excess tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data MBG teacher excess berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching mbg teacher excess:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data MBG teacher excess',
      error: error.message
    });
  }
});

// CREATE mbg teacher excess
router.post('/teacher-excess', async (req, res) => {
  try {
    const { piring_mbg_id, teacher_id, quantity = 0, location, notes } = req.body;
    
    // Validasi input
    if (!piring_mbg_id || !teacher_id) {
      return res.status(400).json({
        success: false,
        message: 'Piring MBG ID dan Teacher ID harus diisi'
      });
    }
    
    const query = `
      INSERT INTO mbg_teacher_excess (piring_mbg_id, teacher_id, quantity, location, notes, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      piring_mbg_id, teacher_id, quantity, location, notes
    ]);
    
    res.status(201).json({
      success: true,
      message: 'MBG teacher excess berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating mbg teacher excess:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat MBG teacher excess',
      error: error.message
    });
  }
});

// UPDATE mbg teacher excess
router.patch('/teacher-excess/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, location, notes } = req.body;
    
    // Cek apakah data ada
    const checkData = await pool.query(
      'SELECT id FROM mbg_teacher_excess WHERE id = $1',
      [id]
    );
    
    if (checkData.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'MBG teacher excess tidak ditemukan'
      });
    }
    
    let query = 'UPDATE mbg_teacher_excess SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (quantity !== undefined) {
      query += `, quantity = $${paramIndex}`;
      params.push(quantity);
      paramIndex++;
    }
    
    if (location !== undefined) {
      query += `, location = $${paramIndex}`;
      params.push(location);
      paramIndex++;
    }
    
    if (notes !== undefined) {
      query += `, notes = $${paramIndex}`;
      params.push(notes);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'MBG teacher excess berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating mbg teacher excess:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate MBG teacher excess',
      error: error.message
    });
  }
});

// DELETE mbg teacher excess
router.delete('/teacher-excess/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM mbg_teacher_excess WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'MBG teacher excess tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'MBG teacher excess berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting mbg teacher excess:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus MBG teacher excess',
      error: error.message
    });
  }
});

module.exports = router;
