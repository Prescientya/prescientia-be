const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Auth route is working!' });
});

// ==================== LOGIN ENDPOINTS ====================

// Login endpoint untuk Siswa (Student)
router.post('/login/siswa', async (req, res) => {
  console.log('Login Siswa request received:', req.body);
  const { nisn, password } = req.body;

  try {
    if (!nisn || !password) {
      return res.status(400).json({
        success: false,
        message: 'NISN dan password harus diisi'
      });
    }

    const studentQuery = `
      SELECT 
        s.id as student_id, s.nis, s.name, s.gender, s.date_of_birth,
        s.phone_number, s.address, s.class_id, s.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.wifi_mac,
        scr.role as class_role
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      LEFT JOIN student_class_roles scr ON s.id = scr.student_id AND s.class_id = scr.class_id
      WHERE s.nis COLLATE "C" = $1 COLLATE "C" AND s.deleted_at IS NULL
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

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [student.user_id]);
    await pool.query('INSERT INTO history_login (user_id, login_at, status) VALUES ($1, NOW(), $2)', [student.user_id, 'success']);

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
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'change_this_secret', { expiresIn: process.env.JWT_EXPIRE || '7d' });

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
        device_id: student.device_id,
        wifi_mac: student.wifi_mac,
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
  const { nip, password } = req.body;

  try {
    if (!nip || !password) {
      return res.status(400).json({
        success: false,
        message: 'NIP dan password harus diisi'
      });
    }

    const teacherQuery = `
      SELECT 
        t.id as teacher_id, t.nip, t.name, t.gender, t.date_of_birth,
        t.phone_number, t.address, t.department, t.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.wifi_mac
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE t.nip COLLATE "C" = $1 COLLATE "C" AND t.deleted_at IS NULL
    `;

    const result = await pool.query(teacherQuery, [nip]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'NIP atau password salah'
      });
    }

    const teacher = result.rows[0];

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

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [teacher.user_id]);
    await pool.query('INSERT INTO history_login (user_id, login_at, status) VALUES ($1, NOW(), $2)', [teacher.user_id, 'success']);

    delete teacher.password;

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
        device_id: teacher.device_id,
        wifi_mac: teacher.wifi_mac,
        role: 'guru'
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
      WHERE username COLLATE "C" = $1 COLLATE "C" AND deleted_at IS NULL
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
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email dan password harus diisi'
      });
    }

    const adminQuery = `
      SELECT 
        a.id as admin_id, a.name, a.nip, a.phone_number, a.photo_profile,
        u.id as user_id, u.email, u.password, u.is_active, u.device_id, u.wifi_mac
      FROM admins a
      INNER JOIN users u ON a.user_id = u.id
      WHERE u.email COLLATE "C" = $1 COLLATE "C" AND a.deleted_at IS NULL AND u.deleted_at IS NULL
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

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [admin.user_id]);
    await pool.query('INSERT INTO history_login (user_id, login_at, status) VALUES ($1, NOW(), $2)', [admin.user_id, 'success']);

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
        device_id: admin.device_id,
        wifi_mac: admin.wifi_mac,
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
