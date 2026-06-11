// ============================================================
// PostgreSQL (pg) — commented out; switch back when needed
// ============================================================
/*
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

module.exports = pool;
*/

// ============================================================
// MySQL (mysql2) — active configuration
// ============================================================
const mysql = require('mysql2/promise');
require('dotenv').config();

const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  // 20 koneksi: cukup untuk burst absensi pagi (30–60 request paralel) tanpa exhaust
  // FOR UPDATE lock. Tiap koneksi yg tertahan menunggu lock = 1 connection occupied.
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 20,
  queueLimit: 0,
});

function pgToMySQL(text) {
  return text
    .replace(/\$\d+/g, '?')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/\s*COLLATE\s+"[^"]+"/g, '')
    .replace(/::(text|date|int|bigint|integer|timestamp|boolean|float|numeric|serial|varchar\(\d*\)?|varchar|char)/gi, '');
}

function inlineLimitOffset(sql, params) {
  const p = [...(params || [])];
  sql = sql.replace(/\bLIMIT\s+\?\s*(?:OFFSET\s+\?)?/gi, (match, offset, str) => {
    const before = str.substring(0, offset);
    const idx = (before.match(/\?/g) || []).length;
    const hasOffset = /OFFSET\s+\?/i.test(match);
    const limitVal  = parseInt(p[idx]) || 0;
    const offsetVal = hasOffset ? (parseInt(p[idx + 1]) || 0) : null;
    if (hasOffset) p.splice(idx, 2);
    else           p.splice(idx, 1);
    return hasOffset ? `LIMIT ${limitVal} OFFSET ${offsetVal}` : `LIMIT ${limitVal}`;
  });
  return { sql, params: p };
}

// Reorder params to match the positional order of $N occurrences in the SQL string.
// PostgreSQL uses named positional params ($1, $2, ...) which can appear in any order,
// but MySQL uses positional '?' which must match params index-by-index.
// Example: "UPDATE t SET col = $2 WHERE id = $1" with params [id, col]
//   $2 appears first → MySQL first '?' should get params[1] (col)
//   $1 appears second → MySQL second '?' should get params[0] (id)
function reorderParams(text, params) {
  if (!params || params.length === 0) return params;
  const order = [];
  text.replace(/\$(\d+)/g, (_, n) => {
    order.push(parseInt(n, 10) - 1);
  });
  if (order.length === 0) return params;
  return order.map(i => params[i]);
}

function normaliseRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const sample = rows[0];
  if (!Object.prototype.hasOwnProperty.call(sample, 'COUNT(*)')) return rows;
  return rows.map(row => {
    const copy = Object.assign({}, row);
    copy.count = copy['COUNT(*)'];
    delete copy['COUNT(*)'];
    return copy;
  });
}

// Konversi setiap field JS Date ke string lokal "YYYY-MM-DD" (kalau midnight) atau
// "YYYY-MM-DD HH:MM:SS" — mencegah timezone shift saat res.json() men-serialize
// Date jadi UTC ISO. Khusus dipakai untuk path RETURNING * (auto SELECT * yang
// di-trigger wrapper), di mana kita tidak bisa pasang DATE_FORMAT di SQL.
//
// Untuk SELECT biasa, gunakan DATE_FORMAT(...) langsung di query — itu lebih
// eksplisit dan tidak bergantung pada perilaku Date di JS runtime.
function localizeDateFields(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  return rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    const copy = {};
    for (const key in row) {
      const val = row[key];
      if (val instanceof Date && !isNaN(val.getTime())) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        const hh = String(val.getHours()).padStart(2, '0');
        const mm = String(val.getMinutes()).padStart(2, '0');
        const ss = String(val.getSeconds()).padStart(2, '0');
        // Heuristik: midnight → kolom DATE (return YYYY-MM-DD saja); selain itu
        // DATETIME/TIMESTAMP (return full). Edge case: DATETIME yang kebetulan
        // jam 00:00:00 akan ditampilkan sebagai DATE-only. Untuk schema saat ini,
        // hal itu tidak mengganggu konsumsi FE.
        if (hh === '00' && mm === '00' && ss === '00') {
          copy[key] = `${y}-${m}-${d}`;
        } else {
          copy[key] = `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
        }
      } else {
        copy[key] = val;
      }
    }
    return copy;
  });
}

function wrapResult(rows) {
  if (Array.isArray(rows)) {
    const normalised = normaliseRows(rows);
    return { rows: normalised, rowCount: normalised.length };
  }
  return {
    rows: [],
    rowCount: rows.affectedRows || 0,
    insertId: rows.insertId,
  };
}

async function runQuery(queryFn, text, params) {
  const retIdx = text.search(/\bRETURNING\b/i);
  if (retIdx === -1) {
    // Reorder params to match the order of $N occurrences in the SQL string before
    // converting to MySQL positional '?' — fixes out-of-order $N like "SET col=$2 WHERE id=$1"
    const reorderedParams = reorderParams(text, params);
    const converted = inlineLimitOffset(pgToMySQL(text), reorderedParams);
    const [rows] = await queryFn(converted.sql, converted.params);
    return wrapResult(rows);
  }
  const cleanText = text.substring(0, retIdx).trim();
  const reorderedReturningParams = reorderParams(cleanText, params);
  const converted = inlineLimitOffset(pgToMySQL(cleanText), reorderedReturningParams);
  const mysqlSql  = converted.sql;
  const cleanParams = converted.params;
  const [rows] = await queryFn(mysqlSql, cleanParams);
  const result  = wrapResult(rows);
  const insertMatch = cleanText.match(/^\s*INSERT\s+(?:INTO\s+)?`?(\w+)`?/i);
  if (insertMatch && result.insertId != null) {
    const table = insertMatch[1];
    const [sel] = await queryFn(`SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [result.insertId]);
    // BUG FIX timezone: SELECT * di sini auto-generate, tidak bisa pakai DATE_FORMAT
    // di SQL → localize JS Date di JS supaya tidak di-serialize sebagai UTC ISO.
    result.rows     = Array.isArray(sel) ? localizeDateFields(sel) : [];
    result.rowCount = result.rows.length;
    return result;
  }
  const updateMatch = cleanText.match(/^\s*UPDATE\s+`?(\w+)`?\s+SET\s+([\s\S]+?)\s+(WHERE\s+[\s\S]+)$/i);
  if (updateMatch) {
    const table     = updateMatch[1];
    const setPart   = updateMatch[2];
    const wherePart = updateMatch[3];
    const setNums   = [...setPart.matchAll(/\$(\d+)/g)].map(m => parseInt(m[1]));
    const maxSetN   = setNums.length ? Math.max(...setNums) : 0;
    const whereParams = cleanParams.slice(maxSetN);
    const [sel] = await queryFn(`SELECT * FROM \`${table}\` ${pgToMySQL(wherePart)}`, whereParams);
    // Sama dengan path INSERT di atas — SELECT * auto-generate, perlu localize Date.
    result.rows     = Array.isArray(sel) ? localizeDateFields(sel) : [];
    result.rowCount = result.rows.length;
    return result;
  }
  return result;
}

const pool = {
  query: async (text, params) => {
    return runQuery(mysqlPool.query.bind(mysqlPool), text, params);
  },
  connect: async () => {
    const conn = await mysqlPool.getConnection();
    const boundQuery = conn.query.bind(conn);
    return {
      query: async (text, params) => {
        return runQuery(boundQuery, text, params);
      },
      release: () => conn.release(),
      beginTransaction: () => conn.beginTransaction(),
      commit: () => conn.commit(),
      rollback: () => conn.rollback(),
      lastQuery: null,
    };
  },
};

module.exports = pool;
