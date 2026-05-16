const { Router } = require('express');
const { signIn, logOut } = require('../controllers/authController');
const { requireAuth } = require('../middlewares/requireAuth');

const router = Router();

router.post('/signin', signIn);
router.post('/logout', requireAuth, logOut);

module.exports = router;
