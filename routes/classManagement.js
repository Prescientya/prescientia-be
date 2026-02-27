const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireStudent } = require('../middlewares/auth.middleware');

// ==================== CLASS MANAGEMENT ATTENDANCE ====================
// Endpoints untuk petugas absensi kelas (KM, Wakil KM, Sekertaris)

// GET - List Siswa dengan Status Kehadiran
// GET /api/class-management/attendance/today?class_id=16&date=2026-01-19
router.get('/attendance/today', requireStudent, async (req, res) => {
  try {
    // Ambil class_id dari query atau dari JWT token siswa yang login
    let { class_id, date } = req.query;
    
    // Jika class_id tidak ada di query, ambil dari token siswa yang login
    if (!class_id && req.user && req.user.class_id) {
      class_id = req.user.class_id;
    }
    
    // Jika date tidak ada di query, gunakan tanggal hari ini
    if (!date) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      date = `${year}-${month}-${day}`;
    }
    
    // Validasi input
    if (!class_id) {
      return res.status(400).json({
        success: false,
        message: 'class_id harus diisi atau siswa harus login dengan kelas yang valid'
      });
    }
    
    // Validasi class exists
    const classCheck = await pool.query(
      'SELECT id, class, major FROM classes WHERE id = $1',
      [class_id]
    );
    
    if (classCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kelas tidak ditemukan'
      });
    }
    
    const classData = classCheck.rows[0];
    
    // Get calendar_id untuk tanggal tersebut
    const calendarQuery = await pool.query(
      'SELECT id FROM school_calendar WHERE DATE(date) = DATE($1)',
      [date]
    );
    
    const calendar_id = calendarQuery.rows.length > 0 ? calendarQuery.rows[0].id : null;
    
    // Query untuk mendapatkan semua siswa di kelas dengan status kehadiran (jika ada)
    // Menggunakan DISTINCT ON untuk memastikan 1 row per student
    // Filter attendance hanya untuk tanggal yang diminta
    const query = `
      SELECT DISTINCT ON (s.id)
        s.id as student_id,
        s.nis,
        s.name,
        s.gender,
        sa.id as attendance_id,
        sa.status,
        sa.check_in_time,
        sa.check_out_time,
        sa.source,
        sa.created_at,
        sa.updated_at
      FROM students s
      LEFT JOIN LATERAL (
        SELECT id, status, check_in_time, check_out_time, source, created_at, updated_at
        FROM student_attendances
        WHERE student_id = s.id 
          AND class_id = $1
          AND DATE(created_at AT TIME ZONE 'UTC') = DATE($2::date)
        ORDER BY created_at DESC
        LIMIT 1
      ) sa ON true
      WHERE s.class_id = $1
      ORDER BY s.id, s.name
    `;
    
    const result = await pool.query(query, [class_id, date]);
    
    // Kategorikan siswa berdasarkan status
    const present = [];
    const absent = [];
    const sick = [];
    const permission = [];
    const noInfo = [];
    
    result.rows.forEach(row => {
      const studentData = {
        student_id: row.student_id,
        nis: row.nis,
        name: row.name,
        gender: row.gender,
        attendance_id: row.attendance_id,
        status: row.status,
        check_in_time: row.check_in_time,
        check_out_time: row.check_out_time,
        source: row.source,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
      
      if (!row.status) {
        noInfo.push(studentData);
      } else if (row.status === 'hadir' || row.status === 'terlambat') {
        present.push(studentData);
      } else if (row.status === 'alpa') {
        absent.push(studentData);
      } else if (row.status === 'sakit') {
        sick.push(studentData);
      } else if (row.status === 'izin') {
        permission.push(studentData);
      }
    });
    
    res.json({
      success: true,
      message: 'Data kehadiran siswa berhasil diambil',
      data: {
        class: {
          id: classData.id,
          class: classData.class,
          major: classData.major,
          name: `${classData.class} ${classData.major || ''}`.trim()
        },
        date: date,
        calendar_id: calendar_id,
        summary: {
          total_students: result.rows.length,
          present: present.length,
          absent: absent.length,
          sick: sick.length,
          permission: permission.length,
          no_info: noInfo.length
        },
        students: {
          present: present,
          absent: absent,
          sick: sick,
          permission: permission,
          no_info: noInfo,
          all: result.rows.map(row => ({
            student_id: row.student_id,
            nis: row.nis,
            name: row.name,
            gender: row.gender,
            attendance_id: row.attendance_id,
            status: row.status || null,
            check_in_time: row.check_in_time,
            check_out_time: row.check_out_time,
            source: row.source,
            created_at: row.created_at,
            updated_at: row.updated_at
          }))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching class attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data kehadiran',
      error: error.message
    });
  }
});

// POST - Batch Submit Status Kehadiran (Create)
// POST /api/class-management/attendance/batch-submit
router.post('/attendance/batch-submit', requireStudent, async (req, res) => {
  const client = await pool.connect();
  
  try {
    let { class_id, date, updated_by, attendances } = req.body;
    
    // Ambil class_id dari token siswa jika tidak ada di body
    if (!class_id && req.user && req.user.class_id) {
      class_id = req.user.class_id;
    }
    
    // Gunakan tanggal hari ini jika tidak ada di body
    if (!date) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      date = `${year}-${month}-${day}`;
    }
    
    // Ambil updated_by dari student_id di token jika tidak ada di body
    if (!updated_by && req.user && req.user.student_id) {
      updated_by = req.user.student_id;
    }
    
    // Validasi input
    if (!class_id || !attendances || !Array.isArray(attendances)) {
      return res.status(400).json({
        success: false,
        message: 'class_id dan attendances array harus diisi'
      });
    }
    
    if (attendances.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'attendances array tidak boleh kosong'
      });
    }
    
    // Get calendar_id untuk tanggal tersebut
    const calendarQuery = await client.query(
      'SELECT id FROM school_calendar WHERE DATE(date) = DATE($1)',
      [date]
    );
    
    const calendar_id = calendarQuery.rows.length > 0 ? calendarQuery.rows[0].id : null;
    
    await client.query('BEGIN');
    
    let successCount = 0;
    let failedCount = 0;
    const details = [];
    
    for (const attendance of attendances) {
      try {
        const { student_id, status, notes } = attendance;
        
        // Validasi status
        if (!['sakit', 'izin', 'alpa'].includes(status)) {
          details.push({
            student_id: student_id,
            success: false,
            error: `Status tidak valid: ${status} (harus sakit, izin, atau alpa)`
          });
          failedCount++;
          continue;
        }
        
        // Cek apakah student ada di kelas tersebut
        const studentCheck = await client.query(
          'SELECT id FROM students WHERE id = $1 AND class_id = $2',
          [student_id, class_id]
        );
        
        if (studentCheck.rows.length === 0) {
          details.push({
            student_id: student_id,
            success: false,
            error: 'Siswa tidak ditemukan di kelas ini'
          });
          failedCount++;
          continue;
        }
        
        // Cek apakah sudah ada attendance untuk student ini di tanggal ini
        const existingCheck = await client.query(
          `SELECT id FROM student_attendances 
           WHERE student_id = $1 
             AND class_id = $2 
             AND DATE(created_at AT TIME ZONE 'UTC') = DATE($3::date)`,
          [student_id, class_id, date]
        );
        
        if (existingCheck.rows.length > 0) {
          details.push({
            student_id: student_id,
            attendance_id: existingCheck.rows[0].id,
            success: false,
            error: 'Attendance untuk siswa ini sudah ada di tanggal ini. Gunakan batch-update untuk mengubah.'
          });
          failedCount++;
          continue;
        }
        
        // Insert attendance record
        const insertQuery = `
          INSERT INTO student_attendances 
          (student_id, class_id, calendar_id, status, source, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          RETURNING id
        `;
        
        const insertResult = await client.query(insertQuery, [
          student_id,
          class_id,
          calendar_id,
          status,
          'manual' // source dari petugas absensi kelas
        ]);
        
        const attendance_id = insertResult.rows[0].id;
        
        // Jika ada notes, insert ke student_attendance_details
        if (notes) {
          await client.query(
            'INSERT INTO student_attendance_details (attendance_id, status, description, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
            [attendance_id, status, notes]
          );
        }
        
        details.push({
          student_id: student_id,
          attendance_id: attendance_id,
          status: status,
          success: true
        });
        
        successCount++;
      } catch (error) {
        console.error(`Error processing student ${attendance.student_id}:`, error);
        details.push({
          student_id: attendance.student_id,
          success: false,
          error: error.message
        });
        failedCount++;
      }
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: failedCount === 0,
      message: `${successCount} siswa berhasil ditambahkan${failedCount > 0 ? `, ${failedCount} gagal` : ''}`,
      data: {
        total_processed: attendances.length,
        success_count: successCount,
        failed_count: failedCount,
        details: details
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error batch submit attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat submit attendance',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// PATCH - Batch Update Status Kehadiran (Update)
// PATCH /api/class-management/attendance/batch-update
router.patch('/attendance/batch-update', requireStudent, async (req, res) => {
  const client = await pool.connect();
  
  try {
    let { class_id, date, updated_by, attendances } = req.body;
    
    // Ambil class_id dari token siswa jika tidak ada di body
    if (!class_id && req.user && req.user.class_id) {
      class_id = req.user.class_id;
    }
    
    // Gunakan tanggal hari ini jika tidak ada di body
    if (!date) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      date = `${year}-${month}-${day}`;
    }
    
    // Ambil updated_by dari student_id di token jika tidak ada di body
    if (!updated_by && req.user && req.user.student_id) {
      updated_by = req.user.student_id;
    }
    
    // Validasi input
    if (!class_id || !attendances || !Array.isArray(attendances)) {
      return res.status(400).json({
        success: false,
        message: 'class_id dan attendances array harus diisi'
      });
    }
    
    if (attendances.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'attendances array tidak boleh kosong'
      });
    }
    
    await client.query('BEGIN');
    
    let successCount = 0;
    let failedCount = 0;
    const details = [];
    
    for (const attendance of attendances) {
      try {
        const { attendance_id, student_id, status, notes } = attendance;
        
        // Validasi status
        if (!['sakit', 'izin', 'alpa', 'hadir'].includes(status)) {
          details.push({
            attendance_id: attendance_id,
            student_id: student_id,
            success: false,
            error: `Status tidak valid: ${status}`
          });
          failedCount++;
          continue;
        }
        
        // Get existing attendance record
        const existingQuery = await client.query(
          'SELECT id, student_id, status FROM student_attendances WHERE id = $1 AND student_id = $2 AND class_id = $3',
          [attendance_id, student_id, class_id]
        );
        
        if (existingQuery.rows.length === 0) {
          details.push({
            attendance_id: attendance_id,
            student_id: student_id,
            success: false,
            error: 'Attendance record tidak ditemukan'
          });
          failedCount++;
          continue;
        }
        
        const oldStatus = existingQuery.rows[0].status;
        
        // Update attendance record
        const updateQuery = `
          UPDATE student_attendances 
          SET status = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING updated_at
        `;
        
        const updateResult = await client.query(updateQuery, [status, attendance_id]);
        
        // Update atau insert attendance details jika ada notes
        if (notes) {
          const detailCheck = await client.query(
            'SELECT id FROM student_attendance_details WHERE attendance_id = $1',
            [attendance_id]
          );
          
          if (detailCheck.rows.length > 0) {
            // Update existing detail
            await client.query(
              'UPDATE student_attendance_details SET status = $1, description = $2, updated_at = NOW() WHERE attendance_id = $3',
              [status, notes, attendance_id]
            );
          } else {
            // Insert new detail
            await client.query(
              'INSERT INTO student_attendance_details (attendance_id, status, description, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
              [attendance_id, status, notes]
            );
          }
        }
        
        details.push({
          attendance_id: attendance_id,
          student_id: student_id,
          old_status: oldStatus,
          new_status: status,
          success: true,
          updated_at: updateResult.rows[0].updated_at
        });
        
        successCount++;
      } catch (error) {
        console.error(`Error updating attendance ${attendance.attendance_id}:`, error);
        details.push({
          attendance_id: attendance.attendance_id,
          student_id: attendance.student_id,
          success: false,
          error: error.message
        });
        failedCount++;
      }
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: failedCount === 0,
      message: `${successCount} siswa berhasil diupdate${failedCount > 0 ? `, ${failedCount} gagal` : ''}`,
      data: {
        total_processed: attendances.length,
        success_count: successCount,
        failed_count: failedCount,
        details: details
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error batch update attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat update attendance',
      error: error.message
    });
  } finally {
    client.release();
  }
});

module.exports = router;
