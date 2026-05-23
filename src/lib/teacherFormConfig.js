const pool = require('../config/database');
const { defaultTeacherFormConfig } = require('../data/defaultTeacherFormConfig');

const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'email',
  'tel',
  'select',
  'multiselect',
  'date',
  'boolean',
  'work_experience',
]);

function slugifyId(raw, fallback = 'item') {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || `${fallback}-${Date.now()}`;
}

function normalizeField(field, sortOrder = 0) {
  const key = slugifyId(field.key || field.id, 'field').replace(/-/g, '_');
  const id = slugifyId(field.id || key, 'field');
  const type = FIELD_TYPES.has(field.type) ? field.type : 'text';
  return {
    id,
    key,
    label: String(field.label || key).trim(),
    type,
    required: Boolean(field.required),
    builtIn: Boolean(field.builtIn),
    mapsTo: field.mapsTo != null ? String(field.mapsTo) : null,
    options: Array.isArray(field.options)
      ? field.options.map((o) => String(o).trim()).filter(Boolean)
      : [],
    sortOrder: Number.isFinite(Number(field.sortOrder))
      ? Number(field.sortOrder)
      : sortOrder,
  };
}

function normalizeSection(section, sortOrder = 0) {
  const id = slugifyId(section.id || section.title, 'section');
  const fields = Array.isArray(section.fields) ? section.fields : [];
  return {
    id,
    title: String(section.title || id).trim(),
    description:
      section.description != null ? String(section.description) : null,
    sortOrder: Number.isFinite(Number(section.sortOrder))
      ? Number(section.sortOrder)
      : sortOrder,
    builtIn: Boolean(section.builtIn),
    component: section.component != null ? String(section.component) : null,
    fields: fields.map((f, i) => normalizeField(f, i)),
  };
}

function normalizeConfig(config) {
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  const keys = new Set();
  const normalized = {
    version: Number(config?.version) || 1,
    sections: sections.map((s, i) => {
      const sec = normalizeSection(s, i);
      for (const f of sec.fields) {
        if (keys.has(f.key)) {
          throw new Error(`Duplicate field key: ${f.key}`);
        }
        keys.add(f.key);
      }
      return sec;
    }),
  };
  normalized.sections.sort((a, b) => a.sortOrder - b.sortOrder);
  for (const sec of normalized.sections) {
    sec.fields.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return normalized;
}

function parseConfigRow(row) {
  if (!row) return null;
  let raw = row.config;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  return normalizeConfig(raw);
}

async function loadTeacherFormConfig() {
  try {
    const [rows] = await pool.execute(
      'SELECT config FROM teacher_form_config WHERE id = 1 LIMIT 1'
    );
    const parsed = parseConfigRow(rows[0]);
    if (parsed) return parsed;
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      throw err;
    }
  }

  const seeded = normalizeConfig(defaultTeacherFormConfig);
  await saveTeacherFormConfig(seeded);
  return seeded;
}

async function saveTeacherFormConfig(config) {
  const normalized = normalizeConfig(config);
  const json = JSON.stringify(normalized);
  await pool.execute(
    `INSERT INTO teacher_form_config (id, config) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE config = VALUES(config)`,
    [json]
  );
  return normalized;
}

function findSection(config, sectionId) {
  return config.sections.find((s) => s.id === sectionId);
}

function findField(config, fieldKey) {
  for (const sec of config.sections) {
    const hit = sec.fields.find((f) => f.key === fieldKey || f.id === fieldKey);
    if (hit) return { section: sec, field: hit };
  }
  return null;
}

module.exports = {
  FIELD_TYPES,
  slugifyId,
  normalizeConfig,
  loadTeacherFormConfig,
  saveTeacherFormConfig,
  findSection,
  findField,
  defaultTeacherFormConfig,
};
