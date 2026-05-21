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
      ' AND (name LIKE ? OR email LIKE ? OR mobile LIKE ? OR city LIKE ? OR subject_taught LIKE ?)';
    params.push(term, term, term, term, term);
  }

  const subjects = parseQueryList(query.subject);
  if (subjects.length === 1) {
    where += ' AND TRIM(subject_taught) = ?';
    params.push(subjects[0]);
  } else if (subjects.length > 1) {
    where += ` AND TRIM(subject_taught) IN (${subjects.map(() => '?').join(',')})`;
    params.push(...subjects);
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
  if (qualifications.length === 1) {
    where += ' AND TRIM(qualification) = ?';
    params.push(qualifications[0]);
  }

  const areas = parseQueryList(query.area_of_interest ?? query.area);
  if (areas.length === 1) {
    where += ' AND TRIM(area_of_interest) = ?';
    params.push(areas[0]);
  }

  const addJsonContains = (col, values) => {
    for (const v of values) {
      where += ` AND JSON_CONTAINS(COALESCE(${col}, JSON_ARRAY()), JSON_QUOTE(?))`;
      params.push(v);
    }
  };

  const boards = parseQueryList(query.board);
  if (boards.length) addJsonContains('boards_taught', boards);

  const grades = parseQueryList(query.grade);
  if (grades.length) addJsonContains('grades_taught', grades);

  const roles = parseQueryList(query.role);
  if (roles.length) addJsonContains('teacher_roles', roles);

  return { where, params };
}

module.exports = { buildTeacherListWhere, parseQueryList };
