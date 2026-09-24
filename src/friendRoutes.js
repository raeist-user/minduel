const express = require('express');
const rateLimit = require('express-rate-limit');
const { listFriends, sendRequest, acceptRequest, removeRequest, unfriend } = require('./friendController');
const { protect } = require('./authMiddleware');

const router = express.Router();

// The list doubles as the app's presence heartbeat (polled every ~45s).
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true, legacyHeaders: false,
});
// Sending requests is what could be abused to spam people.
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 40,
  message: { message: 'Too many friend requests. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
});

router.get('/', protect, readLimiter, listFriends);
router.post('/request', protect, requestLimiter, sendRequest);
router.post('/requests/:id/accept', protect, readLimiter, acceptRequest);
router.delete('/requests/:id', protect, readLimiter, removeRequest);
router.delete('/:userId', protect, readLimiter, unfriend);

module.exports = router;
