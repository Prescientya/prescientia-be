/**
 * Scan all .js files for out-of-order $N parameters in pool.query / client.query calls.
 * Bug: PostgreSQL uses named positional params ($1, $2 can be in any order),
 * but after pgToMySQL conversion, MySQL uses positional '?' — so params must be reordered.
 * This script finds all SQL strings where a higher $N appears before a lower one.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = ['node_modules', '.git', 'documentation'];
const bugs = [];
const warnings = [];

function analyseSQL(sql, filePath, lineNum) {
  const nums = [];
  sql.replace(/\$(\d+)/g, (_, n) => nums.push(parseInt(n, 10)));
  if (nums.length === 0) return;

  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const shortSQL = sql.replace(/\s+/g, ' ').trim().substring(0, 140);

  // Check if any $N appears out of ascending order
  let outOfOrder = false;
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] > nums[i + 1]) {
      outOfOrder = true;
      break;
    }
  }

  if (outOfOrder) {
    bugs.push({ file: relPath, line: lineNum, nums: nums.join(','), sql: shortSQL });
  }

  // Also warn about $N that skip numbers (e.g., $1, $3 but no $2) — possible typo
  const maxN = Math.max(...nums);
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  for (let i = 1; i <= maxN; i++) {
    if (!unique.includes(i)) {
      warnings.push({ file: relPath, line: lineNum, missing: i, sql: shortSQL });
    }
  }
}

function scanFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');

  // Strategy: extract string literals passed as first arg to pool/client.query
  // We handle: single-line strings and template literals (possibly multi-line)
  // Regex: matches the opening of a query call, then captures the string
  const re = /(?:pool|client)\.query\s*\(\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const lineNum = src.substring(0, m.index).split('\n').length;
    const rest = src.substring(m.index + m[0].length);

    let sql = null;
    if (rest[0] === '`') {
      // template literal — find matching closing backtick
      const close = rest.indexOf('`', 1);
      if (close !== -1) sql = rest.substring(1, close);
    } else if (rest[0] === "'") {
      const close = rest.indexOf("'", 1);
      if (close !== -1) sql = rest.substring(1, close);
    } else if (rest[0] === '"') {
      const close = rest.indexOf('"', 1);
      if (close !== -1) sql = rest.substring(1, close);
    }

    if (sql !== null) {
      analyseSQL(sql, filePath, lineNum);
    }
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.some(s => entry.name === s)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.min.js')) scanFile(full);
  }
}

walk(ROOT);

console.log('\n=== SCAN RESULTS ===\n');

if (bugs.length === 0) {
  console.log('✓ No out-of-order $N parameters found!\n');
} else {
  console.log(`✗ ${bugs.length} OUT-OF-ORDER $N ISSUE(S) FOUND:\n`);
  bugs.forEach(b => {
    console.log(`  [${b.file}:${b.line}]`);
    console.log(`  Order: $${b.nums}`);
    console.log(`  SQL:   ${b.sql}`);
    console.log('');
  });
}

if (warnings.length > 0) {
  console.log(`⚠  ${warnings.length} SKIPPED $N NUMBER(S) (possible typo):\n`);
  warnings.forEach(w => {
    console.log(`  [${w.file}:${w.line}] missing $${w.missing} in: ${w.sql}`);
  });
  console.log('');
}
