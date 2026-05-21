/** Lookup field slugs — must match frontend `lookup-menu.ts`. */
const LOOKUP_FIELDS = [
  {
    slug: 'educational-qualification',
    label: 'Educational Qualification',
    match: ['educational qualification', 'educational'],
  },
  {
    slug: 'qualification-certification',
    label: 'Qualification / Certification',
    match: ['qualification / certification', 'qualification', 'certification'],
  },
  {
    slug: 'subjects-taught',
    label: 'Subjects Taught',
    match: ['subjects taught', 'subject'],
  },
  {
    slug: 'boards-taught',
    label: 'Boards Taught',
    match: ['boards taught', 'board'],
  },
  {
    slug: 'grades-taught',
    label: 'Grades Taught',
    match: ['grades taught', 'grade'],
  },
  {
    slug: 'state-wise',
    label: 'State Wise',
    match: ['state wise', 'state', 'states'],
  },
  {
    slug: 'city-wise',
    label: 'City Wise',
    match: ['city wise', 'city', 'cities'],
  },
  {
    slug: 'area-of-interest',
    label: 'Area Of Interest',
    match: ['area of interest', 'interest'],
  },
  {
    slug: 'teacher-roles',
    label: 'Teacher Roles',
    match: ['teacher roles', 'role'],
  },
];

function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

function getLookupField(slug) {
  if (!slug) return null;
  const key = String(slug).trim().toLowerCase();
  return LOOKUP_FIELDS.find((f) => f.slug === key) ?? null;
}

/** Find top-level category row for a lookup field (same rules as the frontend). */
function findParentCategory(roots, field) {
  const target = normalizeName(field.label);
  const exact = roots.find((c) => normalizeName(c.name) === target);
  if (exact) return exact;

  for (const hint of field.match) {
    const h = normalizeName(hint);
    const found = roots.find((c) => {
      const n = normalizeName(c.name);
      return n === h || n.includes(h) || h.includes(n);
    });
    if (found) return found;
  }
  return null;
}

module.exports = {
  LOOKUP_FIELDS,
  getLookupField,
  findParentCategory,
  normalizeName,
};
