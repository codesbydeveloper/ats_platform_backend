const { Router } = require('express');
const {
  getTeacherForm,
  replaceTeacherForm,
  addSection,
  updateSection,
  deleteSection,
  addField,
  updateField,
  deleteField,
} = require('../controllers/teacherFormController');

const router = Router();

router.get('/', getTeacherForm);
router.put('/', replaceTeacherForm);
router.post('/sections', addSection);
router.patch('/sections/:sectionId', updateSection);
router.delete('/sections/:sectionId', deleteSection);
router.post('/sections/:sectionId/fields', addField);
router.patch('/fields/:fieldKey', updateField);
router.delete('/fields/:fieldKey', deleteField);

module.exports = router;
