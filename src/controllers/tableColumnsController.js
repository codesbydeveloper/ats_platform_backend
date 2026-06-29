const pool = require('../config/database');

function toStr(v) {
  if (v == null) return '';
  return String(v).trim();
}

function parseMaybeJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    try {
      return JSON.parse(val.toString('utf8'));
    } catch {
      return null;
    }
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return val;
}

function normalizeColumns(input) {
  const raw = Array.isArray(input) ? input : [];
  const cols = raw.map((x) => toStr(x)).filter(Boolean);
  // de-dupe while preserving order
  const seen = new Set();
  const uniq = [];
  for (const c of cols) {
    if (seen.has(c)) continue;
    seen.add(c);
    uniq.push(c);
  }
  return uniq;
}

function allowedTableName(t) {
  const name = toStr(t).toLowerCase();
  // Keep tight so we don't store arbitrary keys.
  if (name === 'teachers') return 'teachers';
  return '';
}

async function getTableColumns(req, res) {
  const table = allowedTableName(req.params.tableName);
  if (!table) {
    return res.status(400).json({ error: 'Invalid table_name' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT `columns` FROM table_columns WHERE table_name = ? LIMIT 1',
      [table]
    );
    const val = rows && rows.length ? parseMaybeJson(rows[0].columns) : null;
    const columns = Array.isArray(val) ? normalizeColumns(val) : [];
    return res.json({ table_name: table, columns });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function upsertTableColumns(req, res) {
  const table = allowedTableName(req.params.tableName);
  if (!table) {
    return res.status(400).json({ error: 'Invalid table_name' });
  }

  const body = req.body || {};
  const columnsRaw =
    body.columns ?? body.fields ?? body.selected_columns ?? body.selectedColumns;
  const columns = normalizeColumns(columnsRaw);
  if (columns.length > 250) {
    return res
      .status(400)
      .json({ error: 'Too many columns (max 250)' });
  }

  try {
    await pool.execute(
      `INSERT INTO table_columns (table_name, \`columns\`)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`columns\` = VALUES(\`columns\`)`,
      [table, JSON.stringify(columns)]
    );
    return res.json({ table_name: table, columns });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getTableColumns, upsertTableColumns };

