// ============================================================
// PostgreSQL (pg) — active configuration
// ============================================================
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

// ============================================================
// MySQL (mysql2) — commented out; switch back when needed
// ============================================================
/*
const mysql = require('mysql2/promise');
require('dotenv').config();

const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
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
    const converted = inlineLimitOffset(pgToMySQL(text), params);
    const [rows] = await queryFn(converted.sql, converted.params);
    return wrapResult(rows);
  }
  const cleanText = text.substring(0, retIdx).trim();
  const converted = inlineLimitOffset(pgToMySQL(cleanText), params);
  const mysqlSql  = converted.sql;
  const cleanParams = converted.params;
  const [rows] = await queryFn(mysqlSql, cleanParams);
  const result  = wrapResult(rows);
  const insertMatch = cleanText.match(/^\s*INSERT\s+(?:INTO\s+)?`?(\w+)`?/i);
  if (insertMatch && result.insertId != null) {
    const table = insertMatch[1];
    const [sel] = await queryFn(`SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [result.insertId]);
    result.rows     = Array.isArray(sel) ? sel : [];
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
    result.rows     = Array.isArray(sel) ? sel : [];
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
      lastQuery: null,
    };
  },
};

module.exports = pool;
*/
