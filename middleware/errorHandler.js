const fs = require('fs');
const path = require('path');

const errorLogPath = path.join(__dirname, '..', 'logs', 'error.log');

const shouldLogToFile = () => {
  const value = (process.env.ERROR_LOG_TO_FILE || '').toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
};

const appendErrorLog = (entry) => {
  if (!shouldLogToFile()) return;

  try {
    fs.mkdirSync(path.dirname(errorLogPath), { recursive: true });
    const line = JSON.stringify(entry);
    fs.appendFile(errorLogPath, `${line}\n`, (err) => {
      if (err) {
        console.error('Failed to write error log:', err.message);
      }
    });
  } catch (logErr) {
    console.error('Failed to write error log:', logErr.message);
  }
};

/**
 * Middleware untuk handle error
 */
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  appendErrorLog({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl || req.url,
    status: err.status || 500,
    message: err.message,
    code: err.code,
    stack: err.stack
  });

  // Database error
  if (err.code && err.code.startsWith('23')) {
    return res.status(400).json({
      success: false,
      message: 'Database constraint error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  // Validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.errors
    });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

/**
 * Middleware untuk handle 404
 */
const notFound = (req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
};

module.exports = {
  errorHandler,
  notFound
};
