const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const { requireStudent, requireAdmin } = require('../middlewares/auth.middleware');

// Whitelist field yang boleh diubah siswa sendiri (self-service).
// SECURITY: identitas resmi (name, nis, gender, date_of_birth, class_id) sengaja
// TIDAK ada di sini — hanya admin yang boleh mengubahnya.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validasi field nullable bertipe string dengan batas panjang (sesuai kolom DB).
// Mengembalikan true bila INVALID. null diperbolehkan (untuk mengosongkan field);
// tipe selain string ditolak agar tidak bocor jadi error DB (500) di hilir.
function invalidNullableString(val, max) {
  // undefined = field tidak dikirim (tak diubah) → valid; null = sengaja dikosongkan → valid.
  // Tanpa cek undefined, PATCH parsial (mis. ubah email saja) salah ditolak 400.
  if (val === undefined || val === null) return false;
  if (typeof val !== 'string') return true;
  return val.length > max;
}

// Ambil profil siswa lengkap (user + student + class) dalam bentuk yang sama
// dengan response GET /profile, agar bisa dipakai ulang oleh PATCH /profile.
async function fetchStudentProfile(studentId) {
  const result = await pool.query(
    `SELECT
        s.id as student_id, s.user_id, s.nis, s.name, s.gender, s.date_of_birth,
        s.phone_number, s.address, s.class_id as student_class_id, s.photo_profile,
        s.created_at as student_created_at, s.updated_at as student_updated_at,
        u.email, u.email_verified_at, u.device_id, u.is_active, u.last_login_at,
        u.created_at as user_created_at, u.updated_at as user_updated_at,
        c.id as class_id, c.class as class_level, c.major as class_major
     FROM students s
     INNER JOIN users u ON s.user_id = u.id
     LEFT JOIN classes c ON s.class_id = c.id
     WHERE s.id = $1`,
    [studentId]
  );

  if (result.rows.length === 0) return null;
  const profile = result.rows[0];

  return {
    user: {
      id: profile.user_id,
      email: profile.email,
      email_verified_at: profile.email_verified_at,
      device_id: profile.device_id,
      is_active: profile.is_active,
      last_login_at: profile.last_login_at,
      created_at: profile.user_created_at,
      updated_at: profile.user_updated_at
    },
    student: {
      id: profile.student_id,
      nis: profile.nis,
      name: profile.name,
      gender: profile.gender,
      date_of_birth: profile.date_of_birth,
      phone_number: profile.phone_number,
      address: profile.address,
      photo_profile: profile.photo_profile,
      created_at: profile.student_created_at,
      updated_at: profile.student_updated_at
    },
    class: profile.class_id ? {
      id: profile.class_id,
      level: profile.class_level,
      major: profile.class_major
    } : (profile.student_class_id ? {
      id: profile.student_class_id,
      level: profile.class_level,
      major: profile.class_major
    } : null)
  };
}

// ==================== STUDENTS CRUD ====================

// GET all students
router.get('/', requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const { class_id, name } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT s.id, s.user_id, s.nis, s.name, s.gender, s.date_of_birth,
             s.phone_number, s.address, s.class_id, s.photo_profile,
             s.created_at, s.updated_at, u.email, u.is_active,
             c.class as class_level, c.major as class_major
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (class_id) {
      query += ` AND s.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }
    
    if (name) {
      query += ` AND s.name ILIKE $${paramIndex}`;
      params.push(`%${name}%`);
      paramIndex++;
    }
    
    query += ` ORDER BY s.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM students WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (class_id) {
      countQuery += ` AND class_id = $${countParamIndex}`;
      countParams.push(class_id);
      countParamIndex++;
    }
    
    if (name) {
      countQuery += ` AND name ILIKE $${countParamIndex}`;
      countParams.push(`%${name}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data students berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data students',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  }
});

// GET student profile (lengkap - user + student data)
// HARUS DIDEFINISIKAN SEBELUM /:id AGAR TIDAK DIANGGAP SEBAGAI ID PARAMETER
// Endpoint ini untuk mengisi menu Profile di FE
// Memerlukan JWT token dari login siswa
// Langsung menampilkan profil siswa yang sedang login (dari token JWT)
router.get('/profile', requireStudent, async (req, res) => {
  try {
    const studentId = req.user.student_id;
    
    const query = `
      SELECT 
        s.id as student_id,
        s.user_id,
        s.nis,
        s.name,
        s.gender,
        s.date_of_birth,
        s.phone_number,
        s.address,
        s.class_id as student_class_id,
        s.photo_profile,
        s.created_at as student_created_at,
        s.updated_at as student_updated_at,
        u.email,
        u.email_verified_at,
        u.device_id,
        u.is_active,
        u.last_login_at,
        u.created_at as user_created_at,
        u.updated_at as user_updated_at,
        c.id as class_id,
        c.class as class_level,
        c.major as class_major
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.id = $1
    `;
    
    const result = await pool.query(query, [studentId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profil student tidak ditemukan'
      });
    }

    const profile = result.rows[0];
    
    res.json({
      success: true,
      message: 'Data profil student berhasil diambil',
      data: {
        // User Information
        user: {
          id: profile.user_id,
          email: profile.email,
          email_verified_at: profile.email_verified_at,
          device_id: profile.device_id,
          is_active: profile.is_active,
          last_login_at: profile.last_login_at,
          created_at: profile.user_created_at,
          updated_at: profile.user_updated_at
        },
        // Student Information
        student: {
          id: profile.student_id,
          nis: profile.nis,
          name: profile.name,
          gender: profile.gender,
          date_of_birth: profile.date_of_birth,
          phone_number: profile.phone_number,
          address: profile.address,
          photo_profile: profile.photo_profile,
          created_at: profile.student_created_at,
          updated_at: profile.student_updated_at
        },
        // Class Information
        class: profile.class_id ? {
          id: profile.class_id,
          level: profile.class_level,
          major: profile.class_major
        } : (profile.student_class_id ? {
          id: profile.student_class_id,
          level: profile.class_level,
          major: profile.class_major
        } : null)
      }
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data profil student',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  }
});

// PATCH self-service profile (siswa mengubah data kontaknya sendiri)
// HARUS DIDEFINISIKAN SEBELUM route PATCH '/:id' (admin) — karena '/:id' tidak
// punya constraint angka, kata 'profile' akan tertangkap sebagai :id bila urutannya salah.
// SECURITY: identitas diambil dari token (req.user), BUKAN dari body → cegah IDOR.
// Hanya field whitelist (email, phone_number, address, photo_profile) yang diproses;
// field lain (name, nis, gender, date_of_birth, class_id) sengaja diabaikan → cegah mass-assignment.
router.patch('/profile', requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  const userId = req.user.user_id;

  // Whitelist eksplisit. Field di luar ini diabaikan total.
  const { email, phone_number, address, photo_profile } = req.body;

  // Validasi email (bila dikirim): whitelist bentuk, bukan blacklist.
  // NOTE: sengaja hanya trim(), TANPA lowercase — sistem ini case-sensitive untuk
  // email (admin login pakai COLLATE "C", lihat auth.js). Jangan diubah jadi lowercase.
  const emailProvided = email !== undefined;
  let normalizedEmail;
  if (emailProvided) {
    normalizedEmail = typeof email === 'string' ? email.trim() : '';
    if (!normalizedEmail || normalizedEmail.length > 100 || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Format email tidak valid'
      });
    }
  }

  // Validasi tipe & panjang field kontak di boundary (cegah error DB bocor jadi 500).
  if (invalidNullableString(phone_number, 20)) {
    return res.status(400).json({ success: false, message: 'Nomor telepon harus berupa teks maksimal 20 karakter' });
  }
  if (invalidNullableString(address, 1000)) {
    return res.status(400).json({ success: false, message: 'Alamat harus berupa teks maksimal 1000 karakter' });
  }
  if (invalidNullableString(photo_profile, 255)) {
    return res.status(400).json({ success: false, message: 'Foto profil harus berupa teks maksimal 255 karakter' });
  }

  // Bangun update dinamis untuk kolom kontak di tabel students.
  // phone_number/address/photo_profile pakai cek !== undefined agar bisa dikosongkan (null).
  const studentSets = [];
  const studentParams = [];
  let idx = 1;
  if (phone_number !== undefined) { studentSets.push(`phone_number = $${idx++}`); studentParams.push(phone_number); }
  if (address !== undefined)      { studentSets.push(`address = $${idx++}`);      studentParams.push(address); }
  if (photo_profile !== undefined){ studentSets.push(`photo_profile = $${idx++}`);studentParams.push(photo_profile); }

  if (studentSets.length === 0 && !emailProvided) {
    return res.status(400).json({
      success: false,
      message: 'Tidak ada field yang diubah'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (emailProvided) {
      // Keunikan email terhadap user lain (email UNIQUE di tabel users).
      const checkEmail = await client.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [normalizedEmail, userId]
      );
      if (checkEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Email sudah digunakan akun lain'
        });
      }
      // email_verified_at direset NULL: email baru belum terverifikasi.
      await client.query(
        'UPDATE users SET email = $1, email_verified_at = NULL, updated_at = NOW() WHERE id = $2',
        [normalizedEmail, userId]
      );
    }

    if (studentSets.length > 0) {
      studentParams.push(studentId);
      await client.query(
        `UPDATE students SET ${studentSets.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
        studentParams
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // Race: cek-lalu-update email tidak atomik. Penjaga akhir adalah UNIQUE
    // constraint DB (unique_violation 23505) → petakan ke 409, bukan 500.
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Email sudah digunakan akun lain'
      });
    }
    console.error('Error updating student self-profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui profil',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  } finally {
    client.release();
  }

  // Kembalikan profil terbaru (bentuk sama dengan GET /profile) agar FE bisa refresh.
  try {
    const data = await fetchStudentProfile(studentId);
    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      data
    });
  } catch (error) {
    // Update sudah commit; gagal hanya saat re-fetch tampilan.
    console.error('Error fetching student profile after update:', error);
    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui'
    });
  }
});

// GET student by ID
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT s.id, s.user_id, s.nis, s.name, s.gender, s.date_of_birth,
             s.phone_number, s.address, s.class_id, s.photo_profile,
             s.created_at, s.updated_at, u.email, u.is_active,
             c.class as class_level, c.major as class_major
      FROM students s
      INNER JOIN users u ON s.user_id = u.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student tidak ditemukan'
      });
    }
    
    res.json({
      success: true,
      message: 'Data student berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data student',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  }
});

// CREATE student (with user)
router.post('/', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      email, password, nis, name, gender, date_of_birth,
      phone_number, address, class_id, photo_profile 
    } = req.body;
    
    // Validasi input
    if (!email || !password || !nis || !name || !gender || !date_of_birth) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, NIS, nama, gender, dan tanggal lahir harus diisi'
      });
    }
    
    // Validasi gender
    if (!['L', 'P'].includes(gender)) {
      return res.status(400).json({
        success: false,
        message: 'Gender harus L atau P'
      });
    }
    
    await client.query('BEGIN');
    
    // Cek email duplicate
    const checkEmail = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    if (checkEmail.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Email sudah terdaftar'
      });
    }
    
    // Cek NIS duplicate
    const checkNis = await client.query(
      'SELECT id FROM students WHERE nis = $1',
      [nis]
    );
    
    if (checkNis.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'NIS sudah terdaftar'
      });
    }
    
    // Validasi class_id jika diisi
    if (class_id) {
      const checkClass = await client.query(
        'SELECT id FROM classes WHERE id = $1',
        [class_id]
      );
      
      if (checkClass.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Class tidak ditemukan'
        });
      }
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const userQuery = `
      INSERT INTO users (email, password, is_active, created_at, updated_at)
      VALUES ($1, $2, true, NOW(), NOW())
      RETURNING id
    `;
    const userResult = await client.query(userQuery, [email, hashedPassword]);
    const userId = userResult.rows[0].id;
    
    // Create student
    const studentQuery = `
      INSERT INTO students (user_id, nis, name, gender, date_of_birth, phone_number, address, class_id, photo_profile, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id, user_id, nis, name, gender, date_of_birth, phone_number, address, class_id, photo_profile, created_at, updated_at
    `;
    const studentResult = await client.query(studentQuery, [
      userId, nis, name, gender, date_of_birth, phone_number, address, class_id, photo_profile
    ]);
    
    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      message: 'Student berhasil dibuat',
      data: { ...studentResult.rows[0], email }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating student:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat student',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  } finally {
    client.release();
  }
});

// UPDATE student
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nis, name, gender, date_of_birth, phone_number, address, class_id, photo_profile } = req.body;
    
    // Cek apakah student ada
    const checkStudent = await pool.query(
      'SELECT id FROM students WHERE id = $1',
      [id]
    );
    
    if (checkStudent.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student tidak ditemukan'
      });
    }
    
    // Cek NIS duplicate jika NIS diubah
    if (nis) {
      const checkNis = await pool.query(
        'SELECT id FROM students WHERE nis = $1 AND id != $2',
        [nis, id]
      );
      
      if (checkNis.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'NIS sudah digunakan student lain'
        });
      }
    }
    
    // Validasi gender jika diubah
    if (gender && !['L', 'P'].includes(gender)) {
      return res.status(400).json({
        success: false,
        message: 'Gender harus L atau P'
      });
    }
    
    // Validasi class_id jika diubah
    if (class_id) {
      const checkClass = await pool.query(
        'SELECT id FROM classes WHERE id = $1',
        [class_id]
      );
      
      if (checkClass.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Class tidak ditemukan'
        });
      }
    }
    
    let query = 'UPDATE students SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (nis) {
      query += `, nis = $${paramIndex}`;
      params.push(nis);
      paramIndex++;
    }
    
    if (name) {
      query += `, name = $${paramIndex}`;
      params.push(name);
      paramIndex++;
    }
    
    if (gender) {
      query += `, gender = $${paramIndex}`;
      params.push(gender);
      paramIndex++;
    }
    
    if (date_of_birth) {
      query += `, date_of_birth = $${paramIndex}`;
      params.push(date_of_birth);
      paramIndex++;
    }
    
    if (phone_number !== undefined) {
      query += `, phone_number = $${paramIndex}`;
      params.push(phone_number);
      paramIndex++;
    }
    
    if (address !== undefined) {
      query += `, address = $${paramIndex}`;
      params.push(address);
      paramIndex++;
    }
    
    if (class_id !== undefined) {
      query += `, class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }
    
    if (photo_profile !== undefined) {
      query += `, photo_profile = $${paramIndex}`;
      params.push(photo_profile);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex}
      RETURNING id, user_id, nis, name, gender, date_of_birth, phone_number, address, class_id, photo_profile, created_at, updated_at`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Student berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate student',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  }
});

// DELETE student (hard delete)
router.delete('/:id', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');
    
    // Get user_id first
    const studentResult = await client.query(
      'SELECT user_id FROM students WHERE id = $1',
      [id]
    );
    
    if (studentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Student tidak ditemukan'
      });
    }
    
    const userId = studentResult.rows[0].user_id;
    
    // Hard delete student (tabel students tidak lagi menggunakan deleted_at)
    await client.query(
      'DELETE FROM students WHERE id = $1',
      [id]
    );
    
    // Soft delete user
    await client.query(
      'DELETE FROM users WHERE id = $1',
      [userId]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Student berhasil dihapus'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting student:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus student',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  } finally {
    client.release();
  }
});

module.exports = router;
