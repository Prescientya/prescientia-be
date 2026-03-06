const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireStudent, requireTeacher } = require('../middlewares/auth.middleware');

// ============================================================
// ABSENCE LETTERS (Surat Izin / Sakit)
// ============================================================
// Table: absence_letters
// Flow for students: pending → approved_wali → approved (by admin) | rejected
// Flow for teachers: pending → approved (by admin) | rejected
// ============================================================

// --------------------------------------------------
// Auto-create table if not exists
// --------------------------------------------------
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS absence_letters (
        id SERIAL PRIMARY KEY,
        user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('student', 'teacher')),
        student_id INTEGER,
        teacher_id INTEGER,
        class_id INTEGER,
        calendar_id INTEGER,
        date DATE NOT NULL,
        reason VARCHAR(20) NOT NULL CHECK (reason IN ('sakit', 'izin')),
        description TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved_wali', 'approved', 'rejected')),
        approved_by_wali INTEGER,
        approved_by_admin INTEGER,
        approved_wali_at TIMESTAMP,
        approved_admin_at TIMESTAMP,
        rejected_by INTEGER,
        rejected_by_type VARCHAR(10),
        rejected_at TIMESTAMP,
        rejection_note TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[AbsenceLetters] ✓ Table ensured');
  } catch (e) {
    console.error('[AbsenceLetters] Table creation error:', e.message);
  }
})();

// --------------------------------------------------
// POST /student — Student submits an absence letter
// --------------------------------------------------
router.post('/student', requireStudent, async (req, res) => {
  try {
    const { student_id, class_id } = req.user;
    const { reason, description } = req.body;

    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        message: 'Reason dan description wajib diisi.',
      });
    }

    if (!['sakit', 'izin'].includes(reason)) {
      return res.status(400).json({
        success: false,
        message: 'Reason harus sakit atau izin.',
      });
    }

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    // Check if already submitted for today
    const existing = await pool.query(
      `SELECT id FROM absence_letters WHERE student_id = $1 AND date = $2 AND status != 'rejected'`,
      [student_id, dateStr]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Anda sudah mengajukan surat izin untuk hari ini.',
      });
    }

    // Get calendar_id for today (optional)
    let calendarId = null;
    try {
      const cal = await pool.query(
        `SELECT id FROM school_calendar WHERE date = $1 LIMIT 1`,
        [dateStr]
      );
      if (cal.rows.length > 0) calendarId = cal.rows[0].id;
    } catch (_) {}

    const result = await pool.query(
      `INSERT INTO absence_letters (user_type, student_id, class_id, calendar_id, date, reason, description, status)
       VALUES ('student', $1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [student_id, class_id, calendarId, dateStr, reason, description]
    );

    res.status(201).json({
      success: true,
      message: 'Surat izin berhasil dikirim. Menunggu persetujuan wali kelas.',
      data: result.rows[0],
    });
  } catch (e) {
    console.error('[AbsenceLetters] POST /student error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// POST /teacher — Teacher submits an absence letter
// --------------------------------------------------
router.post('/teacher', requireTeacher, async (req, res) => {
  try {
    const { teacher_id } = req.user;
    const { reason, description } = req.body;

    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        message: 'Reason dan description wajib diisi.',
      });
    }

    if (!['sakit', 'izin'].includes(reason)) {
      return res.status(400).json({
        success: false,
        message: 'Reason harus sakit atau izin.',
      });
    }

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    // Check if already submitted for today
    const existing = await pool.query(
      `SELECT id FROM absence_letters WHERE teacher_id = $1 AND date = $2 AND status != 'rejected'`,
      [teacher_id, dateStr]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Anda sudah mengajukan surat izin untuk hari ini.',
      });
    }

    // Get calendar_id for today
    let calendarId = null;
    try {
      const cal = await pool.query(
        `SELECT id FROM school_calendar WHERE date = $1 LIMIT 1`,
        [dateStr]
      );
      if (cal.rows.length > 0) calendarId = cal.rows[0].id;
    } catch (_) {}

    const result = await pool.query(
      `INSERT INTO absence_letters (user_type, teacher_id, calendar_id, date, reason, description, status)
       VALUES ('teacher', $1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [teacher_id, calendarId, dateStr, reason, description]
    );

    res.status(201).json({
      success: true,
      message: 'Surat izin berhasil dikirim. Menunggu persetujuan admin.',
      data: result.rows[0],
    });
  } catch (e) {
    console.error('[AbsenceLetters] POST /teacher error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// GET /student/my — Student gets their own letters
// --------------------------------------------------
router.get('/student/my', requireStudent, async (req, res) => {
  try {
    const { student_id } = req.user;
    const { date, status } = req.query;

    let query = `SELECT * FROM absence_letters WHERE student_id = $1`;
    const params = [student_id];
    let idx = 2;

    if (date) {
      query += ` AND date = $${idx++}`;
      params.push(date);
    }
    if (status) {
      query += ` AND status = $${idx++}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (e) {
    console.error('[AbsenceLetters] GET /student/my error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// GET /teacher/my — Teacher gets their own letters
// --------------------------------------------------
router.get('/teacher/my', requireTeacher, async (req, res) => {
  try {
    const { teacher_id } = req.user;
    const { date, status } = req.query;

    let query = `SELECT * FROM absence_letters WHERE teacher_id = $1`;
    const params = [teacher_id];
    let idx = 2;

    if (date) {
      query += ` AND date = $${idx++}`;
      params.push(date);
    }
    if (status) {
      query += ` AND status = $${idx++}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (e) {
    console.error('[AbsenceLetters] GET /teacher/my error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// GET /pending/class/:class_id — Wali kelas gets pending student letters
// --------------------------------------------------
router.get('/pending/class/:class_id', requireTeacher, async (req, res) => {
  try {
    const classId = parseInt(req.params.class_id);
    const { teacher_id } = req.user;

    // Check wali kelas from DB (JWT teacher_roles may be stale)
    const waliCheck = await pool.query(
      `SELECT 1 FROM teacher_class_roles WHERE teacher_id = $1 AND class_id = $2 AND role = 'wali_kelas'
       UNION
       SELECT 1 FROM classes WHERE homeroom_teacher_id = $1 AND id = $2`,
      [teacher_id, classId]
    );

    if (waliCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Anda bukan wali kelas dari kelas ini.',
      });
    }

    const result = await pool.query(
      `SELECT al.*, s.name as student_name, s.nis
       FROM absence_letters al
       JOIN students s ON al.student_id = s.id
       WHERE al.class_id = $1 AND al.status = 'pending' AND al.user_type = 'student'
       ORDER BY al.created_at DESC`,
      [classId]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (e) {
    console.error('[AbsenceLetters] GET /pending/class error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// PATCH /approve/wali/:id — Wali kelas approves student letter
// --------------------------------------------------
router.patch('/approve/wali/:id', requireTeacher, async (req, res) => {
  try {
    const letterId = parseInt(req.params.id);
    const { teacher_id } = req.user;

    // Get the letter
    const letter = await pool.query(
      `SELECT * FROM absence_letters WHERE id = $1`,
      [letterId]
    );

    if (letter.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Surat izin tidak ditemukan.' });
    }

    const letterData = letter.rows[0];

    if (letterData.user_type !== 'student') {
      return res.status(400).json({ success: false, message: 'Endpoint ini hanya untuk surat siswa.' });
    }

    if (letterData.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Surat sudah diproses sebelumnya.' });
    }

    // Check wali kelas from DB (JWT teacher_roles may be stale)
    const waliCheck = await pool.query(
      `SELECT 1 FROM teacher_class_roles WHERE teacher_id = $1 AND class_id = $2 AND role = 'wali_kelas'
       UNION
       SELECT 1 FROM classes WHERE homeroom_teacher_id = $1 AND id = $2`,
      [teacher_id, letterData.class_id]
    );

    if (waliCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Anda bukan wali kelas siswa ini.' });
    }

    const result = await pool.query(
      `UPDATE absence_letters
       SET status = 'approved', approved_by_wali = $1, approved_wali_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [teacher_id, letterId]
    );

    // Auto-create/update attendance record
    const approved = result.rows[0];
    try {
      if (approved.student_id) {
        const existingAtt = await pool.query(
          `SELECT id FROM student_attendances WHERE student_id = $1 AND calendar_id = $2`,
          [approved.student_id, approved.calendar_id]
        );
        if (existingAtt.rows.length > 0) {
          await pool.query(
            `UPDATE student_attendances SET status = $1, updated_at = NOW() WHERE id = $2`,
            [approved.reason, existingAtt.rows[0].id]
          );
        } else if (approved.calendar_id) {
          await pool.query(
            `INSERT INTO student_attendances (student_id, class_id, calendar_id, status, source, created_at)
             VALUES ($1, $2, $3, $4, 'wali_kelas', NOW())`,
            [approved.student_id, approved.class_id, approved.calendar_id, approved.reason]
          );
        }

        // Update student_attendance_summary counters
        const summaryCol = approved.reason === 'sakit' ? 'total_sakit' : 'total_izin';
        await pool.query(
          `INSERT INTO student_attendance_summary (student_id, ${summaryCol}, created_at, updated_at)
           VALUES ($1, 1, NOW(), NOW())
           ON CONFLICT (student_id) DO UPDATE
           SET ${summaryCol} = student_attendance_summary.${summaryCol} + 1,
               updated_at = NOW()`,
          [approved.student_id]
        );
      }
    } catch (attErr) {
      console.error('[AbsenceLetters] Error updating attendance record:', attErr.message);
    }

    res.json({
      success: true,
      message: 'Surat izin disetujui dan status kehadiran telah diperbarui.',
      data: result.rows[0],
    });
  } catch (e) {
    console.error('[AbsenceLetters] PATCH /approve/wali error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// PATCH /reject/:id — Wali kelas or admin rejects a letter
// --------------------------------------------------
router.patch('/reject/:id', requireTeacher, async (req, res) => {
  try {
    const letterId = parseInt(req.params.id);
    const { teacher_id } = req.user;
    const { rejection_note } = req.body;

    const letter = await pool.query(
      `SELECT * FROM absence_letters WHERE id = $1`,
      [letterId]
    );

    if (letter.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Surat izin tidak ditemukan.' });
    }

    const letterData = letter.rows[0];
    if (letterData.status === 'approved' || letterData.status === 'rejected') {
      return res.status(400).json({ success: false, message: 'Surat sudah selesai diproses.' });
    }

    const result = await pool.query(
      `UPDATE absence_letters
       SET status = 'rejected', rejected_by = $1, rejected_by_type = 'teacher', rejected_at = NOW(),
           rejection_note = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [teacher_id, rejection_note || null, letterId]
    );

    res.json({
      success: true,
      message: 'Surat izin ditolak.',
      data: result.rows[0],
    });
  } catch (e) {
    console.error('[AbsenceLetters] PATCH /reject error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// GET /pending/all — Admin gets all pending letters (students approved_wali + teachers pending)
// --------------------------------------------------
router.get('/pending/all', async (req, res) => {
  try {
    const { user_type } = req.query;

    let query = `
      SELECT al.*,
        CASE WHEN al.user_type = 'student' THEN s.name ELSE t.name END as name,
        CASE WHEN al.user_type = 'student' THEN s.nis ELSE NULL END as nis,
        c.name as class_name
      FROM absence_letters al
      LEFT JOIN students s ON al.student_id = s.id
      LEFT JOIN teachers t ON al.teacher_id = t.id
      LEFT JOIN classes c ON al.class_id = c.id
      WHERE al.status = 'pending'
    `;
    const params = [];

    if (user_type) {
      query += ` AND al.user_type = $1`;
      params.push(user_type);
    }

    query += ` ORDER BY al.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (e) {
    console.error('[AbsenceLetters] GET /pending/all error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// PATCH /approve/admin/:id — Admin final approval
// --------------------------------------------------
router.patch('/approve/admin/:id', async (req, res) => {
  try {
    const letterId = parseInt(req.params.id);
    const { admin_id } = req.body;

    const letter = await pool.query(
      `SELECT * FROM absence_letters WHERE id = $1`,
      [letterId]
    );

    if (letter.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Surat izin tidak ditemukan.' });
    }

    const letterData = letter.rows[0];

    // Both student and teacher letters can be approved from 'pending' status
    if (letterData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Surat sudah diproses sebelumnya.',
      });
    }

    // Update letter status to approved
    const result = await pool.query(
      `UPDATE absence_letters
       SET status = 'approved', approved_by_admin = $1, approved_admin_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [admin_id || null, letterId]
    );

    // Also update/create the attendance record with the reason status
    const approved = result.rows[0];
    try {
      if (approved.user_type === 'student' && approved.student_id) {
        // Check if attendance record exists for this date
        const existingAtt = await pool.query(
          `SELECT id FROM student_attendances WHERE student_id = $1 AND calendar_id = $2`,
          [approved.student_id, approved.calendar_id]
        );

        if (existingAtt.rows.length > 0) {
          // Update existing attendance
          await pool.query(
            `UPDATE student_attendances SET status = $1, updated_at = NOW() WHERE id = $2`,
            [approved.reason, existingAtt.rows[0].id]
          );
        } else if (approved.calendar_id) {
          // Create new attendance record
          await pool.query(
            `INSERT INTO student_attendances (student_id, class_id, calendar_id, status, source, created_at)
             VALUES ($1, $2, $3, $4, 'manual', NOW())`,
            [approved.student_id, approved.class_id, approved.calendar_id, approved.reason]
          );
        }

        // Update student_attendance_summary counters
        const summaryCol = approved.reason === 'sakit' ? 'total_sakit' : 'total_izin';
        await pool.query(
          `INSERT INTO student_attendance_summary (student_id, ${summaryCol}, created_at, updated_at)
           VALUES ($1, 1, NOW(), NOW())
           ON CONFLICT (student_id) DO UPDATE
           SET ${summaryCol} = student_attendance_summary.${summaryCol} + 1,
               updated_at = NOW()`,
          [approved.student_id]
        );
      } else if (approved.user_type === 'teacher' && approved.teacher_id) {
        const existingAtt = await pool.query(
          `SELECT id FROM teacher_attendances WHERE teacher_id = $1 AND calendar_id = $2`,
          [approved.teacher_id, approved.calendar_id]
        );

        if (existingAtt.rows.length > 0) {
          await pool.query(
            `UPDATE teacher_attendances SET status = $1, updated_at = NOW() WHERE id = $2`,
            [approved.reason, existingAtt.rows[0].id]
          );
        } else if (approved.calendar_id) {
          await pool.query(
            `INSERT INTO teacher_attendances (teacher_id, calendar_id, status, source, created_at)
             VALUES ($1, $2, $3, 'manual', NOW())`,
            [approved.teacher_id, approved.calendar_id, approved.reason]
          );
        }
      }
    } catch (attErr) {
      console.error('[AbsenceLetters] Error updating attendance record:', attErr.message);
      // Don't fail the approval — attendance sync is a best-effort operation
    }

    res.json({
      success: true,
      message: 'Surat izin disetujui dan status kehadiran telah diperbarui.',
      data: result.rows[0],
    });
  } catch (e) {
    console.error('[AbsenceLetters] PATCH /approve/admin error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// PATCH /reject/admin/:id — Admin rejects a letter
// --------------------------------------------------
router.patch('/reject/admin/:id', async (req, res) => {
  try {
    const letterId = parseInt(req.params.id);
    const { admin_id, rejection_note } = req.body;

    const letter = await pool.query(
      `SELECT * FROM absence_letters WHERE id = $1`,
      [letterId]
    );

    if (letter.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Surat izin tidak ditemukan.' });
    }

    const letterData = letter.rows[0];
    if (letterData.status === 'approved' || letterData.status === 'rejected') {
      return res.status(400).json({ success: false, message: 'Surat sudah selesai diproses.' });
    }

    const result = await pool.query(
      `UPDATE absence_letters
       SET status = 'rejected', rejected_by = $1, rejected_by_type = 'admin', rejected_at = NOW(),
           rejection_note = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [admin_id || null, rejection_note || null, letterId]
    );

    res.json({
      success: true,
      message: 'Surat izin ditolak.',
      data: result.rows[0],
    });
  } catch (e) {
    console.error('[AbsenceLetters] PATCH /reject/admin error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --------------------------------------------------
// GET / — List all absence letters (admin)
// --------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { user_type, status, date, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereConditions = [];
    const params = [];
    let idx = 1;

    if (user_type) {
      whereConditions.push(`al.user_type = $${idx++}`);
      params.push(user_type);
    }
    if (status) {
      whereConditions.push(`al.status = $${idx++}`);
      params.push(status);
    }
    if (date) {
      whereConditions.push(`al.date = $${idx++}`);
      params.push(date);
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM absence_letters al ${whereClause}`,
      params
    );

    const dataResult = await pool.query(
      `SELECT al.*,
        CASE WHEN al.user_type = 'student' THEN s.name ELSE t.name END as name,
        CASE WHEN al.user_type = 'student' THEN s.nis ELSE NULL END as nis,
        c.name as class_name
       FROM absence_letters al
       LEFT JOIN students s ON al.student_id = s.id
       LEFT JOIN teachers t ON al.teacher_id = t.id
       LEFT JOIN classes c ON al.class_id = c.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), offset]
    );

    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (e) {
    console.error('[AbsenceLetters] GET / error:', e);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
