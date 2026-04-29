const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authLimiter } = require('../middlewares/rateLimiter');

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Auth route is working!' });
});

// GET user by NIS (student) and password - returns user+student info (no password)
// Changed to POST to avoid password in URL query parameters
router.post('/user/siswa', authLimiter, async (req, res) => {
  const { nis, password } = req.body;
  try {
    if (!nis || !password) {
      return res.status(400).json({ success: false, message: 'nis dan password harus disertakan' });
    }

    const q = `
      SELECT 
        s.id as student_id, s.nis, s.name, s.gender, s.date_of_birth,
        s.phone_number, s.address, s.class_id, s.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.created_at as user_created_at, u.updated_at as user_updated_at
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.nis COLLATE "C" = $1 COLLATE "C"
    `;

    const result = await pool.query(q, [nis]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User siswa tidak ditemukan' });
    }

    const row = result.rows[0];

    let hashed = row.password || '';
    if (hashed.startsWith('$2y$')) hashed = hashed.replace('$2y$', '$2b$');

    const ok = await bcrypt.compare(password, hashed);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'nis atau password salah' });
    }

    // remove password before sending
    delete row.password;

    res.json({ success: true, message: 'user ditemukan', data: row });
  } catch (err) {
    console.error('GET user siswa error:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// GET user by NIP (teacher) and password - returns user+teacher info (no password)
// Changed to POST to avoid password in URL query parameters
router.post('/user/guru', authLimiter, async (req, res) => {
  const { nip, password } = req.body;
  try {
    if (!nip || !password) {
      return res.status(400).json({ success: false, message: 'nip dan password harus disertakan' });
    }

    const q = `
      SELECT 
        t.id as teacher_id, t.nip, t.name, t.gender, t.date_of_birth,
        t.phone_number, t.address, t.department, t.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.created_at as user_created_at, u.updated_at as user_updated_at
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE t.nip COLLATE "C" = $1 COLLATE "C"
    `;

    const result = await pool.query(q, [nip]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User guru tidak ditemukan' });
    }

    const row = result.rows[0];

    let hashed = row.password || '';
    if (hashed.startsWith('$2y$')) hashed = hashed.replace('$2y$', '$2b$');

    const ok = await bcrypt.compare(password, hashed);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'nip atau password salah' });
    }

    delete row.password;
    res.json({ success: true, message: 'user ditemukan', data: row });
  } catch (err) {
    console.error('GET user guru error:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// ==================== VALIDATE TOKEN ENDPOINT ====================

/**
 * GET /api/auth/validate-token
 * Verifies that the JWT is valid AND that the underlying user/teacher/student
 * record still exists in the database. Used by mobile apps on startup to
 * detect accounts that have been deleted while the user was logged in.
 *
 * Returns:
 *   200 { success: true, valid: true }              – account exists
 *   401 { success: false, message: '...', account_deleted: true }  – account gone
 *   401 { success: false, message: '...' }          – bad / expired token
// ==================== PASSWORD CHANGE ENDPOINTS ====================

/**
 * POST /api/auth/change-password
 * Allows users (student/teacher/admin) to change their password after first login
 * Required header: Authorization: Bearer <token>
 */
router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan.' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
      return res.status(401).json({ success: false, message: 'Format token tidak valid.' });
    }

    const token = parts[1];
    const { old_password, new_password, new_password_confirm } = req.body;

    // Validate input
    if (!new_password || !new_password_confirm) {
      return res.status(400).json({
        success: false,
        message: 'Password baru dan konfirmasi password harus diisi'
      });
    }

    if (new_password !== new_password_confirm) {
      return res.status(400).json({
        success: false,
        message: 'Password baru dan konfirmasi password tidak cocok'
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password harus minimal 8 karakter'
      });
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Token tidak valid atau sudah kedaluwarsa.' });
    }

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Token tidak valid.' });
    }

    // Get user record
    const userResult = await pool.query('SELECT id, password, is_active FROM users WHERE id = $1', [decoded.user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Akun tidak aktif' });
    }

    // If old_password provided, verify it
    if (old_password) {
      let hashedPassword = user.password || '';
      if (hashedPassword.startsWith('$2y$')) {
        hashedPassword = hashedPassword.replace('$2y$', '$2b$');
      }

      const isPasswordValid = await bcrypt.compare(old_password, hashedPassword);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Password lama salah'
        });
      }
    }
    // If no old_password, it's a first-time password change (admin/system initiated)

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(new_password, saltRounds);

    // Update password and set first_login to false
    await pool.query(
      'UPDATE users SET password = $1, first_login = false, updated_at = NOW() WHERE id = $2',
      [hashedNewPassword, decoded.user_id]
    );

    res.json({
      success: true,
      message: 'Password berhasil diubah. Silakan login kembali dengan password baru.'
    });
  } catch (error) {
    console.error('change-password error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

/**
 * POST /api/auth/admin/reset-password
 * Admin endpoint to reset user password back to NIS/NIP
 * Required header: Authorization: Bearer <admin_token>
 * Body: { user_id, user_type (siswa/guru) }
 */
router.post('/admin/reset-password', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan.' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
      return res.status(401).json({ success: false, message: 'Format token tidak valid.' });
    }

    const token = parts[1];
    const { user_id, user_type } = req.body;

    if (!user_id || !user_type) {
      return res.status(400).json({
        success: false,
        message: 'user_id dan user_type harus diisi'
      });
    }

    if (!['siswa', 'guru'].includes(user_type)) {
      return res.status(400).json({
        success: false,
        message: 'user_type harus siswa atau guru'
      });
    }

    // Verify JWT token (only admin can reset)
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Token tidak valid atau sudah kedaluwarsa.' });
    }

    if (!decoded || decoded.user_type !== 'admin') {
      return res.status(403).json({ success: false, message: 'Hanya admin yang dapat mereset password' });
    }

    // Get the appropriate NIS/NIP based on user_type
    let nisOrNip = null;
    let userName = null;

    if (user_type === 'siswa') {
      const studentQuery = `
        SELECT s.nis, s.name
        FROM students s
        INNER JOIN users u ON s.user_id = u.id
        WHERE u.id = $1
      `;
      const result = await pool.query(studentQuery, [user_id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
      }
      nisOrNip = result.rows[0].nis;
      userName = result.rows[0].name;
    } else if (user_type === 'guru') {
      const teacherQuery = `
        SELECT t.nip, t.name
        FROM teachers t
        INNER JOIN users u ON t.user_id = u.id
        WHERE u.id = $1
      `;
      const result = await pool.query(teacherQuery, [user_id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
      }
      nisOrNip = result.rows[0].nip;
      userName = result.rows[0].name;
    }

    // Hash the NIS/NIP as new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(nisOrNip, saltRounds);

    // Update password and set first_login to true
    await pool.query(
      'UPDATE users SET password = $1, first_login = true, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user_id]
    );

    res.json({
      success: true,
      message: `Password ${user_type} ${userName} telah direset menjadi ${user_type === 'siswa' ? 'NIS' : 'NIP'} mereka. Mereka harus mengubahnya saat login berikutnya.`,
      data: {
        user_id,
        user_type,
        name: userName,
        reset_to: user_type === 'siswa' ? 'NIS' : 'NIP'
      }
    });
  } catch (error) {
    console.error('admin/reset-password error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});
 */
router.get('/validate-token', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan.' });
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
      return res.status(401).json({ success: false, message: 'Format token tidak valid.' });
    }
    const token = parts[1];
    const secret = process.env.JWT_SECRET;

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Token tidak valid atau sudah kedaluwarsa.' });
    }

    if (!decoded || !decoded.user_type) {
      return res.status(401).json({ success: false, message: 'Token tidak valid.' });
    }

    // Check if the user record still exists
    const userResult = await pool.query('SELECT id, is_active FROM users WHERE id = $1', [decoded.user_id]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Akun Anda telah dihapus oleh admin. Silakan hubungi pihak sekolah.',
        account_deleted: true,
      });
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Akun Anda tidak aktif. Silakan hubungi pihak sekolah.',
        account_deleted: true,
      });
    }

    // Check the specific role record still exists AND return fresh role data
    if (decoded.user_type === 'teacher' && decoded.teacher_id) {
      const teacherResult = await pool.query('SELECT id, name, department FROM teachers WHERE id = $1', [decoded.teacher_id]);
      if (teacherResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Data guru Anda telah dihapus oleh admin. Silakan hubungi pihak sekolah.',
          account_deleted: true,
        });
      }

      // Fetch fresh teacher_class_roles so the FE can update cached session
      let teacherRoles = [];
      try {
        const qRoles = `
          SELECT tcr.role, tcr.class_id,
                 CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
                        ELSE c.class END, ' ', COALESCE(c.major, '')) AS class_name
          FROM teacher_class_roles tcr
          LEFT JOIN classes c ON c.id = tcr.class_id
          WHERE tcr.teacher_id = $1
          ORDER BY tcr.role, tcr.class_id`;
        const rRoles = await pool.query(qRoles, [decoded.teacher_id]);
        teacherRoles = rRoles.rows.map(r => ({
          role: r.role,
          class_id: r.class_id || null,
          class_name: r.class_name ? r.class_name.trim() : null
        }));
      } catch (err) {
        console.warn('validate-token: Could not fetch teacher_class_roles:', err.message);
      }

      // Fallback: check classes.homeroom_teacher_id if no wali_kelas in teacher_class_roles
      const hasWaliKelas = teacherRoles.some(r => r.role === 'wali_kelas');
      if (!hasWaliKelas) {
        try {
          const qHomeroom = `
            SELECT c.id AS class_id,
                   CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
                          ELSE c.class END, ' ', COALESCE(c.major, '')) AS class_name
            FROM classes c
            WHERE c.homeroom_teacher_id = $1`;
          const rHomeroom = await pool.query(qHomeroom, [decoded.teacher_id]);
          for (const row of rHomeroom.rows) {
            teacherRoles.push({
              role: 'wali_kelas',
              class_id: row.class_id,
              class_name: row.class_name ? row.class_name.trim() : null
            });
            // Auto-heal
            try {
              const exists = await pool.query(
                `SELECT id FROM teacher_class_roles WHERE teacher_id = $1 AND class_id = $2 AND role = 'wali_kelas'`,
                [decoded.teacher_id, row.class_id]
              );
              if (exists.rows.length === 0) {
                await pool.query(
                  `INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at) VALUES ($1, $2, 'wali_kelas', NOW(), NOW())`,
                  [decoded.teacher_id, row.class_id]
                );
              }
            } catch (_) {}
          }
        } catch (err) {
          console.warn('validate-token: Could not fetch homeroom fallback:', err.message);
        }
      }

      const homeroomClasses = teacherRoles
        .filter(r => r.role === 'wali_kelas' && r.class_id != null)
        .map(r => r.class_id);
      const homeroomClassesValue = homeroomClasses.length === 0 ? null
        : homeroomClasses.length === 1 ? homeroomClasses[0]
        : homeroomClasses;

      return res.status(200).json({
        success: true,
        valid: true,
        // Fresh role data so FE can update cached session without re-login
        teacher_roles: teacherRoles,
        homeroom_classes: homeroomClassesValue,
        department: teacherResult.rows[0].department,
      });

    } else if (decoded.user_type === 'student' && decoded.student_id) {
      const studentResult = await pool.query('SELECT id, class_id FROM students WHERE id = $1', [decoded.student_id]);
      if (studentResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Data siswa Anda telah dihapus oleh admin. Silakan hubungi pihak sekolah.',
          account_deleted: true,
        });
      }

      // Fetch fresh class_role so the FE can update cached session
      let classRole = 'pelajar';
      let className = null;
      const classId = studentResult.rows[0].class_id;
      if (classId) {
        try {
          const qRole = `SELECT role FROM student_class_roles WHERE student_id = $1 AND class_id = $2 LIMIT 1`;
          const rRole = await pool.query(qRole, [decoded.student_id, classId]);
          if (rRole.rows.length > 0 && rRole.rows[0].role) {
            classRole = rRole.rows[0].role;
          }
        } catch (err) {
          console.warn('validate-token: Could not fetch student class_role:', err.message);
        }
        try {
          const qClass = `SELECT CONCAT(CASE class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII' ELSE class END, ' ', COALESCE(major, '')) as class_name FROM classes WHERE id = $1`;
          const rClass = await pool.query(qClass, [classId]);
          if (rClass.rows.length > 0) {
            className = rClass.rows[0].class_name ? rClass.rows[0].class_name.trim() : null;
          }
        } catch (err) {
          console.warn('validate-token: Could not fetch class_name:', err.message);
        }
      }

      return res.status(200).json({
        success: true,
        valid: true,
        // Fresh role data so FE can update cached session without re-login
        class_role: classRole,
        class_id: classId,
        class_name: className,
      });
    } else if (decoded.user_type === 'admin' && decoded.admin_id) {
      const adminResult = await pool.query('SELECT id, name FROM admins WHERE id = $1', [decoded.admin_id]);
      if (adminResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Data admin Anda telah dihapus. Silakan hubungi superadmin.',
          account_deleted: true,
        });
      }

      return res.status(200).json({
        success: true,
        valid: true,
        user_type: 'admin',
        admin_id: decoded.admin_id,
        name: adminResult.rows[0].name,
      });
    }

    return res.status(200).json({ success: true, valid: true });
  } catch (error) {
    console.error('validate-token error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
});

// ==================== LOGIN ENDPOINTS ====================

// Login endpoint untuk Siswa (Student)
router.post('/login/siswa', authLimiter, async (req, res) => {
  const { nisn, password, device_id } = req.body;

  try {
    if (!nisn || !password || !device_id) {
      return res.status(400).json({
        success: false,
        message: 'NISN, password, dan device_id harus diisi'
      });
    }

    if (typeof device_id !== 'string' || device_id.length === 0 || device_id.length > 255) {
      return res.status(400).json({ success: false, message: 'device_id harus string dengan panjang maksimal 255 karakter' });
    }

    const studentQuery = `
      SELECT 
        s.id as student_id, s.nis, s.name, s.gender, s.date_of_birth,
        s.phone_number, s.address, s.class_id, s.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.first_login,
        scr.role as class_role,
        CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
         ELSE c.class END, ' ', COALESCE(c.major, '')) as class_name
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      LEFT JOIN student_class_roles scr ON s.id = scr.student_id AND s.class_id = scr.class_id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.nis COLLATE "C" = $1 COLLATE "C"
    `;

    const result = await pool.query(studentQuery, [nisn]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'NISN atau password salah'
      });
    }

    const student = result.rows[0];

    if (!student.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Akun Anda tidak aktif. Silakan hubungi admin.'
      });
    }

    let hashedPassword = student.password || '';
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }

    const isPasswordValid = await bcrypt.compare(password, hashedPassword);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'NISN atau password salah'
      });
    }

    if (student.device_id && String(student.device_id) !== String(device_id)) {
      return res.status(401).json({
        success: false,
        message: 'device_mismatch',
        data: {
          nis: student.nis,
          user_id: student.user_id,
          name: student.name,
          device_id: student.device_id,
          device_id_new: device_id
        }
      });
    }

    await pool.query('UPDATE users SET last_login_at = NOW(), device_id = $2 WHERE id = $1', [student.user_id, device_id]);
    await pool.query('INSERT INTO history_login (user_id, login_at, status, device_id) VALUES ($1, NOW(), $2, $3)', [student.user_id, 'success', device_id]);

    delete student.password;
    const payload = {
      user_id: student.user_id,
      student_id: student.student_id,
      user_type: 'student',
      student_role: student.student_role || 'STUDENT',
      class_id: student.class_id
    };

    const studentSignOptions = { expiresIn: process.env.JWT_STUDENT_EXPIRE || '30d' };
    const token = jwt.sign(payload, process.env.JWT_SECRET, studentSignOptions);

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        student_id: student.student_id,
        user_id: student.user_id,
        nis: student.nis,
        name: student.name,
        email: student.email,
        gender: student.gender,
        date_of_birth: student.date_of_birth,
        phone_number: student.phone_number,
        address: student.address,
        class_id: student.class_id,
        class_name: student.class_name ? student.class_name.trim() : null,
        photo_profile: student.photo_profile,
        role: 'siswa',
        class_role: student.class_role || 'pelajar',
        first_login: !!student.first_login,
        token
      }
    });
  } catch (error) {
    console.error('Login siswa error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

// Login endpoint untuk Guru (Teacher)
router.post('/login/guru', authLimiter, async (req, res) => {
  const { nip, password, device_id } = req.body;

  try {
    if (!nip || !password || !device_id) {
      return res.status(400).json({
        success: false,
        message: 'NIP, password, dan device_id harus diisi'
      });
    }

    if (typeof device_id !== 'string' || device_id.length === 0 || device_id.length > 255) {
      return res.status(400).json({ success: false, message: 'device_id harus string dengan panjang maksimal 255 karakter' });
    }

    const teacherQuery = `
      SELECT 
        t.id as teacher_id, t.nip, t.name, t.gender, t.date_of_birth,
        t.phone_number, t.address, t.department, t.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.first_login, u.role
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE t.nip COLLATE "C" = $1 COLLATE "C"
    `;

    const result = await pool.query(teacherQuery, [nip]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'NIP atau password salah'
      });
    }

    const teacher = result.rows[0];

    if (teacher.role !== 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'Akun ini tidak memiliki akses sebagai guru.'
      });
    }

    if (!teacher.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Akun Anda tidak aktif. Silakan hubungi admin.'
      });
    }

    let hashedPassword = teacher.password || '';
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }

    const isPasswordValid = await bcrypt.compare(password, hashedPassword);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'NIP atau password salah'
      });
    }

    if (teacher.device_id && String(teacher.device_id) !== String(device_id)) {
      return res.status(401).json({
        success: false,
        message: 'device_mismatch',
        data: {
          user_id: teacher.user_id,
          name: teacher.name,
          device_id: teacher.device_id,
          device_id_new: device_id
        }
      });
    }

    await pool.query('UPDATE users SET last_login_at = NOW(), device_id = $2 WHERE id = $1', [teacher.user_id, device_id]);
    await pool.query('INSERT INTO history_login (user_id, login_at, status, device_id) VALUES ($1, NOW(), $2, $3)', [teacher.user_id, 'success', device_id]);

    delete teacher.password;

    let teacherRoles = [];
    try {
      const qRoles = `
        SELECT tcr.role, tcr.class_id,
               CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
                      ELSE c.class END, ' ', COALESCE(c.major, '')) AS class_name
        FROM teacher_class_roles tcr
        LEFT JOIN classes c ON c.id = tcr.class_id
        WHERE tcr.teacher_id = $1
        ORDER BY tcr.role, tcr.class_id`;
      const rRoles = await pool.query(qRoles, [teacher.teacher_id]);
      teacherRoles = rRoles.rows.map(r => ({
        role: r.role,
        class_id: r.class_id || null,
        class_name: r.class_name ? r.class_name.trim() : null
      }));
    } catch (err) {
      console.warn('Could not fetch teacher_class_roles:', err.message);
      teacherRoles = [];
    }

    const hasWaliKelasRole = teacherRoles.some(r => r.role === 'wali_kelas');
    if (!hasWaliKelasRole) {
      try {
        const qHomeroom = `
          SELECT c.id AS class_id,
                 CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
                        ELSE c.class END, ' ', COALESCE(c.major, '')) AS class_name
          FROM classes c
          WHERE c.homeroom_teacher_id = $1`;
        const rHomeroom = await pool.query(qHomeroom, [teacher.teacher_id]);
        for (const row of rHomeroom.rows) {
          teacherRoles.push({
            role: 'wali_kelas',
            class_id: row.class_id,
            class_name: row.class_name ? row.class_name.trim() : null
          });
        }

        for (const row of rHomeroom.rows) {
          try {
            const exists = await pool.query(
              `SELECT id FROM teacher_class_roles WHERE teacher_id = $1 AND class_id = $2 AND role = 'wali_kelas'`,
              [teacher.teacher_id, row.class_id]
            );
            if (exists.rows.length === 0) {
              await pool.query(
                `INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at) VALUES ($1, $2, 'wali_kelas', NOW(), NOW())`,
                [teacher.teacher_id, row.class_id]
              );
            }
          } catch (healErr) {
            console.warn(`[Login Guru] Auto-heal failed for class_id=${row.class_id}:`, healErr.message);
          }
        }
      } catch (err) {
        console.warn('Could not fetch homeroom from classes table:', err.message);
      }
    }

    const homeroomClasses = teacherRoles
      .filter(r => r.role === 'wali_kelas' && r.class_id != null)
      .map(r => r.class_id);

    const homeroomClassesValue = homeroomClasses.length === 0 ? null
      : homeroomClasses.length === 1 ? homeroomClasses[0]
      : homeroomClasses;

    const payload = {
      user_id: teacher.user_id,
      teacher_id: teacher.teacher_id,
      user_type: 'teacher',
      department: teacher.department,
      teacher_roles: teacherRoles,
      homeroom_classes: homeroomClassesValue
    };

    const teacherSignOptions = { expiresIn: process.env.JWT_TEACHER_EXPIRE || '30d' };
    const token = jwt.sign(payload, process.env.JWT_SECRET, teacherSignOptions);

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        teacher_id: teacher.teacher_id,
        user_id: teacher.user_id,
        nip: teacher.nip,
        name: teacher.name,
        email: teacher.email,
        gender: teacher.gender,
        date_of_birth: teacher.date_of_birth,
        phone_number: teacher.phone_number,
        address: teacher.address,
        department: teacher.department,
        photo_profile: teacher.photo_profile,
        role: 'guru',
        teacher_roles: teacherRoles,
        homeroom_classes: homeroomClassesValue,
        first_login: !!teacher.first_login,
        token
      }
    });
  } catch (error) {
    console.error('Login guru error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

// Login endpoint untuk Petugas MBG
router.post('/login/petugas', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username dan password harus diisi'
      });
    }

    const petugasQuery = `
      SELECT id, username, password, created_at, updated_at
      FROM petugas_mbg
      WHERE username COLLATE "C" = $1 COLLATE "C"
    `;

    const result = await pool.query(petugasQuery, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah'
      });
    }

    const petugas = result.rows[0];

    let hashedPassword = petugas.password || '';
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }

    const isPasswordValid = await bcrypt.compare(password, hashedPassword);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah'
      });
    }

    delete petugas.password;

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        id: petugas.id,
        username: petugas.username,
        created_at: petugas.created_at,
        updated_at: petugas.updated_at,
        role: 'petugas_mbg'
      }
    });
  } catch (error) {
    console.error('Login petugas error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

// Login endpoint untuk Admin
router.post('/login/admin', authLimiter, async (req, res) => {
  const { email, password, device_id } = req.body;

  try {
    if (!email || !password || !device_id) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, dan device_id harus diisi'
      });
    }

    if (typeof device_id !== 'string' || device_id.length === 0 || device_id.length > 255) {
      return res.status(400).json({ success: false, message: 'device_id harus string dengan panjang maksimal 255 karakter' });
    }

    const adminQuery = `
      SELECT 
        a.id as admin_id, a.name, a.nip, a.phone_number, a.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id
      FROM admins a
      INNER JOIN users u ON a.user_id = u.id
      WHERE u.email COLLATE "C" = $1 COLLATE "C"
    `;

    const result = await pool.query(adminQuery, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah'
      });
    }

    const admin = result.rows[0];

    if (!admin.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Akun Anda tidak aktif. Silakan hubungi superadmin.'
      });
    }

    let hashedPassword = admin.password || '';
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }

    const isPasswordValid = await bcrypt.compare(password, hashedPassword);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah'
      });
    }

    // Check if device_id differs - create device change request if so
    if (admin.device_id && String(admin.device_id) !== String(device_id)) {
      // Check if there's already a pending request
      const existingRequestQuery = `
        SELECT id, status FROM device_change_requests 
        WHERE user_id = $1 AND status = 'pending' 
        ORDER BY created_at DESC LIMIT 1
      `;
      const existingRequest = await pool.query(existingRequestQuery, [admin.user_id]);
      
      if (existingRequest.rows.length === 0) {
        // Create new device change request
        await pool.query(
          `INSERT INTO device_change_requests (user_id, device_id_old, device_id_new, status, submitted_by, created_at, updated_at) 
           VALUES ($1, $2, $3, 'pending', $4, NOW(), NOW())`,
          [admin.user_id, admin.device_id, device_id, email]
        );
      }
      
      return res.status(403).json({
        success: false,
        message: 'mohon maaf untuk akun yang anda loginkan sudah pernah login di device yang berbeda sebelumnya. Pengajuan pergantian perangkat sudah dibuat, mohon tunggu konfirmasi.',
        device_change_pending: true
      });
    }

    await pool.query('UPDATE users SET last_login_at = NOW(), device_id = $2 WHERE id = $1', [admin.user_id, device_id]);
    await pool.query('INSERT INTO history_login (user_id, login_at, status, device_id) VALUES ($1, NOW(), $2, $3)', [admin.user_id, 'success', device_id]);

    delete admin.password;

    // Build JWT payload for admin
    const payload = {
      user_id: admin.user_id,
      admin_id: admin.admin_id,
      user_type: 'admin'
    };

    const adminSignOptions = { expiresIn: process.env.JWT_ADMIN_EXPIRE || '7d' };
    const token = jwt.sign(payload, process.env.JWT_SECRET, adminSignOptions);

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        admin_id: admin.admin_id,
        user_id: admin.user_id,
        name: admin.name,
        email: admin.email,
        nip: admin.nip,
        phone_number: admin.phone_number,
        photo_profile: admin.photo_profile,
        device_id: device_id,
        role: 'admin',
        token
      }
    });
  } catch (error) {
    console.error('Login admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

module.exports = router;
