const jwt = require('jsonwebtoken');
const { checkTokenState } = require('../utils/tokenBlacklist');

const JWT_SECRET = process.env.JWT_SECRET;

// SECURITY: whitelist algorithm eksplisit. Mencegah algorithm-confusion attack
// dan menutup jalur `alg: none` jika ada celah di versi library.
const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] };

// Perilaku saat Redis (sumber kebenaran revocation) tak terjangkau.
// Default FAIL-CLOSED: tolak token (503) — token 30 hari membuat blacklist
// satu-satunya tombol kill, jadi fail-open akan melumpuhkan revocation total.
// Set REVOCATION_FAIL_OPEN=true HANYA bila availability lebih diprioritaskan
// daripada jaminan revocation saat Redis down (keputusan sadar).
const REVOCATION_FAIL_OPEN = String(process.env.REVOCATION_FAIL_OPEN || '').toLowerCase() === 'true';

// Validasi status token terhadap Redis (blacklist jti + cutoff password) lewat
// helper bersama `checkTokenState`, lalu petakan ke response HTTP + terapkan
// kebijakan fail-open/closed. Mengembalikan boolean (true bila valid/lanjut);
// bila false, response sudah dikirim.
async function ensureNotRevoked(decoded, res) {
  if (!decoded) return true;

  let state;
  try {
    state = await checkTokenState(decoded);
  } catch (err) {
    // Redis tak terjangkau. FAIL-CLOSED (default): tolak agar token yang mungkin
    // sudah di-revoke tidak lolos. 503 (retryable), bukan 401, supaya klien tahu
    // ini gangguan sementara — bukan kredensial salah.
    if (REVOCATION_FAIL_OPEN) {
      console.error('ensureNotRevoked: Redis error, FAIL-OPEN (token diloloskan):', err.message);
      return true;
    }
    console.error('ensureNotRevoked: Redis error, FAIL-CLOSED (token ditolak):', err.message);
    res.status(503).json({
      success: false,
      message: 'Layanan autentikasi sedang tidak tersedia. Coba lagi sebentar lagi.'
    });
    return false;
  }

  if (!state.ok) {
    const isRevoked = state.reason === 'token_revoked';
    res.status(401).json({
      success: false,
      message: isRevoked
        ? 'Token telah di-revoke. Silakan login kembali.'
        : 'Sesi tidak berlaku karena password telah diubah. Silakan login kembali.',
      [state.reason]: true
    });
    return false;
  }

  return true;
}

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

// Helper: cek apakah token akan expire dalam <= threshold hari
// Mengembalikan jumlah hari tersisa, atau null jika token tidak memiliki expiry
function getTokenExpiresInDays(decoded) {
  if (!decoded || !decoded.exp) return null;
  const msLeft = decoded.exp * 1000 - Date.now();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / (1000 * 60 * 60 * 24));
}

// requireStudent middleware
// - verifies JWT using process.env.JWT_SECRET
// - ensures decoded.user_type === 'student'
// - attaches decoded payload to req.user
// - jika token akan expire dalam <= 3 hari, menambahkan header X-Session-Warning
// NOTE: student tokens diterbitkan dengan expiry 30 hari (JWT_STUDENT_EXPIRE env, default '30d').
function requireStudent(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }

    jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS, async (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            message: 'Sesi Login sudah habis! harap login lagi ke akun Prescientia anda.',
            token_expired: true
          });
        }
        return res.status(401).json({ success: false, message: 'Token tidak valid. Silakan login kembali.' });
      }

      // Ensure token contains required shape and mandatory student_id
      // student_id is mandatory because authorization for attendance/notifications
      // must be performed against the student identifier, not the user_id.
      if (!decoded || decoded.user_type !== 'student' || !decoded.student_id) {
        return res.status(401).json({ success: false, message: 'Token tidak valid atau tidak mengandung student_id.' });
      }

      if (!(await ensureNotRevoked(decoded, res))) return;

      // Attach a minimal, explicit `req.user` shape for downstream authorization.
      // Important: use `student_id` for ownership checks of attendance/notifications.
      // Note: token mungkin membawa role di `class_role` (jalur login) atau `student_role` (legacy).
      req.user = {
        user_id: decoded.user_id,
        user_type: decoded.user_type,
        student_id: decoded.student_id,
        role: decoded.class_role || decoded.student_role || null,
        student_role: decoded.class_role || decoded.student_role || null,
        class_id: decoded.class_id || null
      };

      // Peringatan sesi akan habis: tambahkan header jika token <= 3 hari lagi expire
      const expiresInDays = getTokenExpiresInDays(decoded);
      if (expiresInDays !== null && expiresInDays <= 3) {
        res.setHeader('X-Session-Warning', 'expiring_soon');
        res.setHeader('X-Session-Expires-In-Days', String(expiresInDays));
        req.sessionExpiringSoon = true;
        req.sessionExpiresInDays = expiresInDays;
      }

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
// - Izinkan: KM (km), Wakil KM (wakil_km), Sekretaris (sekretaris)
// - CATATAN: database menyimpan role dalam lowercase (km, wakil_km, sekretaris)
function requireKM(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: middleware requireStudent harus dijalankan terlebih dahulu.' });
    }

    // Normalisasi ke lowercase untuk mencocokkan nilai di database
    const studentRole = (req.user.role || req.user.student_role || '').toString().toLowerCase().trim();

    // Izinkan semua petugas kelas: KM, Wakil KM, dan Sekretaris
    // Nilai di DB: 'km', 'wakil_km', 'sekretaris'
    const allowedRoles = ['km', 'wakil_km', 'sekretaris'];
    if (!allowedRoles.includes(studentRole)) {
      return res.status(403).json({
        success: false,
        message: 'Akses terlarang: dibutuhkan peran KM, Wakil KM, atau Sekretaris.'
      });
    }

    return next();
  } catch (error) {
    console.error('requireKM error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

// requireTeacher middleware
// - verifies JWT using process.env.JWT_SECRET
// - ensures decoded.user_type === 'teacher'
// - attaches decoded payload to req.user
// - jika token akan expire dalam <= 3 hari, menambahkan header X-Session-Warning
// NOTE: teacher tokens diterbitkan dengan expiry 30 hari (JWT_TEACHER_EXPIRE env, default '30d').
function requireTeacher(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }

    jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS, async (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            message: 'Sesi Login sudah habis! harap login lagi ke akun Prescientia anda.',
            token_expired: true
          });
        }
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

      // Ensure token contains required shape and mandatory teacher_id
      if (!decoded || decoded.user_type !== 'teacher' || !decoded.teacher_id) {
        return res.status(401).json({ success: false, message: 'Token tidak valid atau tidak mengandung teacher_id.' });
      }

      if (!(await ensureNotRevoked(decoded, res))) return;

      // Attach a minimal, explicit `req.user` shape for downstream authorization.
      // teacher_roles is an array of {role, class_id, class_name} objects.
      // Use req.user.teacher_roles to check if teacher is wali_kelas of a specific class.
      req.user = {
        user_id: decoded.user_id,
        teacher_id: decoded.teacher_id,
        user_type: decoded.user_type,
        department: decoded.department || null,
        teacher_roles: Array.isArray(decoded.teacher_roles) ? decoded.teacher_roles : [],
        homeroom_classes: decoded.homeroom_classes || null
      };

      // Peringatan sesi akan habis: tambahkan header jika token <= 3 hari lagi expire
      const expiresInDays = getTokenExpiresInDays(decoded);
      if (expiresInDays !== null && expiresInDays <= 3) {
        res.setHeader('X-Session-Warning', 'expiring_soon');
        res.setHeader('X-Session-Expires-In-Days', String(expiresInDays));
        req.sessionExpiringSoon = true;
        req.sessionExpiresInDays = expiresInDays;
      }

      return next();
    });
  } catch (error) {
    console.error('requireTeacher error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

// requireAdmin middleware
// - verifies JWT using process.env.JWT_SECRET
// - ensures decoded.user_type === 'admin'
// - attaches decoded payload to req.user
function requireAdmin(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }

    jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS, async (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ success: false, message: 'Token kadaluwarsa. Silakan login kembali.' });
        }
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

      if (!decoded || decoded.user_type !== 'admin' || !decoded.admin_id) {
        return res.status(403).json({ success: false, message: 'Akses terlarang. Hanya admin yang dapat mengakses endpoint ini.' });
      }

      if (!(await ensureNotRevoked(decoded, res))) return;

      req.user = {
        user_id: decoded.user_id,
        admin_id: decoded.admin_id,
        user_type: decoded.user_type
      };

      return next();
    });
  } catch (error) {
    console.error('requireAdmin error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

// requireStudentOrTeacher middleware — hanya mengizinkan siswa atau guru (bukan admin)
// Digunakan untuk endpoint yang perlu dibatasi hanya untuk pengguna sekolah aktif.
function requireStudentOrTeacher(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }

    jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS, async (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            message: 'Sesi Login sudah habis! harap login lagi ke akun Prescientia anda.',
            token_expired: true
          });
        }
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

      if (!decoded || !decoded.user_type) {
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

      if (!['student', 'teacher'].includes(decoded.user_type)) {
        return res.status(403).json({ success: false, message: 'Akses terlarang. Endpoint ini hanya untuk siswa dan guru.' });
      }

      if (!(await ensureNotRevoked(decoded, res))) return;

      req.user = {
        user_id: decoded.user_id,
        user_type: decoded.user_type,
        student_id: decoded.student_id || null,
        teacher_id: decoded.teacher_id || null,
        class_id: decoded.class_id || null
      };

      // Peringatan sesi akan habis
      const expiresInDays = getTokenExpiresInDays(decoded);
      if (expiresInDays !== null && expiresInDays <= 3) {
        res.setHeader('X-Session-Warning', 'expiring_soon');
        res.setHeader('X-Session-Expires-In-Days', String(expiresInDays));
        req.sessionExpiringSoon = true;
        req.sessionExpiresInDays = expiresInDays;
      }

      return next();
    });
  } catch (error) {
    console.error('requireStudentOrTeacher error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

// requireAuth middleware — accepts ANY valid JWT (student, teacher, or admin)
// Use this for endpoints that should be accessible by any logged-in user.
function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }

    jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS, async (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            message: 'Token kadaluwarsa. Silakan login kembali.',
            token_expired: true
          });
        }
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

      if (!decoded || !decoded.user_type) {
        return res.status(401).json({ success: false, message: 'Token tidak valid.' });
      }

      if (!(await ensureNotRevoked(decoded, res))) return;

      req.user = {
        user_id: decoded.user_id,
        user_type: decoded.user_type,
        student_id: decoded.student_id || null,
        teacher_id: decoded.teacher_id || null,
        admin_id: decoded.admin_id || null
      };

      return next();
    });
  } catch (error) {
    console.error('requireAuth error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
}

module.exports = {
  requireStudent,
  requireKM,
  requireTeacher,
  requireAdmin,
  requireAuth,
  requireStudentOrTeacher
};
