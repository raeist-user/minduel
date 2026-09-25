const express = require('express');
const rateLimit = require('express-rate-limit');
const { getPublicProfile, getLeaderboard } = require('./userController');
const { protect } = require('./authMiddleware');

const router = express.Router();

const profileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Must come before '/:id' or "leaderboard" would be read as a player id
router.get('/leaderboard', protect, profileLimiter, getLeaderboard);
router.get('/:id', protect, profileLimiter, getPublicProfile);

module.exports = router;
