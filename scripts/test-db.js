const { testConnection, query } = require('../config/db-helper');

/**
 * Script untuk test database connection dan query
 * Jalankan: node scripts/test-db.js
 */

async function testDatabase() {
  console.log('=== Testing Database Connection ===\n');
  
  try {
    // Test connection
    console.log('1. Testing connection...');
    const connected = await testConnection();
    
    if (!connected) {
      console.error('❌ Failed to connect to database');
      console.error('Pastikan:');
      console.error('- PostgreSQL sudah berjalan');
      console.error('- File .env sudah diisi dengan benar');
      console.error('- Database sudah dibuat');
      process.exit(1);
    }
    
    console.log('\n2. Testing query...');
    
    // Test query users
    const usersResult = await query('SELECT COUNT(*) as count FROM users');
    console.log(`✓ Users table: ${usersResult.rows[0].count} records`);
    
    // Test query students
    const studentsResult = await query('SELECT COUNT(*) as count FROM students');
    console.log(`✓ Students table: ${studentsResult.rows[0].count} records`);
    
    // Test query classes
    const classesResult = await query('SELECT COUNT(*) as count FROM classes');
    console.log(`✓ Classes table: ${classesResult.rows[0].count} records`);
    
    console.log('\n✅ All tests passed!');
    console.log('Database is ready to use.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.message.includes('relation') && error.message.includes('does not exist')) {
      console.error('\nTabel belum dibuat. Jalankan:');
      console.error('psql -U postgres -d prescientia_db -f database/schema.sql');
    }
    
    process.exit(1);
  }
  
  process.exit(0);
}

testDatabase();
