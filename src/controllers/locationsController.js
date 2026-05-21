const pool = require('../config/database');
const { STATES, CITIES_BY_STATE } = require('../data/locationsSeed');

function mergeUnique(sorted, extra) {
  const set = new Set(sorted);
  for (const x of extra) {
    const t = String(x).trim();
    if (t) set.add(t);
  }
  return [...set].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

async function fetchTeacherLocations() {
  try {
    const [rows] = await pool.execute(
      `SELECT TRIM(state) AS state, TRIM(city) AS city
       FROM teachers
       WHERE (state IS NOT NULL AND TRIM(state) <> '')
          OR (city IS NOT NULL AND TRIM(city) <> '')`
    );
    return rows;
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    throw err;
  }
}

async function buildLocationsPayload() {
  const teacherRows = await fetchTeacherLocations();

  const statesFromTeachers = teacherRows
    .map((r) => r.state)
    .filter(Boolean);
  const states = mergeUnique([...STATES], statesFromTeachers);

  const cities = { ...CITIES_BY_STATE };
  for (const st of states) {
    if (!cities[st]) cities[st] = [];
  }

  for (const row of teacherRows) {
    const st = row.state;
    const city = row.city;
    if (!st || !city) continue;
    if (!cities[st]) cities[st] = [];
    if (!cities[st].includes(city)) {
      cities[st].push(city);
    }
  }

  for (const st of Object.keys(cities)) {
    cities[st].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }

  const allCities = mergeUnique(
    [],
    Object.values(cities).flat()
  );

  return {
    states,
    cities_by_state: cities,
    cities: allCities,
    total_states: states.length,
    total_cities: allCities.length,
  };
}

/** GET /api/locations — all states + cities grouped by state */
async function getLocations(req, res) {
  try {
    const data = await buildLocationsPayload();
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/** GET /api/locations/states — state names only */
async function getStates(req, res) {
  try {
    const data = await buildLocationsPayload();
    return res.json({
      count: data.states.length,
      states: data.states,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/** GET /api/locations/cities?state=Karnataka — cities (all states if no query) */
async function getCities(req, res) {
  try {
    const data = await buildLocationsPayload();
    const stateFilter =
      req.query.state != null ? String(req.query.state).trim() : '';

    if (stateFilter) {
      const cities = data.cities_by_state[stateFilter] ?? [];
      return res.json({
        state: stateFilter,
        count: cities.length,
        cities,
      });
    }

    return res.json({
      count: data.total_cities,
      cities_by_state: data.cities_by_state,
      cities: data.cities,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  getLocations,
  getStates,
  getCities,
};
