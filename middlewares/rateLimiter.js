const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redisClient = require('../config/redis');

function getAuthenticatedUserId(req) {
  const user = req.user || {};
  const candidate = user.id ?? user.user_id ?? user.student_id ?? user.teacher_id ?? user.admin_id;

  if (candidate === undefined || candidate === null) {
    return null;
  }

  const normalized = String(candidate).trim();
  return normalized.length > 0 ? normalized : null;
}

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown-ip';
}

function keyByUserOrIp(req) {
  const userId = getAuthenticatedUserId(req);
  if (userId) {
    return `user:${userId}`;
  }

  return `ip:${getClientIp(req)}`;
}

function createRedisRateLimitStore(prefix) {
  return new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: `rate-limit:${prefix}:`
  });
}

function shouldUseRedisStore() {
  const storeMode = String(process.env.RATE_LIMIT_STORE || '').toLowerCase();

  if (storeMode === 'memory') {
    return false;
  }

  if (storeMode === 'redis') {
    return true;
  }

  if (String(process.env.USE_REDIS_RATE_LIMITER || '').toLowerCase() === 'true') {
    return true;
  }

  return Boolean(process.env.NODE_APP_INSTANCE || process.env.PM2_HOME);
}

function buildLimiter({ windowMs, max, message, keyGenerator, storePrefix }) {
  const options = {
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res, _next, limiterOptions) => {
      const resetTime = req.rateLimit?.resetTime;
      const resetAt = resetTime instanceof Date
        ? resetTime.getTime()
        : resetTime
          ? new Date(resetTime).getTime()
          : null;

      const retryAfterSeconds = resetAt
        ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
        : Math.max(1, Math.ceil((limiterOptions.windowMs || windowMs) / 1000));

      return res.status(429).json({
        success: false,
        message: limiterOptions.message || message,
        retryAfter: retryAfterSeconds
      });
    }
  };

  if (shouldUseRedisStore()) {
    options.store = createRedisRateLimitStore(storePrefix);
  }

  return rateLimit(options);
}

const authLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
  keyGenerator: getClientIp,
  storePrefix: 'auth'
});

const attendanceLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Terlalu sering mengirim absensi. Coba lagi dalam 1 menit.',
  keyGenerator: keyByUserOrIp,
  storePrefix: 'attendance'
});

const readLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Terlalu banyak permintaan data. Coba lagi dalam 1 menit.',
  keyGenerator: keyByUserOrIp,
  storePrefix: 'read'
});

module.exports = {
  authLimiter,
  attendanceLimiter,
  readLimiter,
  keyByUserOrIp,
  getClientIp,
  getAuthenticatedUserId,
  shouldUseRedisStore,
  buildLimiter
};