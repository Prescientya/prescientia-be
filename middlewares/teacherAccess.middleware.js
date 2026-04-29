const pool = require('../config/database');

function toPositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveClassId(req) {
  return toPositiveInt(req.params.classId || req.query.class_id || req.body.class_id);
}

function resolveScheduleId(req) {
  return toPositiveInt(req.query.schedule_id || req.body.schedule_id || req.params.scheduleId);
}

function resolvePeriodId(req) {
  return toPositiveInt(req.query.period_id || req.body.period_id || req.params.periodId);
}

function resolveSubjectId(req) {
  return toPositiveInt(req.query.subject_id || req.body.subject_id || req.params.subjectId);
}

async function requireTeacherClassScheduleAccess(req, res, next) {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || Number.isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const classId = resolveClassId(req);
    if (!classId) {
      return res.status(400).json({ success: false, message: 'class_id harus berupa angka positif yang valid' });
    }

    const scheduleId = resolveScheduleId(req);
    const periodId = resolvePeriodId(req);
    const subjectId = resolveSubjectId(req);

    const params = [teacherId, classId];
    let idx = 3;

    let query = `
      SELECT ts.id AS schedule_id, ts.class_period_id AS period_id, ts.subject_id
      FROM teacher_schedules ts
      WHERE ts.teacher_id = $1
        AND ts.class_id = $2
    `;

    if (scheduleId) {
      query += ` AND ts.id = $${idx}`;
      params.push(scheduleId);
      idx++;
    }

    if (periodId) {
      query += ` AND ts.class_period_id = $${idx}`;
      params.push(periodId);
      idx++;
    }

    if (subjectId) {
      query += ` AND ts.subject_id = $${idx}`;
      params.push(subjectId);
      idx++;
    }

    query += ' LIMIT 1';

    const accessCheck = await pool.query(query, params);
    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak: Anda tidak memiliki akses mengajar pada class/period/schedule yang diminta'
      });
    }

    req.teacherAccess = {
      class_id: classId,
      schedule_id: accessCheck.rows[0].schedule_id,
      period_id: accessCheck.rows[0].period_id,
      subject_id: accessCheck.rows[0].subject_id
    };

    return next();
  } catch (error) {
    console.error('requireTeacherClassScheduleAccess error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
}

async function requireHomeroomClassAccess(req, res, next) {
  try {
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || Number.isNaN(teacherId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: teacher_id tidak ditemukan di token' });
    }

    const classId = toPositiveInt(req.params.classId || req.query.class_id || req.body.class_id);

    // Some homeroom endpoints can auto-detect class_id. Skip guard when class_id is omitted.
    if (!classId) {
      return next();
    }

    const homeroomCheck = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND homeroom_teacher_id = $2 LIMIT 1',
      [classId, teacherId]
    );

    if (homeroomCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak: Anda bukan wali kelas dari kelas ini'
      });
    }

    req.homeroomAccess = { class_id: classId };
    return next();
  } catch (error) {
    console.error('requireHomeroomClassAccess error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
}

module.exports = {
  requireTeacherClassScheduleAccess,
  requireHomeroomClassAccess
};
