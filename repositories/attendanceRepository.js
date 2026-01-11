const pool = require('../config/database');

const findAlphaWithoutDetailsByStudent = async (studentId) => {
  const q = `
    SELECT sa.id AS attendance_id,
           to_char(COALESCE(sc.date::date, sa.created_at::date), 'YYYY-MM-DD') AS date,
           to_char(COALESCE(sc.date::date, sa.created_at::date), 'FMDay') AS day_name,
           sa.status
    FROM student_attendances sa
    LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
    WHERE sa.student_id = $1
      AND sa.status = 'alpa'
      AND sa.id NOT IN (SELECT attendance_id FROM student_attendance_details)
    ORDER BY date DESC
  `;
  const res = await pool.query(q, [studentId]);
  return res.rows;
};

const findAttendanceById = async (attendanceId) => {
  const q = `SELECT id, student_id, status FROM student_attendances WHERE id = $1 LIMIT 1`;
  const r = await pool.query(q, [attendanceId]);
  return r.rows[0] || null;
};

const updateAttendanceStatus = async (client, attendanceId, status) => {
  const q = `UPDATE student_attendances SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`;
  const r = await client.query(q, [status, attendanceId]);
  return r.rows[0];
};

module.exports = {
  findAlphaWithoutDetailsByStudent,
  findAttendanceById,
  updateAttendanceStatus
};
