const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin, requireStudentOrTeacher } = require('../middlewares/auth.middleware');

// GET all wifi networks (used by prescientia_fe and prescientia_guru_fe)
// Hanya siswa dan guru yang boleh mengakses daftar WiFi (bukan admin umum)
// GET /api/wifi-networks?limit=1000
router.get('/', requireStudentOrTeacher, async (req, res) => {
  try {
    const { limit = 1000 } = req.query;

    const query = `
      SELECT id, ssid, bssid, ip_address, created_at, updated_at
      FROM wifi_networks
      ORDER BY ssid ASC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);

    res.json({
      success: true,
      message: 'Data wifi networks berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching wifi networks:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data wifi networks', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET wifi network by ID
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT id, ssid, bssid, ip_address, created_at, updated_at FROM wifi_networks WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Wifi network tidak ditemukan' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching wifi network:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// POST create wifi network
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { ssid, bssid, ip_address } = req.body;

    if (!ssid || !bssid) {
      return res.status(400).json({ success: false, message: 'ssid dan bssid harus diisi' });
    }

    const result = await pool.query(
      `INSERT INTO wifi_networks (ssid, bssid, ip_address, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
      [ssid, bssid, ip_address || null]
    );

    res.status(201).json({ success: true, message: 'Wifi network berhasil ditambahkan', data: result.rows[0] });
  } catch (error) {
    console.error('Error creating wifi network:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// PUT update wifi network
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { ssid, bssid, ip_address } = req.body;

    const result = await pool.query(
      `UPDATE wifi_networks SET ssid = COALESCE($1, ssid), bssid = COALESCE($2, bssid),
       ip_address = COALESCE($3, ip_address), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [ssid, bssid, ip_address, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Wifi network tidak ditemukan' });
    }

    res.json({ success: true, message: 'Wifi network berhasil diupdate', data: result.rows[0] });
  } catch (error) {
    console.error('Error updating wifi network:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// DELETE wifi network
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM wifi_networks WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Wifi network tidak ditemukan' });
    }

    res.json({ success: true, message: 'Wifi network berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting wifi network:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
