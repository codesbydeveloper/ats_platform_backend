const { Router } = require('express');
const {
  getTableColumns,
  upsertTableColumns,
} = require('../controllers/tableColumnsController');

const router = Router();

// GET /api/table-columns/teachers
router.get('/:tableName', getTableColumns);
// PUT or POST /api/table-columns/teachers  body: { columns: string[] }
router.put('/:tableName', upsertTableColumns);
router.post('/:tableName', upsertTableColumns);

module.exports = router;

