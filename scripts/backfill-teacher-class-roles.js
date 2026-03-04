/**
 * Backfill Script: Sync teacher_class_roles from classes.homeroom_teacher_id
 * 
 * This script finds all classes that have a homeroom_teacher_id set but
 * do NOT have a corresponding wali_kelas entry in teacher_class_roles,
 * and inserts the missing rows.
 * 
 * Usage: node scripts/backfill-teacher-class-roles.js
 * 
 * This fixes the bug where teachers assigned as homeroom (wali kelas)
 * through the class management API (classes.js) or direct DB manipulation
 * don't show up as wali_kelas in the teacher login response.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || process.env.DB_DATABASE,
  user: process.env.DB_USER || process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
});

async function backfill() {
  const client = await pool.connect();
  try {
    console.log('=== Backfill teacher_class_roles from classes.homeroom_teacher_id ===\n');

    // Find classes with homeroom_teacher_id that are missing wali_kelas in teacher_class_roles
    const query = `
      SELECT 
        c.id AS class_id,
        c.class,
        c.major,
        c.homeroom_teacher_id AS teacher_id,
        t.name AS teacher_name
      FROM classes c
      INNER JOIN teachers t ON t.id = c.homeroom_teacher_id
      WHERE c.homeroom_teacher_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM teacher_class_roles tcr
          WHERE tcr.teacher_id = c.homeroom_teacher_id
            AND tcr.class_id = c.id
            AND tcr.role = 'wali_kelas'
        )
      ORDER BY c.class, c.major
    `;

    const result = await client.query(query);

    if (result.rows.length === 0) {
      console.log('No missing wali_kelas roles found. Everything is in sync!');
      return;
    }

    console.log(`Found ${result.rows.length} missing wali_kelas role(s):\n`);
    for (const row of result.rows) {
      const className = `${row.class} ${row.major}`;
      console.log(`  - Teacher: ${row.teacher_name} (id=${row.teacher_id}) → Class: ${className} (id=${row.class_id})`);
    }

    console.log('\nInserting missing roles...\n');

    await client.query('BEGIN');

    let insertedCount = 0;
    for (const row of result.rows) {
      try {
        await client.query(
          `INSERT INTO teacher_class_roles (teacher_id, class_id, role, created_at, updated_at)
           VALUES ($1, $2, 'wali_kelas', NOW(), NOW())`,
          [row.teacher_id, row.class_id]
        );
        const className = `${row.class} ${row.major}`;
        console.log(`  ✓ Inserted wali_kelas for ${row.teacher_name} → ${className}`);
        insertedCount++;
      } catch (err) {
        console.error(`  ✗ Failed for teacher_id=${row.teacher_id}, class_id=${row.class_id}: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    console.log(`\nDone! Inserted ${insertedCount} wali_kelas role(s).`);

    // Also report any orphaned wali_kelas entries (exist in teacher_class_roles but not in classes.homeroom_teacher_id)
    const orphanQuery = `
      SELECT 
        tcr.id AS role_id,
        tcr.teacher_id,
        tcr.class_id,
        t.name AS teacher_name,
        c.class,
        c.major,
        c.homeroom_teacher_id
      FROM teacher_class_roles tcr
      INNER JOIN teachers t ON t.id = tcr.teacher_id
      LEFT JOIN classes c ON c.id = tcr.class_id
      WHERE tcr.role = 'wali_kelas'
        AND (c.homeroom_teacher_id IS NULL OR c.homeroom_teacher_id != tcr.teacher_id)
      ORDER BY tcr.teacher_id
    `;

    const orphanResult = await client.query(orphanQuery);

    if (orphanResult.rows.length > 0) {
      console.log(`\n⚠ Found ${orphanResult.rows.length} orphaned wali_kelas role(s) in teacher_class_roles:`);
      console.log('  (These have wali_kelas in teacher_class_roles but classes.homeroom_teacher_id points elsewhere)\n');
      for (const row of orphanResult.rows) {
        const className = row.class ? `${row.class} ${row.major}` : '(deleted class)';
        const actualHomeroom = row.homeroom_teacher_id || 'none';
        console.log(`  - role_id=${row.role_id}: Teacher ${row.teacher_name} (id=${row.teacher_id}) → ${className} (actual homeroom: ${actualHomeroom})`);
      }
      console.log('\n  Consider cleaning these up manually if they are stale.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Backfill failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

backfill();
