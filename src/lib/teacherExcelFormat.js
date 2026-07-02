/**
 * Standard teacher Excel template (import + export).
 * Column order matches the Tree Learning spreadsheet template.
 */

const XLSX = require('xlsx');

const EXCEL_HEADERS = [
  'roll_no',
  'teacher_name',
  'mobile_no',
  'email',
  'country',
  'state_id',
  'city_id',
  'address',
  'college_attended_ug',
  'universities_attended_pg',
  'education_qualifications',
  'qualifications_certificates',
  'subjects_taught',
  'boards_taught',
  'grades_taught',
  'source',
  'preferred_location',
  'roles',
  'current_location_id',
  'areas_of_interest',
  'resume',
];

/** Legacy Tree Learning template headers (still accepted on import). */
const LEGACY_EXCEL_HEADERS = [
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
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      const n = s.toLowerCase();
      return n !== 'na' && n !== 'n/a' && n !== 'nil' && n !== 'none' && n !== '-';
    });
}

function parseJsonArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    try {
      return parseJsonArray(JSON.parse(val.toString('utf8')));
    } catch {
      return [];
    }
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

function resumeFileBasename(filePath) {
  const p = String(filePath || '')
    .trim()
    .replace(/\\/g, '/');
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function normalizeResumeFilePath(raw) {
  let p = normalizeImportedUrl(raw).replace(/\\/g, '/');
  if (!p || isHttpUrl(p)) return p;
  if (p.startsWith('./')) p = p.slice(1);
  if (!p.includes('/')) {
    p = `/uploads/files/${p}`;
  } else if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  return p;
}

function resumeOriginalNameFromStoredPath(pathOrUrl) {
  const t = String(pathOrUrl || '').trim();
  if (!t) return '';
  if (isHttpUrl(t)) {
    try {
      const u = new URL(t);
      const base = resumeFileBasename(decodeURIComponent(u.pathname));
      if (base) return base;
    } catch {
      /* fall through */
    }
    return resumeLinkDisplayName(t);
  }
  return resumeFileBasename(t) || t;
}

/** Read Resume link/path from Excel cell (plain text or HYPERLINK formula). */
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
  if (v) return normalizeImportedUrl(v);
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

/**
 * Resume column on import:
 * - file path e.g. /uploads/files/name.pdf → full path in resume_path, name.pdf in resume_original_name
 * - bare filename → /uploads/files/name.pdf + name.pdf in resume_original_name
 * - http(s) URL → full URL in resume_path, filename from URL path when available
 */
function parseResumeImportValue(raw) {
  const t = normalizeImportedUrl(raw);
  if (!t) return { resume_path: null, resume_original_name: null };
  if (isHttpUrl(t)) {
    return {
      resume_path: t,
      resume_original_name: resumeOriginalNameFromStoredPath(t),
    };
  }
  const resume_path = normalizeResumeFilePath(t);
  const resume_original_name = resumeOriginalNameFromStoredPath(resume_path);
  return { resume_path, resume_original_name };
}

function resumeLabel(row) {
  const pathStr = row.resume_path != null ? String(row.resume_path).trim() : '';
  if (!pathStr) {
    return row.resume_original_name ? String(row.resume_original_name) : '';
  }
  if (isHttpUrl(pathStr)) return pathStr;
  return pathStr;
}

function universitiesExport(row) {
  const ug = row.ug_college != null ? String(row.ug_college).trim() : '';
  const pg = row.pg_university != null ? String(row.pg_university).trim() : '';
  return [ug, pg].filter(Boolean).join('; ');
}

function universitiesImport(raw) {
  const t = String(raw || '').trim();
  if (!t) return { ug_college: '', pg_university: '' };
  // Excel convention:
  // - "UG College / PG University"
  // - PG is everything after the first "/"
  const parts = splitMultiValue(t);
  const ug = parts[0] || '';
  const pg = parts.length > 1 ? parts.slice(1).join('; ') : '';
  return { ug_college: ug, pg_university: pg };
}

/** Map DB row → Excel row (exact header names). */
function teacherRowToExcelExport(row) {
  const boards = parseJsonArray(row.boards_taught);
  const grades = parseJsonArray(row.grades_taught);
  const roles = parseJsonArray(row.teacher_roles);
  const areas = parseJsonArray(row.area_of_interest);
  const skills = parseJsonArray(row.skills);
  const subjects = parseJsonArray(row.subjects_taught);
  const qualifications = parseJsonArray(row.qualifications);
  const customObj =
    row.custom_fields != null &&
    typeof row.custom_fields === 'object' &&
    !Array.isArray(row.custom_fields)
      ? row.custom_fields
      : typeof row.custom_fields === 'string'
        ? (() => {
            try {
              const p = JSON.parse(row.custom_fields);
              return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
            } catch {
              return {};
            }
          })()
        : {};

  return {
    roll_no: row.id != null ? formatTeacherCode(row.id) : '',
    teacher_name: row.name || '',
    mobile_no: row.mobile || '',
    email: row.email || '',
    country: row.country || '',
    state_id: customObj.state_id != null ? String(customObj.state_id) : '',
    city_id: customObj.city_id != null ? String(customObj.city_id) : row.city || '',
    address: row.address != null ? String(row.address) : '',
    college_attended_ug: row.ug_college || '',
    universities_attended_pg: row.pg_university || '',
    education_qualifications:
      joinList(qualifications) || row.qualification || '',
    qualifications_certificates: row.certifications || '',
    subjects_taught: joinList(subjects),
    boards_taught: joinList(boards),
    grades_taught: joinList(grades),
    source: joinList(parseJsonArray(row.where_did_you_hear_about_us)),
    preferred_location:
      row.preferred_location ||
      customObj.preffered_location ||
      '',
    roles:
      joinList(areas) ||
      joinList(customFieldMultiList(customObj.areas_of_interest)) ||
      joinList(roles),
    current_location_id:
      customObj.current_location_id != null
        ? String(customObj.current_location_id)
        : row.current_location || '',
    areas_of_interest: joinList(customFieldMultiList(customObj.candidate_roles)),
    resume: resumeLabel(row),
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

function parseContactId(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  const n = t.toLowerCase();
  if (n === 'na' || n === 'n/a' || n === 'nil' || n === 'none' || n === '-') return null;

  const m = t.match(/tch\s*-\s*0*([0-9]+)/i);
  const digits = m && m[1] ? m[1] : t.replace(/[^\d]/g, '');
  if (!digits) return null;
  const id = parseInt(digits, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isNewExcelImportFormat(row) {
  const keys = Object.keys(row).map((k) => normalizeExcelHeader(k));
  return ['roll_no', 'teacher_name', 'mobile_no'].some((h) => keys.includes(h));
}

function buildImportCustomFields({
  state_id,
  city_id,
  preferred_location,
  rolesRaw,
  areasOfInterestRaw,
  current_location_id,
}) {
  const custom_fields = {};
  if (state_id) custom_fields.state_id = state_id;
  if (city_id) custom_fields.city_id = city_id;
  if (preferred_location) custom_fields.preffered_location = preferred_location;
  const roles = splitMultiValue(rolesRaw);
  if (roles.length) custom_fields.areas_of_interest = roles;
  const candidateRoles = splitMultiValue(areasOfInterestRaw);
  if (candidateRoles.length) custom_fields.candidate_roles = candidateRoles;
  if (current_location_id) {
    custom_fields.current_location_id = current_location_id;
    if (!preferred_location) {
      custom_fields.preffered_location = current_location_id;
    }
  }
  return custom_fields;
}

function customFieldMultiList(val) {
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  return splitMultiValue(val);
}

/** Map Excel row → teacher API body for fieldsFromTeacherBody(). */
function bodyFromExcelRow(row) {
  const newFormat = isNewExcelImportFormat(row);

  const contactIdRaw = pickExcelColumn(row, [
    'roll_no',
    'roll no',
    'contact id',
    'CONTACT ID',
    'teacher id',
    'teacher_id',
    'id',
  ]);
  const id = parseContactId(contactIdRaw);

  const name = pickExcelColumn(row, [
    'teacher_name',
    'teacher name',
    'name',
    'NAME',
  ]);
  const email = pickExcelColumn(row, ['email', 'EMAIL']);
  const mobile = pickExcelColumn(row, [
    'mobile_no',
    'mobile no',
    'mobile',
    'MOBILE',
    'phone',
  ]);

  const state_id = pickExcelColumn(row, ['state_id', 'state id']);
  const city_id = pickExcelColumn(row, ['city_id', 'city id']);
  const country = pickExcelColumn(row, ['country', 'COUNTRY']);
  const address = pickExcelColumn(row, ['address', 'ADDRESS']);

  const ugFromColumn = pickExcelColumn(row, [
    'college_attended_ug',
    'college attended ug',
    'ug_college',
  ]);
  const pgFromColumn = pickExcelColumn(row, [
    'universities_attended_pg',
    'universities attended pg',
    'pg_university',
  ]);

  const uniRaw = pickExcelColumn(row, [
    'universities / colleges attended',
    'UNIVERSITIES / COLLEGES ATTENDED',
    'universities',
    'colleges attended',
  ]);
  const uniLegacy = universitiesImport(uniRaw);
  const ug_college = ugFromColumn || uniLegacy.ug_college;
  const pg_university = pgFromColumn || uniLegacy.pg_university;

  const preferred_location = pickExcelColumn(row, [
    'preferred_location',
    'preferred cities',
    'PREFERRED CITIES',
    'preferred location',
  ]);
  const rolesRaw = pickExcelColumn(row, [
    'roles',
    'ROLES',
    'teacher roles',
    'TEACHER ROLES',
    'teacher_roles',
  ]);
  const areasOfInterestRaw = pickExcelColumn(row, [
    'areas_of_interest',
    'areas of interest',
    'area of interest',
    'AREA OF INTEREST',
  ]);
  const current_location_id = pickExcelColumn(row, [
    'current_location_id',
    'current location id',
  ]);
  const source = pickExcelColumn(row, ['source', 'SOURCE']);

  const tags = pickExcelColumn(row, ['tags', 'TAGS', 'skills']);
  const grades = pickExcelColumn(row, [
    'grades_taught',
    'grades taught',
    'GRADES TAUGHT',
    'grades',
  ]);
  const boards = pickExcelColumn(row, [
    'boards_taught',
    'boards taught',
    'BOARDS TAUGHT',
    'boards',
  ]);

  const custom_fields = buildImportCustomFields({
    state_id,
    city_id,
    preferred_location,
    rolesRaw: newFormat ? rolesRaw : '',
    areasOfInterestRaw,
    current_location_id,
  });

  return {
    ...(id ? { id } : {}),
    name,
    email,
    mobile,
    country,
    state: pickExcelColumn(row, ['state', 'STATE']) || state_id,
    city: pickExcelColumn(row, ['city', 'CITY']) || city_id,
    address,
    ug_college,
    pg_university,
    preferred_location,
    current_location: current_location_id,
    qualifications: splitMultiValue(
      pickExcelColumn(row, [
        'education_qualifications',
        'education qualifications',
        'educational qualification',
        'EDUCATIONAL QUALIFICATION',
        'qualification',
        'qualifications',
      ])
    ),
    subjects_taught: splitMultiValue(
      pickExcelColumn(row, [
        'subjects_taught',
        'subjects taught',
        'SUBJECTS TAUGHT',
        'subject',
      ])
    ),
    skills: splitMultiValue(tags),
    certifications: pickExcelColumn(row, [
      'qualifications_certificates',
      'qualifications certificates',
      'qualification certification',
      'QUALIFICATION CERTIFICATION',
      'certifications',
    ]),
    grades_taught: splitMultiValue(grades),
    boards_taught: splitMultiValue(boards),
    area_of_interest: newFormat
      ? splitMultiValue(rolesRaw)
      : splitMultiValue(
          pickExcelColumn(row, [
            'area of interest',
            'AREA OF INTEREST',
            'area_of_interest',
          ])
        ),
    teacher_roles: newFormat ? [] : splitMultiValue(rolesRaw),
    where_did_you_hear_about_us: splitMultiValue(source),
    internal_notes: pickExcelColumn(row, ['notes', 'NOTES', 'internal_notes']),
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
    custom_fields,
  };
}

module.exports = {
  EXCEL_HEADERS,
  LEGACY_EXCEL_HEADERS,
  EXPORT_EMPTY_ROW,
  teacherRowToExcelExport,
  bodyFromExcelRow,
  formatTeacherCode,
  enrichRowsWithResumeLinks,
  parseResumeImportValue,
  isHttpUrl,
  isNewExcelImportFormat,
};
