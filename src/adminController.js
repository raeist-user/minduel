const User = require('./User');
const ModerationLog = require('./ModerationLog');
const {
  canModerate,
  canAssignRole,
  restrictionStatus,
  parseSuspendHours,
  cleanReason,
  REASON_MIN,
  REASON_MAX,
  MAX_SUSPEND_HOURS,
} = require('./moderation');
const { kickUser } = require('./socketAuth');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const PAGE_SIZE = 20;
const HOUR_MS = 60 * 60 * 1000;

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAdmin = (req) => req.user.role === 'admin';
const view = (req, user) => user.toStaffObject({ includeEmail: isAdmin(req) });

// Loads the account an action is aimed at and applies the rank rules. Returns
// the user, or null after sending the error response.
const loadTarget = async (req, res) => {
  const { id } = req.params;
  if (!OBJECT_ID.test(id)) {
    res.status(404).json({ message: 'Account not found' });
    return null;
  }
  const target = await User.findById(id);
  if (!target) {
    res.status(404).json({ message: 'Account not found' });
    return null;
  }
  if (String(target._id) === String(req.user._id)) {
    res.status(400).json({ message: "You can't do that to your own account." });
    return null;
  }
  if (!canModerate(req.user.role, target.role)) {
    res.status(403).json({
      message: target.role === 'player' ? 'You do not have permission to do that.' : 'You cannot moderate staff accounts at or above your own rank.',
    });
    return null;
  }
  return target;
};

// The log is for accountability, so a failure to write it is loud in the
// server log, but it must not undo an action that already took effect.
const writeLog = async (req, target, action, extra = {}) => {
  try {
    await ModerationLog.create({
      actor: req.user._id,
      actorName: req.user.username,
      actorRole: req.user.role,
      target: target._id,
      targetName: target.username,
      action,
      ...extra,
    });
  } catch (err) {
    console.error('[moderation] FAILED to write log entry:', action, String(target._id), err);
  }
};

const kickIfConnected = (req, userId, reason) => {
  const io = req.app && req.app.get && req.app.get('io');
  if (io) kickUser(io, String(userId), reason);
};

// @route   GET /api/admin/users?q=&filter=all|staff|suspended|banned&page=
// @access  Staff. Moderators search by name only; admins also match and see email.
const listUsers = async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 40);
    const filter = String(req.query.filter || 'all');
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500);

    const conds = [];
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      const or = [{ username: rx }, { displayName: rx }];
      if (isAdmin(req)) or.push({ email: rx });
      if (OBJECT_ID.test(q)) or.push({ _id: q });
      conds.push({ $or: or });
    }
    if (filter === 'staff') conds.push({ role: { $regex: /^\s*(moderator|admin)\s*$/i } });
    else if (filter === 'banned') conds.push({ 'restriction.state': 'banned' });
    else if (filter === 'suspended') {
      conds.push({ 'restriction.state': 'suspended', 'restriction.until': { $gt: new Date() } });
    }
    const query = conds.length ? { $and: conds } : {};

    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ username: 1 })
        .collation({ locale: 'en', strength: 2 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      users: users.map((u) => view(req, u)),
      page,
      pages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
      total,
    });
  } catch (err) {
    next(err);
  }
};

// @route   GET /api/admin/users/:id
// @access  Staff
const getUserDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID.test(id)) return res.status(404).json({ message: 'Account not found' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Account not found' });

    const history = await ModerationLog.find({ target: user._id }).sort({ createdAt: -1 }).limit(10);
    res.status(200).json({
      user: view(req, user),
      history: history.map(logView),
    });
  } catch (err) {
    next(err);
  }
};

const logView = (l) => ({
  _id: l._id,
  action: l.action,
  actorName: l.actorName,
  actorRole: l.actorRole,
  targetName: l.targetName,
  target: l.target,
  reason: l.reason,
  until: l.until || null,
  createdAt: l.createdAt,
});

// @route   POST /api/admin/users/:id/ban   { reason }
// @access  Staff (moderators: players only)
const banUser = async (req, res, next) => {
  try {
    const reason = cleanReason(req.body.reason);
    if (!reason) {
      return res.status(400).json({ message: `Give a reason (${REASON_MIN}-${REASON_MAX} characters).` });
    }
    const target = await loadTarget(req, res);
    if (!target) return;
    if (target.moderationStatus() === 'banned') {
      return res.status(409).json({ message: 'That account is already banned.' });
    }

    // tokenVersion is bumped too, so any token the person still holds stops
    // working even if the ban is lifted later.
    const updated = await User.findByIdAndUpdate(
      target._id,
      {
        $set: { restriction: { state: 'banned', reason, by: req.user._id, at: new Date() } },
        $inc: { tokenVersion: 1 },
      },
      { new: true }
    );
    await writeLog(req, target, 'ban', { reason });
    kickIfConnected(req, target._id, 'Your account has been banned.');

    res.status(200).json({ user: view(req, updated) });
  } catch (err) {
    next(err);
  }
};

// @route   POST /api/admin/users/:id/suspend   { hours, reason }
// @access  Staff (moderators: players only)
const suspendUser = async (req, res, next) => {
  try {
    const hours = parseSuspendHours(req.body.hours);
    if (!hours) {
      return res.status(400).json({ message: `Choose a duration between 1 hour and ${MAX_SUSPEND_HOURS / 24} days.` });
    }
    const reason = cleanReason(req.body.reason);
    if (!reason) {
      return res.status(400).json({ message: `Give a reason (${REASON_MIN}-${REASON_MAX} characters).` });
    }
    const target = await loadTarget(req, res);
    if (!target) return;
    if (target.moderationStatus() === 'banned') {
      return res.status(409).json({ message: 'That account is banned. Lift the ban first if you want to suspend instead.' });
    }

    const until = new Date(Date.now() + hours * HOUR_MS);
    const updated = await User.findByIdAndUpdate(
      target._id,
      { $set: { restriction: { state: 'suspended', until, reason, by: req.user._id, at: new Date() } } },
      { new: true }
    );
    await writeLog(req, target, 'suspend', { reason, until });
    kickIfConnected(req, target._id, 'Your account has been suspended.');

    res.status(200).json({ user: view(req, updated) });
  } catch (err) {
    next(err);
  }
};

// @route   POST /api/admin/users/:id/restore   { reason? }
// @access  Staff. Lifts a ban or an active suspension.
const restoreUser = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;
    const status = target.moderationStatus();
    if (status === 'active') {
      return res.status(409).json({ message: 'That account has no active ban or suspension.' });
    }

    const updated = await User.findByIdAndUpdate(
      target._id,
      { $set: { restriction: { state: 'none' } } },
      { new: true }
    );
    await writeLog(req, target, status === 'banned' ? 'unban' : 'unsuspend', {
      reason: cleanReason(req.body.reason) || '',
    });

    res.status(200).json({ user: view(req, updated) });
  } catch (err) {
    next(err);
  }
};

// @route   PATCH /api/admin/users/:id/role   { role: 'moderator' | 'player' }
// @access  Admin only. Admins themselves are created by hand in the database.
const setRole = async (req, res, next) => {
  try {
    const newRole = String(req.body.role || '');
    if (!['moderator', 'player'].includes(newRole)) {
      return res.status(400).json({ message: 'Role must be "moderator" or "player".' });
    }
    const target = await loadTarget(req, res);
    if (!target) return;
    if (!canAssignRole(req.user.role, target.role, newRole)) {
      return res.status(403).json({ message: 'You cannot change that account\'s role.' });
    }
    if (target.role === newRole) {
      return res.status(409).json({ message: `That account is already a ${newRole}.` });
    }

    const updated = await User.findByIdAndUpdate(target._id, { $set: { role: newRole } }, { new: true });
    await writeLog(req, target, newRole === 'moderator' ? 'promote' : 'demote');

    res.status(200).json({ user: view(req, updated) });
  } catch (err) {
    next(err);
  }
};

// @route   GET /api/admin/log
// @access  Admin only. Most recent staff actions.
const listLog = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const entries = await ModerationLog.find({}).sort({ createdAt: -1 }).limit(limit);
    res.status(200).json({ entries: entries.map(logView) });
  } catch (err) {
    next(err);
  }
};

module.exports = { listUsers, getUserDetail, banUser, suspendUser, restoreUser, setRole, listLog };
