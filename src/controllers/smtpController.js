const nodemailer = require('nodemailer');
const pool = require('../config/database');

function toStr(v, fallback = '') {
  if (v == null) return fallback;
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

async function loadSettings(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return {};
  const uniq = [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))];
  if (uniq.length === 0) return {};
  const ph = uniq.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT \`key\`, \`value\` FROM settings WHERE \`key\` IN (${ph})`,
    uniq
  );
  const out = {};
  for (const r of rows) {
    out[String(r.key)] = parseMaybeJson(r.value);
  }
  return out;
}

function smtpTransportConfig(s) {
  const host = toStr(s.smtp_host ?? s.host);
  const port = parseInt(String(s.smtp_port ?? s.port ?? ''), 10);
  const user = toStr(s.smtp_username ?? s.username ?? s.user);
  const pass = toStr(s.smtp_password ?? s.password ?? s.pass);

  const enc = toStr(s.smtp_encryption ?? s.encryption).toLowerCase();
  const secure = port === 465 || enc === 'ssl' || enc === 'smtps';

  const requireTLS = !secure && (enc === 'tls' || enc === 'starttls');

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    requireTLS,
    auth: user ? { user, pass } : undefined,
  };
}

async function sendSmtpTestEmail(req, res) {
  const email =
    toStr(req.body?.email ?? req.body?.to ?? req.query?.email ?? req.query?.to);
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const s = await loadSettings([
      'smtp_host',
      'smtp_port',
      'smtp_username',
      'smtp_password',
      'smtp_encryption',
      'smtp_from_email',
      'smtp_from_name',
      'smtp_password_set',
    ]);

    const host = toStr(s.smtp_host);
    if (!host) {
      return res.status(400).json({
        error: 'SMTP not configured (missing smtp_host in settings)',
      });
    }

    if (String(s.smtp_password_set) === '0') {
      return res.status(400).json({
        error: 'SMTP password not set (smtp_password_set = 0)',
      });
    }

    const cfg = smtpTransportConfig(s);
    const transporter = nodemailer.createTransport(cfg);

    const fromEmail = toStr(s.smtp_from_email || s.smtp_username || '');
    const fromName = toStr(s.smtp_from_name || 'ATS');
    const from = fromEmail ? `${fromName} <${fromEmail}>` : fromName;

    const info = await transporter.sendMail({
      from,
      to: email,
      subject: 'SMTP Test Email',
      text: `SMTP test email sent at ${new Date().toISOString()}`,
    });

    return res.json({
      ok: true,
      to: email,
      message_id: info.messageId || null,
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    // Avoid leaking credentials; return compact failure.
    console.error(err);
    return res.status(500).json({
      error: 'Could not send test email',
      detail: err && err.message ? String(err.message) : 'Unknown error',
    });
  }
}

module.exports = { sendSmtpTestEmail };

