const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  listUsers,
  getUserDetail,
  banUser,
  suspendUser,
  restoreUser,
  setRole,
  listLog,
} = require('./adminController');
const { protect, adminOnly, staffOnly } = require('./authMiddleware');

const router = express.Router();

// Searching fires as staff type, so it gets a generous limit. Actions that
// change accounts get a tighter one.
const browseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { message: 'Too many actions. Slow down for a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Everything here needs a valid session AND a staff role read from the
// database. Players get a 403 even with a perfectly valid token.
router.use(protect, staffOnly, browseLimiter);

router.get('/users', listUsers);
router.get('/users/:id', getUserDetail);

router.post('/users/:id/ban', actionLimiter, banUser);
router.post('/users/:id/suspend', actionLimiter, suspendUser);
router.post('/users/:id/restore', actionLimiter, restoreUser);

// Admin only
router.patch('/users/:id/role', adminOnly, actionLimiter, setRole);
router.get('/log', adminOnly, listLog);

module.exports = router;
