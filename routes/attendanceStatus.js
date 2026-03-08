const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth.middleware');
const {
  changeAttendanceStatus,
  getStatusChangeLogs,
  getLogsByStudent,
  getLogsByClass
} = require('../controllers/attendanceStatusController');

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
