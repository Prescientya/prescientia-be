const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Get total siswa untuk stok piring MBG
router.get('/stok-total', async (req, res) => {
  try {
    const query = `
      SELECT COUNT(*) as total_siswa
      FROM students
    `;
    
    const result = await pool.query(query);
    const totalSiswa = result.rows[0].total_siswa;

    res.json({
      success: true,
      message: 'Total siswa untuk stok piring berhasil dihitung',
      data: {
        total_siswa: totalSiswa,
        stok: totalSiswa,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error calculating total siswa:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghitung total siswa'
    });
  }
});

// Get semua data piring MBG
router.get('/list', async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        stok,
        tanggal_distribusi,
        created_at,
        updated_at
      FROM piring_mbg
      ORDER BY tanggal_distribusi DESC
    `;
    
    const result = await pool.query(query);

    res.json({
      success: true,
      message: 'Data piring MBG berhasil diambil',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching piring data:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data piring'
    });
  }
});

// Create piring MBG baru dengan stok = total siswa
router.post('/create', async (req, res) => {
  const { tanggal_distribusi } = req.body;

  try {
    // Validasi input
    if (!tanggal_distribusi) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal distribusi harus diisi'
      });
    }

    // Cek apakah sudah ada data dengan tanggal_distribusi yang sama
    const checkQuery = `
      SELECT id FROM piring_mbg 
      WHERE DATE(tanggal_distribusi) = DATE($1)
    `;
    const checkResult = await pool.query(checkQuery, [tanggal_distribusi]);

    if (checkResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Data piring MBG dengan tanggal distribusi yang sama sudah ada.'
      });
    }

    // Hitung total siswa
    const totalQuery = `SELECT COUNT(*) as total_siswa FROM students`;
    const totalResult = await pool.query(totalQuery);
    const stok = totalResult.rows[0].total_siswa;

    // Insert ke piring_mbg
    const insertQuery = `
      INSERT INTO piring_mbg (stok, tanggal_distribusi, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING id, stok, tanggal_distribusi, created_at, updated_at
    `;
    
    const result = await pool.query(insertQuery, [stok, tanggal_distribusi]);
    const piringData = result.rows[0];

    res.json({
      success: true,
      message: 'Data piring MBG berhasil dibuat',
      data: {
        id: piringData.id,
        stok: piringData.stok,
        tanggal_distribusi: piringData.tanggal_distribusi,
        total_siswa_reference: stok,
        created_at: piringData.created_at,
        updated_at: piringData.updated_at
      }
    });
  } catch (error) {
    console.error('Error creating piring data:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat data piring'
    });
  }
});

// Update stok piring MBG berdasarkan total siswa terbaru
router.put('/update-stok/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Hitung total siswa terbaru
    const totalQuery = `SELECT COUNT(*) as total_siswa FROM students`;
    const totalResult = await pool.query(totalQuery);
    const stokBaru = totalResult.rows[0].total_siswa;

    // Update piring_mbg
    const updateQuery = `
      UPDATE piring_mbg
      SET stok = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, stok, tanggal_distribusi, created_at, updated_at
    `;
    
    const result = await pool.query(updateQuery, [stokBaru, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data piring MBG tidak ditemukan'
      });
    }

    const piringData = result.rows[0];

    res.json({
      success: true,
      message: 'Stok piring MBG berhasil diperbarui sesuai total siswa terbaru',
      data: {
        id: piringData.id,
        stok_baru: piringData.stok,
        tanggal_distribusi: piringData.tanggal_distribusi,
        updated_at: piringData.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating piring stok:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui stok piring'
    });
  }
});

// (Route /class-summary/:piring_mbg_id telah dihapus — gunakan /class-summary/date/:date)

// Create mbg_class_daily record
router.post('/daily/create', async (req, res) => {
  const {
    piring_mbg_id,
    class_id,
    attended_students,
    returned_plates,
    student_representative
  } = req.body;

  try {
    // Validasi input
    if (!piring_mbg_id || !class_id) {
      return res.status(400).json({
        success: false,
        message: 'piring_mbg_id dan class_id harus diisi'
      });
    }

    // Validasi piring_mbg_id exists
    const piringCheck = `SELECT id FROM piring_mbg WHERE id = $1`;
    const piringResult = await pool.query(piringCheck, [piring_mbg_id]);

    if (piringResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data piring MBG tidak ditemukan'
      });
    }

    // Validasi class_id exists dan hitung total_students
      const classCheck = `
        SELECT 
        c.id, 
        c.major,
        c.class,
        COUNT(s.id) as total_students
        FROM classes c
        LEFT JOIN students s ON c.id = s.class_id
        WHERE c.id = $1
        GROUP BY c.id, c.major, c.class
      `;
    const classResult = await pool.query(classCheck, [class_id]);

    if (classResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kelas tidak ditemukan'
      });
    }

    const classData = classResult.rows[0];
    const totalStudents = parseInt(classData.total_students);

    // Jika student_representative diberikan, pastikan nama siswa ada di kelas yang sama
    if (student_representative) {
      try {
        const studentCheckQuery = `
          SELECT id, name FROM students
          WHERE name = $1 AND class_id = $2 AND (deleted_at IS NULL)
          LIMIT 1
        `;
        const studentCheck = await pool.query(studentCheckQuery, [student_representative, class_id]);
        if (studentCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Nama siswa tidak ditemukan'
          });
        }
      } catch (err) {
        console.error('Error checking student representative:', err);
        // fallback: lanjutkan, tapi jangan mask error as "Nama siswa tidak ditemukan"
      }
    }

    // Cek apakah sudah ada record untuk piring dan kelas yang sama
    const duplicateCheck = `
      SELECT id FROM mbg_class_daily 
      WHERE piring_mbg_id = $1 AND class_id = $2
    `;
    const duplicateResult = await pool.query(duplicateCheck, [piring_mbg_id, class_id]);

    if (duplicateResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Data MBG untuk kelas ini pada hari tersebut sudah ada'
      });
    }

    // Insert ke mbg_class_daily
    const insertQuery = `
      INSERT INTO mbg_class_daily 
      (piring_mbg_id, class_id, total_students, attended_students, returned_plates, student_representative, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id, piring_mbg_id, class_id, total_students, attended_students, returned_plates, student_representative, created_at, updated_at
    `;

    const result = await pool.query(insertQuery, [
      piring_mbg_id,
      class_id,
      totalStudents,
      attended_students || 0,
      returned_plates || 0,
      student_representative || null
    ]);

    const dailyData = result.rows[0];

    // Kurangi stok piring_mbg sesuai attended_students (tidak boleh negatif)
    const attended = parseInt(dailyData.attended_students) || 0;
    try {
      const updateStockQuery = `
        UPDATE piring_mbg
        SET stok = GREATEST(stok - $1, 0), updated_at = NOW()
        WHERE id = $2
        RETURNING stok
      `;
      const stockResult = await pool.query(updateStockQuery, [attended, piring_mbg_id]);
      var stokAfter = stockResult.rows[0] ? stockResult.rows[0].stok : null;
    } catch (err) {
      console.error('Error updating piring_mbg stok after creating daily record:', err);
      var stokAfter = null;
    }

    res.json({
      success: true,
      message: 'Data MBG harian berhasil dibuat',
      data: {
        id: dailyData.id,
        piring_mbg_id: dailyData.piring_mbg_id,
        class_id: dailyData.class_id,
        jurusan: classData.major || null,
        kelas: classData.class || null,
        total_students: dailyData.total_students,
        attended_students: dailyData.attended_students,
        returned_plates: dailyData.returned_plates,
        student_representative: dailyData.student_representative,
        stok_after: stokAfter,
        created_at: dailyData.created_at,
        updated_at: dailyData.updated_at
      }
    });
  } catch (error) {
    console.error('Error creating mbg daily data:', error);
    // Jika error terkait missing column/table (pesan DB teknis), kembalikan pesan yang lebih informatif
    if (error && error.message && /does not exist|column .* does not exist/i.test(error.message)) {
      return res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan pada struktur database. Silakan hubungi administrator.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat data MBG harian'
    });
  }
});

// GET /api/piring/class-summary/date/:date
// Menampilkan summary kelas untuk distribusi piring berdasarkan tanggal (YYYY-MM-DD)
router.get('/class-summary/date/:date', async (req, res) => {
  const { date } = req.params;

  try {
    if (!date) {
      return res.status(400).json({ success: false, message: 'Tanggal harus diisi (YYYY-MM-DD)' });
    }

    // Cari piring_mbg berdasarkan tanggal distribusi
    const piringByDateQ = `SELECT id, stok, tanggal_distribusi FROM piring_mbg WHERE DATE(tanggal_distribusi) = DATE($1) LIMIT 1`;
    const piringByDateR = await pool.query(piringByDateQ, [date]);

    if (piringByDateR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tidak ditemukan distribusi piring pada tanggal tersebut' });
    }

    const piringData = piringByDateR.rows[0];

    // Ambil summary kelas seperti di class-summary (tetap berdasarkan piring_mbg.id)
    const classQuery = `
      SELECT 
        c.id as class_id,
        (COALESCE(c.major::text, '') || ' ' || COALESCE(c.class::text, '')) as class_name,
        c.class as grade,
        COUNT(s.id)::int as total_students,
        COALESCE(SUM(mcd.attended_students), 0)::int as total_mbg_received,
        GREATEST((COUNT(s.id) - COALESCE(SUM(mcd.attended_students), 0)), 0)::int as remaining_mbg
      FROM classes c
      LEFT JOIN students s ON c.id = s.class_id
      LEFT JOIN mbg_class_daily mcd ON c.id = mcd.class_id AND mcd.piring_mbg_id = $1
      GROUP BY c.id, c.major, c.class
      ORDER BY class_name
    `;

    const result = await pool.query(classQuery, [piringData.id]);

    res.json({
      success: true,
      message: 'List kelas dengan summary MBG untuk tanggal berhasil diambil',
      data: {
        piring_mbg: {
          id: piringData.id,
          stok_total: piringData.stok,
          tanggal_distribusi: piringData.tanggal_distribusi
        },
        classes: result.rows
      }
    });
  } catch (error) {
    console.error('Error fetching class summary by date:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil summary kelas berdasarkan tanggal' });
  }
});

// Alias: GET /api/piring/class-summary/:date
// Supaya request tanpa segmen `date` juga diterima (sesuai screenshot)
router.get('/class-summary/:date', async (req, res) => {
  const { date } = req.params;

  try {
    if (!date) {
      return res.status(400).json({ success: false, message: 'Tanggal harus diisi (YYYY-MM-DD)' });
    }

    // Cari piring_mbg berdasarkan tanggal distribusi
    const piringByDateQ = `SELECT id, stok, tanggal_distribusi FROM piring_mbg WHERE DATE(tanggal_distribusi) = DATE($1) LIMIT 1`;
    const piringByDateR = await pool.query(piringByDateQ, [date]);

    if (piringByDateR.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tidak ditemukan distribusi piring pada tanggal tersebut' });
    }

    const piringData = piringByDateR.rows[0];

    // Ambil summary kelas seperti di class-summary (tetap berdasarkan piring_mbg.id)
    const classQuery = `
      SELECT 
        c.id as class_id,
        (COALESCE(c.major::text, '') || ' ' || COALESCE(c.class::text, '')) as class_name,
        c.class as grade,
        COUNT(s.id)::int as total_students,
        COALESCE(SUM(mcd.attended_students), 0)::int as total_mbg_received,
        GREATEST((COUNT(s.id) - COALESCE(SUM(mcd.attended_students), 0)), 0)::int as remaining_mbg
      FROM classes c
      LEFT JOIN students s ON c.id = s.class_id
      LEFT JOIN mbg_class_daily mcd ON c.id = mcd.class_id AND mcd.piring_mbg_id = $1
      GROUP BY c.id, c.major, c.class
      ORDER BY class_name
    `;

    const result = await pool.query(classQuery, [piringData.id]);

    res.json({
      success: true,
      message: 'List kelas dengan summary MBG untuk tanggal berhasil diambil',
      data: {
        piring_mbg: {
          id: piringData.id,
          stok_total: piringData.stok,
          tanggal_distribusi: piringData.tanggal_distribusi
        },
        classes: result.rows
      }
    });
  } catch (error) {
    console.error('Error fetching class summary by date (alias):', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil summary kelas berdasarkan tanggal' });
  }
});

module.exports = router;
