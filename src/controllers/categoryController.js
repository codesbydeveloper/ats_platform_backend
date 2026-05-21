const pool = require('../config/database');
const { logActivity } = require('../lib/activityLog');
const {
  getLookupField,
  LOOKUP_FIELDS,
} = require('../lib/lookupFields');
const {
  getDistinctTeacherFieldValues,
  buildTeacherFilterForLookup,
} = require('../lib/lookupTeacherValues');
const { mapTeacherRow } = require('./teacherController');

function toName(v) {
  if (v == null) return '';
  return String(v).trim();
}

/** POST body: { name | category_name, sub_items? (array of strings) } */
async function createCategory(req, res) {
  const body = req.body || {};
  const name = toName(body.name ?? body.category_name);
  const subRaw =
    body.sub_items ?? body.subcategories ?? body.subcategory_names ?? [];

  if (!name) {
    return res.status(400).json({
      error: 'name (or category_name) is required',
    });
  }

  const subs = Array.isArray(subRaw)
    ? subRaw.map((s) => toName(s)).filter(Boolean)
    : [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.execute(
      'INSERT INTO categories (name, parent_id) VALUES (?, NULL)',
      [name]
    );
    const parentId = ins.insertId;
    const sub_items = [];
    for (const s of subs) {
      const [subIns] = await conn.execute(
        'INSERT INTO categories (name, parent_id) VALUES (?, ?)',
        [s, parentId]
      );
      sub_items.push({ id: subIns.insertId, name: s });
    }
    await conn.commit();
    await logActivity(`New category created – ${name}`, {
      entityType: 'category',
      entityId: parentId,
    });
    for (const sub of sub_items) {
      await logActivity(`New sub-item added – ${sub.name}`, {
        entityType: 'category',
        entityId: sub.id,
      });
    }
    return res.status(201).json({
      id: parentId,
      name,
      sub_items,
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
}

async function createSubcategory(req, res) {
  const parentId = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(parentId) || parentId < 1) {
    return res.status(400).json({ error: 'Invalid parent category id' });
  }

  const name = toName(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const [parents] = await pool.execute(
      'SELECT id FROM categories WHERE id = ? LIMIT 1',
      [parentId]
    );
    if (!parents.length) {
      return res.status(404).json({ error: 'Parent category not found' });
    }

    const [result] = await pool.execute(
      'INSERT INTO categories (name, parent_id) VALUES (?, ?)',
      [name, parentId]
    );
    await logActivity(`New sub-item added – ${name}`, {
      entityType: 'category',
      entityId: result.insertId,
    });
    return res.status(201).json({
      id: result.insertId,
      name,
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

function rowsToTree(rows) {
  const byId = new Map();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      parent_id: r.parent_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      children: [],
    });
  }
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id == null) {
      roots.push(node);
    } else {
      const p = byId.get(node.parent_id);
      if (p) p.children.push(node);
      else roots.push(node);
    }
  }
  for (const n of byId.values()) {
    n.children.sort((a, b) => a.id - b.id);
  }
  roots.sort((a, b) => a.id - b.id);
  const strip = (n) => ({
    id: n.id,
    name: n.name,
    created_at: n.created_at,
    updated_at: n.updated_at,
    children: n.children.map(strip),
  });
  return roots.map(strip);
}

/** All categories + sub-items — no pagination (for "Your categories" UI). */
async function listAllCategories(req, res) {
  try {
    const [allRows] = await pool.execute(
      `SELECT id, name, parent_id, created_at, updated_at
       FROM categories
       ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, id DESC`
    );
    const categories = rowsToTree(allRows);
    categories.sort((a, b) => b.id - a.id);
    return res.json({
      count: categories.length,
      categories,
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

/**
 * GET /api/categories/lookup/:slug/options?page=&limit=&q=
 * Distinct values teachers filled for this field (e.g. each subject + how many teachers).
 */
async function listLookupFieldOptions(req, res) {
  const field = getLookupField(req.params.slug);
  if (!field) {
    return res.status(400).json({
      error: 'Invalid lookup field slug',
      valid_slugs: LOOKUP_FIELDS.map((f) => f.slug),
    });
  }

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limitRaw = parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10)
  );
  const q = req.query.q != null ? String(req.query.q).trim() : '';

  try {
    const result = await getDistinctTeacherFieldValues(
      field.slug,
      page,
      limit,
      q
    );
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const total = result.total ?? 0;
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);

    return res.json({
      slug: field.slug,
      field: field.label,
      data_source: result.data_source ?? 'teachers',
      page,
      limit,
      total,
      total_pages,
      has_next_page: page < total_pages,
      has_prev_page: page > 1 && total > 0,
      count: result.options.length,
      options: result.options,
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

/**
 * GET /api/categories/lookup/:slug/teachers?value=&page=&limit=
 * Teachers who have the selected field value (e.g. subject = Global Politics).
 */
async function listLookupFieldTeachers(req, res) {
  const field = getLookupField(req.params.slug);
  if (!field) {
    return res.status(400).json({
      error: 'Invalid lookup field slug',
      valid_slugs: LOOKUP_FIELDS.map((f) => f.slug),
    });
  }

  const value = req.query.value ?? req.query.name;
  const teacherId = req.query.teacher_id ?? req.query.teacherId;
  const filter = buildTeacherFilterForLookup(field.slug, value, teacherId);
  if (filter.error) {
    return res.status(400).json({ error: filter.error });
  }

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limitRaw = parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10)
  );
  const offset = (page - 1) * limit;

  try {
    const where = `WHERE ${filter.where}`;
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM teachers ${where}`,
      filter.params
    );
    const total = Number(countRow.total) || 0;
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);

    const [rows] = await pool.query(
      `SELECT * FROM teachers ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...filter.params, limit, offset]
    );
    const teachers = rows.map((row) => mapTeacherRow(row));

    return res.json({
      slug: field.slug,
      field: field.label,
      value: String(value).trim(),
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
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function listCategories(req, res) {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limitRaw = parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10));
  const offset = (page - 1) * limit;

  try {
    const [[countRow]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM categories WHERE parent_id IS NULL'
    );
    const total = Number(countRow.total) || 0;
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);

    const [roots] = await pool.query(
      'SELECT id, name, parent_id, created_at, updated_at FROM categories WHERE parent_id IS NULL ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    if (!roots.length) {
      return res.json({
        page,
        limit,
        total,
        total_pages,
        has_next_page: false,
        has_prev_page: false,
        count: 0,
        categories: [],
      });
    }

    const rootIds = roots.map((r) => r.id);
    const allIds = new Set(rootIds);
    let frontier = [...rootIds];
    while (frontier.length) {
      const ph = frontier.map(() => '?').join(',');
      const [ch] = await pool.query(
        `SELECT id, parent_id FROM categories WHERE parent_id IN (${ph})`,
        frontier
      );
      const next = [];
      for (const c of ch) {
        if (!allIds.has(c.id)) {
          allIds.add(c.id);
          next.push(c.id);
        }
      }
      frontier = next;
    }

    const idList = [...allIds];
    const ph2 = idList.map(() => '?').join(',');
    const [allRows] = await pool.query(
      `SELECT id, name, parent_id, created_at, updated_at FROM categories WHERE id IN (${ph2}) ORDER BY id ASC`,
      idList
    );

    const trees = rowsToTree(allRows);
    const byRootId = new Map(trees.map((t) => [t.id, t]));
    const categories = rootIds
      .map((id) => byRootId.get(id))
      .filter(Boolean);

    return res.json({
      page,
      limit,
      total,
      total_pages,
      has_next_page: page < total_pages,
      has_prev_page: page > 1 && total > 0,
      count: categories.length,
      categories,
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

async function updateCategory(req, res) {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid category id' });
  }

  const name = toName(req.body?.name ?? req.body?.category_name);
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const [existing] = await pool.execute(
      'SELECT id, parent_id, name AS old_name FROM categories WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await pool.execute('UPDATE categories SET name = ? WHERE id = ?', [name, id]);

    const isSub = existing[0].parent_id != null;
    await logActivity(
      isSub ? `Sub-item updated – ${name}` : `Category updated – ${name}`,
      { entityType: 'category', entityId: id }
    );
    return res.json({
      id,
      name,
      type: isSub ? 'sub_item' : 'category',
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

async function deleteCategory(req, res) {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid category id' });
  }

  try {
    const [existing] = await pool.execute(
      'SELECT id, parent_id, name FROM categories WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const isSub = existing[0].parent_id != null;
    const catName = existing[0].name;

    const [result] = await pool.execute('DELETE FROM categories WHERE id = ?', [
      id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await logActivity(
      isSub
        ? `Sub-item deleted – ${catName}`
        : `Category deleted – ${catName}`,
      { entityType: 'category', entityId: id }
    );
    return res.json({
      ok: true,
      id,
      type: isSub ? 'sub_item' : 'category',
      message: isSub
        ? 'Sub-item deleted'
        : 'Category and all sub-items deleted',
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

module.exports = {
  createCategory,
  createSubcategory,
  listCategories,
  listAllCategories,
  listLookupFieldOptions,
  listLookupFieldTeachers,
  updateCategory,
  deleteCategory,
};
