const pool = require('../config/database');

async function logActivity(message, options = {}) {
  const text = message != null ? String(message).trim() : '';
  if (!text) return;

  const entity_type =
    options.entityType != null ? String(options.entityType) : null;
  const entity_id =
    options.entityId != null && Number.isFinite(Number(options.entityId))
      ? Number(options.entityId)
      : null;

  try {
    await pool.execute(
      'INSERT INTO activity_logs (message, entity_type, entity_id) VALUES (?, ?, ?)',
      [text, entity_type, entity_id]
    );
  } catch (err) {
    console.error('Failed to write activity log:', err.message);
  }
}

module.exports = { logActivity };
