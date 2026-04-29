const express = require('express');
const router = express.Router();
const controller = require('../controllers/studentNotificationController');
const attendanceSubmissionController = require('../controllers/attendanceSubmissionController');
const { requireStudent } = require('../middlewares/auth.middleware');
const { readLimiter, attendanceLimiter } = require('../middlewares/rateLimiter');

// GET notifications for authenticated student
router.get('/notifications', requireStudent, readLimiter, controller.getNotifications);

// POST submit attendance reason (for alpa -> sakit/izin)
router.post('/attendance/:attendance_id', requireStudent, attendanceLimiter, attendanceSubmissionController.submitAttendanceReason);

module.exports = router;
