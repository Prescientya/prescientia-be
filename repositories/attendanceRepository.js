const pool = require('../config/database');

const findAlphaWithoutDetailsByStudent = async (studentId) => {
  // MySQL version (commented out — uses DATE_FORMAT and DAYNAME):
  /*
  const q = `
        SELECT sa.id AS attendance_id,
          DATE_FORMAT(COALESCE(DATE(sc.date), DATE(sa.created_at)), '%Y-%m-%d') AS date,
          DAYNAME(COALESCE(DATE(sc.date), DATE(sa.created_at))) AS day_name,
          sa.status,
          sad.id AS detail_id,
          sad.status AS detail_status,
          sad.approval_status
    FROM student_attendances sa
    LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
    LEFT JOIN student_attendance_details sad ON sad.attendance_id = sa.id
    WHERE sa.student_id = ?
      AND sa.status = 'alpa'
    ORDER BY date DESC
  `;
  */
  const q = `
        SELECT sa.id AS attendance_id,
          DATE_FORMAT(COALESCE(DATE(sc.date), DATE(sa.created_at)), '%Y-%m-%d') AS date,
          DAYNAME(COALESCE(DATE(sc.date), DATE(sa.created_at))) AS day_name,
          sa.status,
          sad.id AS detail_id,
          sad.status AS detail_status,
          sad.approval_status
    FROM student_attendances sa
    LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
    LEFT JOIN student_attendance_details sad ON sad.attendance_id = sa.id
    WHERE sa.student_id = $1
      AND sa.status = 'alpa'
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
  // MySQL version (commented out — UPDATE then SELECT):
  // await client.query(`UPDATE student_attendances SET status = ?, updated_at = NOW() WHERE id = ?`, [status, attendanceId]);
  // const r = await client.query(`SELECT * FROM student_attendances WHERE id = ? LIMIT 1`, [attendanceId]);
  // return r.rows[0];

  // PostgreSQL version: RETURNING *
  const q = `UPDATE student_attendances SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`;
  const r = await client.query(q, [status, attendanceId]);
  return r.rows[0];
};

module.exports = {
  findAlphaWithoutDetailsByStudent,
  findAttendanceById,
  updateAttendanceStatus
};
