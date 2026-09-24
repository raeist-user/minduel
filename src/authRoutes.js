const express = require('express');
const rateLimit = require('express-rate-limit');
const { register, login, getMe } = require('./authController');
const { protect } = require('./authMiddleware');

const router = express.Router();

// Basic protection against brute force on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { message: 'Too many attempts, please try again later' },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', protect, getMe);

module.exports = router;
