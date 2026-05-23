const {
  loadTeacherFormConfig,
  saveTeacherFormConfig,
  normalizeConfig,
  findSection,
  findField,
  slugifyId,
  FIELD_TYPES,
} = require('../lib/teacherFormConfig');

async function getTeacherForm(req, res) {
  try {
    const config = await loadTeacherFormConfig();
    return res.json(config);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    if (err.message && err.message.startsWith('Duplicate field key')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function replaceTeacherForm(req, res) {
  try {
    const config = await saveTeacherFormConfig(req.body || {});
    return res.json(config);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        error: 'Database not ready. Run: npm run migrate',
      });
    }
    if (err.message && err.message.startsWith('Duplicate field key')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function addSection(req, res) {
  const body = req.body || {};
  const title = body.title != null ? String(body.title).trim() : '';
  if (!title) {
    return res.status(400).json({ error: 'Section title is required' });
  }

  try {
    const config = await loadTeacherFormConfig();
    const id = slugifyId(body.id || title, 'section');
    if (findSection(config, id)) {
      return res.status(409).json({ error: 'Section id already exists', id });
    }

    const maxOrder = config.sections.reduce(
      (m, s) => Math.max(m, s.sortOrder),
      -1
    );

    config.sections.push({
      id,
      title,
      description: body.description != null ? String(body.description) : null,
      sortOrder: maxOrder + 1,
      builtIn: false,
      component: body.component != null ? String(body.component) : null,
      fields: [],
    });

    const saved = await saveTeacherFormConfig(config);
    return res.status(201).json(findSection(saved, id));
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

async function updateSection(req, res) {
  const sectionId = String(req.params.sectionId || '').trim();
  const body = req.body || {};

  try {
    const config = await loadTeacherFormConfig();
    const section = findSection(config, sectionId);
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (body.title != null) {
      const title = String(body.title).trim();
      if (!title) {
        return res.status(400).json({ error: 'Section title cannot be empty' });
      }
      section.title = title;
    }
    if (body.description !== undefined) {
      section.description =
        body.description != null ? String(body.description) : null;
    }
    if (body.sortOrder != null && Number.isFinite(Number(body.sortOrder))) {
      section.sortOrder = Number(body.sortOrder);
    }

    const saved = await saveTeacherFormConfig(config);
    return res.json(findSection(saved, sectionId));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function deleteSection(req, res) {
  const sectionId = String(req.params.sectionId || '').trim();

  try {
    const config = await loadTeacherFormConfig();
    const section = findSection(config, sectionId);
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    config.sections = config.sections.filter((s) => s.id !== sectionId);
    if (config.sections.length === 0) {
      return res.status(400).json({
        error: 'Cannot remove the last section',
      });
    }

    const saved = await saveTeacherFormConfig(config);
    return res.json({ ok: true, config: saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function addField(req, res) {
  const sectionId = String(req.params.sectionId || '').trim();
  const body = req.body || {};
  const label = body.label != null ? String(body.label).trim() : '';
  if (!label) {
    return res.status(400).json({ error: 'Field label is required' });
  }

  const type = body.type != null ? String(body.type) : 'text';
  if (!FIELD_TYPES.has(type)) {
    return res.status(400).json({
      error: 'Invalid field type',
      allowed: [...FIELD_TYPES],
    });
  }

  try {
    const config = await loadTeacherFormConfig();
    const section = findSection(config, sectionId);
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    const key = slugifyId(body.key || label, 'field').replace(/-/g, '_');
    if (findField(config, key)) {
      return res.status(409).json({ error: 'Field key already exists', key });
    }

    const maxOrder = section.fields.reduce(
      (m, f) => Math.max(m, f.sortOrder),
      -1
    );

    const field = {
      id: slugifyId(body.id || key, 'field'),
      key,
      label,
      type,
      required: Boolean(body.required),
      builtIn: false,
      mapsTo: null,
      options: Array.isArray(body.options) ? body.options : [],
      sortOrder: maxOrder + 1,
    };

    section.fields.push(field);
    const saved = await saveTeacherFormConfig(config);
    const updated = findSection(saved, sectionId);
    const created = updated.fields.find((f) => f.key === key);
    return res.status(201).json(created);
  } catch (err) {
    if (err.message && err.message.startsWith('Duplicate field key')) {
      return res.status(409).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function updateField(req, res) {
  const fieldKey = String(req.params.fieldKey || '').trim();
  const body = req.body || {};

  try {
    const config = await loadTeacherFormConfig();
    const hit = findField(config, fieldKey);
    if (!hit) {
      return res.status(404).json({ error: 'Field not found' });
    }

    const { field } = hit;
    if (body.label != null) {
      const label = String(body.label).trim();
      if (!label) {
        return res.status(400).json({ error: 'Field label cannot be empty' });
      }
      field.label = label;
    }
    if (body.type != null) {
      const type = String(body.type);
      if (!FIELD_TYPES.has(type)) {
        return res.status(400).json({
          error: 'Invalid field type',
          allowed: [...FIELD_TYPES],
        });
      }
      field.type = type;
    }
    if (body.required !== undefined) {
      field.required = Boolean(body.required);
    }
    if (body.options !== undefined) {
      field.options = Array.isArray(body.options) ? body.options : [];
    }
    if (body.sortOrder != null && Number.isFinite(Number(body.sortOrder))) {
      field.sortOrder = Number(body.sortOrder);
    }
    if (body.sectionId != null) {
      const targetId = String(body.sectionId).trim();
      const target = findSection(config, targetId);
      if (!target) {
        return res.status(404).json({ error: 'Target section not found' });
      }
      hit.section.fields = hit.section.fields.filter((f) => f.key !== field.key);
      target.fields.push(field);
    }

    const saved = await saveTeacherFormConfig(config);
    const updated = findField(saved, field.key);
    return res.json(updated.field);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function deleteField(req, res) {
  const fieldKey = String(req.params.fieldKey || '').trim();

  try {
    const config = await loadTeacherFormConfig();
    const hit = findField(config, fieldKey);
    if (!hit) {
      return res.status(404).json({ error: 'Field not found' });
    }

    hit.section.fields = hit.section.fields.filter(
      (f) => f.key !== hit.field.key
    );

    const saved = await saveTeacherFormConfig(config);
    return res.json({ ok: true, config: saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  getTeacherForm,
  replaceTeacherForm,
  addSection,
  updateSection,
  deleteSection,
  addField,
  updateField,
  deleteField,
};
