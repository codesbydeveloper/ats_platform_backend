const { Router } = require('express');
const { sendSmtpTestEmail } = require('../controllers/smtpController');

const router = Router();

// POST /api/smtp/test  body: { email: "to@example.com" }
router.post('/test', sendSmtpTestEmail);

module.exports = router;

