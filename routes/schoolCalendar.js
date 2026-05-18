const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middlewares/auth.middleware');
const { readLimiter } = require('../middlewares/rateLimiter');

// GET school calendar entries with optional filter
// GET /api/school-calendar?year=2026&month=3&page=1
router.get('/', readLimiter, async (req, res) => {
  try {
    const { page = 1, limit = 31, year, month } = req.query;
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

    // Count total before pagination
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
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    query += ` ORDER BY date ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data school calendar berhasil diambil',
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching school calendar:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data school calendar', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET school calendar by date (used by prescientia_fe and prescientia_guru_fe)
// GET /api/school-calendar/by-date/2026-03-07
router.get('/by-date/:dateStr', readLimiter, async (req, res) => {
  try {
    const { dateStr } = req.params;

    const result = await pool.query(
      'SELECT id, date, year, month, day, status, created_at, updated_at FROM school_calendar WHERE date = $1',
      [dateStr]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data kalender tidak ditemukan untuk tanggal tersebut' });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching school calendar by date:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// POST create school calendar entry
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { date, status } = req.body;

    if (!date || !status) {
      return res.status(400).json({ success: false, message: 'date dan status harus diisi' });
    }

    const dateObj = new Date(date);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();

    const result = await pool.query(
      `INSERT INTO school_calendar (date, year, month, day, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
      [date, year, month, day, status]
    );

    res.status(201).json({ success: true, message: 'School calendar entry berhasil ditambahkan', data: result.rows[0] });
  } catch (error) {
    console.error('Error creating school calendar:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// PUT update school calendar entry
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, status } = req.body;

    let year, month, day;
    if (date) {
      const dateObj = new Date(date);
      year = dateObj.getFullYear();
      month = dateObj.getMonth() + 1;
      day = dateObj.getDate();
    }

    const result = await pool.query(
      `UPDATE school_calendar SET
       date = COALESCE($1, date), year = COALESCE($2, year), month = COALESCE($3, month),
       day = COALESCE($4, day), status = COALESCE($5, status), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [date || null, year || null, month || null, day || null, status || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'School calendar entry tidak ditemukan' });
    }

    res.json({ success: true, message: 'School calendar entry berhasil diupdate', data: result.rows[0] });
  } catch (error) {
    console.error('Error updating school calendar:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// DELETE school calendar entry
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM school_calendar WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'School calendar entry tidak ditemukan' });
    }

    res.json({ success: true, message: 'School calendar entry berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting school calendar:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
