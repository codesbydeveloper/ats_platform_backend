const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { getJwtSecret } = require('../lib/jwtSecret');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const REQUIRED = ['email', 'password'];

async function signIn(req, res) {
  const body = req.body || {};
  const missing = REQUIRED.filter(
    (k) => body[k] == null || String(body[k]).trim() === ''
  );
  if (missing.length) {
    return res.status(400).json({
      error: 'Missing required fields',
      fields: missing,
    });
  }

  const secret = getJwtSecret();
  if (!secret) {
    return res.status(500).json({
      error: 'Server misconfigured: JWT_SECRET is required',
    });
  }

  const email = String(body.email).trim().toLowerCase();
  const password = String(body.password);

  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, `number`, password, token_version FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res
        .status(401)
        .json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res
        .status(401)
        .json({ error: 'Invalid email or password' });
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const tv = Number(user.token_version) || 0;
    const token = jwt.sign(
      { sub: user.id, email: user.email, tv },
      secret,
      { expiresIn }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        number: user.number,
      },
    });
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function logOut(req, res) {
  try {
    const [result] = await pool.execute(
      'UPDATE users SET token_version = token_version + 1 WHERE id = ? AND token_version = ?',
      [req.auth.userId, req.auth.tv]
    );
    if (result.affectedRows === 0) {
      return res
        .status(401)
        .json({ error: 'Session ended. Please sign in again.' });
    }
    return res.json({ ok: true, message: 'Signed out' });
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    number: row.number,
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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
  const uniq = [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))];
  if (!uniq.length) return {};
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

async function sendOtpEmail(toEmail, otp) {
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
    throw new Error('SMTP not configured (missing smtp_host in settings)');
  }
  if (String(s.smtp_password_set) === '0') {
    throw new Error('SMTP password not set (smtp_password_set = 0)');
  }

  const cfg = smtpTransportConfig(s);
  const transporter = nodemailer.createTransport(cfg);
  const fromEmail = toStr(s.smtp_from_email || s.smtp_username || '');
  const fromName = toStr(s.smtp_from_name || 'ATS');
  const from = fromEmail ? `${fromName} <${fromEmail}>` : fromName;

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'Your password reset OTP',
    text: `Your OTP is: ${otp}\n\nIt will expire in 10 minutes.`,
  });
}

function generateOtp() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

async function forgotPassword(req, res) {
  const email = toStr(req.body?.email).toLowerCase();
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, reset_otp_sent_at FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    // Always return ok=true to avoid email enumeration.
    if (!rows.length) {
      return res.json({ ok: true, message: 'If the email exists, OTP was sent' });
    }

    const user = rows[0];
    if (user.reset_otp_sent_at) {
      const last = new Date(user.reset_otp_sent_at);
      if (!Number.isNaN(last.getTime())) {
        const diffMs = Date.now() - last.getTime();
        if (diffMs < 30_000) {
          return res.status(429).json({
            error: 'OTP already sent recently. Please wait 30 seconds.',
          });
        }
      }
    }

    const otp = generateOtp();
    const hash = await bcrypt.hash(otp, 10);
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    await pool.execute(
      `UPDATE users
       SET reset_otp_hash = ?,
           reset_otp_expires_at = ?,
           reset_otp_attempts = 0,
           reset_otp_sent_at = ?
       WHERE id = ?`,
      [hash, expires, new Date(), user.id]
    );

    await sendOtpEmail(email, otp);
    return res.json({ ok: true, message: 'If the email exists, OTP was sent' });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(503).json({
        error: 'Database schema outdated. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function resetPasswordWithOtp(req, res) {
  const email = toStr(req.body?.email).toLowerCase();
  const otp = toStr(req.body?.otp ?? req.body?.code);
  const newPassword = toStr(req.body?.new_password ?? req.body?.newPassword);

  const missing = [
    ...(!email ? ['email'] : []),
    ...(!otp ? ['otp'] : []),
    ...(!newPassword ? ['new_password'] : []),
  ];
  if (missing.length) {
    return res.status(400).json({ error: 'Missing required fields', fields: missing });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (otp.length < 4 || otp.length > 12) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, password, reset_otp_hash, reset_otp_expires_at, reset_otp_attempts
       FROM users
       WHERE email = ? LIMIT 1`,
      [email]
    );
    if (!rows.length) {
      return res.status(400).json({ error: 'Invalid OTP or expired' });
    }

    const u = rows[0];
    if (!u.reset_otp_hash || !u.reset_otp_expires_at) {
      return res.status(400).json({ error: 'Invalid OTP or expired' });
    }
    const exp = new Date(u.reset_otp_expires_at);
    if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP expired' });
    }
    const attempts = Number(u.reset_otp_attempts) || 0;
    if (attempts >= 5) {
      return res.status(400).json({ error: 'Too many attempts. Request a new OTP.' });
    }

    const ok = await bcrypt.compare(otp, u.reset_otp_hash);
    if (!ok) {
      await pool.execute(
        'UPDATE users SET reset_otp_attempts = reset_otp_attempts + 1 WHERE id = ?',
        [u.id]
      );
      return res.status(400).json({ error: 'Invalid OTP or expired' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      `UPDATE users
       SET password = ?,
           token_version = token_version + 1,
           reset_otp_hash = NULL,
           reset_otp_expires_at = NULL,
           reset_otp_attempts = 0,
           reset_otp_sent_at = NULL
       WHERE id = ?`,
      [hash, u.id]
    );

    return res.json({ ok: true, message: 'Password reset successful' });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(503).json({
        error: 'Database schema outdated. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function getMe(req, res) {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, `number` FROM users WHERE id = ? LIMIT 1',
      [req.auth.userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: publicUser(rows[0]) });
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

async function updateProfile(req, res) {
  const body = req.body || {};
  const name = body.name != null ? String(body.name).trim() : '';
  const email =
    body.email != null ? String(body.email).trim().toLowerCase() : '';

  const fields = [];
  if (!name || name.length < 2) fields.push('name');
  if (!email || !isValidEmail(email)) fields.push('email');
  if (fields.length) {
    return res.status(400).json({
      error: 'Invalid profile fields',
      fields,
      detail:
        fields.includes('name') && fields.includes('email')
          ? 'Name must be at least 2 characters and email must be valid'
          : fields.includes('name')
            ? 'Display name must be at least 2 characters'
            : 'Enter a valid email address',
    });
  }

  try {
    const [dup] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
      [email, req.auth.userId]
    );
    if (dup.length) {
      return res.status(409).json({ error: 'Email is already in use' });
    }

    const [result] = await pool.execute(
      'UPDATE users SET name = ?, email = ? WHERE id = ?',
      [name, email, req.auth.userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [rows] = await pool.execute(
      'SELECT id, name, email, `number` FROM users WHERE id = ? LIMIT 1',
      [req.auth.userId]
    );
    return res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email is already in use' });
    }
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function changePassword(req, res) {
  const body = req.body || {};
  const currentPassword =
    body.currentPassword != null
      ? String(body.currentPassword)
      : body.current_password != null
        ? String(body.current_password)
        : '';
  const newPassword =
    body.newPassword != null
      ? String(body.newPassword)
      : body.new_password != null
        ? String(body.new_password)
        : '';

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error: 'Current password and new password are required',
      fields: [
        ...(!currentPassword ? ['currentPassword'] : []),
        ...(!newPassword ? ['newPassword'] : []),
      ],
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      error: 'New password must be at least 6 characters',
    });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      error: 'New password must be different from your current password',
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT password FROM users WHERE id = ? LIMIT 1',
      [req.auth.userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const match = await bcrypt.compare(currentPassword, rows[0].password);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [
      hash,
      req.auth.userId,
    ]);

    return res.json({ ok: true, message: 'Password updated' });
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

module.exports = {
  signIn,
  logOut,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPasswordWithOtp,
};
