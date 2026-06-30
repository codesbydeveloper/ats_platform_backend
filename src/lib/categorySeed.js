const pool = require('../config/database');

const DEFAULT_TEACHER_ROLES = [
  'Class Teacher',
  'Subject Teacher',
  'HOD',
  'Coordinator',
  'Tutor',
  'Examiner',
];

/** Ensure "Teacher Roles" category exists with default sub-items (for dropdowns). */
async function ensureTeacherRolesCategory() {
  const [roots] = await pool.execute(
    `SELECT id FROM categories
     WHERE parent_id IS NULL AND LOWER(TRIM(name)) = 'teacher roles'
     LIMIT 1`
  );

  let parentId = roots[0]?.id;
  if (!parentId) {
    const [ins] = await pool.execute(
      'INSERT INTO categories (name, parent_id) VALUES (?, NULL)',
      ['Teacher Roles']
    );
    parentId = ins.insertId;
  }

  for (const name of DEFAULT_TEACHER_ROLES) {
    await pool.execute(
      `INSERT INTO categories (name, parent_id)
       SELECT ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM categories WHERE parent_id = ? AND name = ?
       )`,
      [name, parentId, parentId, name]
    );
  }

  return parentId;
}

module.exports = { ensureTeacherRolesCategory, DEFAULT_TEACHER_ROLES };
