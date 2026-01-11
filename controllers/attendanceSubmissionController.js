const service = require('../services/attendanceSubmissionService');

/**
 * POST /api/student/attendance/:attendance_id
 * 
 * Submit reason and evidence for attendance status change.
 * Requires authentication (req.user populated by requireStudent middleware).
 * 
 * Request body:
 * {
 *   "status": "sakit" | "izin" (required, string)
 *   "description": "Alasan ketidakhadiran..." (required, string)
 *   "evidence_url": "https://..." (optional, string)
 * }
 * 
 * Response:
 * {
 *   "success": true|false,
 *   "message": "...",
 *   "data": { attendance, detail } | null
 * }
 */
const submitAttendanceReason = async (req, res) => {
  try {
    // Extract student_id from authenticated request
    const studentId = req.user && Number(req.user.student_id);
    if (!studentId || isNaN(studentId)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: student_id tidak ditemukan di token'
      });
    }

    // Extract attendance_id from URL parameter
    const attendanceId = Number(req.params.attendance_id);
    if (!attendanceId || isNaN(attendanceId)) {
      return res.status(400).json({
        success: false,
        message: 'Parameter attendance_id harus berupa angka yang valid'
      });
    }

    // Extract and validate required fields from request body
    const { status, description, evidence_url = null } = req.body;

    // Validate status (required, non-empty string)
    if (!status || typeof status !== 'string' || status.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Field status harus diisi (contoh: sakit, izin)'
      });
    }

    // Validate description (required, non-empty string)
    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Field description harus diisi'
      });
    }

    // Validate evidence_url if provided (must be valid URL string)
    if (evidence_url && typeof evidence_url !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Field evidence_url harus berupa URL string'
      });
    }

    console.log(`[submitAttendanceReason] Controller: studentId=${studentId}, attendanceId=${attendanceId}`);

    // Call service with all validated parameters
    const result = await service.submitAttendanceReason({
      studentId,
      attendanceId,
      status: status.trim(),
      description: description.trim(),
      evidence_url: evidence_url ? evidence_url.trim() : null
    });

    // Handle service response
    if (result.status === 200) {
      return res.json({
        success: true,
        message: 'Alasan kehadiran berhasil disubmit',
        data: result.data
      });
    } else if (result.status === 400) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    } else if (result.status === 403) {
      return res.status(403).json({
        success: false,
        message: result.error
      });
    } else if (result.status === 404) {
      return res.status(404).json({
        success: false,
        message: result.error
      });
    } else if (result.status === 409) {
      return res.status(409).json({
        success: false,
        message: result.error
      });
    } else {
      // status 500 or other
      return res.status(500).json({
        success: false,
        message: result.error || 'Terjadi kesalahan pada server'
      });
    }
  } catch (error) {
    console.error('[submitAttendanceReason] Controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  submitAttendanceReason
};
