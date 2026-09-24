// One place that decides "is this token allowed in right now?". The HTTP
// middleware (authMiddleware.js) and the Socket.io handshake (socketAuth.js)
// both call it, so a ban, a password change or a deactivated account takes
// effect the same way everywhere.
const jwt = require('jsonwebtoken');
const User = require('./User');
const { restrictionStatus } = require('./moderation');

const OBJECT_ID = /^[a-f\d]{24}$/i;

const fail = (status, message, extra = {}) => ({ ok: false, status, body: { message, ...extra } });

// Message + machine-readable code for a banned / suspended account. Used for
// blocked API calls and for the login response.
const restrictionBody = (user, status = restrictionStatus(user.restriction)) => {
  const r = user.restriction || {};
  const reason = r.reason ? ` Reason: ${r.reason}` : '';
  if (status === 'banned') {
    return { message: `This account has been banned.${reason}`, code: 'BANNED', reason: r.reason || '' };
  }
  return {
    message: `This account is suspended.${reason}`,
    code: 'SUSPENDED',
    until: r.until || null,
    reason: r.reason || '',
  };
};

// Returns { ok: true, user } or { ok: false, status, body }.
// JWT problems -> 401. Database errors are NOT swallowed: they throw, so an
// outage shows up as a 500 instead of silently logging everyone out.
const authenticateToken = async (token) => {
  if (!token) return fail(401, 'Not authorized, no token provided');

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return fail(401, 'Not authorized, token invalid or expired');
  }
  if (!decoded || !OBJECT_ID.test(String(decoded.id))) {
    return fail(401, 'Not authorized, token invalid or expired');
  }

  const user = await User.findById(decoded.id);
  if (!user || !user.isActive) return fail(401, 'Not authorized, user not found');

  // Checked on EVERY request, so a ban or suspension applies immediately even
  // though the person's token is still cryptographically valid. This comes
  // before the version check so someone banned mid-session is told they were
  // banned, not just "session ended".
  const status = restrictionStatus(user.restriction);
  if (status !== 'active') return { ok: false, status: 403, body: restrictionBody(user, status) };

  // Tokens issued before a password change/reset/ban carry an older version.
  // Tokens from before this feature existed have no `tv`, which counts as 0.
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    return fail(401, 'Your session has ended. Please log in again.', { code: 'SESSION_REVOKED' });
  }

  return { ok: true, user };
};

module.exports = { authenticateToken, restrictionBody };
