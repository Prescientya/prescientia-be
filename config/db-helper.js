const pool = require('../config/database');

/**
 * Test database connection.
 *
 * MySQL version (commented out):
 * // const result = await pool.query('SELECT NOW() AS now');
 *
 * PostgreSQL version: uses pool.connect() / client.release() directly.
 */
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✓ Database connected successfully');
    console.log('✓ Current database time:', result.rows[0].now);
    client.release();
    return true;
  } catch (error) {
    console.error('✗ Database connection error:', error.message);
    return false;
  }
};

/**
 * Execute a query and log duration / row count.
 *
 * PostgreSQL version kept as reference:
 * /*
 *   const res = await pool.query(text, params);
 *   console.log('Executed query', { text, duration, rows: res.rowCount });
 *   return res;
 * * /
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Query error:', error.message);
    throw error;
  }
};

/**
 * Get a connection from the pool for transactions.
 *
 * PostgreSQL version (monkey-patched client — commented out):
 * /*
 *   const client = await pool.connect();
 *   const query   = client.query;
 *   const release = client.release;
 *   const timeout = setTimeout(() => {
 *     console.error('A client has been checked out for more than 5 seconds!');
 *   }, 5000);
 *   client.query = (...args) => { client.lastQuery = args; return query.apply(client, args); };
 *   client.release = () => { clearTimeout(timeout); client.query = query; client.release = release; return release.apply(client); };
 *   return client;
 * * /
 *
 * MySQL version: pool.connect() already returns a pg-compatible client object
 * (see config/database.js wrapper). A simple timeout warning is added here.
 *
 * PostgreSQL version: pool.connect() with monkey-patched release and timeout warning.
 */
const getClient = async () => {
  const client = await pool.connect();

  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
  }, 5000);

  const originalRelease = client.release;
  client.release = () => {
    clearTimeout(timeout);
    client.release = originalRelease;
    return originalRelease();
  };

  return client;
};

module.exports = {
  query,
  getClient,
  testConnection,
  pool
};
