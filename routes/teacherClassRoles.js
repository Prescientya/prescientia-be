const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { localDateStr } = require('../utils/dateHelper');
const { requireTeacher, requireAdmin } = require('../middlewares/auth.middleware');

// GET all teacher class roles
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, class_id, teacher_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT tcr.id, tcr.teacher_id, tcr.class_id, tcr.role, tcr.created_at, tcr.updated_at,
             t.name as teacher_name, t.nip, c.class as class_level, c.major as class_major
      FROM teacher_class_roles tcr
      LEFT JOIN teachers t ON tcr.teacher_id = t.id
      LEFT JOIN classes c ON tcr.class_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (class_id) {
      query += ` AND tcr.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }

    if (teacher_id) {
      query += ` AND tcr.teacher_id = $${paramIndex}`;
      params.push(teacher_id);
      paramIndex++;
    }

    query += ` ORDER BY tcr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Data teacher class roles berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching teacher class roles:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// GET classes with attendance for a specific teacher (used by prescientia_guru_fe)
// GET /api/teacher-class-roles/classes-with-attendance/:teacherId?attendance_date=YYYY-MM-DD
router.get('/classes-with-attendance/:teacherId', requireTeacher, async (req, res) => {
  try {
    const { teacherId } = req.params;
    // SECURITY: cegah IDOR — guru A tidak boleh pass id guru B di URL.
    // teacherId hanya untuk konsistensi URL; otoritatifnya dari token.
    const tokenTeacherId = req.user && req.user.teacher_id;
    if (!tokenTeacherId || String(tokenTeacherId) !== String(teacherId)) {
      return res.status(403).json({
        success: false,
        message: 'Akses terlarang: tidak boleh melihat kelas guru lain'
      });
    }
    const { attendance_date } = req.query;
    const targetDate = attendance_date || localDateStr(new Date());

    // Get classes where teacher has a role
    const classesQuery = `
      SELECT tcr.id as role_id, tcr.role, tcr.class_id,
             c.class as class_level, c.major as class_major
      FROM teacher_class_roles tcr
      LEFT JOIN classes c ON tcr.class_id = c.id
      WHERE tcr.teacher_id = $1
      ORDER BY c.class ASC, c.major ASC
    `;
    const classesResult = await pool.query(classesQuery, [teacherId]);

    // For each class, get student attendance data for the target date
    const classesWithAttendance = [];
    for (const cls of classesResult.rows) {
      const studentsQuery = `
        SELECT s.id as student_id, s.name, s.nis, s.gender, s.photo_profile,
               sa.status as attendance_status, sa.check_in_time, sa.check_out_time, sa.source
        FROM students s
        LEFT JOIN student_attendances sa ON sa.student_id = s.id
          AND sa.class_id = $1
          AND DATE(sa.check_in_time) = $2
        WHERE s.class_id = $3
        ORDER BY s.name ASC
      `;
      const studentsResult = await pool.query(studentsQuery, [cls.class_id, targetDate, cls.class_id]);

      const totalStudents = studentsResult.rows.length;
      const present = studentsResult.rows.filter(s => s.attendance_status === 'hadir').length;
      const absent = studentsResult.rows.filter(s => s.attendance_status === 'alpa').length;
      const sick = studentsResult.rows.filter(s => s.attendance_status === 'sakit').length;
      const permission = studentsResult.rows.filter(s => s.attendance_status === 'izin').length;

      classesWithAttendance.push({
        ...cls,
        attendance_date: targetDate,
        students: studentsResult.rows,
        summary: {
          total_students: totalStudents,
          present,
          absent,
          sick,
          permission,
          no_info: totalStudents - present - absent - sick - permission
        }
      });
    }

    res.json({
      success: true,
      data: classesWithAttendance
    });
  } catch (error) {
    console.error('Error fetching teacher classes with attendance:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// POST create teacher class role
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { teacher_id, class_id, role } = req.body;

    if (!teacher_id || !class_id || !role) {
      return res.status(400).json({ success: false, message: 'teacher_id, class_id, dan role harus diisi' });
    }

    const result = await pool.query(
      `INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
      [teacher_id, class_id, role]
    );

    res.status(201).json({ success: true, message: 'Teacher class role berhasil dibuat', data: result.rows[0] });
  } catch (error) {
    console.error('Error creating teacher class role:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

// DELETE teacher class role
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM teacher_class_roles WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Teacher class role tidak ditemukan' });
    }

    res.json({ success: true, message: 'Teacher class role berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting teacher class role:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan', ...(process.env.NODE_ENV === 'development' && { error: error.message }) });
  }
});

module.exports = router;
