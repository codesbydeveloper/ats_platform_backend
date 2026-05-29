const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const {
  getSettings,
  upsertSetting,
  upsertSettingImage,
} = require('../controllers/settingsController');

const router = Router();

// Upsert by key (single route):
// - POST /api/settings   body: { key: string, value: any }
// Get settings:
// - GET /api/settings             -> { count, settings: [{key,value}] }
// - GET /api/settings?keys=a,b    -> { count, settings: [...] }
// - GET /api/settings/:key        -> { key, value }
router.get('/', getSettings);
router.get('/:key', getSettings);
router.post('/', upsertSetting);

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'settings');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
      ? ext
      : '.png';
    const rand = Math.random().toString(16).slice(2, 10);
    cb(null, `${Date.now()}-${rand}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\//i.test(file.mimetype || '');
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

// Upload image + upsert setting value to stored path
// POST /api/settings/image (multipart/form-data)
// fields: key=<setting_key>, file=<image>
router.post('/image', upload.single('file'), upsertSettingImage);

module.exports = router;

