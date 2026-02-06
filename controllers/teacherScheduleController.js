const pool = require('../config/database');

/**
 * GET /api/teacher/today-classes
 * 
 * Returns real-time list of all classes a teacher teaches TODAY,
 * including lesson periods and attendance status per period.
 * 
 * Authentication: Requires JWT token with teacher_id
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "...",
 *   "data": {
 *     "day": "senin",
 *     "teacher_id": 73,
 *     "schedules": [
 *       {
 *         "class_id": 5,
 *         "class_name": "X RPL 1",
 *         "subject_id": 92,
 *         "subject_name": "Matematika",
 *         "period_id": 134,
 *         "start_time": "07:15:00",
 *         "end_time": "07:55:00",
 *         "is_submitted": false
 *       }
 *     ]
 *   }
 * }
 */
const getTodayClasses = async (req, res) => {
  try {
    // Extract teacher_id from authenticated user (populated by requireTeacher middleware)
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: teacher_id tidak ditemukan di token'
      });
    }

    // Get current day in Indonesian format
    const daysIndonesian = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const todayIndex = new Date().getDay();
    const todayDay = daysIndonesian[todayIndex];

    // If today is weekend (minggu/sabtu), return empty schedule
    if (todayDay === 'minggu' || todayDay === 'sabtu') {
      return res.json({
        success: true,
        message: 'Tidak ada jadwal mengajar pada hari ini',
        data: {
          day: todayDay,
          teacher_id: teacherId,
          schedules: []
        }
      });
    }

    // Query to get today's schedule with attendance submission status
    const query = `
      SELECT 
        tcs.class_id,
        (COALESCE(c.major::text, '') || ' ' || COALESCE(c.class::text, '')) AS class_name,
        tcs.subject_id,
        s.name AS subject_name,
        tcs.period_id,
        cp.start_time,
        cp.end_time,
        cp.sequence,
        EXISTS (
          SELECT 1 
          FROM submit_teacher_periods stp
          WHERE stp.teacher_id = tcs.teacher_id
            AND stp.class_id = tcs.class_id
            AND stp.subject_id = tcs.subject_id
            AND stp.period_id = tcs.period_id
            AND stp.day = tcs.day
        ) AS is_submitted
      FROM teacher_class_schedules tcs
      INNER JOIN classes c ON c.id = tcs.class_id
      INNER JOIN subjects s ON s.id = tcs.subject_id
      INNER JOIN class_periods cp ON cp.id = tcs.period_id
      WHERE tcs.teacher_id = $1
        AND tcs.day = $2
      ORDER BY cp.sequence ASC, tcs.class_id ASC
    `;

    const result = await pool.query(query, [teacherId, todayDay]);

    // Get unique class IDs from schedules
    const classIds = [...new Set(result.rows.map(row => row.class_id))];

    // Get students with attendance status for today for each class
    let studentsData = [];
    if (classIds.length > 0) {
      const studentsQuery = `
        SELECT 
          st.id as student_id,
          st.nis,
          st.name as student_name,
          st.class_id,
          st.gender,
          st.photo_profile,
          sa.id as attendance_id,
          sa.status as attendance_status,
          sa.check_in_time,
          sa.check_out_time,
          sc.date as attendance_date
        FROM students st
        LEFT JOIN student_attendances sa ON st.id = sa.student_id 
          AND sa.class_id = st.class_id
          AND DATE(sa.check_in_time) = CURRENT_DATE
        LEFT JOIN school_calendar sc ON sa.calendar_id = sc.id
        WHERE st.class_id = ANY($1)
          AND st.deleted_at IS NULL
        ORDER BY st.class_id ASC, st.name ASC
      `;
      
      const studentsResult = await pool.query(studentsQuery, [classIds]);
      studentsData = studentsResult.rows;
    }

    // Group students by class_id
    const studentsByClass = {};
    studentsData.forEach(student => {
      if (!studentsByClass[student.class_id]) {
        studentsByClass[student.class_id] = [];
      }
      studentsByClass[student.class_id].push({
        student_id: student.student_id,
        nis: student.nis,
        name: student.student_name,
        gender: student.gender,
        photo_profile: student.photo_profile,
        attendance: student.attendance_id ? {
          attendance_id: student.attendance_id,
          status: student.attendance_status,
          check_in_time: student.check_in_time,
          check_out_time: student.check_out_time,
          date: student.attendance_date
        } : null
      });
    });

    // Format the response with students
    const schedules = result.rows.map(row => ({
      class_id: row.class_id,
      class_name: row.class_name,
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      period_id: row.period_id,
      start_time: row.start_time,
      end_time: row.end_time,
      is_submitted: row.is_submitted,
      students: studentsByClass[row.class_id] || [],
      total_students: (studentsByClass[row.class_id] || []).length,
      present_students: (studentsByClass[row.class_id] || []).filter(s => s.attendance && s.attendance.status === 'hadir').length
    }));

    res.json({
      success: true,
      message: `Jadwal mengajar hari ${todayDay} berhasil diambil`,
      data: {
        day: todayDay,
        teacher_id: teacherId,
        schedules: schedules
      }
    });

  } catch (error) {
    console.error('getTodayClasses error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/teachers/my-classes
 * 
 * Returns all classes taught by authenticated teacher grouped by class and subject.
 * Shows which days teacher teaches each class-subject combination.
 * 
 * Authentication: Requires JWT token with teacher_id
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "teacher_id": 85,
 *     "classes": [
 *       {
 *         "class_id": 16,
 *         "class_name": "X RPL 1",
 *         "subjects": [
 *           {
 *             "subject_id": 86,
 *             "subject_name": "Matematika",
 *             "days": ["senin"],
 *             "total_periods": 2
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 */
const getMyClasses = async (req, res) => {
  try {
    // Extract teacher_id from authenticated user
    const teacherId = req.user && Number(req.user.teacher_id);
    if (!teacherId || isNaN(teacherId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: teacher_id tidak ditemukan di token'
      });
    }

    // Query to get all classes taught by teacher with subject details
    const query = `
      SELECT 
        tcs.class_id,
        (COALESCE(c.major::text, '') || ' ' || COALESCE(c.class::text, '')) AS class_name,
        c.class as grade,
        c.major,
        tcs.subject_id,
        s.name AS subject_name,
        tcs.day,
        COUNT(tcs.period_id) as period_count,
        tcs.semester
      FROM teacher_class_schedules tcs
      INNER JOIN classes c ON c.id = tcs.class_id
      INNER JOIN subjects s ON s.id = tcs.subject_id
      WHERE tcs.teacher_id = $1
      GROUP BY tcs.class_id, c.major, c.class, tcs.subject_id, s.name, tcs.day, tcs.semester
      ORDER BY tcs.class_id ASC, tcs.subject_id ASC, 
        CASE tcs.day 
          WHEN 'senin' THEN 1 
          WHEN 'selasa' THEN 2 
          WHEN 'rabu' THEN 3 
          WHEN 'kamis' THEN 4 
          WHEN 'jumat' THEN 5 
        END
    `;

    const result = await pool.query(query, [teacherId]);

    // Group data by class and subject
    const classesMap = new Map();

    result.rows.forEach(row => {
      const classKey = row.class_id;
      const subjectKey = row.subject_id;

      // Initialize class if not exists
      if (!classesMap.has(classKey)) {
        classesMap.set(classKey, {
          class_id: row.class_id,
          class_name: row.class_name.trim(),
          grade: row.grade,
          major: row.major,
          subjects: new Map()
        });
      }

      const classData = classesMap.get(classKey);

      // Initialize subject if not exists
      if (!classData.subjects.has(subjectKey)) {
        classData.subjects.set(subjectKey, {
          subject_id: row.subject_id,
          subject_name: row.subject_name,
          days: [],
          total_periods: 0,
          semester: row.semester
        });
      }

      const subjectData = classData.subjects.get(subjectKey);
      subjectData.days.push(row.day);
      subjectData.total_periods += row.period_count;
    });

    // Convert maps to arrays
    const classes = Array.from(classesMap.values()).map(classData => ({
      class_id: classData.class_id,
      class_name: classData.class_name,
      grade: classData.grade,
      major: classData.major,
      subjects: Array.from(classData.subjects.values())
    }));

    res.json({
      success: true,
      message: `Ditemukan ${classes.length} kelas yang diajar`,
      data: {
        teacher_id: teacherId,
        total_classes: classes.length,
        classes: classes
      }
    });

  } catch (error) {
    console.error('getMyClasses error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getTodayClasses,
  getMyClasses
};
