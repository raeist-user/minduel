const express = require('express');
const rateLimit = require('express-rate-limit');
const { getPublicProfile } = require('./userController');
const { protect } = require('./authMiddleware');

const router = express.Router();

const profileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/:id', protect, profileLimiter, getPublicProfile);

module.exports = router;
