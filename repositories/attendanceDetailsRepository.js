const pool = require('../config/database');

// Flexible helper: can be called either as
//   existsByAttendanceId(attendanceId)
// or
//   existsByAttendanceId(client, attendanceId)
// When called with a `client`, the client's connection is used (important inside transactions).
const existsByAttendanceId = async (clientOrAttendanceId, maybeAttendanceId) => {
  let client = null;
  let attendanceId;

  if (maybeAttendanceId === undefined) {
    // Called as existsByAttendanceId(attendanceId)
    attendanceId = clientOrAttendanceId;
  } else {
    client = clientOrAttendanceId;
    attendanceId = maybeAttendanceId;
  }

  const q = `SELECT 1 FROM student_attendance_details WHERE attendance_id = $1 LIMIT 1`;
  const r = client ? await client.query(q, [attendanceId]) : await pool.query(q, [attendanceId]);
  return r.rows.length > 0;
};

const insertDetails = async (client, { attendance_id, status, description = null, evidence_url = null }) => {
  // The table `student_attendance_details` now stores `status` (sakit/izin)
  const q = `
    INSERT INTO student_attendance_details (attendance_id, status, description, evidence_url, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *
  `;
  const r = await client.query(q, [attendance_id, status, description, evidence_url]);
  return r.rows[0];
};

module.exports = {
  existsByAttendanceId,
  insertDetails
};
