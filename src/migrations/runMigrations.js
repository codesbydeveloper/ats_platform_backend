require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name varchar(255) NOT NULL,
        run_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const dir = path.join(__dirname, 'sql');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const [rows] = await conn.query(
        'SELECT 1 AS ok FROM schema_migrations WHERE name = ? LIMIT 1',
        [file]
      );
      if (rows.length) continue;

      const sql = fs.readFileSync(path.join(dir, file), 'utf8').trim();
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [
        file,
      ]);
      console.log('Applied:', file);
    }
    console.log('Migrations up to date.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
