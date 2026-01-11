const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==================== WIFI NETWORKS CRUD ====================

// GET all wifi networks
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, ssid } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT id, ssid, bssid, ip_address, created_at, updated_at
      FROM wifi_networks
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (ssid) {
      query += ` AND ssid ILIKE $${paramIndex}`;
      params.push(`%${ssid}%`);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM wifi_networks WHERE 1=1';
    const countParams = [];
    
    if (ssid) {
      countQuery += ` AND ssid ILIKE $1`;
      countParams.push(`%${ssid}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data wifi networks berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching wifi networks:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data wifi networks',
      error: error.message
    });
  }
});

// GET wifi network by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT id, ssid, bssid, ip_address, created_at, updated_at
      FROM wifi_networks
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wifi network tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data wifi network berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching wifi network:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data wifi network',
      error: error.message
    });
  }
});

// CREATE wifi network
router.post('/', async (req, res) => {
  try {
    const { ssid, bssid, ip_address } = req.body;
    
    // Validasi input
    if (!ssid || !bssid) {
      return res.status(400).json({
        success: false,
        message: 'SSID dan BSSID harus diisi'
      });
    }
    
    // Cek duplicate BSSID
    const checkBssid = await pool.query(
      'SELECT id FROM wifi_networks WHERE bssid = $1',
      [bssid]
    );
    
    if (checkBssid.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'BSSID sudah terdaftar'
      });
    }
    
    const query = `
      INSERT INTO wifi_networks (ssid, bssid, ip_address, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [ssid, bssid, ip_address]);
    
    res.status(201).json({
      success: true,
      message: 'Wifi network berhasil dibuat',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating wifi network:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat wifi network',
      error: error.message
    });
  }
});

// UPDATE wifi network
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ssid, bssid, ip_address } = req.body;
    
    // Cek apakah wifi ada
    const checkWifi = await pool.query(
      'SELECT id FROM wifi_networks WHERE id = $1',
      [id]
    );
    
    if (checkWifi.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wifi network tidak ditemukan'
      });
    }
    
    // Cek duplicate BSSID jika diubah
    if (bssid) {
      const checkBssid = await pool.query(
        'SELECT id FROM wifi_networks WHERE bssid = $1 AND id != $2',
        [bssid, id]
      );
      
      if (checkBssid.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'BSSID sudah digunakan wifi lain'
        });
      }
    }
    
    let query = 'UPDATE wifi_networks SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (ssid) {
      query += `, ssid = $${paramIndex}`;
      params.push(ssid);
      paramIndex++;
    }
    
    if (bssid) {
      query += `, bssid = $${paramIndex}`;
      params.push(bssid);
      paramIndex++;
    }
    
    if (ip_address !== undefined) {
      query += `, ip_address = $${paramIndex}`;
      params.push(ip_address);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Wifi network berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating wifi network:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate wifi network',
      error: error.message
    });
  }
});

// DELETE wifi network
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM wifi_networks WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wifi network tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Wifi network berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting wifi network:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus wifi network',
      error: error.message
    });
  }
});

module.exports = router;
