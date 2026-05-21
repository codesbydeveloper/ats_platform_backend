const { Router } = require('express');
const {
  createCategory,
  createSubcategory,
  listCategories,
  listAllCategories,
  listLookupFieldOptions,
  listLookupFieldTeachers,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');

const router = Router();

router.get('/lookup/:slug/options', listLookupFieldOptions);
router.get('/lookup/:slug/teachers', listLookupFieldTeachers);
router.get('/', listCategories);
router.get('/all', listAllCategories);
router.post('/', createCategory);
router.post('/:id/subcategories', createSubcategory);
router.put('/:id', updateCategory);
router.delete('/:id', deleteCategory);

module.exports = router;
