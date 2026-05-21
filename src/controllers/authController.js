const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { getJwtSecret } = require('../lib/jwtSecret');

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

module.exports = { signIn, logOut, getMe, updateProfile, changePassword };
