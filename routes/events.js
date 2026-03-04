const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getEvents, getEventDetail } = require('../controllers/eventController');

// Middleware that accepts EITHER teacher OR student tokens.
// Decodes JWT manually and sets req.user based on user_type.
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
        };
        return next();
      } else if (decoded.user_type === 'student') {
        req.user = {
          user_id: decoded.user_id,
          student_id: decoded.student_id,
          role: decoded.student_role || null,
          class_id: decoded.class_id || null,
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

// GET /api/events - list events for the authenticated user
router.get('/', requireAuth, getEvents);

// GET /api/events/:id - single event detail
router.get('/:id', requireAuth, getEventDetail);

module.exports = router;
