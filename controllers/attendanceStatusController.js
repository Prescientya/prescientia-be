const pool = require('../config/database');

// ==================== HELPER FUNCTIONS ====================

/**
 * Mendapatkan hari dalam bahasa Indonesia (sesuai enum class_periods.day)
 */
function getDayNameId() {
  const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  const now = new Date();
  return days[now.getDay()];
}

/**
 * Mendapatkan jam pelajaran aktif saat ini berdasarkan hari dan waktu.
 * Returns: { id, sequence, start_time, end_time, activity_type } atau null
 */
async function getCurrentPeriod() {
  const day = getDayNameId();
  if (day === 'minggu' || day === 'sabtu') return null;

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 8); // HH:MM:SS

  const result = await pool.query(
    `SELECT id, sequence, start_time, end_time, activity_type
     FROM class_periods
     WHERE day = $1
       AND start_time <= $2
       AND end_time > $3
       AND activity_type = 'lesson'
     ORDER BY sequence ASC
     LIMIT 1`,
    [day, currentTime, currentTime]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Mendapatkan jam pelajaran terakhir hari ini (untuk menentukan jam pulang).
 * Returns: end_time string atau null
 */
async function getLastPeriodEndTime() {
  const day = getDayNameId();
  if (day === 'minggu' || day === 'sabtu') return null;

  const result = await pool.query(
    `SELECT end_time
     FROM class_periods
     WHERE day = $1
       AND activity_type = 'lesson'
     ORDER BY sequence DESC
     LIMIT 1`,
    [day]
  );

  return result.rows.length > 0 ? result.rows[0].end_time : null;
}

/**
 * Cek apakah waktu sekarang masih sebelum jam pulang.
 */
async function isBeforeSchoolEnd() {
  const lastEnd = await getLastPeriodEndTime();
  if (!lastEnd) return false;

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 8);
  return currentTime <= lastEnd;
}

// ==================== CHANGE ATTENDANCE STATUS ====================

/**
 * POST /change-status
 * Mengubah status kehadiran siswa dan mencatat log perubahan.
 *
 * Body: { attendance_id, new_status, note? }
 *
 * Otorisasi:
 * - Walikelas: bisa ubah status siswa di kelasnya kapan saja
 * - Pengajar: hanya bisa ubah saat jam pelajarannya di kelas tersebut
 * - Siswa (KM/WKM/Sekretaris): bisa ubah siswa sekelasnya sampai jam pulang
 */
async function changeAttendanceStatus(req, res) {
  try {
    const { attendance_id, new_status, note } = req.body;

    // Validasi input
    if (!attendance_id || !new_status) {
      return res.status(400).json({
        success: false,
        message: 'attendance_id dan new_status wajib diisi'
      });
    }

    const validStatuses = ['hadir', 'sakit', 'izin', 'alpa', 'terlambat'];
    if (!validStatuses.includes(new_status)) {
      return res.status(400).json({
        success: false,
        message: `Status tidak valid. Gunakan salah satu: ${validStatuses.join(', ')}`
      });
    }

    // Ambil data attendance beserta info siswa dan kelas
    const attResult = await pool.query(
      `SELECT sa.id, sa.student_id, sa.class_id, sa.status as current_status,
              s.name as student_name, s.class_id as student_class_id
       FROM student_attendances sa
       JOIN students s ON sa.student_id = s.id
       WHERE sa.id = $1`,
      [attendance_id]
    );

    if (attResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kehadiran tidak ditemukan'
      });
    }

    const attendance = attResult.rows[0];
    const oldStatus = attendance.current_status;

    // Jika status sama, tidak perlu diubah
    if (oldStatus === new_status) {
      return res.status(400).json({
        success: false,
        message: `Status sudah ${new_status}, tidak ada perubahan`
      });
    }

    const targetClassId = attendance.class_id;

    // Tentukan jam pelajaran saat ini
    const currentPeriod = await getCurrentPeriod();

    // ============ OTORISASI ============
    let changedByType = null;
    let changedById = null;
    let changedByName = null;

    if (req.user.teacher_id) {
      // ---- GURU ----
      const teacherId = req.user.teacher_id;

      // Ambil nama guru
      const teacherResult = await pool.query(
        'SELECT name FROM teachers WHERE id = $1',
        [teacherId]
      );
      if (teacherResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan' });
      }
      const teacherName = teacherResult.rows[0].name;

      // Cek apakah guru adalah walikelas dari kelas siswa ini
      const walkelasResult = await pool.query(
        `SELECT id FROM classes WHERE id = $1 AND homeroom_teacher_id = $2`,
        [targetClassId, teacherId]
      );

      if (walkelasResult.rows.length > 0) {
        // WALIKELAS — boleh ubah kapan saja
        changedByType = 'wali_kelas';
        changedById = teacherId;
        changedByName = teacherName;
      } else {
        // Bukan walikelas, cek apakah pengajar di kelas ini
        // Pengajar hanya boleh saat jam pelajarannya
        if (!currentPeriod) {
          return res.status(403).json({
            success: false,
            message: 'Saat ini bukan jam pelajaran. Hanya walikelas yang bisa mengubah status di luar jam pelajaran.'
          });
        }

        // Cek apakah guru mengajar di kelas ini pada jam ini
        const scheduleResult = await pool.query(
          `SELECT ts.id
           FROM teacher_schedules ts
           WHERE ts.teacher_id = $1
             AND ts.class_id = $2
             AND ts.class_period_id = $3`,
          [teacherId, targetClassId, currentPeriod.id]
        );

        if (scheduleResult.rows.length === 0) {
          return res.status(403).json({
            success: false,
            message: 'Anda bukan pengajar di kelas ini pada jam pelajaran saat ini.'
          });
        }

        changedByType = 'guru_pengajar';
        changedById = teacherId;
        changedByName = teacherName;
      }

    } else if (req.user.student_id) {
      // ---- SISWA ----
      const studentId = req.user.student_id;
      const studentClassId = req.user.class_id;

      // Siswa hanya bisa ubah status teman sekelasnya
      if (String(studentClassId) !== String(targetClassId)) {
        return res.status(403).json({
          success: false,
          message: 'Anda hanya bisa mengubah status kehadiran siswa di kelas Anda.'
        });
      }

      // Siswa tidak boleh ubah statusnya sendiri
      if (String(studentId) === String(attendance.student_id)) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak bisa mengubah status kehadiran Anda sendiri.'
        });
      }

      // Cek role siswa: hanya KM, WKM, Sekretaris yang boleh
      const roleResult = await pool.query(
        `SELECT role FROM student_class_roles
         WHERE student_id = $1 AND class_id = $2`,
        [studentId, studentClassId]
      );

      const studentRole = roleResult.rows.length > 0 ? roleResult.rows[0].role : 'pelajar';
      const allowedRoles = ['KM', 'WKM', 'Sekretaris'];

      if (!allowedRoles.includes(studentRole)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Ketua Murid (KM), Wakil KM, atau Sekretaris yang bisa mengubah status kehadiran.'
        });
      }

      // Cek apakah masih dalam jam sekolah (sebelum jam pulang)
      const stillInSchool = await isBeforeSchoolEnd();
      if (!stillInSchool) {
        return res.status(403).json({
          success: false,
          message: 'Jam sekolah sudah berakhir. Perubahan status kehadiran tidak diperbolehkan lagi.'
        });
      }

      // Ambil nama siswa pengubah
      const studentResult = await pool.query(
        'SELECT name FROM students WHERE id = $1',
        [studentId]
      );
      if (studentResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
      }

      changedByType = 'siswa';
      changedById = studentId;
      changedByName = `${studentResult.rows[0].name} (${studentRole})`;

    } else {
      return res.status(401).json({
        success: false,
        message: 'Token tidak mengandung informasi pengguna yang valid.'
      });
    }

    // ============ EKSEKUSI PERUBAHAN ============

    // 1. Update status di student_attendances
    const sourceValue = changedByType === 'wali_kelas'
      ? 'wali_kelas'
      : changedByType === 'guru_pengajar'
        ? 'guru_pengajar'
        : 'manual';

    const auditRole = changedByType === 'wali_kelas'
      ? 'wali_kelas'
      : changedByType === 'guru_pengajar'
        ? 'guru_pengajar'
        : 'system';

    const auditTeacherId = auditRole === 'system' ? null : changedById;

    await pool.query(
      `UPDATE student_attendances
       SET status = $1,
           source = $2,
           updated_by_role = $4,
           updated_by_teacher_id = $5,
           change_reason = $6,
           updated_at = NOW()
       WHERE id = $3`,
      [new_status, sourceValue, attendance_id, auditRole, auditTeacherId, note || null]
    );

    // 2. Insert log ke attendance_status_changes
    const logResult = await pool.query(
      `INSERT INTO attendance_status_changes
       (attendance_id, student_id, class_period_id, old_status, new_status,
        changed_by_type, changed_by_id, changed_by_name, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [
        attendance_id,
        attendance.student_id,
        currentPeriod ? currentPeriod.id : null,
        oldStatus,
        new_status,
        changedByType,
        changedById,
        changedByName,
        note || null
      ]
    );

    return res.json({
      success: true,
      message: `Status kehadiran ${attendance.student_name} berhasil diubah dari "${oldStatus}" menjadi "${new_status}"`,
      data: {
        attendance_id: parseInt(attendance_id),
        student_name: attendance.student_name,
        old_status: oldStatus,
        new_status: new_status,
        changed_by: changedByName,
        changed_by_type: changedByType,
        period: currentPeriod ? {
          id: currentPeriod.id,
          sequence: currentPeriod.sequence,
          start_time: currentPeriod.start_time,
          end_time: currentPeriod.end_time
        } : null,
        log: logResult.rows[0]
      }
    });

  } catch (error) {
    console.error('Error changing attendance status:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengubah status kehadiran',
      error: error.message
    });
  }
}

// ==================== GET STATUS CHANGE LOGS ====================

/**
 * GET /logs/:attendance_id
 * Mendapatkan semua log perubahan status untuk satu attendance record.
 */
async function getStatusChangeLogs(req, res) {
  try {
    const { attendance_id } = req.params;

    if (!attendance_id) {
      return res.status(400).json({
        success: false,
        message: 'attendance_id wajib diisi'
      });
    }

    // Verifikasi attendance ada dan ambil info dasar
    const attResult = await pool.query(
      `SELECT sa.id, sa.student_id, sa.class_id, sa.status,
              s.name as student_name, s.nis
       FROM student_attendances sa
       JOIN students s ON sa.student_id = s.id
       WHERE sa.id = $1`,
      [attendance_id]
    );

    if (attResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kehadiran tidak ditemukan'
      });
    }

    const attendance = attResult.rows[0];

    // Otorisasi: guru boleh lihat semua, siswa hanya boleh lihat di kelasnya
    if (req.user.student_id) {
      if (String(req.user.class_id) !== String(attendance.class_id)) {
        return res.status(403).json({
          success: false,
          message: 'Anda hanya bisa melihat log perubahan siswa di kelas Anda.'
        });
      }
    }

    // Ambil semua log perubahan
    const logsResult = await pool.query(
      `SELECT asc2.id, asc2.class_period_id, asc2.old_status, asc2.new_status,
              asc2.changed_by_type, asc2.changed_by_id, asc2.changed_by_name,
              asc2.note, asc2.created_at,
              cp.sequence as period_sequence, cp.start_time as period_start,
              cp.end_time as period_end
       FROM attendance_status_changes asc2
       LEFT JOIN class_periods cp ON asc2.class_period_id = cp.id
       WHERE asc2.attendance_id = $1
       ORDER BY asc2.created_at ASC`,
      [attendance_id]
    );

    return res.json({
      success: true,
      data: {
        attendance: {
          id: attendance.id,
          student_id: attendance.student_id,
          student_name: attendance.student_name,
          nis: attendance.nis,
          current_status: attendance.status
        },
        logs: logsResult.rows.map(log => ({
          id: log.id,
          period: log.class_period_id ? {
            id: log.class_period_id,
            sequence: log.period_sequence,
            jam_ke: (log.period_sequence || 0) + 1, // 1-indexed for display
            start_time: log.period_start,
            end_time: log.period_end
          } : null,
          old_status: log.old_status,
          new_status: log.new_status,
          changed_by_type: log.changed_by_type,
          changed_by_id: log.changed_by_id,
          changed_by_name: log.changed_by_name,
          note: log.note,
          created_at: log.created_at
        })),
        total_changes: logsResult.rows.length
      }
    });

  } catch (error) {
    console.error('Error fetching status change logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil log perubahan status',
      error: error.message
    });
  }
}

// ==================== GET LOGS BY STUDENT ====================

/**
 * GET /logs/student/:student_id
 * Mendapatkan semua log perubahan status kehadiran per siswa (hari ini).
 * Query params: ?date=YYYY-MM-DD (optional, default: hari ini)
 */
async function getLogsByStudent(req, res) {
  try {
    const { student_id } = req.params;
    const { date } = req.query;

    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: 'student_id wajib diisi'
      });
    }

    // Jika date tidak diberikan, gunakan hari ini
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const result = await pool.query(
      `SELECT asc2.id, asc2.attendance_id, asc2.class_period_id,
              asc2.old_status, asc2.new_status,
              asc2.changed_by_type, asc2.changed_by_id, asc2.changed_by_name,
              asc2.note, asc2.created_at,
              cp.sequence as period_sequence, cp.start_time as period_start,
              cp.end_time as period_end,
              s.name as student_name, s.nis
       FROM attendance_status_changes asc2
       JOIN student_attendances sa ON asc2.attendance_id = sa.id
       JOIN students s ON asc2.student_id = s.id
       LEFT JOIN class_periods cp ON asc2.class_period_id = cp.id
       LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
       WHERE asc2.student_id = $1
         AND DATE(sc.date) = $2::date
       ORDER BY asc2.created_at ASC`,
      [student_id, targetDate]
    );

    return res.json({
      success: true,
      data: {
        student_id: parseInt(student_id),
        date: targetDate,
        logs: result.rows.map(log => ({
          id: log.id,
          attendance_id: log.attendance_id,
          student_name: log.student_name,
          nis: log.nis,
          period: log.class_period_id ? {
            id: log.class_period_id,
            sequence: log.period_sequence,
            jam_ke: (log.period_sequence || 0) + 1,
            start_time: log.period_start,
            end_time: log.period_end
          } : null,
          old_status: log.old_status,
          new_status: log.new_status,
          changed_by_type: log.changed_by_type,
          changed_by_id: log.changed_by_id,
          changed_by_name: log.changed_by_name,
          note: log.note,
          created_at: log.created_at
        })),
        total_changes: result.rows.length
      }
    });

  } catch (error) {
    console.error('Error fetching student status change logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil log perubahan status siswa',
      error: error.message
    });
  }
}

// ==================== GET LOGS BY CLASS ====================

/**
 * GET /logs/class/:class_id
 * Mendapatkan semua log perubahan status kehadiran per kelas (hari ini).
 * Query params: ?date=YYYY-MM-DD (optional, default: hari ini)
 */
async function getLogsByClass(req, res) {
  try {
    const { class_id } = req.params;
    const { date } = req.query;

    if (!class_id) {
      return res.status(400).json({
        success: false,
        message: 'class_id wajib diisi'
      });
    }

    const targetDate = date || new Date().toISOString().slice(0, 10);

    // Otorisasi: siswa hanya boleh lihat kelasnya
    if (req.user.student_id) {
      if (String(req.user.class_id) !== String(class_id)) {
        return res.status(403).json({
          success: false,
          message: 'Anda hanya bisa melihat log perubahan di kelas Anda.'
        });
      }
    }

    const result = await pool.query(
      `SELECT asc2.id, asc2.attendance_id, asc2.student_id, asc2.class_period_id,
              asc2.old_status, asc2.new_status,
              asc2.changed_by_type, asc2.changed_by_id, asc2.changed_by_name,
              asc2.note, asc2.created_at,
              cp.sequence as period_sequence, cp.start_time as period_start,
              cp.end_time as period_end,
              s.name as student_name, s.nis
       FROM attendance_status_changes asc2
       JOIN student_attendances sa ON asc2.attendance_id = sa.id
       JOIN students s ON asc2.student_id = s.id
       LEFT JOIN class_periods cp ON asc2.class_period_id = cp.id
       LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
       WHERE sa.class_id = $1
         AND DATE(sc.date) = $2::date
       ORDER BY asc2.created_at DESC`,
      [class_id, targetDate]
    );

    return res.json({
      success: true,
      data: {
        class_id: parseInt(class_id),
        date: targetDate,
        logs: result.rows.map(log => ({
          id: log.id,
          attendance_id: log.attendance_id,
          student_id: log.student_id,
          student_name: log.student_name,
          nis: log.nis,
          period: log.class_period_id ? {
            id: log.class_period_id,
            sequence: log.period_sequence,
            jam_ke: (log.period_sequence || 0) + 1,
            start_time: log.period_start,
            end_time: log.period_end
          } : null,
          old_status: log.old_status,
          new_status: log.new_status,
          changed_by_type: log.changed_by_type,
          changed_by_id: log.changed_by_id,
          changed_by_name: log.changed_by_name,
          note: log.note,
          created_at: log.created_at
        })),
        total_changes: result.rows.length
      }
    });

  } catch (error) {
    console.error('Error fetching class status change logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil log perubahan status kelas',
      error: error.message
    });
  }
}

module.exports = {
  changeAttendanceStatus,
  getStatusChangeLogs,
  getLogsByStudent,
  getLogsByClass
};
