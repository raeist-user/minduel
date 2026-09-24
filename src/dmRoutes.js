const express = require('express');
const rateLimit = require('express-rate-limit');
const { listConversations, getMessages, sendMessage } = require('./dmController');
const { protect } = require('./authMiddleware');

const router = express.Router();

// An open chat polls every few seconds, so reads need headroom.
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 150,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true, legacyHeaders: false,
});
const sendLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { message: 'You are sending messages too fast. Wait a moment.' },
  standardHeaders: true, legacyHeaders: false,
});

router.get('/', protect, readLimiter, listConversations);
router.get('/with/:userId', protect, readLimiter, getMessages);
router.post('/with/:userId', protect, sendLimiter, sendMessage);

module.exports = router;
