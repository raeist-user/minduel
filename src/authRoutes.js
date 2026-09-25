const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  register,
  checkAvailability,
  login,
  getMe,
  updateProfile,
  uploadAvatar,
  removeAvatar,
  getAvatar,
  changePassword,
  changeUsername,
  changeEmail,
  acceptTerms,
  forgotPassword,
  resetPassword,
} = require('./authController');
const { protect } = require('./authMiddleware');

const router = express.Router();

// Login: the main brute-force target, so this is the tightest limit.
// Combined with per-account lockout in the User model (see registerFailedLogin).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { message: 'Too many login attempts from this device. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { message: 'Too many accounts created from this device. Please try again later.' },
});

// Forgot-password sends an email, so it needs its own limit to stop it
// being used to spam a target inbox or hammer the email provider.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { message: 'Too many reset requests. Please try again later.' },
});

// Live "is this username/email taken?" checks fire as the user types, so this
// needs a much more generous limit than register. It's still limited so it
// can't be used to scrape the full list of registered usernames/emails.
const availabilityLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { message: 'Too many checks. Slow down for a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/check-availability', availabilityLimiter, checkAvailability);
router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);

// Profile picture. The image arrives as raw bytes (not JSON/base64), which
// avoids ~33% base64 bloat and needs no extra upload library. The global
// express.json() ignores these content types, so this parser handles them.
// The limit is enforced here BEFORE the body is buffered into memory.
const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { message: 'Too many photo uploads. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.put(
  '/avatar',
  protect,
  avatarUploadLimiter,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '150kb' }),
  uploadAvatar
);
router.delete('/avatar', protect, removeAvatar);
router.get('/avatar/:id', getAvatar);
// Username/email changes take the password, so they are brute-force targets for
// anyone holding a stolen session. Tight limit, keyed per IP.
const accountChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { message: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.patch('/password', protect, accountChangeLimiter, changePassword);
router.patch('/username', protect, accountChangeLimiter, changeUsername);
router.patch('/email', protect, accountChangeLimiter, changeEmail);
router.post('/accept-terms', protect, accountChangeLimiter, acceptTerms);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', forgotPasswordLimiter, resetPassword);

module.exports = router;
