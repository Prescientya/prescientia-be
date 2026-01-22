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
const classManagementRoutes = require('./routes/classManagement'); // Class attendance management
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { testConnection } = require('./config/db-helper');
const { displayRoutes } = require('./utils/routeAnalyzer2');

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
  { path: '/api/class-management', handler: classManagementRoutes }
];

// Register all routes dynamically
routes.forEach(route => {
  app.use(route.path, route.handler);
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
