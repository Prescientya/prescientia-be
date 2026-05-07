const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Load .env BEFORE any code that reads process.env
dotenv.config();

// Fail fast if JWT_SECRET is not configured
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
  process.exit(1);
}

const redisClient = require('./config/redis');
const authRoutes = require('./routes/auth');
const piringRoutes = require('./routes/piring');
const usersRoutes = require('./routes/users');
const adminsRoutes = require('./routes/admins');
const teachersRoutes = require('./routes/teachers');
const classesRoutes = require('./routes/classes');
const studentsRoutes = require('./routes/students');
const studentNotificationsRoutes = require('./routes/studentNotifications');
const historyLoginRoutes = require('./routes/historyLogin');
const studentClassRolesRoutes = require('./routes/studentClassRoles');
const teacherClassRolesRoutes = require('./routes/teacherClassRoles');
const wifiNetworksRoutes = require('./routes/wifiNetworks');
const wifiPresenceLogsRoutes = require('./routes/wifiPresenceLogs');
const schoolCalendarRoutes = require('./routes/schoolCalendar');
const studentAttendancesRoutes = require('./routes/studentAttendances');
const teacherAttendancesRoutes = require('./routes/teacherAttendances');
const attendanceDetailsRoutes = require('./routes/attendanceDetails');
const mbgRoutes = require('./routes/mbg');
const studentAttendanceSummaryRoutes = require('./routes/studentAttendanceSummary');
const attendanceRoutes = require('./routes/attendance'); // Wi-Fi based attendance validation
const classManagementRoutes = require('./routes/classManagement'); // Class attendance management
const deviceChangeRequestsRoutes = require('./routes/deviceChangeRequests'); // Device change requests management
const eventsRoutes = require('./routes/events'); // Events / acara sekolah
const attendanceStatusRoutes = require('./routes/attendanceStatus'); // Attendance status changes
const absenceLettersRoutes = require('./routes/absenceLetters'); // Absence letters (surat izin/sakit)
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { testConnection } = require('./config/db-helper');
const pool = require('./config/database');
const { displayRoutes } = require('./utils/routeAnalyzer2');
const { readLimiter, attendanceLimiter } = require('./middlewares/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// === SECURITY MIDDLEWARE ===

// Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
app.use(helmet());

// CORS — restrict to allowed origins
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Routes configuration array
const routes = [
  { path: '/api/auth', handler: authRoutes },
  { path: '/api/piring', handler: piringRoutes },
  { path: '/api/users', handler: usersRoutes },
  { path: '/api/admins', handler: adminsRoutes },
  { path: '/api/teachers', handler: teachersRoutes },
  { path: '/api/classes', handler: classesRoutes },
  { path: '/api/students', handler: studentsRoutes },
  { path: '/api/student', handler: studentNotificationsRoutes },
  { path: '/api/history-login', handler: historyLoginRoutes },
  { path: '/api/student-class-roles', handler: studentClassRolesRoutes },
  { path: '/api/teacher-class-roles', handler: teacherClassRolesRoutes },
  { path: '/api/wifi-networks', handler: wifiNetworksRoutes },
  { path: '/api/wifi-presence-logs', handler: wifiPresenceLogsRoutes },
  { path: '/api/school-calendar', handler: schoolCalendarRoutes },
  { path: '/api/student-attendances', handler: studentAttendancesRoutes },
  { path: '/api/teacher-attendances', handler: teacherAttendancesRoutes },
  { path: '/api/attendance-details', handler: attendanceDetailsRoutes },
  { path: '/api/mbg', handler: mbgRoutes },
  { path: '/api/student-attendance-summary', handler: studentAttendanceSummaryRoutes },
  { path: '/api/attendance', handler: attendanceRoutes },
  { path: '/api/class-management', handler: classManagementRoutes },
  { path: '/api/device-change-requests', handler: deviceChangeRequestsRoutes },
  { path: '/api/events', handler: eventsRoutes },
  { path: '/api/attendance-status', handler: attendanceStatusRoutes },
  { path: '/api/absence-letters', handler: absenceLettersRoutes }
];

// Register all routes dynamically with readLimiter (60 req/min per user)
routes.forEach(route => {
  app.use(route.path, readLimiter, route.handler);
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Prescientia Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Database health check (both /health and /api/health for FE compatibility)
const healthHandler = async (req, res) => {
  const dbStatus = await testConnection();
  const redisStatus = await redisClient.ping().then(() => true).catch(() => false);
  res.json({
    success: true,
    status: 'running',
    database: dbStatus ? 'connected' : 'disconnected',
    redis: redisStatus ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Legacy /api/people (demo data - no database table)
app.get('/api/people', (req, res) => {
  res.json({ success: true, data: [] });
});

// POST /api/wifi-info - receive WiFi scan data from student app
app.post('/api/wifi-info', attendanceLimiter, async (req, res) => {
  try {
    const { ssid, bssid, ip, signalStrength, frequency, isSchoolWifi } = req.body;
    // Log WiFi info for monitoring purposes
    console.log('[WiFi Info]', { ssid, bssid, ip, isSchoolWifi });
    // If there's a wifi_presence_logs table, try to insert
    if (ssid && bssid) {
      try {
        await pool.query(
          `INSERT INTO wifi_presence_logs (ssid, bssid, ip_address, signal_strength, connected_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [ssid, bssid, ip || null, signalStrength || null]
        );
      } catch (dbErr) {
        console.warn('[WiFi Info] Could not log to DB:', dbErr.message);
      }
    }
    res.status(201).json({ success: true, message: 'WiFi info received' });
  } catch (err) {
    console.error('[WiFi Info] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await testConnection();
    
    // Get database info — MySQL version
    const { query } = require('./config/db-helper');
    const dbInfo = await query('SELECT DATABASE() AS current_database');
    const tablesResult = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`);
    
    app.listen(PORT, () => {
      console.log('=================================');
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 URL: http://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('=================================');
      console.log(`\n💾 Database: ${dbInfo.rows[0].current_database}`);
      console.log(`🔴 Redis: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
      console.log('📊 Tables:');
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      
      // Display all routes dynamically
      displayRoutes(app, routes);
      
      console.log('═══════════════════════════════════════════════════════');
      console.log('✨ API Ready! See API_DOCUMENTATION.md for details\n');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
