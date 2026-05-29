const { Router } = require('express');
const {
  signIn,
  logOut,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPasswordWithOtp,
} = require('../controllers/authController');
const { requireAuth } = require('../middlewares/requireAuth');

const router = Router();

router.post('/signin', signIn);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPasswordWithOtp);
router.get('/me', requireAuth, getMe);
router.patch('/profile', requireAuth, updateProfile);
router.post('/change-password', requireAuth, changePassword);
router.post('/logout', requireAuth, logOut);

module.exports = router;
