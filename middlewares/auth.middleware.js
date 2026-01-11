const jwt = require('jsonwebtoken');

// Helper: extract Bearer token from Authorization header
function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || typeof authHeader !== 'string') return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2) return null;
  const scheme = parts[0];
  const token = parts[1];
  if (!/^Bearer$/i.test(scheme)) return null;
  return token;
}

// requireStudent middleware
// - verifies JWT using process.env.JWT_SECRET
// - ensures decoded.user_type === 'student'
// - attaches decoded payload to req.user
// - responds with Indonesian error messages on failure
function requireStudent(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }

    // Use same secret fallback as used when signing the token in auth route
    const secret = process.env.JWT_SECRET || 'change_this_secret';

    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ success: false, message: 'Token kadaluwarsa. Silakan login kembali.' });
        }
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

        // Ensure token contains required shape and mandatory student_id
        // student_id is mandatory because authorization for attendance/notifications
        // must be performed against the student identifier, not the user_id.
        if (!decoded || decoded.user_type !== 'student' || !decoded.student_id) {
          return res.status(401).json({ success: false, message: 'Token tidak valid atau tidak mengandung student_id.' });
        }

        // Attach a minimal, explicit `req.user` shape for downstream authorization.
        // Important: use `student_id` for ownership checks of attendance/notifications.
        req.user = {
          user_id: decoded.user_id,
          student_id: decoded.student_id,
          role: decoded.student_role || null,
          class_id: decoded.class_id || null
        };

        return next();
    });
  } catch (error) {
    console.error('requireStudent error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

// requireKM middleware
// - MUST run after requireStudent
// - does NOT re-verify the token; it uses req.user populated by requireStudent
function requireKM(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: middleware requireStudent harus dijalankan terlebih dahulu.' });
    }

    if (req.user.student_role !== 'KM') {
      return res.status(403).json({ success: false, message: 'Akses terlarang: dibutuhkan peran KM.' });
    }

    return next();
  } catch (error) {
    console.error('requireKM error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

module.exports = {
  requireStudent,
  requireKM
};
