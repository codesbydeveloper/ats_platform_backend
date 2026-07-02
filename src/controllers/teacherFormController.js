const {
  loadTeacherFormConfig,
  saveTeacherFormConfig,
  normalizeConfig,
  findSection,
  findField,
  slugifyId,
  FIELD_TYPES,
  resolveFieldType,
  parseOptionsInput,
  normalizeFieldKey,
  applyFieldTypeRules,
  fieldToApi,
} = require('../lib/teacherFormConfig');

function toFilterFlag(val) {
  if (val === true) return 1;
  if (val === false || val == null) return 0;
  const n = parseInt(String(val), 10);
  return n === 1 ? 1 : 0;
}

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

function toIdList(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * PATCH /api/teacher-form/reorder
 *
 * Accepts either:
 * - Full config { version, sections: [...] } (same as PUT /api/teacher-form), OR
 * - Reorder payload:
 *   {
 *     section_order?: string[],
 *     field_orders?: { [sectionId: string]: string[] } // list of field keys/ids
 *   }
 */
async function reorderTeacherForm(req, res) {
  const body = req.body || {};
  try {
    // If frontend sends the full config after drag-drop, just save it.
    if (body && typeof body === 'object' && Array.isArray(body.sections)) {
      const saved = await saveTeacherFormConfig(body);
      return res.json(saved);
    }

    const section_order = toIdList(body.section_order ?? body.sectionOrder);
    const field_orders =
      body.field_orders && typeof body.field_orders === 'object'
        ? body.field_orders
        : body.fieldOrders && typeof body.fieldOrders === 'object'
          ? body.fieldOrders
          : null;

    const config = await loadTeacherFormConfig();

    // Reorder sections.
    if (section_order.length) {
      const byId = new Map(config.sections.map((s) => [s.id, s]));
      const ordered = [];
      for (const id of section_order) {
        const sec = byId.get(id);
        if (sec) ordered.push(sec);
      }
      for (const sec of config.sections) {
        if (!ordered.includes(sec)) ordered.push(sec);
      }
      ordered.forEach((sec, i) => {
        sec.sortOrder = i;
      });
      config.sections = ordered;
    }

    // Reorder/move fields inside sections.
    if (field_orders) {
      // Build a global index to find current location by key/id.
      const index = new Map();
      for (const sec of config.sections) {
        for (const f of sec.fields) {
          index.set(f.key, { sec, f });
          index.set(f.id, { sec, f });
        }
      }

      for (const [sectionIdRaw, listRaw] of Object.entries(field_orders)) {
        const sectionId = String(sectionIdRaw).trim();
        const orderList = toIdList(listRaw);
        if (!sectionId || orderList.length === 0) continue;

        const target = findSection(config, sectionId);
        if (!target) continue;

        const next = [];
        for (const fieldRef of orderList) {
          const hit = index.get(fieldRef);
          if (!hit) continue;
          const { sec: fromSec, f } = hit;
          // Remove from old section if moving.
          if (fromSec !== target) {
            fromSec.fields = fromSec.fields.filter((x) => x.key !== f.key);
          } else {
            target.fields = target.fields.filter((x) => x.key !== f.key);
          }
          next.push(f);
          index.set(f.key, { sec: target, f });
          index.set(f.id, { sec: target, f });
        }

        // Append anything not mentioned (keep current order).
        for (const f of target.fields) {
          if (!next.find((x) => x.key === f.key)) next.push(f);
        }

        next.forEach((f, i) => {
          f.sortOrder = i;
        });
        target.fields = next;
      }
    }

    const saved = await saveTeacherFormConfig(config);
    return res.json(saved);
  } catch (err) {
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

  const typeRaw = body.type != null ? String(body.type) : 'text';
  const resolvedType = resolveFieldType(typeRaw);
  if (!resolvedType) {
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

    const key =
      normalizeFieldKey(body.key, label) ||
      slugifyId(body.key || label, 'field').replace(/-/g, '_');
    if (!key || key.includes(',')) {
      return res.status(400).json({
        error: 'Enter one field key (no commas). Use the work-role bundle for multiple fields.',
      });
    }
    if (findField(config, key)) {
      return res.status(409).json({ error: 'Field key already exists', key });
    }

    const maxOrder = section.fields.reduce(
      (m, f) => Math.max(m, f.sortOrder),
      -1
    );

    const field = fieldToApi(
      applyFieldTypeRules({
        id: slugifyId(body.id || key, 'field'),
        key,
        label,
        type: resolvedType,
        required: Boolean(body.required),
        filter: toFilterFlag(body.filter),
        builtIn: false,
        mapsTo: null,
        options: parseOptionsInput(body.options),
        categorySlug: body.categorySlug ?? body.category_slug ?? null,
        multiple: body.multiple,
        selection_mode: body.selection_mode ?? body.selectionMode,
        sortOrder: maxOrder + 1,
      })
    );

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
      const nextLabel = String(body.label).trim();
      if (!nextLabel) {
        return res.status(400).json({ error: 'Field label cannot be empty' });
      }
      field.label = nextLabel;
    }
    if (body.type != null) {
      const resolvedType = resolveFieldType(body.type);
      if (!resolvedType) {
        return res.status(400).json({
          error: 'Invalid field type',
          allowed: [...FIELD_TYPES],
        });
      }
      field.type = resolvedType;
    }
    if (body.required !== undefined) {
      field.required = Boolean(body.required);
    }
    if (body.filter !== undefined) {
      field.filter = toFilterFlag(body.filter);
    }
    if (body.options !== undefined) {
      field.options = parseOptionsInput(body.options);
    }
    if (body.multiple !== undefined) {
      field.multiple = body.multiple;
    }
    if (body.selection_mode !== undefined || body.selectionMode !== undefined) {
      field.selection_mode = body.selection_mode ?? body.selectionMode;
    }
    Object.assign(field, fieldToApi(applyFieldTypeRules(field)));
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
  reorderTeacherForm,
  addSection,
  updateSection,
  deleteSection,
  addField,
  updateField,
  deleteField,
};
