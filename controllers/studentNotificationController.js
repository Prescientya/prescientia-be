const service = require('../services/studentNotificationService');

/**
 * GET /api/student/notifications
 * Requires `req.user` populated by authentication middleware.
 */
const getNotifications = async (req, res) => {
  try {
    // Use student_id from req.user (mandatory). Do NOT use user_id for attendance queries.
    // Coerce to Number to avoid string/number mismatches from JWT parsing.
    const studentId = req.user && Number(req.user.student_id);
    if (!studentId || isNaN(studentId)) return res.status(401).json({ success: false, message: 'Unauthorized: student_id tidak ditemukan di token' });

    const data = await service.getAlphaNotificationsForStudent(studentId);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Controller getNotifications error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
};

module.exports = {
  getNotifications
};
