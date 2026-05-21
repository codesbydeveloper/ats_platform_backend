const pool = require('../config/database');

/** Maps lookup slug → teacher table column. */
const TEACHER_FIELD_BY_SLUG = {
  'educational-qualification': { column: 'qualification', type: 'scalar' },
  'qualification-certification': { column: 'certifications', type: 'scalar' },
  'subjects-taught': { column: 'subject_taught', type: 'scalar' },
  'boards-taught': { column: 'boards_taught', type: 'json_array' },
  'grades-taught': { column: 'grades_taught', type: 'json_array' },
  'state-wise': { column: 'state', type: 'scalar' },
  'city-wise': { column: 'city', type: 'scalar' },
  'area-of-interest': { column: 'area_of_interest', type: 'scalar' },
  'teacher-roles': { column: 'teacher_roles', type: 'json_array' },
};

function getTeacherFieldMeta(slug) {
  return TEACHER_FIELD_BY_SLUG[String(slug).trim().toLowerCase()] ?? null;
}

function parseJsonArray(val) {
  if (val == null) return [];
  let raw = val;
  if (typeof val === 'string') {
    try {
      raw = JSON.parse(val);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

/** One row per teacher (same city/subject appears on multiple rows — not merged). */
async function listScalarFieldRows(column, page, limit, q) {
  const col = column;
  let where = `WHERE ${col} IS NOT NULL AND TRIM(${col}) <> ''`;
  const params = [];
  if (q) {
    where += ` AND TRIM(${col}) LIKE ?`;
    params.push(`%${q}%`);
  }

  const [[countRow]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM teachers ${where}`,
    params
  );
  const total = Number(countRow.total) || 0;
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT id AS teacher_id, name AS teacher_name, TRIM(${col}) AS field_value
     FROM teachers ${where}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    total,
    options: rows.map((r) => ({
      id: String(r.teacher_id),
      teacher_id: r.teacher_id,
      teacher_name: r.teacher_name,
      name: r.field_value,
      value: r.field_value,
    })),
  };
}

/** One row per teacher per array item (e.g. two boards → two rows). */
async function listJsonArrayFieldRows(column, page, limit, q) {
  const [rows] = await pool.execute(
    `SELECT id AS teacher_id, name AS teacher_name, ${column} AS raw
     FROM teachers
     WHERE ${column} IS NOT NULL`
  );

  const qLower = q ? q.toLowerCase() : '';
  const expanded = [];
  for (const row of rows) {
    const items = parseJsonArray(row.raw);
    if (items.length === 0) continue;
    for (const fieldValue of items) {
      if (qLower && !fieldValue.toLowerCase().includes(qLower)) continue;
      expanded.push({
        teacher_id: row.teacher_id,
        teacher_name: row.teacher_name,
        field_value: fieldValue,
      });
    }
  }

  expanded.sort((a, b) => b.teacher_id - a.teacher_id);
  const total = expanded.length;
  const offset = (page - 1) * limit;
  const slice = expanded.slice(offset, offset + limit);

  return {
    total,
    options: slice.map((r) => ({
      id: `${r.teacher_id}-${slugifyPart(r.field_value)}`,
      teacher_id: r.teacher_id,
      teacher_name: r.teacher_name,
      name: r.field_value,
      value: r.field_value,
    })),
  };
}

function slugifyPart(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Paginated rows: each teacher (and each JSON chip) is its own entry — duplicates not merged.
 */
async function getDistinctTeacherFieldValues(slug, page, limit, q) {
  const meta = getTeacherFieldMeta(slug);
  if (!meta) {
    return { error: 'This field is not linked to teacher data' };
  }

  if (meta.type === 'json_array') {
    return {
      ...(await listJsonArrayFieldRows(meta.column, page, limit, q)),
      data_source: 'teachers',
      list_mode: 'per_teacher',
    };
  }
  return {
    ...(await listScalarFieldRows(meta.column, page, limit, q)),
    data_source: 'teachers',
    list_mode: 'per_teacher',
  };
}

function buildTeacherFilterForLookup(slug, value, teacherId) {
  const meta = getTeacherFieldMeta(slug);
  if (!meta) {
    return { error: 'Invalid lookup field' };
  }

  const tid =
    teacherId != null && String(teacherId).trim() !== ''
      ? parseInt(String(teacherId), 10)
      : null;
  if (tid != null && Number.isFinite(tid) && tid > 0) {
    return { where: 'id = ?', params: [tid] };
  }

  if (value == null || String(value).trim() === '') {
    return { error: 'value or teacher_id query param is required' };
  }
  const v = String(value).trim();
  if (meta.type === 'json_array') {
    return {
      where: `JSON_CONTAINS(COALESCE(${meta.column}, JSON_ARRAY()), JSON_QUOTE(?))`,
      params: [v],
    };
  }
  return {
    where: `TRIM(${meta.column}) = ?`,
    params: [v],
  };
}

module.exports = {
  TEACHER_FIELD_BY_SLUG,
  getTeacherFieldMeta,
  getDistinctTeacherFieldValues,
  buildTeacherFilterForLookup,
};
