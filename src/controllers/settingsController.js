const pool = require('../config/database');

function toKey(v) {
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
    if (t === '') return null;
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return val;
}

function parseKeyList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  return s
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toEntries(body) {
  if (body == null) return [];

  // 1) Bulk array: { settings: [ { key, value }, ... ] } or { items: [...] }
  const list =
    (Array.isArray(body.settings) && body.settings) ||
    (Array.isArray(body.items) && body.items) ||
    (Array.isArray(body.data) && body.data) ||
    null;
  if (list) {
    return list
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const key = toKey(row.key);
        if (!key) return null;
        const value = Object.prototype.hasOwnProperty.call(row, 'value')
          ? row.value
          : Object.prototype.hasOwnProperty.call(row, 'data')
            ? row.data
            : undefined;
        if (value === undefined) return null;
        return { key, value };
      })
      .filter(Boolean);
  }

  // 2) Bulk object map: { values: { k1: v1, k2: v2 } } or { settings: { ... } }
  const map =
    (body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? body.values
      : null) ||
    (body.settings &&
    typeof body.settings === 'object' &&
    !Array.isArray(body.settings)
      ? body.settings
      : null);
  if (map) {
    return Object.entries(map)
      .map(([k, v]) => {
        const key = toKey(k);
        if (!key) return null;
        return { key, value: v };
      })
      .filter(Boolean);
  }

  // 3) Single: { key, value }
  const key = toKey(body.key);
  if (!key) return [];
  if (!Object.prototype.hasOwnProperty.call(body, 'value')) return [];
  return [{ key, value: body.value }];
}

function pickValueFromBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'value')) return body.value;
  if (Object.prototype.hasOwnProperty.call(body, 'data')) return body.data;
  if (Object.prototype.hasOwnProperty.call(body, 'setting')) return body.setting;
  return undefined;
}

const FULL_URL_KEYS = new Set(['login_logo_url', 'favicon_url']);

function absolutizeSettingValue(req, key, value) {
  if (!FULL_URL_KEYS.has(String(key))) return value;
  if (typeof value !== 'string') return value;
  const v = value.trim();
  if (!v) return value;
  if (/^https?:\/\//i.test(v)) return v;
  if (!v.startsWith('/')) return v;
  const proto =
    (req.headers['x-forwarded-proto']
      ? String(req.headers['x-forwarded-proto']).split(',')[0].trim()
      : '') || req.protocol;
  const host =
    (req.headers['x-forwarded-host']
      ? String(req.headers['x-forwarded-host']).split(',')[0].trim()
      : '') || req.get('host');
  return `${proto}://${host}${v}`;
}

async function getSettings(req, res) {
  const key = toKey(req.params.key ?? req.query.key);
  const keys = parseKeyList(req.query.keys);

  try {
    if (key) {
      const [rows] = await pool.execute(
        'SELECT `key`, `value` FROM settings WHERE `key` = ? LIMIT 1',
        [key]
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Setting not found', key });
      }
      const parsed = parseMaybeJson(rows[0].value);
      return res.json({
        key: rows[0].key,
        value: absolutizeSettingValue(req, rows[0].key, parsed),
      });
    }

    if (keys.length) {
      const uniq = [...new Set(keys)];
      const ph = uniq.map(() => '?').join(',');
      const [rows] = await pool.execute(
        `SELECT \`key\`, \`value\` FROM settings WHERE \`key\` IN (${ph}) ORDER BY id ASC`,
        uniq
      );
      const settings = rows.map((r) => ({
        key: r.key,
        value: absolutizeSettingValue(req, r.key, parseMaybeJson(r.value)),
      }));
      return res.json({ count: settings.length, settings });
    }

    const [rows] = await pool.execute(
      'SELECT `key`, `value` FROM settings ORDER BY id ASC'
    );
    const settings = rows.map((r) => ({
      key: r.key,
      value: absolutizeSettingValue(req, r.key, parseMaybeJson(r.value)),
    }));
    return res.json({ count: settings.length, settings });
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

async function upsertSetting(req, res) {
  const body = req.body || {};
  const entries = toEntries(body);
  if (entries.length === 0) {
    return res.status(400).json({
      error:
        'Send { key, value } OR { settings: [{ key, value }, ...] } OR { values: { key: value, ... } }',
    });
  }
  if (entries.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 settings per request' });
  }

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const { key, value } of entries) {
        const json = JSON.stringify(value);
        await conn.execute(
          `INSERT INTO settings (\`key\`, \`value\`)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
          [key, json]
        );
      }
      await conn.commit();
    } finally {
      conn.release();
    }

    return res.json({
      ok: true,
      count: entries.length,
      keys: entries.map((e) => e.key),
    });
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

async function upsertSettingImage(req, res) {
  const key = toKey(req.body?.key);
  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'image file is required (field: file)' });
  }

  try {
    // Ensure destination exists (multer should create, but be safe if storage changes).
    const rel = `/uploads/settings/${req.file.filename}`;
    const json = JSON.stringify(rel);

    await pool.execute(
      `INSERT INTO settings (\`key\`, \`value\`)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
      [key, json]
    );

    return res.json({ ok: true, key, value: rel });
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

module.exports = { getSettings, upsertSetting, upsertSettingImage };

