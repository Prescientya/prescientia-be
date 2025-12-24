const pool = require('../config/database');

/**
 * Test database connection
 */
const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('✓ Database connected successfully');
    
    const result = await client.query('SELECT NOW()');
    console.log('✓ Current database time:', result.rows[0].now);
    
    client.release();
    return true;
  } catch (error) {
    console.error('✗ Database connection error:', error.message);
    return false;
  }
};

/**
 * Execute a query
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
 * Get a client from the pool for transactions
 */
const getClient = async () => {
  const client = await pool.connect();
  const query = client.query;
  const release = client.release;

  // Set a timeout of 5 seconds, after which we will log this client's last query
  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
  }, 5000);

  // Monkey patch the query method to keep track of the last query executed
  client.query = (...args) => {
    client.lastQuery = args;
    return query.apply(client, args);
  };

  client.release = () => {
    // Clear our timeout
    clearTimeout(timeout);
    // Set the methods back to their old un-monkey-patched version
    client.query = query;
    client.release = release;
    return release.apply(client);
  };

  return client;
};

module.exports = {
  query,
  getClient,
  testConnection,
  pool
};
