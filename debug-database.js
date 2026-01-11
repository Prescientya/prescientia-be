const pool = require('./config/database');

async function debugDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('\n=== DATABASE SCHEMA CHECK ===\n');
    
    // Check table structure
    const tableCheck = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'student_attendance_details'
      ORDER BY ordinal_position
    `);
    
    console.log('student_attendance_details columns:');
    console.log(tableCheck.rows);
    
    // Check constraints
    const constraintCheck = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'student_attendance_details'
    `);
    
    console.log('\nConstraints:');
    console.log(constraintCheck.rows);
    
    // Check triggers
    const triggerCheck = await client.query(`
      SELECT trigger_name, event_manipulation, event_object_table
      FROM information_schema.triggers
      WHERE event_object_table = 'student_attendance_details'
    `);
    
    console.log('\nTriggers:');
    console.log(triggerCheck.rows);
    
    // Check FK constraints
    const fkCheck = await client.query(`
      SELECT constraint_name, table_name, column_name, foreign_table_name, foreign_column_name
      FROM information_schema.key_column_usage
      WHERE table_name = 'student_attendance_details'
        AND foreign_table_name IS NOT NULL
    `);
    
    console.log('\nForeign Keys:');
    console.log(fkCheck.rows);
    
    // Count records
    const countCheck = await client.query(`
      SELECT COUNT(*) as total_records FROM student_attendance_details
    `);
    
    console.log('\nTotal records in student_attendance_details:');
    console.log(countCheck.rows);
    
    // List all records
    const allRecords = await client.query(`
      SELECT * FROM student_attendance_details
      ORDER BY created_at DESC LIMIT 10
    `);
    
    console.log('\nLast 10 records:');
    console.log(allRecords.rows);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

debugDatabase();
