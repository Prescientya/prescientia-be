const pool = require('../config/database');

const markNotificationsRead = async (client, attendanceId, studentId) => {
  // Some deployments may not have a `notifications` table. Make this operation
  // safe: attempt the UPDATE, but if the relation doesn't exist, log and continue.
  const q = `UPDATE notifications SET is_read = TRUE, updated_at = NOW() WHERE attendance_id = $1 AND student_id = $2`;
  try {
    await client.query(q, [attendanceId, studentId]);
  } catch (err) {
    // PostgreSQL error code for undefined table: '42P01'
    // MySQL  error code for undefined table: 'ER_NO_SUCH_TABLE'
    if (err && (err.code === '42P01' || err.code === 'ER_NO_SUCH_TABLE')) {
      console.warn('notifications table not found; skipping markNotificationsRead');
      return;
    }
    // Re-throw other unexpected errors so callers can handle them
    throw err;
  }
};

module.exports = {
  markNotificationsRead
};
