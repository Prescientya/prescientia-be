const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const {
  changeAttendanceStatus,
  getStatusChangeLogs,
  getLogsByStudent,
  getLogsByClass
} = require('../controllers/attendanceStatusController');

// ==================== AUTH MIDDLEWARE ====================
// Middleware yang menerima token guru ATAU siswa.
// Sama seperti di events.js — decode JWT manual, set req.user berdasarkan user_type.
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
      return res.status(401).json({ success: false, message: 'Format token tidak valid.' });
    }
    const token = parts[1];
    const secret = process.env.JWT_SECRET || 'change_this_secret';

    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        return res.status(401).json({ success: false, message: 'Token tidak valid. Silakan login kembali.' });
      }
      if (!decoded || !decoded.user_type) {
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

      if (decoded.user_type === 'teacher') {
        req.user = {
          user_id: decoded.user_id,
          teacher_id: decoded.teacher_id,
          user_type: 'teacher',
          department: decoded.department || null,
          teacher_roles: Array.isArray(decoded.teacher_roles) ? decoded.teacher_roles : [],
          homeroom_classes: decoded.homeroom_classes || null
        };
        return next();
      } else if (decoded.user_type === 'student') {
        req.user = {
          user_id: decoded.user_id,
          student_id: decoded.student_id,
          user_type: 'student',
          role: decoded.student_role || null,
          class_id: decoded.class_id || null
        };
        return next();
      } else {
        return res.status(401).json({ success: false, message: 'Tipe pengguna tidak diizinkan.' });
      }
    });
  } catch (error) {
    console.error('requireAuth error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

// ==================== ROUTES ====================

// POST /api/attendance-status/change-status — Ubah status kehadiran siswa
router.post('/change-status', requireAuth, changeAttendanceStatus);

// GET /api/attendance-status/logs/:attendance_id — Log perubahan per attendance
router.get('/logs/:attendance_id', requireAuth, getStatusChangeLogs);

// GET /api/attendance-status/logs/student/:student_id — Log perubahan per siswa (hari ini / tanggal tertentu)
router.get('/logs/student/:student_id', requireAuth, getLogsByStudent);

// GET /api/attendance-status/logs/class/:class_id — Log perubahan per kelas (hari ini / tanggal tertentu)
router.get('/logs/class/:class_id', requireAuth, getLogsByClass);

module.exports = router;
