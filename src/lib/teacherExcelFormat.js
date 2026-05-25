/**
 * Standard teacher Excel template (import + export).
 * Column order matches the Tree Learning spreadsheet template.
 */

const XLSX = require('xlsx');

const EXCEL_HEADERS = [
  'CONTACT ID',
  'NAME',
  'MOBILE',
  'EMAIL',
  'CITY',
  'PREFERRED CITIES',
  'UNIVERSITIES / COLLEGES ATTENDED',
  'EDUCATIONAL QUALIFICATION',
  'SUBJECTS TAUGHT',
  'TAGS',
  'QUALIFICATION CERTIFICATION',
  'GRADES TAUGHT',
  'BOARDS TAUGHT',
  'NOTES',
  'TEACHER ROLES',
  'Resume',
];

const EXPORT_EMPTY_ROW = Object.fromEntries(
  EXCEL_HEADERS.map((h) => [h, ''])
);

function normalizeExcelHeader(key) {
  return String(key).trim().toLowerCase().replace(/\s+/g, ' ');
}

function excelCellStr(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v);
  }
  return String(v).trim();
}

function joinList(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map((x) => String(x).trim()).filter(Boolean).join('; ');
}

function splitMultiValue(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  return String(raw)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseJsonArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      return Array.isArray(p)
        ? p.map((x) => String(x).trim()).filter(Boolean)
        : [];
    } catch {
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function formatTeacherCode(id) {
  return `TCH-${String(id).padStart(5, '0')}`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function normalizeImportedUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function resumeLinkDisplayName(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.hostname.includes('google')) return 'Resume (Google Docs link)';
    return `Resume link (${u.hostname})`;
  } catch {
    return 'Resume link';
  }
}

/** Read Resume URL from Excel cell (plain text or HYPERLINK formula). */
function extractCellLink(cell) {
  if (!cell) return '';
  if (cell.l && cell.l.Target) return normalizeImportedUrl(cell.l.Target);
  if (typeof cell.f === 'string' && /HYPERLINK/i.test(cell.f)) {
    const m = cell.f.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
    if (m && m[1]) return normalizeImportedUrl(m[1]);
  }
  const v =
    cell.v != null && cell.v !== ''
      ? String(cell.v).trim()
      : cell.w != null
        ? String(cell.w).trim()
        : '';
  if (isHttpUrl(v)) return normalizeImportedUrl(v);
  return '';
}

/** Attach Resume hyperlink targets from the sheet (sheet_to_json often misses them). */
function enrichRowsWithResumeLinks(sheet, rawRows) {
  if (!sheet || !rawRows.length) return rawRows;

  const headerRow = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    range: 0,
  })[0];
  if (!headerRow || !Array.isArray(headerRow)) return rawRows;

  const resumeColIdx = headerRow.findIndex(
    (h) => normalizeExcelHeader(String(h)) === 'resume'
  );
  if (resumeColIdx < 0) return rawRows;

  return rawRows.map((row, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: resumeColIdx });
    const link = extractCellLink(sheet[cellRef]);
    if (!link) return row;
    return { ...row, Resume: link, resume: link };
  });
}

/** Resume column on import: URL → resume_path, file name only → resume_original_name. */
function parseResumeImportValue(raw) {
  const t = normalizeImportedUrl(raw);
  if (!t) return { resume_path: null, resume_original_name: null };
  if (isHttpUrl(t)) {
    return {
      resume_path: t,
      resume_original_name: resumeLinkDisplayName(t),
    };
  }
  return { resume_path: null, resume_original_name: t };
}

function resumeLabel(row) {
  const pathStr = row.resume_path != null ? String(row.resume_path).trim() : '';
  if (isHttpUrl(pathStr)) return pathStr;
  if (row.resume_original_name) return String(row.resume_original_name);
  if (pathStr) {
    const p = pathStr.replace(/\\/g, '/');
    const parts = p.split('/');
    return parts[parts.length - 1] || '';
  }
  return '';
}

function universitiesExport(row) {
  const ug = row.ug_college != null ? String(row.ug_college).trim() : '';
  const pg = row.pg_university != null ? String(row.pg_university).trim() : '';
  return [ug, pg].filter(Boolean).join('; ');
}

function universitiesImport(raw) {
  const t = String(raw || '').trim();
  if (!t) return { ug_college: '', pg_university: '' };
  const parts = splitMultiValue(t.replace(/\s*\/\s*/g, ';'));
  if (parts.length >= 2) {
    return { ug_college: parts[0], pg_university: parts.slice(1).join('; ') };
  }
  return { ug_college: t, pg_university: '' };
}

/** Map DB row → Excel row (exact header names). */
function teacherRowToExcelExport(row) {
  const boards = parseJsonArray(row.boards_taught);
  const grades = parseJsonArray(row.grades_taught);
  const roles = parseJsonArray(row.teacher_roles);
  const skills = parseJsonArray(row.skills);
  const subjects = parseJsonArray(row.subjects_taught);

  return {
    'CONTACT ID': row.id != null ? formatTeacherCode(row.id) : '',
    NAME: row.name || '',
    MOBILE: row.mobile || '',
    EMAIL: row.email || '',
    CITY: row.city || '',
    'PREFERRED CITIES': row.preferred_location || '',
    'UNIVERSITIES / COLLEGES ATTENDED': universitiesExport(row),
    'EDUCATIONAL QUALIFICATION': row.qualification || '',
    'SUBJECTS TAUGHT': joinList(subjects),
    TAGS: joinList(skills),
    'QUALIFICATION CERTIFICATION': row.certifications || '',
    'GRADES TAUGHT': joinList(grades),
    'BOARDS TAUGHT': joinList(boards),
    NOTES: row.internal_notes || '',
    'TEACHER ROLES': joinList(roles),
    Resume: resumeLabel(row),
  };
}

function pickExcelColumn(row, candidates) {
  const keys = Object.keys(row);
  const byNorm = new Map();
  for (const k of keys) {
    byNorm.set(normalizeExcelHeader(k), k);
  }

  for (const want of candidates) {
    const nw = normalizeExcelHeader(want);
    const hit = byNorm.get(nw);
    if (hit !== undefined) {
      const val = excelCellStr(row[hit]);
      if (val !== '') return val;
    }
  }

  for (const want of candidates) {
    const nw = normalizeExcelHeader(want);
    const hit = keys.find((k) => {
      const n = normalizeExcelHeader(k);
      return n === nw || n.includes(nw) || nw.includes(n);
    });
    if (hit !== undefined) {
      const val = excelCellStr(row[hit]);
      if (val !== '') return val;
    }
  }
  return '';
}

/** Map Excel row → teacher API body for fieldsFromTeacherBody(). */
function bodyFromExcelRow(row) {
  const name = pickExcelColumn(row, ['name', 'NAME']);
  const email = pickExcelColumn(row, ['email', 'EMAIL']);
  const mobile = pickExcelColumn(row, ['mobile', 'MOBILE', 'phone']);
  if (!name && !email && !mobile) {
    return null;
  }

  const uniRaw = pickExcelColumn(row, [
    'universities / colleges attended',
    'UNIVERSITIES / COLLEGES ATTENDED',
    'universities',
    'colleges attended',
    'ug_college',
  ]);
  const { ug_college, pg_university } = universitiesImport(uniRaw);

  const tags = pickExcelColumn(row, ['tags', 'TAGS', 'skills']);
  const grades = pickExcelColumn(row, [
    'grades taught',
    'GRADES TAUGHT',
    'grades_taught',
    'grades',
  ]);
  const boards = pickExcelColumn(row, [
    'boards taught',
    'BOARDS TAUGHT',
    'boards_taught',
    'boards',
  ]);
  const roles = pickExcelColumn(row, [
    'teacher roles',
    'TEACHER ROLES',
    'teacher_roles',
    'roles',
  ]);

  return {
    name,
    email,
    mobile,
    city: pickExcelColumn(row, ['city', 'CITY']),
    preferred_location: pickExcelColumn(row, [
      'preferred cities',
      'PREFERRED CITIES',
      'preferred_location',
    ]),
    ug_college,
    pg_university,
    qualification: pickExcelColumn(row, [
      'educational qualification',
      'EDUCATIONAL QUALIFICATION',
      'qualification',
    ]),
    subjects_taught: splitMultiValue(
      pickExcelColumn(row, [
        'subjects taught',
        'SUBJECTS TAUGHT',
        'subjects_taught',
        'subject',
      ])
    ),
    skills: splitMultiValue(tags),
    certifications: pickExcelColumn(row, [
      'qualification certification',
      'QUALIFICATION CERTIFICATION',
      'certifications',
    ]),
    grades_taught: splitMultiValue(grades),
    boards_taught: splitMultiValue(boards),
    internal_notes: pickExcelColumn(row, ['notes', 'NOTES', 'internal_notes']),
    teacher_roles: splitMultiValue(roles),
    state: pickExcelColumn(row, ['state', 'STATE']),
    experience_years: pickExcelColumn(row, [
      'experienceYears',
      'experience_years',
      'experience',
      'total_experience',
    ]),
    status: pickExcelColumn(row, ['status', 'STATUS']),
    resume_link: pickExcelColumn(row, [
      'resume',
      'Resume',
      'resume link',
      'resume url',
      'resume_url',
    ]),
  };
}

module.exports = {
  EXCEL_HEADERS,
  EXPORT_EMPTY_ROW,
  teacherRowToExcelExport,
  bodyFromExcelRow,
  formatTeacherCode,
  enrichRowsWithResumeLinks,
  parseResumeImportValue,
  isHttpUrl,
};
