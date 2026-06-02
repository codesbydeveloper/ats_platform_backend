function parseQueryList(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  const s = String(val).trim();
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildTeacherListWhere(query) {
  const params = [];
  let where = '1=1';

  const search = query.q != null ? String(query.q).trim() : '';
  if (search) {
    const term = `%${search}%`;
    where +=
      ' AND (name LIKE ? OR email LIKE ? OR mobile LIKE ? OR city LIKE ?)';
    params.push(term, term, term, term);
  }

  const name = query.name != null ? String(query.name).trim() : '';
  if (name) {
    where += ' AND name LIKE ?';
    params.push(`%${name}%`);
  }

  const emailRaw = query.email ?? query.email_id ?? query.emailId;
  const emails = parseQueryList(emailRaw);
  if (emails.length === 1) {
    where += ' AND email LIKE ?';
    params.push(`%${emails[0]}%`);
  } else if (emails.length > 1) {
    where += ` AND (${emails.map(() => 'email LIKE ?').join(' OR ')})`;
    params.push(...emails.map((e) => `%${e}%`));
  }

  const mobileRaw = query.mobile ?? query.phone ?? query.phone_number ?? query.phoneNumber;
  const mobiles = parseQueryList(mobileRaw);
  if (mobiles.length === 1) {
    where += ' AND mobile LIKE ?';
    params.push(`%${mobiles[0]}%`);
  } else if (mobiles.length > 1) {
    where += ` AND (${mobiles.map(() => 'mobile LIKE ?').join(' OR ')})`;
    params.push(...mobiles.map((m) => `%${m}%`));
  }

  const countryRaw = query.country ?? query.nationality;
  const countries = parseQueryList(countryRaw);
  if (countries.length === 1) {
    where += ' AND TRIM(country) = ?';
    params.push(countries[0]);
  } else if (countries.length > 1) {
    where += ` AND TRIM(country) IN (${countries.map(() => '?').join(',')})`;
    params.push(...countries);
  }

  const notes = query.notes != null ? String(query.notes).trim() : '';
  if (notes) {
    where += ' AND internal_notes LIKE ?';
    params.push(`%${notes}%`);
  }

  const cities = parseQueryList(query.city);
  if (cities.length === 1) {
    where += ' AND TRIM(city) = ?';
    params.push(cities[0]);
  } else if (cities.length > 1) {
    where += ` AND TRIM(city) IN (${cities.map(() => '?').join(',')})`;
    params.push(...cities);
  }

  const states = parseQueryList(query.state);
  if (states.length === 1) {
    where += ' AND TRIM(state) = ?';
    params.push(states[0]);
  } else if (states.length > 1) {
    where += ` AND TRIM(state) IN (${states.map(() => '?').join(',')})`;
    params.push(...states);
  }

  const statuses = parseQueryList(query.status);
  if (statuses.length === 1) {
    where += ' AND status = ?';
    params.push(statuses[0]);
  } else if (statuses.length > 1) {
    where += ` AND status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }

  const qualifications = parseQueryList(query.qualification);
  if (qualifications.length) {
    for (const q of qualifications) {
      // New storage: qualifications JSON array. Backward-compat: also check legacy scalar column.
      where +=
        ' AND (JSON_CONTAINS(COALESCE(qualifications, JSON_ARRAY()), JSON_QUOTE(?)) OR TRIM(qualification) = ?)';
      params.push(q, q);
    }
  }

  const certifications = query.certifications ?? query.certification;
  const certList = parseQueryList(certifications);
  if (certList.length === 1) {
    where += ' AND certifications LIKE ?';
    params.push(`%${certList[0]}%`);
  } else if (certList.length > 1) {
    where += ` AND (${certList.map(() => 'certifications LIKE ?').join(' OR ')})`;
    params.push(...certList.map((c) => `%${c}%`));
  }

  const preferredRaw =
    query.preferred_location ?? query.preferred ?? query.preferredLocation;
  const preferred = parseQueryList(preferredRaw);
  if (preferred.length === 1) {
    where += ' AND preferred_location LIKE ?';
    params.push(`%${preferred[0]}%`);
  } else if (preferred.length > 1) {
    where += ` AND (${preferred.map(() => 'preferred_location LIKE ?').join(' OR ')})`;
    params.push(...preferred.map((p) => `%${p}%`));
  }

  const ugRaw =
    query.ug_college ?? query.ug ?? query.college_ug ?? query.collegeUg;
  const ugList = parseQueryList(ugRaw);
  if (ugList.length === 1) {
    where += ' AND ug_college LIKE ?';
    params.push(`%${ugList[0]}%`);
  } else if (ugList.length > 1) {
    where += ` AND (${ugList.map(() => 'ug_college LIKE ?').join(' OR ')})`;
    params.push(...ugList.map((u) => `%${u}%`));
  }

  const pgRaw =
    query.pg_university ?? query.pg ?? query.university_pg ?? query.universityPg;
  const pgList = parseQueryList(pgRaw);
  if (pgList.length === 1) {
    where += ' AND pg_university LIKE ?';
    params.push(`%${pgList[0]}%`);
  } else if (pgList.length > 1) {
    where += ` AND (${pgList.map(() => 'pg_university LIKE ?').join(' OR ')})`;
    params.push(...pgList.map((p) => `%${p}%`));
  }

  const addJsonContains = (col, values) => {
    for (const v of values) {
      where += ` AND JSON_CONTAINS(COALESCE(${col}, JSON_ARRAY()), JSON_QUOTE(?))`;
      params.push(v);
    }
  };

  const subjects = parseQueryList(
    query.subjects_taught ?? query.subject_taught ?? query.subject
  );
  if (subjects.length) addJsonContains('subjects_taught', subjects);

  const boards = parseQueryList(query.board);
  if (boards.length) addJsonContains('boards_taught', boards);

  const grades = parseQueryList(query.grade);
  if (grades.length) addJsonContains('grades_taught', grades);

  const roles = parseQueryList(query.role);
  if (roles.length) addJsonContains('teacher_roles', roles);

  const reasons = parseQueryList(
    query.reason_to_join ?? query.reason ?? query.reasonToJoin
  );
  if (reasons.length) addJsonContains('reason_to_join', reasons);

  const areas = parseQueryList(
    query.areas_of_interest ?? query.area_of_interest ?? query.area
  );
  if (areas.length) addJsonContains('area_of_interest', areas);

  return { where, params };
}

module.exports = { buildTeacherListWhere, parseQueryList };
