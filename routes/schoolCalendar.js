const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== SCHOOL CALENDAR CRUD ====================

// GET all school calendar entries
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, year, month, status } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT id, date, year, month, day, status, created_at, updated_at
      FROM school_calendar
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (year) {
      query += ` AND year = $${paramIndex}`;
      params.push(year);
      paramIndex++;
    }
    
    if (month) {
      query += ` AND month = $${paramIndex}`;
      params.push(month);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM school_calendar WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (year) {
      countQuery += ` AND year = $${countParamIndex}`;
      countParams.push(year);
      countParamIndex++;
    }
    
    if (month) {
      countQuery += ` AND month = $${countParamIndex}`;
      countParams.push(month);
      countParamIndex++;
    }
    
    if (status) {
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data school calendar berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching school calendar:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data school calendar',
      error: error.message
    });
  }
});

// GET school calendar by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT id, date, year, month, day, status, created_at, updated_at
      FROM school_calendar
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'School calendar tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data school calendar berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching school calendar:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data school calendar',
      error: error.message
    });
  }
});

// GET school calendar by DATE (format: YYYY-MM-DD)
router.get('/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal harus diisi (format: YYYY-MM-DD)'
      });
    }

    // Validate date format (basic check)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid (gunakan YYYY-MM-DD)'
      });
    }

    const query = `
      SELECT id, date, year, month, day, status, created_at, updated_at
      FROM school_calendar
      WHERE DATE(date) = $1
    `;

    const result = await pool.query(query, [date]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `School calendar tidak ditemukan untuk tanggal ${date}`
      });
    }

    res.json({
      success: true,
      message: 'Data school calendar berdasarkan tanggal berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching school calendar by date:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data school calendar berdasarkan tanggal',
      error: error.message
    });
  }
});

// CREATE school calendar entry
router.post('/', async (req, res) => {
  try {
    const { date, status = 'aktif' } = req.body;
    
    // Validasi input
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date harus diisi'
      });
    }
    
    // Validasi status
    if (!['aktif', 'libur'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus aktif atau libur'
      });
    }
    
    // Cek duplicate date
    const checkDate = await pool.query(
      'SELECT id FROM school_calendar WHERE date = $1',
      [date]
    );
    
    if (checkDate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Tanggal sudah terdaftar'
      });
    }
    
    // Parse date untuk dapatkan year, month, day
    const dateObj = new Date(date);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    
    const query = `
      INSERT INTO school_calendar (date, year, month, day, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [date, year, month, day, status]);
    
    res.status(201).json({
      success: true,
      message: 'School calendar berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating school calendar:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat school calendar',
      error: error.message
    });
  }
});

// UPDATE school calendar
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Cek apakah calendar ada
    const checkCalendar = await pool.query(
      'SELECT id FROM school_calendar WHERE id = $1',
      [id]
    );
    
    if (checkCalendar.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'School calendar tidak ditemukan'
      });
    }
    
    // Validasi status
    if (status && !['aktif', 'libur'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus aktif atau libur'
      });
    }
    
    const query = `
      UPDATE school_calendar 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [status, id]);
    
    res.json({
      success: true,
      message: 'School calendar berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating school calendar:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate school calendar',
      error: error.message
    });
  }
});

// DELETE school calendar
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM school_calendar WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'School calendar tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'School calendar berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting school calendar:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus school calendar',
      error: error.message
    });
  }
});

module.exports = router;
