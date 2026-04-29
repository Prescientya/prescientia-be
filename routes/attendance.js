const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireStudent } = require('../middlewares/auth.middleware');
const { attendanceLimiter, readLimiter } = require('../middlewares/rateLimiter');

// ==================== WIFI-BASED ATTENDANCE VALIDATION ====================

/**
 * Match scanned Wi-Fi networks against database records.
 * 
 * @param {Array} scannedWifi - Array of { ssid, bssid } from client
 * @param {Array} dbNetworks - Array of rows from wifi_networks table
 * @returns {Object|null} - Matched network info or null if no match
 * 
 * Matching priority:
 * 1. BSSID (exact, case-insensitive) - most reliable
 * 2. SSID (exact, case-insensitive) - fallback only
 */
function matchWifiNetworks(scannedWifi, dbNetworks) {
  // First pass: Try BSSID matching (highest priority)
  for (const scanned of scannedWifi) {
    const scannedBssid = (scanned.bssid || '').toLowerCase().trim();
    if (!scannedBssid) continue;

    for (const dbNet of dbNetworks) {
      const dbBssid = (dbNet.bssid || '').toLowerCase().trim();
      
      if (scannedBssid === dbBssid) {
        console.log(`[Attendance] BSSID match found: ${scannedBssid}`);
        return {
          wifi_id: dbNet.id,
          detected_by: 'BSSID',
          matched_ssid: dbNet.ssid,
          matched_bssid: dbBssid,
          scanned_ssid: scanned.ssid,
          scanned_bssid: scannedBssid,
        };
      }
    }
  }

  // Second pass: Try SSID matching (fallback)
  for (const scanned of scannedWifi) {
    const scannedSsid = (scanned.ssid || '').toLowerCase().trim();
    if (!scannedSsid) continue;

    for (const dbNet of dbNetworks) {
      const dbSsid = (dbNet.ssid || '').toLowerCase().trim();
      
      if (scannedSsid === dbSsid) {
        console.log(`[Attendance] SSID match found: ${scannedSsid}`);
        return {
          wifi_id: dbNet.id,
          detected_by: 'SSID',
          matched_ssid: dbSsid,
          matched_bssid: dbNet.bssid,
          scanned_ssid: scannedSsid,
          scanned_bssid: scanned.bssid,
        };
      }
    }
  }

  // No match found
  return null;
}

/**
 * POST /api/attendance/scan
 * 
 * Validates attendance based on scanned Wi-Fi networks.
 * Frontend sends all nearby Wi-Fi data, backend makes the decision.
 * 
 * Request body:
 * {
 *   "user_id": 12,
 *   "scanned_wifi": [
 *     { "ssid": "WIFI_SCHOOL", "bssid": "9a:bc:de:12:34:56" },
 *     { "ssid": "MyHotspot", "bssid": "aa:bb:cc:dd:ee:ff" }
 *   ]
 * }
 * 
 * Response (success - 200):
 * {
 *   "success": true,
 *   "message": "Kehadiran berhasil divalidasi",
 *   "data": {
 *     "presence_log_id": 123,
 *     "wifi_id": 1,
 *     "detected_by": "BSSID",
 *     "matched_ssid": "WIFI_SCHOOL",
 *     "matched_bssid": "9a:bc:de:12:34:56"
 *   }
 * }
 * 
 * Response (failure - 403):
 * {
 *   "success": false,
 *   "message": "Not connected to authorized school Wi-Fi"
 * }
 */
router.post('/scan', requireStudent, attendanceLimiter, async (req, res) => {
  try {
    const { user_id, scanned_wifi } = req.body;

    // ========== Input Validation ==========
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'user_id is required'
      });
    }

    if (!scanned_wifi || !Array.isArray(scanned_wifi) || scanned_wifi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'scanned_wifi must be a non-empty array'
      });
    }

    console.log(`[Attendance] Validating attendance for user_id=${user_id}`);
    console.log(`[Attendance] Received ${scanned_wifi.length} scanned networks`);

    // ========== Validate User Exists ==========
    const userCheck = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // ========== Fetch All Registered Wi-Fi Networks ==========
    const wifiResult = await pool.query(
      'SELECT id, ssid, bssid, ip_address FROM wifi_networks'
    );
    const dbNetworks = wifiResult.rows;

    console.log(`[Attendance] Database has ${dbNetworks.length} registered networks`);

    if (dbNetworks.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'No Wi-Fi networks registered in database'
      });
    }

    // ========== Match Scanned Wi-Fi Against Database ==========
    const match = matchWifiNetworks(scanned_wifi, dbNetworks);

    if (!match) {
      // No authorized Wi-Fi found in scan results
      console.log(`[Attendance] No match found for user_id=${user_id}`);
      return res.status(403).json({
        success: false,
        message: 'Not connected to authorized school Wi-Fi',
        detail: 'Tidak terdeteksi jaringan WiFi sekolah yang terdaftar'
      });
    }

    // ========== Insert Presence Log ==========
    const insertQuery = `
      INSERT INTO wifi_presence_logs (user_id, wifi_id, detected_by, detected_at, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW(), NOW())
      RETURNING id, user_id, wifi_id, detected_by, detected_at, created_at
    `;

    const insertResult = await pool.query(insertQuery, [
      user_id,
      match.wifi_id,
      match.detected_by
    ]);

    const presenceLog = insertResult.rows[0];

    console.log(`[Attendance] Presence logged: id=${presenceLog.id}, wifi_id=${match.wifi_id}, detected_by=${match.detected_by}`);

    // ========== Success Response ==========
    return res.status(200).json({
      success: true,
      message: 'Kehadiran berhasil divalidasi',
      data: {
        presence_log_id: presenceLog.id,
        wifi_id: match.wifi_id,
        detected_by: match.detected_by,
        matched_ssid: match.matched_ssid,
        matched_bssid: match.matched_bssid,
        detected_at: presenceLog.detected_at
      }
    });

  } catch (error) {
    console.error('[Attendance] Error validating attendance:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memvalidasi kehadiran',
      error: error.message
    });
  }
});

/**
 * GET /api/attendance/check/:user_id
 * 
 * Check if user has already submitted attendance today.
 * Useful to prevent duplicate attendance submissions.
 */
router.get('/check/:user_id', requireAuth, readLimiter, async (req, res) => {
  try {
    const { user_id } = req.params;

    // Check for today's presence log
    const result = await pool.query(`
      SELECT wpl.id, wpl.wifi_id, wpl.detected_by, wpl.detected_at,
             wn.ssid, wn.bssid
      FROM wifi_presence_logs wpl
      LEFT JOIN wifi_networks wn ON wpl.wifi_id = wn.id
      WHERE wpl.user_id = $1
        AND DATE(wpl.detected_at) = CURRENT_DATE
      ORDER BY wpl.detected_at DESC
      LIMIT 1
    `, [user_id]);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        has_attendance_today: false,
        message: 'Belum ada kehadiran hari ini'
      });
    }

    return res.status(200).json({
      success: true,
      has_attendance_today: true,
      message: 'Sudah ada kehadiran hari ini',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('[Attendance] Error checking attendance:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengecek kehadiran',
      error: error.message
    });
  }
});

// ==================== LAST PERIOD END TIME ====================

/**
 * GET /api/attendance/last-period-today
 * Returns the end_time of the last lesson period for today's day of week.
 * Used by Flutter apps to schedule checkout notifications.
 */
router.get('/last-period-today', requireAuth, readLimiter, async (req, res) => {
  try {
    const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const now = new Date();
    const day = days[now.getDay()];

    if (day === 'minggu' || day === 'sabtu') {
      return res.json({
        success: true,
        data: null,
        message: 'Tidak ada jam pelajaran pada hari ini'
      });
    }

    const result = await pool.query(
      `SELECT end_time
       FROM class_periods
       WHERE day = $1
         AND activity_type = 'lesson'
       ORDER BY sequence DESC
       LIMIT 1`,
      [day]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: null,
        message: 'Tidak ada jam pelajaran yang ditemukan untuk hari ini'
      });
    }

    return res.json({
      success: true,
      data: {
        day: day,
        end_time: result.rows[0].end_time
      }
    });
  } catch (error) {
    console.error('[Attendance] Error getting last period:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan',
      error: error.message
    });
  }
});

module.exports = router;
