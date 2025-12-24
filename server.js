const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./routes/auth');
const piringRoutes = require('./routes/piring');
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
      console.log('-----------------------------------');
      console.log('GET    /');
      console.log('GET    /health');
      console.log('\n--- Auth Endpoints ---');
      console.log('GET    /api/auth/test');
      console.log('GET    /api/auth/check-db');
      console.log('POST   /api/auth/login/siswa');
      console.log('POST   /api/auth/login/guru');
      console.log('POST   /api/auth/login/petugas');
      console.log('\n--- Piring MBG Endpoints ---');
      console.log('GET    /api/piring/stok-total');
      console.log('GET    /api/piring/list');
      console.log('POST   /api/piring/create');
      console.log('PUT    /api/piring/update-stok/:id');
      console.log('GET    /api/piring/class-summary/:date');
      console.log('GET    /api/piring/class-summary/date/:date');
      console.log('POST   /api/piring/daily/create');
      console.log('-----------------------------------\n');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
