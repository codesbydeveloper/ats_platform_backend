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

module.exports = { signIn, logOut };
