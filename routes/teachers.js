const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const { requireTeacher, requireAdmin } = require('../middlewares/auth.middleware');
const { requireTeacherClassScheduleAccess, requireHomeroomClassAccess } = require('../middlewares/teacherAccess.middleware');
const teacherScheduleController = require('../controllers/teacherScheduleController');
const teacherClassController = require('../controllers/teacherClassController');

// SECURITY: field identitas resmi (name, nip, gender, date_of_birth) dan penugasan
// (department, jadwal, mapel) TIDAK boleh diubah guru sendiri — hanya admin.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validasi field nullable bertipe string dengan batas panjang (sesuai kolom DB).
// true bila INVALID. null diperbolehkan (mengosongkan field); tipe selain string
// ditolak agar tidak bocor jadi error DB (500) di hilir.
function invalidNullableString(val, max) {
  // undefined = field tidak dikirim (tak diubah) → valid; null = sengaja dikosongkan → valid.
  // Tanpa cek undefined, PATCH parsial (mis. ubah email saja) salah ditolak 400.
  if (val === undefined || val === null) return false;
  if (typeof val !== 'string') return true;
  return val.length > max;
}

// Ambil profil guru lengkap (user + teacher), dipakai ulang oleh GET & PATCH /profile.
async function fetchTeacherProfile(teacherId) {
  const result = await pool.query(
    `SELECT
        t.id as teacher_id, t.user_id, t.nip, t.name, t.gender, t.date_of_birth,
        t.phone_number, t.address, t.department, t.photo_profile,
        t.created_at as teacher_created_at, t.updated_at as teacher_updated_at,
        u.email, u.email_verified_at, u.device_id, u.is_active, u.last_login_at,
        u.created_at as user_created_at, u.updated_at as user_updated_at
     FROM teachers t
     INNER JOIN users u ON t.user_id = u.id
     WHERE t.id = $1`,
    [teacherId]
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
    teacher: {
      id: profile.teacher_id,
      nip: profile.nip,
      name: profile.name,
      gender: profile.gender,
      date_of_birth: profile.date_of_birth,
      phone_number: profile.phone_number,
      address: profile.address,
      department: profile.department,
      photo_profile: profile.photo_profile,
      created_at: profile.teacher_created_at,
      updated_at: profile.teacher_updated_at
    }
  };
}

// ==================== TEACHER SCHEDULE ENDPOINTS ====================

// POST submit teaching evidence for a specific period today (UPSERT)
router.post('/submit-period', requireTeacher, teacherScheduleController.submitTeacherPeriod);

// GET all distinct classes taught by authenticated teacher (from teacher_schedules)
router.get('/schedule/classes', requireTeacher, teacherScheduleController.getScheduleClasses);

// GET classes the authenticated teacher must teach today (from teacher_schedules)
router.get('/schedule/today', requireTeacher, teacherScheduleController.getScheduleToday);

// GET classes the authenticated teacher teaches on a specific date
// Example: /api/teachers/schedule?date=2026-04-27
router.get('/schedule', requireTeacher, teacherScheduleController.getScheduleByDate);

// ==================== TEACHER CLASS MANAGEMENT ENDPOINTS ====================

// GET all classes taught by authenticated teacher with today's attendance summary
router.get('/my-classes', requireTeacher, teacherClassController.getTeacherClasses);

// GET students in a specific class with their attendance status
router.get('/class/:classId/students', requireTeacher, requireTeacherClassScheduleAccess, teacherClassController.getClassStudents);

// PATCH attendance by teacher with explicit period/schedule context
router.patch('/attendance/:attendanceId', requireTeacher, teacherClassController.updateTeacherAttendanceWithPeriodContext);

// ==================== HOMEROOM (WALI KELAS) ENDPOINTS ====================

// GET classes where the teacher is homeroom teacher
router.get('/homeroom-classes', requireTeacher, teacherClassController.getHomeroomClasses);

// GET students in the homeroom class with attendance status
router.get('/homeroom/students', requireTeacher, teacherClassController.getHomeroomStudents);

// PATCH update (or create) student attendance in homeroom class
router.patch('/homeroom/attendance', requireTeacher, teacherClassController.updateHomeroomAttendance);

// GET pending attendance approvals for a homeroom class
router.get('/homeroom/pending', requireTeacher, requireHomeroomClassAccess, teacherClassController.getPendingAttendances);

// GET homeroom period monitor per date
router.get('/homeroom/period-monitor', requireTeacher, requireHomeroomClassAccess, teacherClassController.getHomeroomPeriodMonitor);

// POST approve a pending attendance detail
router.post('/homeroom/attendance/:detailId/approve', requireTeacher, teacherClassController.approveAttendance);

// POST reject a pending attendance detail
router.post('/homeroom/attendance/:detailId/reject', requireTeacher, teacherClassController.rejectAttendance);

// ==================== TEACHERS CRUD ====================

// GET self-service profile (guru melihat profilnya sendiri dari token JWT).
// Berguna agar app bisa refetch profil terbaru setelah PATCH /profile.
router.get('/profile', requireTeacher, async (req, res) => {
  try {
    const data = await fetchTeacherProfile(req.user.teacher_id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Profil guru tidak ditemukan' });
    }
    res.json({
      success: true,
      message: 'Data profil guru berhasil diambil',
      data
    });
  } catch (error) {
    console.error('Error fetching teacher profile:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data profil guru',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
});

// PATCH self-service profile (guru mengubah data kontaknya sendiri).
// SECURITY: identitas diambil dari token (req.user.teacher_id), BUKAN dari body → cegah IDOR.
// Hanya field whitelist (email, phone_number, address, photo_profile) yang diproses;
// field lain (name, nip, gender, date_of_birth, department) sengaja diabaikan → cegah mass-assignment.
router.patch('/profile', requireTeacher, async (req, res) => {
  const teacherId = req.user.teacher_id;
  const userId = req.user.user_id;

  const { email, phone_number, address, photo_profile } = req.body;

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

  const teacherSets = [];
  const teacherParams = [];
  let idx = 1;
  if (phone_number !== undefined) { teacherSets.push(`phone_number = $${idx++}`); teacherParams.push(phone_number); }
  if (address !== undefined)      { teacherSets.push(`address = $${idx++}`);      teacherParams.push(address); }
  if (photo_profile !== undefined){ teacherSets.push(`photo_profile = $${idx++}`);teacherParams.push(photo_profile); }

  if (teacherSets.length === 0 && !emailProvided) {
    return res.status(400).json({
      success: false,
      message: 'Tidak ada field yang diubah'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (emailProvided) {
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

    if (teacherSets.length > 0) {
      teacherParams.push(teacherId);
      await client.query(
        `UPDATE teachers SET ${teacherSets.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
        teacherParams
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
    console.error('Error updating teacher self-profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui profil',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  } finally {
    client.release();
  }

  try {
    const data = await fetchTeacherProfile(teacherId);
    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      data
    });
  } catch (error) {
    console.error('Error fetching teacher profile after update:', error);
    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui'
    });
  }
});

// GET all teachers
router.get('/', requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const { department, name } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT t.id, t.user_id, t.nip, t.name, t.gender, t.date_of_birth,
             t.phone_number, t.address, t.department, t.photo_profile,
             t.created_at, t.updated_at, u.email, u.is_active
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (department) {
      query += ` AND t.department ILIKE $${paramIndex}`;
      params.push(`%${department}%`);
      paramIndex++;
    }
    
    if (name) {
      query += ` AND t.name ILIKE $${paramIndex}`;
      params.push(`%${name}%`);
      paramIndex++;
    }
    
    query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Count query
    let countQuery = 'SELECT COUNT(*) FROM teachers WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;
    
    if (department) {
      countQuery += ` AND department ILIKE $${countParamIndex}`;
      countParams.push(`%${department}%`);
      countParamIndex++;
    }
    
    if (name) {
      countQuery += ` AND name ILIKE $${countParamIndex}`;
      countParams.push(`%${name}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      success: true,
      message: 'Data teachers berhasil diambil',
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teachers',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  }
});

// GET teacher by ID (only numeric IDs)
router.get('/:id(\\d+)', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher id' });
    }

    const query = `
      SELECT t.id, t.user_id, t.nip, t.name, t.gender, t.date_of_birth,
             t.phone_number, t.address, t.department, t.photo_profile,
             t.created_at, t.updated_at, u.email, u.is_active
      FROM teachers t
      INNER JOIN users u ON t.user_id = u.id
      WHERE t.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher tidak ditemukan'
      });
    }

    res.json({
      success: true,
      message: 'Data teacher berhasil diambil',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data teacher',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  }
});

// CREATE teacher (with user)
router.post('/', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      email, password, nip, name, gender, date_of_birth,
      phone_number, address, department, photo_profile 
    } = req.body;
    
    // Validasi input
    if (!email || !password || !nip || !name || !gender || !date_of_birth) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, NIP, nama, gender, dan tanggal lahir harus diisi'
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
    
    // Cek NIP duplicate
    const checkNip = await client.query(
      'SELECT id FROM teachers WHERE nip = $1',
      [nip]
    );
    
    if (checkNip.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'NIP sudah terdaftar'
      });
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
    
    // Create teacher
    const teacherQuery = `
      INSERT INTO teachers (user_id, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id, user_id, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile, created_at, updated_at
    `;
    const teacherResult = await client.query(teacherQuery, [
      userId, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile
    ]);
    
    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      message: 'Teacher berhasil dibuat',
      data: { ...teacherResult.rows[0], email }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat teacher',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  } finally {
    client.release();
  }
});

// UPDATE teacher
router.patch('/:id(\\d+)', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher id' });
    }
    const { nip, name, gender, date_of_birth, phone_number, address, department, photo_profile } = req.body;

    // Cek apakah teacher ada
    const checkTeacher = await pool.query(
      'SELECT id FROM teachers WHERE id = $1',
      [id]
    );
    
    if (checkTeacher.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher tidak ditemukan'
      });
    }
    
    // Cek NIP duplicate jika NIP diubah
    if (nip) {
      const checkNip = await pool.query(
        'SELECT id FROM teachers WHERE nip = $1 AND id != $2',
        [nip, id]
        );
      
      if (checkNip.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'NIP sudah digunakan teacher lain'
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
    
    let query = 'UPDATE teachers SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;
    
    if (nip) {
      query += `, nip = $${paramIndex}`;
      params.push(nip);
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
    
    if (department !== undefined) {
      query += `, department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }
    
    if (photo_profile !== undefined) {
      query += `, photo_profile = $${paramIndex}`;
      params.push(photo_profile);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex}
      RETURNING id, user_id, nip, name, gender, date_of_birth, phone_number, address, department, photo_profile, created_at, updated_at`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: 'Teacher berhasil diupdate',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupdate teacher',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  }
});

// DELETE teacher — hard delete; deletes the linked user which cascades to teacher via FK
router.delete('/:id(\\d+)', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher id' });
    }
    
    await client.query('BEGIN');
    
    // Get user_id before deleting
    const teacherResult = await client.query(
      'SELECT user_id FROM teachers WHERE id = $1',
      [id]
    );
    
    if (teacherResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Teacher tidak ditemukan'
      });
    }
    
    const userId = teacherResult.rows[0].user_id;
    
    // Deleting the user cascades to the teachers row via FK ON DELETE CASCADE
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Teacher berhasil dihapus'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus teacher',
      ...(process.env.NODE_ENV === 'development' && { ...(process.env.NODE_ENV === 'development' && { error: error.message }) })
    });
  } finally {
    client.release();
  }
});

module.exports = router;
