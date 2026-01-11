const pool = require('./config/database');

async function checkDatabaseIssues() {
  const client = await pool.connect();
  
  try {
    console.log('\n=== DATABASE INTEGRITY CHECK ===\n');
    
    // 1. Check table structure
    console.log('1. TABLE STRUCTURE:');
    const tableStructure = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'student_attendance_details'
      ORDER BY ordinal_position
    `);
    console.log(tableStructure.rows);
    
    // 2. Check foreign key constraints
    console.log('\n2. FOREIGN KEY CONSTRAINTS:');
    const fkConstraints = await client.query(`
      SELECT 
        constraint_name,
        table_name,
        column_name,
        foreign_table_name,
        foreign_column_name
      FROM information_schema.key_column_usage
      WHERE table_name = 'student_attendance_details'
        AND foreign_table_name IS NOT NULL
    `);
    console.log(fkConstraints.rows);
    
    // 3. Check triggers
    console.log('\n3. TRIGGERS ON TABLE:');
    const triggers = await client.query(`
      SELECT 
        trigger_name,
        event_manipulation,
        event_object_table,
        action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'student_attendance_details'
    `);
    console.log(triggers.rows.length > 0 ? triggers.rows : 'No triggers found');
    
    // 4. Check current data
    console.log('\n4. CURRENT DATA:');
    const dataCount = await client.query(`
      SELECT COUNT(*) as total FROM student_attendance_details
    `);
    console.log(`Total records: ${dataCount.rows[0].total}`);
    
    const recentData = await client.query(`
      SELECT * FROM student_attendance_details
      ORDER BY created_at DESC LIMIT 5
    `);
    console.log('Last 5 records:');
    console.log(recentData.rows);
    
    // 5. Check parent tables
    console.log('\n5. CHECKING PARENT TABLE (student_attendances):');
    const attendanceCheck = await client.query(`
      SELECT COUNT(*) as total FROM student_attendances WHERE status = 'alpa'
    `);
    console.log(`Total 'alpa' attendances: ${attendanceCheck.rows[0].total}`);
    
    const sampleAttendance = await client.query(`
      SELECT * FROM student_attendances WHERE status = 'alpa' LIMIT 1
    `);
    console.log('Sample alpa attendance:');
    console.log(sampleAttendance.rows[0]);
    
    // 6. Check sequence/auto-increment
    console.log('\n6. CHECKING SEQUENCE:');
    const sequenceCheck = await client.query(`
      SELECT * FROM information_schema.sequences
      WHERE sequence_name LIKE '%student_attendance_details%'
    `);
    console.log(sequenceCheck.rows);
    
    console.log('\n=== END OF CHECK ===\n');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkDatabaseIssues();
