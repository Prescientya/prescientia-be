const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireStudent } = require('../middlewares/auth.middleware');
const { attendanceLimiter, readLimiter } = require('../middlewares/rateLimiter');

// Logging hanya di non-production agar tidak membanjiri stdout di-prod (1 log per scan = ratusan/ribuan baris/jam).
const isDev = process.env.NODE_ENV !== 'production';
const devLog = (...args) => { if (isDev) console.log(...args); };

// ==================== WIFI-BASED ATTENDANCE VALIDATION ====================

// Format BSSID standar: 6 oktet hex dipisah ':' (case-insensitive)
const BSSID_FORMAT = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

/**
 * Match scanned Wi-Fi networks against database records.
 *
 * SECURITY: hanya cocokkan berdasarkan BSSID (MAC address AP). Fallback SSID
 * dihapus karena SSID adalah nama jaringan yang sepele di-clone via hotspot
 * dengan nama yang sama — bukan bukti kehadiran fisik di sekolah.
 *
 * @param {Array} scannedWifi - Array of { ssid, bssid } from client
 * @param {Array} dbNetworks - Array of rows from wifi_networks table
 * @returns {Object|null} - Matched network info or null if no match
 */
function matchWifiNetworks(scannedWifi, dbNetworks) {
  for (const scanned of scannedWifi) {
    const scannedBssid = (scanned.bssid || '').toLowerCase().trim();
    if (!scannedBssid) continue;

    for (const dbNet of dbNetworks) {
      const dbBssid = (dbNet.bssid || '').toLowerCase().trim();

      if (scannedBssid === dbBssid) {
        devLog(`[Attendance] BSSID match found: ${scannedBssid}`);
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
    const { scanned_wifi } = req.body;
    // SECURITY: user_id WAJIB diambil dari JWT (req.user) — jangan trust body.
    // Sebelumnya user_id dibaca dari body sehingga siswa A bisa absen atas nama siswa B.
    const user_id = req.user && req.user.user_id;

    // ========== Input Validation ==========
    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: 'Token tidak mengandung user_id yang valid'
      });
    }

    if (!scanned_wifi || !Array.isArray(scanned_wifi) || scanned_wifi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'scanned_wifi must be a non-empty array'
      });
    }

    // SECURITY: pastikan setiap entry membawa BSSID format MAC valid.
    // Tolak payload yang berisi BSSID asal/string sampah agar tidak mengisi log
    // dengan probe palsu dan agar matching tidak rancu.
    const sanitizedWifi = [];
    for (const w of scanned_wifi) {
      if (!w || typeof w !== 'object') continue;
      const bssid = (w.bssid || '').toString().toLowerCase().trim();
      if (!BSSID_FORMAT.test(bssid)) continue;
      sanitizedWifi.push({
        ssid: typeof w.ssid === 'string' ? w.ssid : null,
        bssid,
        rssi: Number.isFinite(w.rssi) ? w.rssi : null,
        frequency: Number.isFinite(w.frequency) ? w.frequency : null,
      });
    }
    if (sanitizedWifi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Format BSSID tidak valid pada scanned_wifi'
      });
    }

    devLog(`[Attendance] Validating attendance for user_id=${user_id}`);
    devLog(`[Attendance] Received ${sanitizedWifi.length} valid scanned networks (rssi/freq disertakan bila ada)`);

    // ========== Cegah Duplikat Absensi Hari Ini ==========
    const dupCheck = await pool.query(
      `SELECT id FROM wifi_presence_logs
       WHERE user_id = $1 AND DATE(detected_at) = CURRENT_DATE
       LIMIT 1`,
      [user_id]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Anda sudah melakukan absensi hari ini',
        already_attended: true
      });
    }

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

    devLog(`[Attendance] Database has ${dbNetworks.length} registered networks`);

    if (dbNetworks.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'No Wi-Fi networks registered in database'
      });
    }

    // ========== Match Scanned Wi-Fi Against Database ==========
    const match = matchWifiNetworks(sanitizedWifi, dbNetworks);

    if (!match) {
      // No authorized Wi-Fi found in scan results
      devLog(`[Attendance] No match found for user_id=${user_id}`);
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

    devLog(`[Attendance] Presence logged: id=${presenceLog.id}, wifi_id=${match.wifi_id}, detected_by=${match.detected_by}`);

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
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
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

    // SECURITY: cegah user A mengintip status absensi user B.
    // Hanya owner (atau admin) yang boleh cek.
    const requesterId = req.user && req.user.user_id;
    const requesterType = req.user && req.user.user_type;
    if (requesterType !== 'admin' && String(requesterId) !== String(user_id)) {
      return res.status(403).json({
        success: false,
        message: 'Akses terlarang: tidak boleh memeriksa status absensi pengguna lain'
      });
    }

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
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
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
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

module.exports = router;
