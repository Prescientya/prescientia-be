const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
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
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { testConnection } = require('./config/db-helper');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/piring', piringRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admins', adminsRoutes);
app.use('/api/teachers', teachersRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/student', studentNotificationsRoutes);
app.use('/api/history-login', historyLoginRoutes);
app.use('/api/student-class-roles', studentClassRolesRoutes);
app.use('/api/teacher-class-roles', teacherClassRolesRoutes);
app.use('/api/wifi-networks', wifiNetworksRoutes);
app.use('/api/wifi-presence-logs', wifiPresenceLogsRoutes);
app.use('/api/school-calendar', schoolCalendarRoutes);
app.use('/api/student-attendances', studentAttendancesRoutes);
app.use('/api/teacher-attendances', teacherAttendancesRoutes);
app.use('/api/attendance-details', attendanceDetailsRoutes);
app.use('/api/mbg', mbgRoutes);
app.use('/api/student-attendance-summary', studentAttendanceSummaryRoutes);
app.use('/api/attendance', attendanceRoutes); // Wi-Fi based attendance validation

// Health check
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Prescientia Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Database health check
app.get('/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({
    success: true,
    status: 'running',
    database: dbStatus ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await testConnection();
    
    // Get database info
    const { query } = require('./config/db-helper');
    const dbInfo = await query('SELECT current_database()');
    const tablesResult = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    app.listen(PORT, () => {
      console.log('=================================');
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 URL: http://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('=================================');
      console.log(`\n💾 Database: ${dbInfo.rows[0].current_database}`);
      console.log('📊 Tables:');
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      console.log('\n📡 Available API Endpoints:');
      console.log('═══════════════════════════════════════════════════════');
      
      // Root endpoints
      console.log('\n🏠 Root Endpoints');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /');
      console.log('  GET    /health');
      
      // Auth endpoints
      console.log('\n🔐 Auth & Authorization');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /api/auth/test');
      console.log('  POST   /api/auth/login/siswa (NISN + password)');
      console.log('  POST   /api/auth/login/guru (NIP + password)');
      console.log('  POST   /api/auth/login/petugas (username + password)');
      console.log('  POST   /api/auth/login/admin (email + password)');
      
      // Core CRUD endpoints
      console.log('\n👥 Users Management');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /api/users');
      console.log('  GET    /api/users/:id');
      console.log('  (POST disabled - Create users via /students, /teachers, /admins)');
      console.log('  PATCH  /api/users/:id');
      console.log('  DELETE /api/users/:id');
      
      console.log('\n👨‍💼 Admins');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /api/admins');
      console.log('  GET    /api/admins/:id');
      console.log('  PATCH  /api/admins/:id');
      console.log('  (DELETE disabled - Admin accounts are protected)');
      
      console.log('\n👨‍🏫 Teachers');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /api/teachers');
      console.log('  GET    /api/teachers/:id');
      console.log('  POST   /api/teachers');
      console.log('  PATCH  /api/teachers/:id');
      console.log('  DELETE /api/teachers/:id');
      
      console.log('\n🏫 Classes');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /api/classes');
      console.log('  GET    /api/classes/:id');
      console.log('  POST   /api/classes');
      console.log('  PATCH  /api/classes/:id');
      console.log('  DELETE /api/classes/:id');
      
      console.log('\n👨‍🎓 Students');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /api/students');
      console.log('  GET    /api/students/:id');
      console.log('  POST   /api/students');
      console.log('  PATCH  /api/students/:id');
      console.log('  DELETE /api/students/:id');
      
      // User Management
      console.log('\n📋 User Management');
      console.log('───────────────────────────────────────────────────────');
      console.log('  📝 History Login:');
      console.log('    GET    /api/history-login');
      console.log('    GET    /api/history-login/:id');
      console.log('    POST   /api/history-login');
      console.log('    PATCH  /api/history-login/:id');
      console.log('    DELETE /api/history-login/:id');
      
      console.log('\n  🎯 Student Class Roles:');
      console.log('    GET    /api/student-class-roles');
      console.log('    GET    /api/student-class-roles/:id');
      console.log('    POST   /api/student-class-roles');
      console.log('    PATCH  /api/student-class-roles/:id');
      console.log('    DELETE /api/student-class-roles/:id');
      
      console.log('\n  🎯 Teacher Class Roles:');
      console.log('    GET    /api/teacher-class-roles');
      console.log('    GET    /api/teacher-class-roles/:id');
      console.log('    POST   /api/teacher-class-roles');
      console.log('    PATCH  /api/teacher-class-roles/:id');
      console.log('    DELETE /api/teacher-class-roles/:id');
      
      // WiFi endpoints
      console.log('\n📶 WiFi System');
      console.log('───────────────────────────────────────────────────────');
      console.log('  🌐 WiFi Networks:');
      console.log('    GET    /api/wifi-networks');
      console.log('    GET    /api/wifi-networks/:id');
      console.log('    POST   /api/wifi-networks');
      console.log('    PATCH  /api/wifi-networks/:id');
      console.log('    DELETE /api/wifi-networks/:id');
      
      console.log('\n  📍 WiFi Presence Logs:');
      console.log('    GET    /api/wifi-presence-logs');
      console.log('    GET    /api/wifi-presence-logs/:id');
      console.log('    POST   /api/wifi-presence-logs');
      console.log('    PATCH  /api/wifi-presence-logs/:id');
      console.log('    DELETE /api/wifi-presence-logs/:id');
      
      // School Calendar
      console.log('\n📅 School Calendar');
      console.log('───────────────────────────────────────────────────────');
      console.log('  GET    /api/school-calendar');
      console.log('  GET    /api/school-calendar/:id');
      console.log('  GET    /api/school-calendar/by-date/:date (query by date: YYYY-MM-DD)');
      console.log('  POST   /api/school-calendar');
      console.log('  PATCH  /api/school-calendar/:id');
      console.log('  DELETE /api/school-calendar/:id');
      
      // Attendance endpoints
      console.log('\n✅ Attendance System');
      console.log('───────────────────────────────────────────────────────');
      console.log('  👨‍🎓 Student Attendances:');
      console.log('    GET    /api/student-attendances');
      console.log('    GET    /api/student-attendances/:id');
      console.log('    POST   /api/student-attendances');
      console.log('    PATCH  /api/student-attendances/:id');
      console.log('    POST   /api/student-attendances/app/login (app -> create on login)');
      console.log('    PATCH  /api/student-attendances/app/logout (app -> set check_out_time)');
      console.log('    GET    /api/student-attendances/app/logged (list currently logged-in students)');
      console.log('    DELETE /api/student-attendances/:id');
      
      console.log('\n  👨‍🏫 Teacher Attendances:');
      console.log('    GET    /api/teacher-attendances');
      console.log('    GET    /api/teacher-attendances/:id');
      console.log('    POST   /api/teacher-attendances');
      console.log('    POST   /api/teacher-attendances/app/login (app -> create on login)');
      console.log('    PATCH  /api/teacher-attendances/:id');
      console.log('    PATCH  /api/teacher-attendances/app/logout/:teacher_id (app -> set check_out_time)');
      console.log('    DELETE /api/teacher-attendances/:id');
      
      console.log('\n  📝 Attendance Details:');
      console.log('    GET    /api/attendance-details');
      console.log('    GET    /api/attendance-details/:id');
      console.log('    POST   /api/attendance-details');
      console.log('    PATCH  /api/attendance-details/:id');
      console.log('    DELETE /api/attendance-details/:id');
      console.log('    GET    /api/attendance-details/teacher');
      console.log('    POST   /api/attendance-details/teacher');
      console.log('    PATCH  /api/attendance-details/teacher/:id');
      console.log('    DELETE /api/attendance-details/teacher/:id');
      
      console.log('\n  📊 Attendance Summary:');
      console.log('    GET    /api/student-attendance-summary');
      console.log('    GET    /api/student-attendance-summary/:id');
      console.log('    POST   /api/student-attendance-summary');
      console.log('    PATCH  /api/student-attendance-summary/:id');
      console.log('    DELETE /api/student-attendance-summary/:id');
      
      // MBG System
      console.log('\n🍽️  MBG System (Meal/Food Distribution)');
      console.log('═══════════════════════════════════════════════════════');
      
      console.log('\n  👤 Petugas MBG (Officers):');
      console.log('    GET    /api/mbg/petugas');
      console.log('    GET    /api/mbg/petugas/:id');
      console.log('    POST   /api/mbg/petugas');
      console.log('    PATCH  /api/mbg/petugas/:id');
      console.log('    DELETE /api/mbg/petugas/:id');
      
      console.log('\n  🍽️  Piring MBG (Plates/Stock):');
      console.log('    GET    /api/piring/stok-total');
      console.log('    GET    /api/piring/list');
      console.log('    POST   /api/piring/create (stok & tanggal_distribusi optional)');
      console.log('    PATCH  /api/piring/update-stok/:id');
      console.log('    POST   /api/piring/daily/create');
      console.log('    PATCH  /api/piring/daily/returned-plates/:id');
      console.log('    GET    /api/piring/class-summary/date/:date');
      console.log('    GET    /api/piring/class-summary/:date');
      
      console.log('\n  📚 MBG Class Daily (Daily Distribution):');
      console.log('    GET    /api/mbg/class-daily');
      console.log('    GET    /api/mbg/class-daily/:id');
      console.log('    POST   /api/mbg/class-daily');
      console.log('    PATCH  /api/mbg/class-daily/:id');
      console.log('    DELETE /api/mbg/class-daily/:id');
      
      console.log('\n  👨‍🏫 MBG Teacher Excess:');
      console.log('    GET    /api/mbg/teacher-excess');
      console.log('    GET    /api/mbg/teacher-excess/:id');
      console.log('    POST   /api/mbg/teacher-excess');
      console.log('    PATCH  /api/mbg/teacher-excess/:id');
      console.log('    DELETE /api/mbg/teacher-excess/:id');
      
      console.log('\n  🍽️  Piring MBG (CRUD via /api/mbg routes):');
      console.log('    GET    /api/mbg/piring');
      console.log('    GET    /api/mbg/piring/:id');
      console.log('    POST   /api/mbg/piring');
      console.log('    PATCH  /api/mbg/piring/:id');
      console.log('    DELETE /api/mbg/piring/:id');
      
      console.log('\n═══════════════════════════════════════════════════════');
      console.log('✨ API Ready! See API_DOCUMENTATION.md for details\n');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
