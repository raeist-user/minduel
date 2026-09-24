const { authenticateToken } = require('./authCore');

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
