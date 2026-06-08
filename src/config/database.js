const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// Ensure DB "CURRENT_TIMESTAMP"/NOW() use Indian time (IST) for this app.
// TIMESTAMP columns are stored in UTC but converted using session time_zone.
pool.on('connection', (conn) => {
  conn
    .query("SET time_zone = '+05:30'")
    .catch(() => {});
});

module.exports = pool;
