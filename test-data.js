const pool = require('./config/database');

(async () => {
  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    console.log('\n=== CHECKING DATA ===');
    const res = await client.query('SELECT COUNT(*) as cnt FROM student_attendance_details');
    console.log('Total records:', res.rows[0]);
    
    const res2 = await client.query('SELECT * FROM student_attendance_details ORDER BY created_at DESC LIMIT 10');
    console.log('Last 10 records:');
    res2.rows.forEach(row => console.log(row));
    
    client.release();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
