const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const {
  createTeacher,
  listTeachers,
  getTeacherById,
  downloadTeacherResume,
  updateTeacher,
  deleteTeacher,
  importTeachersFromExcel,
  getTeacherImportColumns,
  downloadTeacherImportTemplate,
  exportTeachers,
  bulkDeleteTeachers,
} = require('../controllers/teacherController');
const { parseResume } = require('../controllers/resumeParserController');

const uploadDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    cb(
      null,
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
    );
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

function maybeResumeUpload(req, res, next) {
  if (req.is('multipart/form-data')) {
    return upload.single('resume')(req, res, next);
  }
  next();
}

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const uploadResumeMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = Router();

router.post('/parse-resume', uploadResumeMem.single('resume'), parseResume);

router.get('/', listTeachers);
router.get('/export', exportTeachers);
router.post('/export', exportTeachers);
router.get('/import/columns', getTeacherImportColumns);
router.get('/import/template', downloadTeacherImportTemplate);
router.post('/bulk-delete', bulkDeleteTeachers);
router.get('/:id/resume/download', downloadTeacherResume);
router.get('/:id', getTeacherById);
router.post('/', maybeResumeUpload, createTeacher);
router.post('/import', uploadExcel.single('file'), importTeachersFromExcel);
router.put('/:id', maybeResumeUpload, updateTeacher);
router.delete('/:id', deleteTeacher);

module.exports = router;
