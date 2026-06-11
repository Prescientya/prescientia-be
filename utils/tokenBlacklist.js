const redisClient = require('../config/redis');

const KEY_PREFIX = 'revoked_token:';
const PWD_CUTOFF_PREFIX = 'pwd_cutoff:';

// Batas atas masa hidup token (30 hari) — dipakai sebagai TTL default agar
// entry Redis hilang sendiri saat token tidak mungkin valid lagi.
const MAX_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Tandai sebuah JWT (berdasarkan claim `jti`) sebagai revoked di Redis.
 * TTL otomatis = sisa hidup token, jadi entry hilang sendirinya saat token
 * sudah expired alami — tidak perlu cleanup manual.
 *
 * PENTING: fungsi ini SENGAJA melempar error bila Redis gagal. Pemanggil
 * (mis. /auth/logout) harus tahu kalau revoke tidak berhasil, supaya tidak
 * membalas "logout sukses" padahal token masih hidup (logout palsu).
 *
 * @param {string} jti - JWT ID (claim `jti`)
 * @param {number} expSeconds - Sisa detik sebelum token expired
 */
async function revokeToken(jti, expSeconds) {
  if (!jti || typeof jti !== 'string') return;
  const ttl = Math.max(1, Math.floor(expSeconds || 60));
  await redisClient.setEx(KEY_PREFIX + jti, ttl, '1');
}

/**
 * Cek apakah JWT (via claim `jti`) sudah di-revoke.
 *
 * Melempar error bila Redis tak terjangkau — pemanggil (auth middleware)
 * memperlakukannya FAIL-CLOSED (tolak token). Lihat ensureNotRevoked.
 *
 * @param {string} jti
 * @returns {Promise<boolean>}
 */
async function isTokenRevoked(jti) {
  if (!jti || typeof jti !== 'string') return false;
  const exists = await redisClient.exists(KEY_PREFIX + jti);
  return exists === 1;
}

/**
 * Invalidasi SEMUA token milik satu user yang diterbitkan sebelum `cutoffSeconds`.
 * Dipakai saat password berubah (oleh user sendiri atau di-reset admin) sehingga
 * token lama di SEMUA perangkat tidak bisa dipakai lagi — menutup skenario
 * "akun dibajak lalu ganti password tapi token penyerang masih hidup 30 hari".
 *
 * Implementasi: simpan timestamp cutoff per user_id. Middleware menolak token
 * yang `iat` (issued-at) < cutoff. Reuse Redis (sudah jadi dependency), tanpa
 * migrasi schema dan tanpa perlu melacak setiap jti.
 *
 * @param {string|number} userId
 * @param {number} cutoffSeconds - epoch detik; token dengan iat < ini ditolak
 */
async function invalidateUserTokensBefore(userId, cutoffSeconds) {
  if (userId === undefined || userId === null) return;
  const cutoff = Math.floor(cutoffSeconds || Date.now() / 1000);
  await redisClient.setEx(
    PWD_CUTOFF_PREFIX + String(userId),
    MAX_TOKEN_TTL_SECONDS,
    String(cutoff)
  );
}

/**
 * Ambil cutoff invalidasi untuk satu user (epoch detik), atau null bila tak ada.
 * Melempar error bila Redis tak terjangkau (ditangani fail-closed oleh pemanggil).
 *
 * @param {string|number} userId
 * @returns {Promise<number|null>}
 */
async function getUserTokenCutoff(userId) {
  if (userId === undefined || userId === null) return null;
  const val = await redisClient.get(PWD_CUTOFF_PREFIX + String(userId));
  if (val === null || val === undefined) return null;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Periksa status sebuah token terdekode terhadap Redis:
 *   - blacklist per-`jti` (logout / revoke manual)
 *   - cutoff per-user (password berubah → token lama ditolak)
 *
 * Helper MURNI: tidak menyentuh req/res dan tidak menerapkan kebijakan
 * fail-open/closed — itu urusan pemanggil. MELEMPAR bila Redis tak terjangkau.
 *
 * @param {object} decoded - payload JWT terverifikasi
 * @returns {Promise<{ok: boolean, reason?: 'token_revoked'|'token_invalidated'}>}
 */
async function checkTokenState(decoded) {
  if (!decoded) return { ok: true };

  if (decoded.jti && (await isTokenRevoked(decoded.jti))) {
    return { ok: false, reason: 'token_revoked' };
  }

  if (decoded.user_id != null && decoded.iat != null) {
    const cutoff = await getUserTokenCutoff(decoded.user_id);
    if (cutoff != null && decoded.iat < cutoff) {
      return { ok: false, reason: 'token_invalidated' };
    }
  }

  return { ok: true };
}

module.exports = {
  revokeToken,
  isTokenRevoked,
  invalidateUserTokensBefore,
  getUserTokenCutoff,
  checkTokenState,
};
