const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/database');
const { logActivity } = require('../lib/activityLog');
const {
  resolveExternalResumeDownload,
  looksLikeHtml,
} = require('../lib/externalResumeDownload');
const { buildTeacherListWhere } = require('../lib/teacherListFilters');
const {
  EXCEL_HEADERS,
  EXPORT_EMPTY_ROW,
  teacherRowToExcelExport,
  bodyFromExcelRow,
  enrichRowsWithResumeLinks,
  parseResumeImportValue,
  isHttpUrl,
} = require('../lib/teacherExcelFormat');

async function logTeacherCreated(f, resume_path, teacherId) {
  await logActivity(`New teacher created – ${f.name}`, {
    entityType: 'teacher',
    entityId: teacherId,
  });
  if (resume_path) {
    await logActivity(`Resume uploaded – ${f.name}`, {
      entityType: 'teacher',
      entityId: teacherId,
    });
  }
}

const REQUIRED = ['name', 'mobile', 'email'];

function toStr(v, fallback = '') {
  if (v == null) return fallback;
  return String(v).trim();
}

function toStringArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => String(x).trim())
      .filter((s) => {
        if (!s) return false;
        const n = s.toLowerCase();
        return n !== 'na' && n !== 'n/a' && n !== 'nil' && n !== 'none' && n !== '-';
      });
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) {
          return p.map((x) => String(x).trim()).filter(Boolean);
        }
      } catch {
        /* fall through */
      }
    }
    return t
      .split(/[,;/]/)
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        const n = s.toLowerCase();
        return n !== 'na' && n !== 'n/a' && n !== 'nil' && n !== 'none' && n !== '-';
      });
  }
  return [];
}

function joinScalar(arr, maxLen) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  const joined = arr.map((x) => String(x).trim()).filter(Boolean).join('; ');
  if (!maxLen || joined.length <= maxLen) return joined;
  return joined.slice(0, maxLen);
}

function digitsOnlyPhone(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

function last10Digits(v) {
  const d = digitsOnlyPhone(v);
  if (!d) return '';
  return d.length <= 10 ? d : d.slice(-10);
}

function toNum(v, fallback = 0) {
  if (v == null) return fallback;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : fallback;
  }
  const t = String(v).trim();
  if (!t) return fallback;
  // Accept values like "10", "10.5", "10 yrs", "₹ 50,000", etc.
  const m = t.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : fallback;
}

function pickWorkExperienceInput(body) {
  if (!body || typeof body !== 'object') return [];
  const lists = [
    body.work_experience,
    body.workExperience,
    body.work_experiences && body.work_experiences.create,
    body.workExperiences && body.workExperiences.create,
  ].filter((list) => Array.isArray(list) && list.length > 0);
  if (lists.length === 0) return [];
  return lists.reduce((best, cur) =>
    cur.length > best.length ? cur : best
  );
}

function pickAdditionalEducationInput(body) {
  if (!body || typeof body !== 'object') return [];
  const hasField =
    Object.prototype.hasOwnProperty.call(body, 'additional_education') ||
    Object.prototype.hasOwnProperty.call(body, 'additionalEducation') ||
    Object.prototype.hasOwnProperty.call(body, 'education_extras') ||
    Object.prototype.hasOwnProperty.call(body, 'extra_education');
  if (!hasField) return null;
  return toStringArray(
    body.additional_education ??
      body.additionalEducation ??
      body.education_extras ??
      body.extra_education
  );
}

function normalizeWorkExperience(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((row) => {
      const school_name = toStr(
        row.school_name ??
          row.schoolName ??
          row.organization_name ??
          row.organizationName
      );
      const role = toStr(row.role);
      const fromSrc =
        row.from_date ?? row.from ?? row.duration_from ?? row.durationFrom;
      const fromVal =
        fromSrc != null && String(fromSrc).trim() !== ''
          ? String(fromSrc).trim()
          : '';
      const toSrc = row.to_date ?? row.to ?? row.duration_to ?? row.durationTo;
      const toVal =
        toSrc != null && String(toSrc).trim() !== ''
          ? String(toSrc).trim()
          : null;
      const currentlyWorking = Boolean(
        row.is_currently_working ??
          row.is_current ??
          row.currently_working ??
          row.currentlyWorking
      );
      return {
        school_name,
        role,
        from: fromVal,
        to: toVal,
        from_date: fromVal,
        to_date: toVal,
        currently_working: currentlyWorking,
        is_currently_working: currentlyWorking,
      };
    })
    .filter((row) => row.school_name || row.role);
}

const MULTIPART_SCALAR_FIELDS = [
  'name',
  'mobile',
  'email',
  'state',
  'city',
  'address',
  'country',
  'ug_college',
  'pg_university',
  'qualification',
  'certifications',
  'subjects_taught',
  'area_of_interest',
  'current_location',
  'preferred_location',
  'reason_to_join',
  'where_did_you_hear_about_us',
  'internal_notes',
  'status',
  'boards_taught',
  'grades_taught',
  'teacher_roles',
  'skills',
  'current_salary',
  'total_experience',
  'experience_years',
];

function buildBodyFromFlatMultipart(body) {
  const out = {};
  if (!body || typeof body !== 'object') {
    return { success: true, data: out };
  }

  for (const key of MULTIPART_SCALAR_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let val = body[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      val = val.filter((x) => x != null && String(x).trim() !== '').join(', ');
    }
    const str = typeof val === 'string' ? val : String(val);
    const trimmed = str.trim();
    if (trimmed === '') continue;
    out[key] = trimmed;
  }

  const wx = body.work_experience;
  if (wx != null && String(wx).trim() !== '') {
    const raw = String(wx).trim();
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return {
          success: false,
          error: 'work_experience must be a JSON array',
        };
      }
      out.work_experience = parsed;
    } catch {
      return {
        success: false,
        error: 'work_experience must be valid JSON (array of jobs)',
      };
    }
  }

  const cf = body.custom_fields ?? body.customFields;
  if (cf != null && String(cf).trim() !== '') {
    const raw = String(cf).trim();
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          success: false,
          error: 'custom_fields must be a JSON object',
        };
      }
      out.custom_fields = parsed;
    } catch {
      return {
        success: false,
        error: 'custom_fields must be valid JSON (object)',
      };
    }
  }

  return { success: true, data: out };
}

function parsePayload(req) {
  if (req.is('multipart/form-data')) {
    const raw = req.body.teacher ?? req.body.data;
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        return { payload: JSON.parse(raw) };
      } catch {
        return { error: 'Invalid JSON in teacher/data field' };
      }
    }

    const built = buildBodyFromFlatMultipart(req.body || {});
    if (!built.success) {
      return { error: built.error };
    }
    const flat = built.data;
    if (Object.keys(flat).length === 0) {
      return {
        error:
          'Use form fields (name, mobile, email, …) or one text field "teacher" / "data" with JSON',
      };
    }
    return { payload: flat };
  }
  return { payload: req.body || {} };
}

function normalizeStatus(v) {
  if (v == null || String(v).trim() === '') {
    return 'active';
  }
  const s = String(v).trim().toLowerCase();
  if (s === 'inactive') return 'inactive';
  return 'active';
}

function parseCustomFields(body) {
  const raw = body.custom_fields ?? body.customFields;
  if (raw == null) return {};

  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return {};
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parseCustomFields({ custom_fields: parsed });
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).trim();
    if (!key) continue;
    out[key] = v;
  }
  return out;
}

function parseStoredCustomFields(val) {
  if (val == null) return {};
  if (typeof val === 'object' && !Array.isArray(val)) {
    return parseCustomFields({ custom_fields: val });
  }
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        return parseCustomFields({ custom_fields: p });
      }
    } catch {
      return {};
    }
  }
  return {};
}

function fieldsFromTeacherBody(body) {
  const wxRaw = pickWorkExperienceInput(body);
  const work_experience = normalizeWorkExperience(wxRaw);
  const subjects_taught = toStringArray(
    body.subjects_taught ?? body.subject_taught ?? body.subjectTaught
  );
  const area_of_interest = toStringArray(
    body.area_of_interest ?? body.areaOfInterest
  );

  const qualifications = toStringArray(
    body.qualifications ?? body.qualification ?? body.educational_qualification
  );
  const qualificationFallback =
    typeof body.qualification === 'string' ? toStr(body.qualification) : '';
  const qualification = joinScalar(qualifications, 512) || qualificationFallback;

  const totalExpInput =
    body.total_experience ??
    body.experience_years ??
    body.totalExperience ??
    body.experience;
  let total_experience = toNum(totalExpInput, NaN);
  if (!Number.isFinite(total_experience)) {
    // Backward-compat: allow putting overall exp on first work_experience row.
    let derived = null;
    for (const row of Array.isArray(wxRaw) ? wxRaw : []) {
      const expSrc =
        row?.experience ??
        row?.exp ??
        row?.years ??
        row?.total_years ??
        row?.totalYears;
      const n = Number(expSrc);
      if (Number.isFinite(n)) {
        derived = n;
        break;
      }
    }
    total_experience = derived ?? 0;
  }

  return {
    name: toStr(body.name),
    mobile: toStr(body.mobile),
    email: toStr(body.email).toLowerCase(),
    state: toStr(body.state),
    city: toStr(body.city),
    address: body.address != null ? String(body.address) : '',
    country: toStr(body.country),
    ug_college: toStr(body.ug_college),
    pg_university: toStr(body.pg_university),
    qualifications,
    qualification,
    certifications:
      body.certifications != null ? String(body.certifications) : '',
    subjects_taught,
    area_of_interest,
    boards_taught: toStringArray(body.boards_taught),
    grades_taught: toStringArray(body.grades_taught),
    teacher_roles: toStringArray(body.teacher_roles),
    current_location: toStr(body.current_location),
    preferred_location: toStr(body.preferred_location),
    reason_to_join: toStringArray(body.reason_to_join ?? body.reasonToJoin),
    where_did_you_hear_about_us: toStringArray(
      body.where_did_you_hear_about_us ?? body.whereDidYouHearAboutUs
    ),
    current_salary: toNum(
      body.current_salary ?? body.currentSalary ?? body.salary,
      0
    ),
    total_experience,
    work_experience,
    skills: toStringArray(body.skills),
    custom_fields: parseCustomFields(body),
    internal_notes:
      body.internal_notes != null
        ? String(body.internal_notes)
        : body.notes != null
          ? String(body.notes)
          : '',
    status: normalizeStatus(body.status),
  };
}

async function createTeacher(req, res) {
  const parsed = parsePayload(req);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const body = parsed.payload;
  const missing = REQUIRED.filter(
    (k) => body[k] == null || String(body[k]).trim() === ''
  );
  if (missing.length) {
    return res.status(400).json({
      error: 'Missing required fields',
      fields: missing,
    });
  }

  const f = fieldsFromTeacherBody(body);

  let resume_path = null;
  let resume_original_name = null;
  if (req.file) {
    resume_path = path
      .join('/uploads', req.file.filename)
      .replace(/\\/g, '/');
    resume_original_name = req.file.originalname || null;
  }

  try {
    const [result] = await pool.execute(
      TEACHER_INSERT_SQL,
      teacherInsertValues(f, resume_path, resume_original_name)
    );
    const teacherId = result.insertId;
    await logTeacherCreated(f, resume_path, teacherId);
    return res.status(201).json({
      id: teacherId,
      teacher_id: `TCH-${String(teacherId).padStart(5, '0')}`,
      ...f,
      experience_years: f.total_experience,
      resume_path,
      resume_original_name,
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

function teacherPublicShape(id, f, resume_path, resume_original_name) {
  return {
    id,
    teacher_id: `TCH-${String(id).padStart(5, '0')}`,
    ...f,
    experience_years: f.total_experience,
    resume_path,
    resume_original_name,
  };
}

function parseStoredJsonArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    try {
      return parseStoredJsonArray(JSON.parse(val.toString('utf8')));
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
      return toStringArray(val);
    }
  }
  return [];
}

function parseStoredWorkExp(val) {
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
  return normalizeWorkExperience(raw);
}

function rowToPatchBase(row) {
  const qualifications =
    row.qualifications != null
      ? parseStoredJsonArray(row.qualifications)
      : toStringArray(row.qualification);

  return {
    name: row.name,
    mobile: row.mobile,
    email: row.email,
    state: row.state,
    city: row.city,
    address: row.address != null ? String(row.address) : '',
    country: row.country || '',
    ug_college: row.ug_college,
    pg_university: row.pg_university,
    qualifications,
    qualification: joinScalar(qualifications, 512) || row.qualification,
    certifications:
      row.certifications != null ? String(row.certifications) : '',
    subjects_taught: parseStoredJsonArray(row.subjects_taught),
    area_of_interest: parseStoredJsonArray(row.area_of_interest),
    boards_taught: parseStoredJsonArray(row.boards_taught),
    grades_taught: parseStoredJsonArray(row.grades_taught),
    teacher_roles: parseStoredJsonArray(row.teacher_roles),
    current_location: row.current_location,
    preferred_location: row.preferred_location,
    reason_to_join: parseStoredJsonArray(row.reason_to_join),
    where_did_you_hear_about_us: parseStoredJsonArray(
      row.where_did_you_hear_about_us
    ),
    current_salary: row.current_salary != null ? Number(row.current_salary) : 0,
    total_experience:
      row.total_experience != null ? Number(row.total_experience) : 0,
    work_experience: parseStoredWorkExp(row.work_experience),
    skills: parseStoredJsonArray(row.skills),
    custom_fields: parseStoredCustomFields(row.custom_fields),
    internal_notes: row.internal_notes != null ? String(row.internal_notes) : '',
    status: row.status || 'active',
  };
}

async function updateTeacher(req, res) {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid teacher id' });
  }

  const parsed = parsePayload(req);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const body = parsed.payload;

  try {
    const [existingRows] = await pool.execute(
      'SELECT * FROM teachers WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const base = rowToPatchBase(existingRows[0]);
    const merged = { ...base, ...body };

    const f = fieldsFromTeacherBody(merged);
    const missing = REQUIRED.filter(
      (k) => f[k] == null || String(f[k]).trim() === ''
    );
    if (missing.length) {
      return res.status(400).json({
        error: 'Missing required fields after merge',
        fields: missing,
      });
    }

    let resume_path = existingRows[0].resume_path;
    let resume_original_name = existingRows[0].resume_original_name;
    if (req.file) {
      resume_path = path
        .join('/uploads', req.file.filename)
        .replace(/\\/g, '/');
      resume_original_name = req.file.originalname || null;
    }

    const sql = `UPDATE teachers SET
    name=?, mobile=?, email=?, state=?, city=?, address=?, country=?,
    ug_college=?, pg_university=?, qualifications=?, qualification=?, certifications=?, subjects_taught=?, area_of_interest=?,
    boards_taught=?, grades_taught=?, teacher_roles=?,
    current_location=?, preferred_location=?, reason_to_join=?, where_did_you_hear_about_us=?,
    current_salary=?, total_experience=?, work_experience=?, skills=?,
    internal_notes=?, custom_fields=?, resume_path=?, status=?, resume_original_name=?
    WHERE id=?`;

    await pool.execute(sql, [
      f.name,
      f.mobile,
      f.email,
      f.state,
      f.city,
      f.address,
      f.country,
      f.ug_college,
      f.pg_university,
      JSON.stringify(f.qualifications ?? []),
      f.qualification,
      f.certifications,
      JSON.stringify(f.subjects_taught),
      JSON.stringify(f.area_of_interest),
      JSON.stringify(f.boards_taught),
      JSON.stringify(f.grades_taught),
      JSON.stringify(f.teacher_roles),
      f.current_location,
      f.preferred_location,
      JSON.stringify(f.reason_to_join),
      JSON.stringify(f.where_did_you_hear_about_us),
      f.current_salary,
      f.total_experience,
      JSON.stringify(f.work_experience),
      JSON.stringify(f.skills),
      f.internal_notes,
      JSON.stringify(f.custom_fields ?? {}),
      resume_path,
      f.status,
      resume_original_name,
      id,
    ]);

    if (req.file) {
      await logActivity(`Resume uploaded – ${f.name}`, {
        entityType: 'teacher',
        entityId: id,
      });
    } else {
      await logActivity(`Teacher updated – ${f.name}`, {
        entityType: 'teacher',
        entityId: id,
      });
    }

    return res.json(teacherPublicShape(id, f, resume_path, resume_original_name));
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

async function deleteTeacher(req, res) {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid teacher id' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT name FROM teachers WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    const teacherName = rows[0].name;

    const [result] = await pool.execute('DELETE FROM teachers WHERE id = ?', [
      id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    await logActivity(`Teacher deleted – ${teacherName}`, {
      entityType: 'teacher',
      entityId: id,
    });

    return res.json({
      ok: true,
      id,
      teacher_id: `TCH-${String(id).padStart(5, '0')}`,
      message: 'Teacher deleted',
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function parseBulkIds(body) {
  if (!body || body.ids == null) return [];
  if (Array.isArray(body.ids)) {
    return body.ids
      .map((x) => parseInt(String(x), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof body.ids === 'string') {
    return body.ids
      .split(/[,;\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
}

async function bulkDeleteTeachers(req, res) {
  const ids = [...new Set(parseBulkIds(req.body))];
  if (ids.length === 0) {
    return res.status(400).json({
      error: 'Send JSON body with selected database ids, e.g. { "ids": [1, 2, 3, 4] }',
    });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 ids per request' });
  }

  const placeholders = ids.map(() => '?').join(',');
  try {
    const [result] = await pool.query(
      `DELETE FROM teachers WHERE id IN (${placeholders})`,
      ids
    );
    const deleted = result.affectedRows;
    if (deleted > 0) {
      await logActivity(
        deleted === 1
          ? '1 teacher deleted'
          : `${deleted} teachers deleted`
      );
    }
    return res.json({
      ok: true,
      deleted,
      requested: ids.length,
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function jsonToArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    try {
      return jsonToArray(JSON.parse(val.toString('utf8')));
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
      return toStringArray(val);
    }
  }
  return [];
}

function jsonToWorkExp(val) {
  if (val == null) return [];
  let raw = val;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    try {
      raw = JSON.parse(val.toString('utf8'));
    } catch {
      return [];
    }
  } else if (typeof val === 'string') {
    try {
      raw = JSON.parse(val);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return normalizeWorkExperience(raw);
}

function formatTeacherCode(id) {
  return `TCH-${String(id).padStart(5, '0')}`;
}

function formatExperienceYears(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0 yrs';
  const rounded = Math.round(num * 10) / 10;
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${display} yrs`;
}

function mapTeacherRow(row) {
  const boards_taught = jsonToArray(row.boards_taught);
  const grades_taught = jsonToArray(row.grades_taught);
  const teacher_roles = jsonToArray(row.teacher_roles);
  const work_experience = jsonToWorkExp(row.work_experience);
  const skills = jsonToArray(row.skills);
  const subjects_taught = jsonToArray(row.subjects_taught);
  const area_of_interest = jsonToArray(row.area_of_interest);
  const reason_to_join = jsonToArray(row.reason_to_join);
  const where_did_you_hear_about_us = jsonToArray(row.where_did_you_hear_about_us);
  const qualifications =
    row.qualifications != null
      ? jsonToArray(row.qualifications)
      : toStringArray(row.qualification);
  const custom_fields = parseStoredCustomFields(row.custom_fields);

  const resume_path = row.resume_path || null;
  const resumeOriginal = row.resume_original_name || null;
  const pathStr = resume_path ? String(resume_path).trim() : '';
  const resumeDisplay = isHttpUrl(pathStr)
    ? resumeOriginal || pathStr
    : resumeOriginal ||
      (pathStr
        ? path.posix.basename(String(pathStr).replace(/\\/g, '/'))
        : '') ||
      '';

  return {
    teacher_id: formatTeacherCode(row.id),
    id: row.id,
    name: row.name,
    email: row.email,
    mobile: row.mobile,
    city: row.city || '',
    subject: subjects_taught.join(', '),
    roles: teacher_roles.join(', '),
    grades: grades_taught.join(', '),
    boards: boards_taught.join(', '),
    experience: formatExperienceYears(row.total_experience),
    resume: resumeDisplay,
    status: row.status || 'active',
    state: row.state,
    address: row.address,
    country: row.country || '',
    ug_college: row.ug_college,
    pg_university: row.pg_university,
    qualifications,
    qualification: joinScalar(qualifications, 512) || row.qualification,
    certifications: row.certifications,
    subjects_taught,
    area_of_interest,
    current_location: row.current_location,
    preferred_location: row.preferred_location,
    reason_to_join,
    where_did_you_hear_about_us,
    current_salary:
      row.current_salary != null ? Number(row.current_salary) : 0,
    total_experience:
      row.total_experience != null ? Number(row.total_experience) : 0,
    experience_years:
      row.total_experience != null ? Number(row.total_experience) : 0,
    boards_taught,
    grades_taught,
    teacher_roles,
    work_experience,
    skills,
    custom_fields,
    internal_notes: row.internal_notes,
    resume_path,
    resume_original_name: resumeOriginal,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}


function buildExportFilter(opts, scope) {
  const params = [];
  let where = '1=1';

  if (scope === 'selected') {
    const idsRaw = opts.ids != null ? String(opts.ids) : '';
    const idList = idsRaw
      .split(/[,;\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (idList.length === 0) {
      return {
        error:
          'For scope=selected, pass ids (comma-separated or JSON body ids: [1,2,3])',
      };
    }
    const placeholders = idList.map(() => '?').join(',');
    where = `id IN (${placeholders})`;
    return { where, params: idList };
  }

  if (scope === 'filtered') {
    const q = opts.q ? String(opts.q).trim() : '';
    if (q) {
      const term = `%${q}%`;
      where += ' AND (name LIKE ? OR email LIKE ? OR mobile LIKE ? OR city LIKE ?)';
      params.push(term, term, term, term);
    }
    const likeCol = (col, val) => {
      if (val == null || String(val).trim() === '') return;
      where += ` AND ${col} LIKE ?`;
      params.push(`%${String(val).trim()}%`);
    };
    likeCol('city', opts.city);
    likeCol('state', opts.state);
    likeCol('email', opts.email);
    if (opts.status != null && String(opts.status).trim() !== '') {
      where += ' AND status = ?';
      params.push(String(opts.status).trim());
    }
  }

  return { where, params };
}

function mergeExportOptions(req) {
  const opts = { ...(req.query || {}) };
  const b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    if (b.scope != null) opts.scope = b.scope;
    if (b.format != null) opts.format = b.format;
    if (b.q != null) opts.q = b.q;
    if (b.city != null) opts.city = b.city;
    if (b.state != null) opts.state = b.state;
    if (b.email != null) opts.email = b.email;
    if (b.subject != null) opts.subject = b.subject;
    if (b.status != null) opts.status = b.status;
    if (Array.isArray(b.ids)) opts.ids = b.ids.join(',');
    else if (b.ids != null) opts.ids = b.ids;
  }
  return opts;
}

async function exportTeachers(req, res) {
  const opts = mergeExportOptions(req);
  const format = String(opts.format || 'xlsx').toLowerCase();
  if (format !== 'xlsx' && format !== 'csv') {
    return res.status(400).json({ error: 'format must be xlsx or csv' });
  }

  const scope = String(opts.scope || 'all').toLowerCase();
  if (!['all', 'filtered', 'selected'].includes(scope)) {
    return res.status(400).json({
      error: 'scope must be all, filtered, or selected',
    });
  }

  const filter = buildExportFilter(opts, scope);
  if (filter.error) {
    return res.status(400).json({ error: filter.error });
  }

  const sql = `SELECT * FROM teachers WHERE ${filter.where} ORDER BY id DESC`;

  try {
    const [rows] = await pool.query(sql, filter.params);
    const data = rows.map((r) => teacherRowToExcelExport(r));
    const rowsOut = data.length ? data : [EXPORT_EMPTY_ROW];

    const stamp = new Date().toISOString().slice(0, 10);
    const base = `teachers-${scope}-${stamp}`;

    if (format === 'csv') {
      const ws = XLSX.utils.json_to_sheet(rowsOut, { header: EXCEL_HEADERS });
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.csv"`
      );
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Disposition, Content-Length'
      );
      return res.send(Buffer.from(`\uFEFF${csv}`, 'utf8'));
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rowsOut, { header: EXCEL_HEADERS });
    XLSX.utils.book_append_sheet(wb, ws, 'Teachers');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${base}.xlsx"`
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Content-Length'
    );
    return res.send(buf);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function getTeacherById(req, res) {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid teacher id' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM teachers WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    return res.json(mapTeacherRow(rows[0]));
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

async function downloadTeacherResume(req, res) {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid teacher id' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT name, resume_path, resume_original_name FROM teachers WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const resume_path = rows[0].resume_path;
    if (!resume_path || String(resume_path).trim() === '') {
      return res.status(404).json({ error: 'Resume is not uploaded' });
    }

    const pathStr = String(resume_path).trim();
    if (isHttpUrl(pathStr)) {
      const teacherName = rows[0].name || 'Teacher';
      const resolved = resolveExternalResumeDownload(
        pathStr,
        rows[0].resume_original_name || teacherName
      );
      if (!resolved) {
        return res.status(400).json({
          error: 'External resume link is not supported for download',
          detail:
            'Use a Google Docs/Drive sharing link or a direct file URL (.pdf, .docx).',
          external_url: pathStr,
        });
      }

      let upstream;
      try {
        upstream = await fetch(resolved.fetchUrl, { redirect: 'follow' });
      } catch (err) {
        console.error('external resume fetch failed', err);
        return res.status(502).json({
          error: 'Could not fetch resume from external link',
        });
      }

      if (!upstream.ok) {
        return res.status(502).json({
          error: 'Could not fetch resume from external link',
          detail: `Remote server returned ${upstream.status}`,
          external_url: pathStr,
        });
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      if (looksLikeHtml(buf)) {
        return res.status(502).json({
          error: 'Resume is not publicly downloadable',
          detail:
            'Share the Google Doc as “Anyone with the link” can view, or upload the file on the teacher profile.',
          external_url: pathStr,
        });
      }

      const contentType =
        upstream.headers.get('content-type')?.split(';')[0]?.trim() ||
        resolved.contentType;

      await logActivity(`Resume downloaded – ${teacherName}`, {
        entityType: 'teacher',
        entityId: id,
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${resolved.filename.replace(/"/g, '')}"`
      );
      return res.send(buf);
    }

    const relative = pathStr.replace(/^\/+/, '').replace(/\\/g, '/');
    const filePath = path.join(__dirname, '../../', relative);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Resume is not uploaded',
        detail: 'File missing on server',
      });
    }

    const downloadName =
      rows[0].resume_original_name ||
      path.basename(filePath) ||
      'resume';

    const teacherName = rows[0].name || 'Teacher';
    await logActivity(`Resume downloaded – ${teacherName}`, {
      entityType: 'teacher',
      entityId: id,
    });

    return res.download(filePath, downloadName, (err) => {
      if (err) {
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Could not download resume' });
        }
      }
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function listTeachers(req, res) {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limitRaw = parseInt(String(req.query.limit ?? '10'), 10);
    const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10));
    const offset = (page - 1) * limit;

    const { where, params } = buildTeacherListWhere(req.query);
    const whereSql = `WHERE ${where}`;

    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM teachers ${whereSql}`,
      params
    );
    const total = Number(countRow.total) || 0;
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);

    const [rows] = await pool.query(
      `SELECT * FROM teachers ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const teachers = rows.map((row) => mapTeacherRow(row));

    return res.json({
      page,
      limit,
      total,
      total_pages,
      has_next_page: page < total_pages,
      has_prev_page: page > 1 && total > 0,
      count: teachers.length,
      teachers,
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

const TEACHER_INSERT_SQL = `INSERT INTO teachers (
  name, mobile, email, state, city, address, country,
  ug_college, pg_university, qualifications, qualification, certifications, subjects_taught, area_of_interest,  
  boards_taught, grades_taught, teacher_roles,
  current_location, preferred_location, reason_to_join, where_did_you_hear_about_us,
  current_salary, total_experience, work_experience, skills,
  internal_notes, custom_fields, resume_path, status, resume_original_name
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const TEACHER_UPSERT_BY_ID_SQL = `INSERT INTO teachers (
  id, name, mobile, email, state, city, address, country,
  ug_college, pg_university, qualifications, qualification, certifications, subjects_taught, area_of_interest,  
  boards_taught, grades_taught, teacher_roles,
  current_location, preferred_location, reason_to_join, where_did_you_hear_about_us,
  current_salary, total_experience, work_experience, skills,
  internal_notes, custom_fields, resume_path, status, resume_original_name
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  mobile=VALUES(mobile),
  email=VALUES(email),
  state=VALUES(state),
  city=VALUES(city),
  address=VALUES(address),
  country=VALUES(country),
  ug_college=VALUES(ug_college),
  pg_university=VALUES(pg_university),
  qualifications=VALUES(qualifications),
  qualification=VALUES(qualification),
  certifications=VALUES(certifications),
  subjects_taught=VALUES(subjects_taught),
  area_of_interest=VALUES(area_of_interest),
  boards_taught=VALUES(boards_taught),
  grades_taught=VALUES(grades_taught),
  teacher_roles=VALUES(teacher_roles),
  current_location=VALUES(current_location),
  preferred_location=VALUES(preferred_location),
  reason_to_join=VALUES(reason_to_join),
  where_did_you_hear_about_us=VALUES(where_did_you_hear_about_us),
  current_salary=VALUES(current_salary),
  total_experience=VALUES(total_experience),
  work_experience=VALUES(work_experience),
  skills=VALUES(skills),
  internal_notes=VALUES(internal_notes),
  custom_fields=VALUES(custom_fields),
  resume_path=VALUES(resume_path),
  status=VALUES(status),
  resume_original_name=VALUES(resume_original_name)`;

function teacherInsertValues(f, resume_path, resume_original_name) {
  return [
    f.name,
    f.mobile,
    f.email,
    f.state,
    f.city,
    f.address,
    f.country,
    f.ug_college,
    f.pg_university,
    JSON.stringify(f.qualifications ?? []),
    f.qualification,
    f.certifications,
    JSON.stringify(f.subjects_taught),
    JSON.stringify(f.area_of_interest),
    JSON.stringify(f.boards_taught),
    JSON.stringify(f.grades_taught),
    JSON.stringify(f.teacher_roles),
    f.current_location,
    f.preferred_location,
    JSON.stringify(f.reason_to_join),
    JSON.stringify(f.where_did_you_hear_about_us),
    f.current_salary,
    f.total_experience,
    JSON.stringify(f.work_experience),
    JSON.stringify(f.skills),
    f.internal_notes,
    JSON.stringify(f.custom_fields ?? {}),
    resume_path,
    f.status,
    resume_original_name,
  ];
}

function teacherUpsertValuesWithId(id, f, resume_path, resume_original_name) {
  return [id, ...teacherInsertValues(f, resume_path, resume_original_name)];
}

async function importTeachersFromExcel(req, res) {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      error: 'Upload an Excel file using form field "file" (.xlsx or .xls)',
    });
  }

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) {
    return res.status(400).json({
      error: 'Only .xlsx or .xls files are supported',
    });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch {
    return res.status(400).json({ error: 'Could not read Excel file' });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return res.status(400).json({ error: 'Workbook has no sheets' });
  }

  const sheet = workbook.Sheets[sheetName];
  let rawRows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });
  rawRows = enrichRowsWithResumeLinks(sheet, rawRows);

  const summary = {
    sheet: sheetName,
    total_data_rows: rawRows.length,
    created: 0,
    updated: 0,
    skipped_duplicate_mobile: 0,
    failed: [],
  };

  try {
    const seenMobiles = new Set(); // last-10 digits within this file
    for (let i = 0; i < rawRows.length; i++) {
      const body = bodyFromExcelRow(rawRows[i]);
      if (!body) continue;

      const missing = REQUIRED.filter(
        (k) => body[k] == null || String(body[k]).trim() === ''
      );
      if (missing.length) {
        summary.failed.push({
          excel_row: i + 2,
          reason: 'missing_required',
          fields: missing,
        });
        continue;
      }

      const resume = parseResumeImportValue(body.resume_link);
      const f = fieldsFromTeacherBody(body);
      try {
        const contactId =
          body.id != null && String(body.id).trim() !== ''
            ? parseInt(String(body.id), 10)
            : null;

        // Prevent mobile duplicates (skip row if mobile already exists on a different teacher).
        const mobKey = last10Digits(f.mobile);
        if (mobKey) {
          if (seenMobiles.has(mobKey)) {
            summary.skipped_duplicate_mobile += 1;
            summary.failed.push({
              excel_row: i + 2,
              reason: 'duplicate_mobile_in_file',
              mobile: f.mobile,
            });
            continue;
          }
          seenMobiles.add(mobKey);

          const [dupRows] = await pool.execute(
            'SELECT id, mobile FROM teachers WHERE mobile LIKE ? LIMIT 10',
            [`%${mobKey}`]
          );
          const match = (dupRows || []).find((r) => last10Digits(r.mobile) === mobKey);
          if (match) {
            const existingId = Number(match.id) || null;
            if (!(contactId && existingId && existingId === contactId)) {
              summary.skipped_duplicate_mobile += 1;
              summary.failed.push({
                excel_row: i + 2,
                reason: 'duplicate_mobile',
                mobile: f.mobile,
                existing_teacher_id: existingId,
              });
              continue;
            }
          }
        }

        if (contactId != null && Number.isFinite(contactId) && contactId > 0) {
          const [result] = await pool.execute(
            TEACHER_UPSERT_BY_ID_SQL,
            teacherUpsertValuesWithId(
              contactId,
              f,
              resume.resume_path,
              resume.resume_original_name
            )
          );
          // MySQL: insert=1, update=2, no-op=0
          if (result.affectedRows === 1) summary.created += 1;
          else if (result.affectedRows === 2) summary.updated += 1;
          else summary.updated += 1;
        } else {
          await pool.execute(
            TEACHER_INSERT_SQL,
            teacherInsertValues(
              f,
              resume.resume_path,
              resume.resume_original_name
            )
          );
          summary.created += 1;
        }
      } catch (err) {
        summary.failed.push({
          excel_row: i + 2,
          reason: err.message || 'insert_failed',
          code: err.code,
        });
      }
    }

    if (summary.created > 0) {
      await logActivity(
        summary.created === 1
          ? '1 teacher imported from Excel file'
          : `${summary.created} teachers imported from Excel file`
      );
    }

    return res.json(summary);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  mapTeacherRow,
  createTeacher,
  listTeachers,
  getTeacherById,
  downloadTeacherResume,
  updateTeacher,
  deleteTeacher,
  importTeachersFromExcel,
  exportTeachers,
  bulkDeleteTeachers,
};
