const { setCache, cacheExists } = require('./redisHelper');

const KEY_PREFIX = 'revoked_token:';

/**
 * Tandai sebuah JWT (berdasarkan claim `jti`) sebagai revoked di Redis.
 * TTL otomatis = sisa hidup token, jadi entry hilang sendirinya saat token
 * sudah expired alami — tidak perlu cleanup manual.
 *
 * @param {string} jti - JWT ID (claim `jti`)
 * @param {number} expSeconds - Sisa detik sebelum token expired
 */
async function revokeToken(jti, expSeconds) {
  if (!jti || typeof jti !== 'string') return;
  const ttl = Math.max(1, Math.floor(expSeconds || 60));
  await setCache(KEY_PREFIX + jti, '1', ttl);
}

/**
 * Cek apakah JWT (via claim `jti`) sudah di-revoke.
 * @param {string} jti
 * @returns {Promise<boolean>}
 */
async function isTokenRevoked(jti) {
  if (!jti || typeof jti !== 'string') return false;
  return await cacheExists(KEY_PREFIX + jti);
}

module.exports = { revokeToken, isTokenRevoked };
