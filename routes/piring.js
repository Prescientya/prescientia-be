const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middlewares/auth.middleware');

// Get total siswa untuk stok piring MBG
router.get('/stok-total', requireAuth, async (req, res) => {
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
router.get('/list', requireAuth, async (req, res) => {
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

// Create piring MBG baru with optional manual stok and tanggal_distribusi
router.post('/create', requireAdmin, async (req, res) => {
  // Accept optional fields; if body empty or fields absent, we'll default.
  let { tanggal_distribusi, stok } = req.body || {};

  try {
    // Normalize tanggal_distribusi: if undefined or empty string -> use current time
    const tanggalProvided = tanggal_distribusi !== undefined && String(tanggal_distribusi).trim() !== '';
    const tanggalToUse = tanggalProvided ? tanggal_distribusi : new Date().toISOString();

    // If stok provided, validate; else compute from students
    let finalStok;
    let totalSiswaReference = null;
    if (stok !== undefined && stok !== null && String(stok).trim() !== '') {
      const parsed = parseInt(stok);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ success: false, message: 'Field stok harus berupa angka >= 0' });
      }
      finalStok = parsed;
    } else {
      const totalQuery = `SELECT COUNT(*) as total_siswa FROM students`;
      const totalResult = await pool.query(totalQuery);
      totalSiswaReference = totalResult.rows[0].total_siswa;
      finalStok = totalSiswaReference;
    }

    // Cek apakah sudah ada data dengan tanggal_distribusi yang sama (by date)
    const checkQuery = `SELECT id FROM piring_mbg WHERE DATE(tanggal_distribusi) = DATE($1)`;
    const checkResult = await pool.query(checkQuery, [tanggalToUse]);

    if (checkResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Data piring MBG dengan tanggal distribusi yang sama sudah ada.'
      });
    }

    // Insert ke piring_mbg
    const insertQuery = `
      INSERT INTO piring_mbg (stok, tanggal_distribusi, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING id, stok, tanggal_distribusi, created_at, updated_at
    `;

    const result = await pool.query(insertQuery, [finalStok, tanggalToUse]);
    const piringData = result.rows[0];

    const responseData = {
      id: piringData.id,
      stok: piringData.stok,
      tanggal_distribusi: piringData.tanggal_distribusi,
      created_at: piringData.created_at,
      updated_at: piringData.updated_at
    };

    if (totalSiswaReference !== null) responseData.total_siswa_reference = totalSiswaReference;
    if (stok !== undefined && stok !== null && String(stok).trim() !== '') responseData.provided_stok = true;

    res.json({
      success: true,
      message: 'Data piring MBG berhasil dibuat',
      data: responseData
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
router.patch('/update-stok/:id', requireAdmin, async (req, res) => {
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
router.post('/daily/create', requireAuth, async (req, res) => {
  const {
    piring_mbg_id,
    class_id,
    attended_students,
    returned_plates,
    student_representative
  } = req.body;
  // New required field: given_plates (JSON)
  let { given_plates } = req.body || {};

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
          WHERE name = $1 AND class_id = $2
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

    // Validate given_plates (must be provided and be a non-negative integer)
    if (given_plates === undefined || given_plates === null) {
      return res.status(400).json({ success: false, message: 'Field given_plates harus diisi dan tidak boleh null' });
    }
    // accept numeric string or number
    if (typeof given_plates === 'string') {
      const s = given_plates.trim();
      if (!/^\d+$/.test(s)) {
        return res.status(400).json({ success: false, message: 'Field given_plates harus berupa integer (contoh: 2)' });
      }
      given_plates = parseInt(s, 10);
    }
    if (typeof given_plates === 'number') {
      if (!Number.isInteger(given_plates) || given_plates < 0) {
        return res.status(400).json({ success: false, message: 'Field given_plates harus berupa integer >= 0' });
      }
    } else {
      return res.status(400).json({ success: false, message: 'Field given_plates harus berupa integer' });
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

    // Insert ke mbg_class_daily (include given_plates JSON)
    const insertQuery = `
      INSERT INTO mbg_class_daily 
      (piring_mbg_id, class_id, total_students, attended_students, returned_plates, student_representative, given_plates, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, piring_mbg_id, class_id, total_students, attended_students, returned_plates, student_representative, given_plates, created_at, updated_at
    `;

    const result = await pool.query(insertQuery, [
      piring_mbg_id,
      class_id,
      totalStudents,
      attended_students || 0,
      returned_plates || 0,
      student_representative || null,
      given_plates
    ]);

    const dailyData = result.rows[0];

    // Kurangi stok piring_mbg sesuai given_plates (jumlah piring yang diberikan, bukan attended_students)
    const givenPlates = parseInt(dailyData.given_plates) || 0;
    try {
      const updateStockQuery = `
        UPDATE piring_mbg
        SET stok = GREATEST(stok - $1, 0), updated_at = NOW()
        WHERE id = $2
        RETURNING stok
      `;
      const stockResult = await pool.query(updateStockQuery, [givenPlates, piring_mbg_id]);
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
        given_plates: dailyData.given_plates || given_plates,
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

// Update returned_plates for MBG class daily by ID
router.patch('/daily/returned-plates/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { returned_plates } = req.body || {};

  try {
    if (returned_plates === undefined || returned_plates === null) {
      return res.status(400).json({ success: false, message: 'Field returned_plates harus diisi' });
    }
    const qty = parseInt(returned_plates);
    if (isNaN(qty) || qty < 0) {
      return res.status(400).json({ success: false, message: 'returned_plates harus berupa angka >= 0' });
    }

    // Ambil data existing untuk hitung delta stok
    const getExistingQ = `
      SELECT piring_mbg_id, returned_plates, given_plates 
      FROM mbg_class_daily 
      WHERE id = $1
    `;
    const existingResult = await pool.query(getExistingQ, [id]);
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data MBG class daily tidak ditemukan' });
    }
    
    const existing = existingResult.rows[0];
    const piringMbgId = existing.piring_mbg_id;
    const oldReturnedPlates = parseInt(existing.returned_plates) || 0;
    const givenPlates = parseInt(existing.given_plates) || 0;
    
    // Validasi: returned_plates tidak boleh lebih dari given_plates
    if (qty > givenPlates) {
      return res.status(400).json({ 
        success: false, 
        message: `returned_plates (${qty}) tidak boleh lebih dari given_plates (${givenPlates})` 
      });
    }

    // Update returned_plates di mbg_class_daily
    const updateQ = `
      UPDATE mbg_class_daily
      SET returned_plates = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, piring_mbg_id, class_id, total_students, attended_students, returned_plates, student_representative, given_plates, created_at, updated_at
    `;
    const result = await pool.query(updateQ, [qty, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Data MBG class daily tidak ditemukan' });
    }

    const updatedData = result.rows[0];
    
    // Update stok piring: naikkan stok berdasarkan delta returned_plates
    // Delta = qty (returned saat ini) - oldReturnedPlates (returned sebelumnya)
    // Jika qty > oldReturnedPlates: naikkan stok (piring dikembalikan lebih banyak)
    // Jika qty < oldReturnedPlates: kurangi stok (kurangi return)
    const deltaReturned = qty - oldReturnedPlates;
    
    try {
      if (deltaReturned !== 0) {
        const updateStockQuery = `
          UPDATE piring_mbg
          SET stok = GREATEST(stok + $1, 0), updated_at = NOW()
          WHERE id = $2
          RETURNING stok
        `;
        const stockResult = await pool.query(updateStockQuery, [deltaReturned, piringMbgId]);
        var stokAfter = stockResult.rows[0] ? stockResult.rows[0].stok : null;
      }
    } catch (err) {
      console.error('Error updating piring_mbg stok after returned-plates update:', err);
      var stokAfter = null;
    }

    res.json({
      success: true,
      message: 'returned_plates berhasil diperbarui dan stok disesuaikan',
      data: {
        ...updatedData,
        stok_after: stokAfter
      }
    });
  } catch (error) {
    console.error('Error updating returned_plates:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memperbarui returned_plates' });
  }
});

// GET /api/piring/class-summary/date/:date
// Menampilkan summary kelas untuk distribusi piring berdasarkan tanggal (YYYY-MM-DD)
router.get('/class-summary/date/:date', requireAuth, async (req, res) => {
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

    // Ambil summary kelas dengan attended_students dihitung dari login hari itu
    // Hitung siswa yang hadir hari ini dari student_attendances (login hari itu)
    // Hitung piring yang diberikan dan dikembalikan untuk tracking stok
    // PENTING: Ambil hanya 1 record terbaru per kelas (jangan SUM jika ada multiple)
    const classQuery = `
      SELECT 
        c.id as class_id,
        CONCAT(COALESCE(c.major, ''), ' ', COALESCE(c.class, '')) as class_name,
        c.class as grade,
        COUNT(DISTINCT s.id) as total_students,
        COALESCE(COUNT(DISTINCT sa.student_id), 0) as attended_students_today,
        COALESCE(mcd_latest.given_plates, 0) as total_piring_given,
        COALESCE(mcd_latest.returned_plates, 0) as total_piring_returned,
        GREATEST((COALESCE(mcd_latest.given_plates, 0) - COALESCE(mcd_latest.returned_plates, 0)), 0) as piring_outstanding,
        mcd_latest.id as daily_record_id,
        mcd_latest.attended_students as daily_attended_students,
        mcd_latest.given_plates as daily_given_plates,
        mcd_latest.returned_plates as daily_returned_plates,
        mcd_latest.student_representative,
        mcd_latest.created_at as daily_created_at
      FROM classes c
      LEFT JOIN students s ON c.id = s.class_id
      LEFT JOIN student_attendances sa ON s.id = sa.student_id AND DATE(sa.check_in_time) = DATE($1)
      LEFT JOIN mbg_class_daily mcd_latest ON mcd_latest.id = (
        SELECT mcd2.id FROM mbg_class_daily mcd2
        WHERE mcd2.class_id = c.id AND mcd2.piring_mbg_id = $2
        ORDER BY mcd2.created_at DESC 
        LIMIT 1
      )
      GROUP BY c.id, c.major, c.class, mcd_latest.id, mcd_latest.attended_students, mcd_latest.given_plates, mcd_latest.returned_plates, mcd_latest.student_representative, mcd_latest.created_at
      ORDER BY class_name
    `;

    const result = await pool.query(classQuery, [date, piringData.id]);

    // Transform hasil query untuk membentuk daily_record jika ada
    const classes = result.rows.map(row => {
      const classObj = {
        class_id: row.class_id,
        class_name: row.class_name,
        grade: row.grade,
        total_students: row.total_students,
        attended_students_today: row.attended_students_today,
        total_piring_given: row.total_piring_given,
        total_piring_returned: row.total_piring_returned,
        piring_outstanding: row.piring_outstanding
      };

      // Jika ada daily record (class sudah menerima MBG), tambahkan ke response
      if (row.daily_record_id) {
        classObj.daily_record = {
          id: row.daily_record_id,
          class_id: row.class_id,
          piring_mbg_id: piringData.id,
          attended_students: row.daily_attended_students,
          given_plates: row.daily_given_plates,
          returned_plates: row.daily_returned_plates,
          student_representative: row.student_representative,
          created_at: row.daily_created_at
        };
      }

      return classObj;
    });

    res.json({
      success: true,
      message: 'List kelas dengan summary MBG untuk tanggal berhasil diambil',
      data: {
        piring_mbg: {
          id: piringData.id,
          stok_total: piringData.stok,
          tanggal_distribusi: piringData.tanggal_distribusi
        },
        classes: classes
      }
    });
  } catch (error) {
    console.error('Error fetching class summary by date (alias):', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil summary kelas berdasarkan tanggal' });
  }
});

module.exports = router;
