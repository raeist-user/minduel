const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  listPosts,
  getPost,
  createPost,
  createReply,
  toggleReaction,
  updatePostFlags,
  deletePost,
  deleteReply,
} = require('./forumController');
const { protect } = require('./authMiddleware');

const router = express.Router();

// Browsing the forum (list + open threads). Generous since it's read-only.
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true, legacyHeaders: false,
});
// Posting/replying: tighter, to blunt spam.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true, legacyHeaders: false,
});
// Reacting is cheap per-click but people click fast; a bit more headroom than writes.
const reactLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { message: 'Too many requests. Slow down for a moment.' },
  standardHeaders: true, legacyHeaders: false,
});

router.get('/posts', protect, readLimiter, listPosts);
router.get('/posts/:id', protect, readLimiter, getPost);
router.post('/posts', protect, writeLimiter, createPost);
router.patch('/posts/:id', protect, writeLimiter, updatePostFlags); // staff: pin/lock
router.delete('/posts/:id', protect, writeLimiter, deletePost);
router.post('/posts/:id/replies', protect, writeLimiter, createReply);
router.delete('/posts/:id/replies/:replyId', protect, writeLimiter, deleteReply);
router.post('/posts/:id/react', protect, reactLimiter, toggleReaction);

module.exports = router;
