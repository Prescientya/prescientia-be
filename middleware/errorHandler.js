/**
 * Middleware untuk handle error
 */
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

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
