const pool = require('../config/database');

function formatActivityTime(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}, ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function formatTeacherCode(id) {
  return `TCH-${String(id).padStart(5, '0')}`;
}

async function getDashboard(req, res) {
  const recentLimit = Math.min(
    20,
    Math.max(1, parseInt(String(req.query.recent_limit ?? '10'), 10) || 10)
  );
  const activityLimit = Math.min(
    50,
    Math.max(1, parseInt(String(req.query.activity_limit ?? '10'), 10) || 10)
  );

  try {
    const [[statsRow]] = await pool.execute(`
      SELECT
        COUNT(*) AS total_teachers,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_teachers,
        0 AS unique_subjects,
        SUM(CASE WHEN resume_path IS NOT NULL AND resume_path != '' THEN 1 ELSE 0 END) AS resumes_on_file
      FROM teachers
    `);

    const [[growthRow]] = await pool.execute(`
      SELECT
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS last_30,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)
          AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS prev_30
      FROM teachers
    `);

    const last30 = Number(growthRow.last_30) || 0;
    const prev30 = Number(growthRow.prev_30) || 0;
    let total_teachers_change_percent = 0;
    if (prev30 > 0) {
      total_teachers_change_percent =
        Math.round(((last30 - prev30) / prev30) * 1000) / 10;
    } else if (last30 > 0) {
      total_teachers_change_percent = 100;
    }

    const [recentRows] = await pool.query(
      `SELECT id, name, status, created_at, subjects_taught
       FROM teachers
       ORDER BY created_at DESC
       LIMIT ?`,
      [recentLimit]
    );

    const recent_teachers = recentRows.map((r) => ({
      teacher_id: formatTeacherCode(r.id),
      id: r.id,
      name: r.name,
      subject: (() => {
        try {
          const raw = r.subjects_taught;
          const arr =
            raw == null
              ? []
              : Array.isArray(raw)
                ? raw
                : typeof raw === 'string'
                  ? JSON.parse(raw)
                  : [];
          return Array.isArray(arr)
            ? arr.map((x) => String(x).trim()).filter(Boolean).join(', ')
            : '';
        } catch {
          return '';
        }
      })(),
      status: r.status || 'active',
      created_at: r.created_at,
      time_label: formatActivityTime(r.created_at),
    }));

    let activity_logs = [];
    try {
      const [logRows] = await pool.query(
        `SELECT id, message, entity_type, entity_id, created_at
         FROM activity_logs
         ORDER BY created_at DESC
         LIMIT ?`,
        [activityLimit]
      );
      activity_logs = logRows.map((r) => ({
        id: r.id,
        message: r.message,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        created_at: r.created_at,
        time_label: formatActivityTime(r.created_at),
      }));
    } catch (logErr) {
      if (logErr.code !== 'ER_NO_SUCH_TABLE') throw logErr;
    }

    return res.json({
      stats: {
        total_teachers: Number(statsRow.total_teachers) || 0,
        active_teachers: Number(statsRow.active_teachers) || 0,
        unique_subjects: Number(statsRow.unique_subjects) || 0,
        resumes_on_file: Number(statsRow.resumes_on_file) || 0,
        total_teachers_change_percent,
        total_teachers_change_label:
          total_teachers_change_percent >= 0
            ? `+${total_teachers_change_percent}% vs last cycle`
            : `${total_teachers_change_percent}% vs last cycle`,
      },
      recent_teachers,
      activity_logs,
    });
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

module.exports = { getDashboard };
