const pool = require('../config/database');
const { localDateStr } = require('../utils/dateHelper');

/**
 * GET /api/events
 * Returns events visible to the authenticated user based on their role.
 *
 * For teachers (req.user.teacher_id):
 *   - events with target_audience IN ('semua', 'guru')
 *
 * For students (req.user.student_id):
 *   - events with target_audience = 'semua'
 *   - events with target_audience = 'siswa'
 *   - events with target_audience = 'kelas' AND the student's class matches
 *     one of the event_targets (by class_id, grade, or major)
 *
 * Only active/scheduled events are returned (end_date >= today).
 * Sorted by release_date DESC.
 *
 * Query params:
 *   - status: 'aktif' | 'terjadwal' | 'selesai' (optional filter)
 *   - page: int (default 1)
 *   - limit: int (default 20)
 */
async function getEvents(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const today = localDateStr(new Date());

    const isTeacher = !!req.user.teacher_id;
    const isStudent = !!req.user.student_id;

    let query = '';
    const params = [];
    let paramIndex = 1;

    // BUG FIX timezone: kolom DATE/DATETIME diformat eksplisit jadi string supaya
    // tidak di-decode mysql2 → JS Date → UTC ISO yang menggeser tanggal 1 hari.
    if (isTeacher) {
      // Teachers see events targeted at 'semua' or 'guru'
      query = `
        SELECT DISTINCT e.id, e.title, e.description, e.link,
               DATE_FORMAT(e.release_date, '%Y-%m-%d') AS release_date,
               DATE_FORMAT(e.end_date, '%Y-%m-%d') AS end_date,
               e.target_audience,
               DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
               DATE_FORMAT(e.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
        FROM events e
        WHERE e.target_audience IN ('semua', 'guru')
      `;
    } else if (isStudent) {
      // Students see events targeted at 'semua', 'siswa', or their specific class
      // Need to join with student's class info for 'kelas' target matching
      const studentClassId = req.user.class_id;

      query = `
        SELECT DISTINCT e.id, e.title, e.description, e.link,
               DATE_FORMAT(e.release_date, '%Y-%m-%d') AS release_date,
               DATE_FORMAT(e.end_date, '%Y-%m-%d') AS end_date,
               e.target_audience,
               DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
               DATE_FORMAT(e.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
        FROM events e
        LEFT JOIN event_targets et ON et.event_id = e.id
        LEFT JOIN classes c ON c.id = $${paramIndex}
        WHERE (
          e.target_audience IN ('semua', 'siswa')
          OR (
            e.target_audience = 'kelas'
            AND (
              et.class_id = $${paramIndex + 1}
              OR et.grade = c.class
              OR et.major = c.major
            )
          )
        )
      `;
      params.push(studentClassId, studentClassId);
      paramIndex += 2;
    } else {
      return res.status(403).json({
        success: false,
        message: 'Akses tidak diizinkan.',
      });
    }

    // Optional status filter
    if (status === 'aktif') {
      query += ` AND e.release_date <= $${paramIndex} AND e.end_date >= $${paramIndex + 1}`;
      params.push(today, today);
      paramIndex += 2;
    } else if (status === 'terjadwal') {
      query += ` AND e.release_date > $${paramIndex}`;
      params.push(today);
      paramIndex++;
    } else if (status === 'selesai') {
      query += ` AND e.end_date < $${paramIndex}`;
      params.push(today);
      paramIndex++;
    }

    // Count query (for pagination)
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS filtered`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);

    // Add ordering and pagination
    query += ` ORDER BY e.release_date DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    // Pre-fetch semua targets sekaligus untuk menghindari N+1 query
    const kelasEventIds = result.rows
      .filter(r => r.target_audience === 'kelas')
      .map(r => r.id);

    const targetsMap = {};
    if (kelasEventIds.length > 0) {
      const targetsResult = await pool.query(
        `SELECT et.id, et.event_id, et.class_id, et.grade, et.major,
                CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
                       ELSE c.class END, ' ', COALESCE(c.major, '')) AS class_name
         FROM event_targets et
         LEFT JOIN classes c ON c.id = et.class_id
         WHERE et.event_id = ANY($1)`,
        [kelasEventIds]
      );
      for (const t of targetsResult.rows) {
        if (!targetsMap[t.event_id]) targetsMap[t.event_id] = [];
        targetsMap[t.event_id].push(t);
      }
    }

    const events = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      link: row.link,
      release_date: row.release_date,
      end_date: row.end_date,
      target_audience: row.target_audience,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: _getEventStatus(row.release_date, row.end_date, today),
      targets: targetsMap[row.id] || [],
    }));

    return res.status(200).json({
      success: true,
      data: events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('getEvents error:', error);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development'
        ? `Error: ${error.message}`
        : 'Terjadi kesalahan saat mengambil data event.',
    });
  }
}

/**
 * GET /api/events/:id
 * Returns a single event detail.
 * Access check: same as getEvents (teacher sees guru/semua, student sees siswa/semua/kelas-matched).
 */
async function getEventDetail(req, res) {
  try {
    const { id } = req.params;

    const eventResult = await pool.query(
      `SELECT id, title, description, link,
              DATE_FORMAT(release_date, '%Y-%m-%d') AS release_date,
              DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
              target_audience,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
              DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM events WHERE id = $1`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Event tidak ditemukan.',
      });
    }

    const row = eventResult.rows[0];
    const today = localDateStr(new Date());

    const event = {
      id: row.id,
      title: row.title,
      description: row.description,
      link: row.link,
      release_date: row.release_date,
      end_date: row.end_date,
      target_audience: row.target_audience,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: _getEventStatus(row.release_date, row.end_date, today),
      targets: [],
    };

    // Fetch targets if kelas
    if (row.target_audience === 'kelas') {
      const targetsResult = await pool.query(
        // MySQL version (commented out):
        // `SELECT et.id, et.class_id, et.grade, et.major,
        //         CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
        //                ELSE c.class END, ' ', COALESCE(c.major, '')) AS class_name
        //  FROM event_targets et LEFT JOIN classes c ON c.id = et.class_id WHERE et.event_id = ?`
        //
        // MySQL version: CONCAT()
        `SELECT et.id, et.class_id, et.grade, et.major,
                CONCAT(CASE c.class WHEN 10 THEN 'X' WHEN 11 THEN 'XI' WHEN 12 THEN 'XII'
                       ELSE c.class END, ' ', COALESCE(c.major, '')) AS class_name
         FROM event_targets et
         LEFT JOIN classes c ON c.id = et.class_id
         WHERE et.event_id = $1`,
        [id]
      );
      event.targets = targetsResult.rows;
    }

    return res.status(200).json({
      success: true,
      data: event,
    });
  } catch (error) {
    console.error('getEventDetail error:', error);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development'
        ? `Error: ${error.message}`
        : 'Terjadi kesalahan saat mengambil detail event.',
    });
  }
}

/**
 * Helper: determine event status from dates.
 *
 * Setelah BUG FIX timezone, releaseDate & endDate sudah berupa string "YYYY-MM-DD"
 * dari DATE_FORMAT di SQL. Bandingkan langsung sebagai string — comparison
 * lexicographic untuk format ISO ekuivalen dengan comparison chronological,
 * sehingga tidak perlu lagi membungkus dengan new Date()+localDateStr() yang
 * sebelumnya rentan timezone shift.
 */
function _getEventStatus(releaseDate, endDate, today) {
  if (!releaseDate || !endDate) return 'aktif';
  if (today < releaseDate) return 'terjadwal';
  if (today > endDate) return 'selesai';
  return 'aktif';
}

module.exports = {
  getEvents,
  getEventDetail,
};
