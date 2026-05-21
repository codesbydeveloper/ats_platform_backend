const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { getJwtSecret } = require('../lib/jwtSecret');

async function requireAuth(req, res, next) {
  const secret = getJwtSecret();
  if (!secret) {
    return res.status(500).json({
      error: 'Server misconfigured: JWT_SECRET is required',
    });
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization Bearer token required' });
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authorization Bearer token required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired. Please sign in again.',
        code: 'token_expired',
      });
    }
    return res.status(401).json({
      error: 'Invalid token. Please sign in again.',
      code: 'token_invalid',
      detail:
        err.name === 'JsonWebTokenError'
          ? 'Token was signed with a different secret or is malformed.'
          : undefined,
    });
  }

  const userId = payload.sub;
  const tv = payload.tv != null ? Number(payload.tv) : 0;

  if (!userId) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT token_version FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const row = rows[0];
    if (!row || Number(row.token_version) !== tv) {
      return res
        .status(401)
        .json({ error: 'Session ended. Please sign in again.' });
    }
    req.auth = { userId, email: payload.email, tv };
    return next();
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

module.exports = { requireAuth };
