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
  'countries_states_cities',
  'countries',
  'indian_states',
  'indian_cities',
]);

const FIELD_TYPE_ALIASES = {
  dropdown: 'select',
  'multi-select': 'multiselect',
  multi_select: 'multiselect',
  yes_no: 'boolean',
  'yes-no': 'boolean',
  checkbox: 'boolean',
  work_experience_block: 'work_experience',
  long_text: 'textarea',
};

const TEACHER_ROLE_KEY_RE = /^(teacher_role|teacher_roles|role)(_|$|$)/i;

function slugifyId(raw, fallback = 'item') {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || `${fallback}-${Date.now()}`;
}

function normalizeFilterFlag(val) {
  if (val === true) return 1;
  if (val === false || val == null) return 0;
  const n = parseInt(String(val), 10);
  return n === 1 ? 1 : 0;
}

function parseOptionsInput(raw) {
  if (Array.isArray(raw)) {
    return raw.map((o) => String(o).trim()).filter(Boolean);
  }
  if (raw != null && String(raw).trim() !== '') {
    return String(raw)
      .split(/[,;\n]+/)
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeFieldKey(raw, label) {
  const src =
    raw != null && String(raw).trim() !== ''
      ? String(raw).trim()
      : String(label || '').trim();
  if (!src || src.includes(',')) return '';
  return src
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function resolveFieldType(rawType) {
  const raw = String(rawType || 'text')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/\//g, '_');
  if (FIELD_TYPES.has(raw)) return raw;
  if (FIELD_TYPE_ALIASES[raw]) return FIELD_TYPE_ALIASES[raw];
  return null;
}

function isTeacherRoleField(key, label) {
  const k = String(key || '').toLowerCase();
  const l = String(label || '').toLowerCase();
  if (TEACHER_ROLE_KEY_RE.test(k)) return true;
  return l === 'teacher role' || l === 'teacher roles';
}

function applyFieldTypeRules(field) {
  const next = { ...field };
  let type = resolveFieldType(next.type) || next.type;

  if (isTeacherRoleField(next.key, next.label)) {
    type = 'multiselect';
    next.categorySlug = next.categorySlug || 'teacher-roles';
  } else if (next.key === 'country' || next.key === 'countries') {
    if (!type || type === 'text') type = 'countries';
  } else if (next.key === 'state' || String(next.key).endsWith('_state')) {
    if (!type || type === 'text') type = 'indian_states';
  } else if (next.key === 'city' || String(next.key).endsWith('_city')) {
    if (!type || type === 'text') type = 'indian_cities';
  }

  if (!resolveFieldType(type)) {
    type = 'text';
  }

  next.type = type;
  return next;
}

function fieldToApi(field) {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    sortOrder: field.sortOrder,
    filter: field.filter,
    builtIn: Boolean(field.builtIn),
    builtin: Boolean(field.builtIn),
    mapsTo: field.mapsTo,
    mapTo: field.mapsTo,
    options: Array.isArray(field.options) ? field.options : [],
    categorySlug: field.categorySlug ?? null,
  };
}

function normalizeField(field, sortOrder = 0) {
  const label = String(field.label ?? field.name ?? '').trim();
  const key =
    normalizeFieldKey(field.key, label) ||
    slugifyId(field.key || field.id, 'field').replace(/-/g, '_');
  const id = slugifyId(field.id || key, 'field');

  let normalized = applyFieldTypeRules({
    id,
    key,
    label: label || key || 'Field',
    type: resolveFieldType(field.type) || String(field.type || 'text'),
    required: Boolean(field.required ?? field.is_required),
    filter: normalizeFilterFlag(field.filter),
    builtIn: Boolean(field.builtIn ?? field.builtin),
    mapsTo:
      field.mapsTo != null
        ? String(field.mapsTo)
        : field.mapTo != null
          ? String(field.mapTo)
          : null,
    options: parseOptionsInput(field.options ?? field.choices),
    categorySlug:
      field.categorySlug != null
        ? String(field.categorySlug)
        : field.category_slug != null
          ? String(field.category_slug)
          : null,
    sortOrder: Number.isFinite(Number(field.sortOrder ?? field.sort_order))
      ? Number(field.sortOrder ?? field.sort_order)
      : sortOrder,
  });

  return fieldToApi(normalized);
}

function normalizeSection(section, sortOrder = 0) {
  const id = slugifyId(section.id || section.title, 'section');
  const fields = Array.isArray(section.fields) ? section.fields : [];
  return {
    id,
    title: String(section.title || section.name || id).trim(),
    description:
      section.description != null ? String(section.description) : null,
    sortOrder: Number.isFinite(Number(section.sortOrder ?? section.sort_order))
      ? Number(section.sortOrder ?? section.sort_order)
      : sortOrder,
    builtIn: Boolean(section.builtIn ?? section.builtin),
    system: Boolean(section.system ?? section.builtIn ?? section.builtin),
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
      'SELECT config, updated_at FROM teacher_form_config WHERE id = 1 LIMIT 1'
    );
    const parsed = parseConfigRow(rows[0]);
    if (parsed) {
      const saved = await saveTeacherFormConfig(parsed);
      return {
        ...saved,
        updatedAt: rows[0]?.updated_at
          ? new Date(rows[0].updated_at).toISOString()
          : undefined,
      };
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      throw err;
    }
  }

  const seeded = normalizeConfig(defaultTeacherFormConfig);
  return saveTeacherFormConfig(seeded);
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
  FIELD_TYPE_ALIASES,
  slugifyId,
  normalizeFieldKey,
  resolveFieldType,
  parseOptionsInput,
  applyFieldTypeRules,
  fieldToApi,
  normalizeConfig,
  loadTeacherFormConfig,
  saveTeacherFormConfig,
  findSection,
  findField,
  defaultTeacherFormConfig,
};
