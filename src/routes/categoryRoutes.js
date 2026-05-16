const { Router } = require('express');
const {
  createCategory,
  createSubcategory,
  listCategories,
  listAllCategories,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');

const router = Router();

router.get('/', listCategories);
router.get('/all', listAllCategories);
router.post('/', createCategory);
router.post('/:id/subcategories', createSubcategory);
router.put('/:id', updateCategory);
router.delete('/:id', deleteCategory);

module.exports = router;
