const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const jwt = require('jsonwebtoken');
const redisClient = require('../config/redis');

const JWT_SECRET = process.env.JWT_SECRET;
// SECURITY: whitelist algoritma — konsisten dengan auth.middleware (tutup alg:none).
const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] };

// Ambil Bearer token dari header Authorization (null bila tidak ada/format salah).
function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || typeof authHeader !== 'string') return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) return null;
  return parts[1];
}

// Identitas user untuk kunci rate-limit.
//
// PERF/AVAILABILITY: limiter `readLimiter` dipasang di server.js SEBELUM
// middleware auth berjalan, jadi `req.user` masih kosong saat keyGenerator
// dipanggil. Akibatnya dulu kunci jatuh ke IP — dan karena semua siswa absen
// lewat satu IP publik (NAT WiFi sekolah), 60 req/menit dibagi se-sekolah →
// burst absen pagi memicu 429 massal.
//
// Fix: kalau req.user belum ada, derive identitas dari JWT yang DIVERIFIKASI
// (bukan sekadar di-decode). Verifikasi penting agar attacker tidak bisa
// memalsukan user_id korban untuk menghabiskan kuota korban (rate-limit
// poisoning). Token invalid/expired → null → fallback ke IP.
function getAuthenticatedUserId(req) {
  const user = req.user || {};
  let candidate = user.id ?? user.user_id ?? user.student_id ?? user.teacher_id ?? user.admin_id;

  if (candidate === undefined || candidate === null) {
    const token = extractBearerToken(req);
    if (token && JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS);
        candidate = decoded.user_id ?? decoded.student_id ?? decoded.teacher_id ?? decoded.admin_id;
      } catch (_) {
        // Token tidak valid/expired → biarkan jatuh ke kunci per-IP di bawah.
      }
    }
  }

  if (candidate === undefined || candidate === null) {
    return null;
  }

  const normalized = String(candidate).trim();
  return normalized.length > 0 ? normalized : null;
}

// Kunci rate-limit berbasis IP. WAJIB lewat helper `ipKeyGenerator` dari
// express-rate-limit: untuk IPv6 ia mem-mask alamat ke subnet (/56) agar satu
// pengguna IPv6 — yang biasanya dapat satu /64 penuh — tidak bisa rotasi alamat
// untuk bypass limit. Tanpa ini, v8 memunculkan ERR_ERL_KEY_GEN_IPV6.
function getClientIp(req) {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown-ip';
  return ipKeyGenerator(ip);
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