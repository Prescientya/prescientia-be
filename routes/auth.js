const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Backend telah terkoneksikan' });
});

// Check database endpoint
router.get('/check-db', async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const studentsCount = await pool.query('SELECT COUNT(*) FROM students');
    const students = await pool.query('SELECT nis, name FROM students LIMIT 5');
    
    res.json({
      success: true,
      data: {
        users_count: usersCount.rows[0].count,
        students_count: studentsCount.rows[0].count,
        sample_students: students.rows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Login endpoint untuk Siswa
router.post('/login/siswa', async (req, res) => {
  console.log('Login Siswa request received:', req.body);
  const { nisn, password } = req.body;

  try {
    // Validasi input
    if (!nisn || !password) {
      console.log('Validation failed: missing nisn or password');
      return res.status(400).json({
        success: false,
        message: 'NISN dan password harus diisi'
      });
    }

    // Cari student berdasarkan NISN (nis)
    const studentQuery = `
      SELECT 
        s.id as student_id,
        s.nis,
        s.name,
        s.gender,
        s.date_of_birth,
        s.phone_number,
        s.address,
        s.class_id,
        s.photo_profile,
        u.id as user_id,
        u.email,
        u.password,
        u.is_active,
        u.device_id,
        u.wifi_mac
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.nis = $1
    `;

    const result = await pool.query(studentQuery, [nisn]);

    console.log('Query result:', result.rows.length, 'rows found');

    if (result.rows.length === 0) {
      console.log('Student not found with NISN:', nisn);
      return res.status(401).json({
        success: false,
        message: 'NISN atau password salah'
      });
    }

    const student = result.rows[0];

    // Cek apakah user aktif
    if (!student.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Akun Anda tidak aktif. Silakan hubungi admin.'
      });
    }

    // Verifikasi password
    console.log('Checking password for student:', student.name);
    
    // Laravel menggunakan $2y$, Node.js bcrypt menggunakan $2b$
    // Mereka kompatibel, jadi kita convert untuk compatibility
    let hashedPassword = student.password;
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }
    
    const isPasswordValid = await bcrypt.compare(password, hashedPassword);

    if (!isPasswordValid) {
      console.log('Password invalid for NISN:', nisn);
      return res.status(401).json({
        success: false,
        message: 'NISN atau password salah'
      });
    }
    
    console.log('Login successful for:', student.name);

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [student.user_id]
    );

    // Insert history login
    await pool.query(
      'INSERT INTO history_login (user_id, login_at, status) VALUES ($1, NOW(), $2)',
      [student.user_id, 'success']
    );

    // Return user data (without password)
    delete student.password;

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
        wifi_mac: student.wifi_mac
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

// Login endpoint untuk Guru
router.post('/login/guru', async (req, res) => {
  console.log('Login Guru request received:', req.body);
  const { nip, password } = req.body;

  try {
    // Validasi input
    if (!nip || !password) {
      console.log('Validation failed: missing nip or password');
      return res.status(400).json({
        success: false,
        message: 'NIP dan password harus diisi'
      });
    }

    // Cari teacher berdasarkan NIP
    const teacherQuery = `
      SELECT 
        t.id as teacher_id,
        t.nip,
        t.name,
        t.gender,
        t.date_of_birth,
        t.phone_number,
        t.address,
        t.department,
        t.photo_profile,
        u.id as user_id,
        u.email,
        u.password,
        u.is_active,
        u.device_id,
        u.wifi_mac
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE t.nip = $1 AND t.deleted_at IS NULL
    `;

    const result = await pool.query(teacherQuery, [nip]);

    console.log('Query result:', result.rows.length, 'rows found');

    if (result.rows.length === 0) {
      console.log('Teacher not found with NIP:', nip);
      return res.status(401).json({
        success: false,
        message: 'NIP atau password salah'
      });
    }

    const teacher = result.rows[0];

    // Cek apakah user aktif
    if (!teacher.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Akun Anda tidak aktif. Silakan hubungi admin.'
      });
    }

    // Verifikasi password
    console.log('Checking password for teacher:', teacher.name);
    
    // Laravel menggunakan $2y$, Node.js bcrypt menggunakan $2b$
    let hashedPassword = teacher.password;
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }
    
    const isPasswordValid = await bcrypt.compare(password, hashedPassword);

    if (!isPasswordValid) {
      console.log('Password invalid for NIP:', nip);
      return res.status(401).json({
        success: false,
        message: 'NIP atau password salah'
      });
    }
    
    console.log('Login successful for:', teacher.name);

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [teacher.user_id]
    );

    // Insert history login
    await pool.query(
      'INSERT INTO history_login (user_id, login_at, status) VALUES ($1, NOW(), $2)',
      [teacher.user_id, 'success']
    );

    // Return user data (without password)
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
    console.error('Login error:', error);
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
    // Validasi input
    if (!username || !password) {
      console.log('Validation failed: missing username or password');
      return res.status(400).json({
        success: false,
        message: 'Username dan password harus diisi'
      });
    }

    // Cari petugas berdasarkan username
    const petugasQuery = `
      SELECT 
        id,
        username,
        password,
        created_at,
        updated_at
      FROM petugas_mbg
      WHERE username = $1 AND deleted_at IS NULL
    `;

    const result = await pool.query(petugasQuery, [username]);

    console.log('Query result:', result.rows.length, 'rows found');

    if (result.rows.length === 0) {
      console.log('Petugas not found with username:', username);
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah'
      });
    }

    const petugas = result.rows[0];

    // Verifikasi password
    console.log('Checking password for petugas:', petugas.username);
    
    // Laravel menggunakan $2y$, Node.js bcrypt menggunakan $2b$
    let hashedPassword = petugas.password;
    if (hashedPassword.startsWith('$2y$')) {
      hashedPassword = hashedPassword.replace('$2y$', '$2b$');
    }
    
    const isPasswordValid = await bcrypt.compare(password, hashedPassword);

    if (!isPasswordValid) {
      console.log('Password invalid for username:', username);
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah'
      });
    }
    
    console.log('Login successful for petugas:', petugas.username);

    // Return petugas data (without password)
    delete petugas.password;

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        id: petugas.id,
        username: petugas.username,
        role: 'petugas_mbg'
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

module.exports = router;
