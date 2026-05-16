const bcrypt = require('bcryptjs');
const pool = require('../config/database');

const REQUIRED = ['name', 'email', 'password', 'number'];

async function createUser(req, res) {
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

  const name = String(body.name).trim();
  const email = String(body.email).trim().toLowerCase();
  const password = String(body.password);
  const number = String(body.number).trim();

  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, `number`) VALUES (?, ?, ?, ?)',
      [name, email, hash, number]
    );
    return res.status(201).json({
      id: result.insertId,
      name,
      email,
      number,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already registered' });
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

module.exports = { createUser };
