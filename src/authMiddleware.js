const { authenticateToken } = require('./authCore');
const User = require('./User');

// Presence: write lastSeenAt at most every 30s per account. Fire-and-forget so
// it never slows or fails a request.
const PRESENCE_THROTTLE_MS = 30 * 1000;
const touchPresence = (user) => {
  const last = user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
  if (Date.now() - last < PRESENCE_THROTTLE_MS) return;
  user.lastSeenAt = new Date(); // keeps this request's copy consistent
  User.updateOne({ _id: user._id }, { $set: { lastSeenAt: user.lastSeenAt } }, { timestamps: false }).catch(() => {});
};

// Protects a route: requires a valid Bearer token belonging to an account that
// is active, not banned/suspended, and whose token version is still current.
const protect = async (req, res, next) => {
  try {
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    const result = await authenticateToken(token);
    if (!result.ok) return res.status(result.status).json(result.body);

    req.user = result.user;
    touchPresence(req.user);
    next();
  } catch (err) {
    next(err);
  }
};

// Restricts a route to certain roles (use after `protect`). The role comes
// from the database on every request, never from the token or the client.
const requireRole = (message, ...roles) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) return next();
  return res.status(403).json({ message });
};

// Admin only: role assignment, activity log, and (later) Question CRUD.
const adminOnly = requireRole('Admin access required', 'admin');

// Moderators and admins: searching accounts, ban / suspend.
const staffOnly = requireRole('Staff access required', 'moderator', 'admin');

module.exports = { protect, adminOnly, staffOnly, requireRole };
