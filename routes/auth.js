const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Auth route is working!' });
});

// GET user by NIS (student) and password - returns user+student info (no password)
router.get('/user/siswa', async (req, res) => {
  const { nis, password } = req.query;
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
router.get('/user/guru', async (req, res) => {
  const { nip, password } = req.query;
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

// ==================== LOGIN ENDPOINTS ====================

// Login endpoint untuk Siswa (Student)
router.post('/login/siswa', async (req, res) => {
  console.log('Login Siswa request received:', req.body);
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
        u.id as user_id, u.email, u.password, u.is_active, u.device_id,
        scr.role as class_role
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      LEFT JOIN student_class_roles scr ON s.id = scr.student_id AND s.class_id = scr.class_id
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

    // Check if device_id differs - inform frontend so it can call POST /api/device-change-requests
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
    // Build JWT payload according to the agreed structure
    // Include `student_id` explicitly so authorization can use the student identifier
    const payload = {
      user_id: student.user_id,
      student_id: student.student_id, // mandatory for authorization of attendance records
      user_type: 'student',
      // default to 'STUDENT' if no explicit role information available
      student_role: student.student_role || 'STUDENT',
      class_id: student.class_id
    };

    // Sign token
    // Student tokens are permanent by default — students cannot be force-logged-out
    // by expiry. Set JWT_STUDENT_EXPIRE (e.g. '10y') in .env only if a time-bounded
    // policy is ever needed in the future.
    const studentSignOptions = process.env.JWT_STUDENT_EXPIRE
      ? { expiresIn: process.env.JWT_STUDENT_EXPIRE }
      : {};
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'change_this_secret', studentSignOptions);

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
        photo_profile: student.photo_profile,
        role: 'siswa',
        class_role: student.class_role || 'pelajar',
        token // JWT for client to use in Authorization header
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
router.post('/login/guru', async (req, res) => {
  console.log('Login Guru request received:', req.body);
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
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.role
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

    // Validate that the user account has the 'teacher' role
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

    // Check if device_id differs - inform frontend so it can call POST /api/device-change-requests
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

    // Fetch teacher_class_roles: keeps full objects {role, class_id} so callers
    // (especially wali_kelas) know exactly which class each role applies to.
    let teacherRoles = [];
    try {
      const qRoles = `
        SELECT tcr.role, tcr.class_id,
               (CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
                ELSE c.class::text END || ' ' || COALESCE(c.major::text, '')) AS class_name
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

    // Derive homeroom class IDs from wali_kelas roles (single source of truth)
    const homeroomClasses = teacherRoles
      .filter(r => r.role === 'wali_kelas' && r.class_id != null)
      .map(r => r.class_id);

    const homeroomClassesValue = homeroomClasses.length === 0 ? null
      : homeroomClasses.length === 1 ? homeroomClasses[0]
      : homeroomClasses;

    // Build JWT payload for teacher — include full role objects so middleware
    // can authorize wali_kelas actions without an extra DB lookup.
    const payload = {
      user_id: teacher.user_id,
      teacher_id: teacher.teacher_id,
      user_type: 'teacher',
      department: teacher.department,
      teacher_roles: teacherRoles,        // array of {role, class_id, class_name}
      homeroom_classes: homeroomClassesValue
    };

    // Sign token — teacher tokens follow the standard expiry policy
    const teacherSignOptions = { expiresIn: process.env.JWT_TEACHER_EXPIRE || process.env.JWT_EXPIRE || '7d' };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'change_this_secret', teacherSignOptions);

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
        teacher_roles: teacherRoles,       // [{role, class_id, class_name}]
        homeroom_classes: homeroomClassesValue,
        token // JWT for client to use in Authorization header
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
router.post('/login/petugas', async (req, res) => {
  console.log('Login Petugas MBG request received:', req.body);
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
router.post('/login/admin', async (req, res) => {
  console.log('Login Admin request received:', req.body);
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
        role: 'admin'
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
