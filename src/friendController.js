const User = require('./User');
const Friendship = require('./Friendship');
const { restrictionStatus } = require('./moderation');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const MAX_FRIENDS = 200;
const MAX_OUTGOING = 50;
// Presence: a player counts as online if the server heard from them (any
// authenticated request, incl. the app's 45s poll) within this window.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

const isOnline = (lastSeenAt) => !!lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;

// Only ever called for accepted friends (or yourself): adds presence.
const withPresence = (u) => ({
  ...User.toPublic(u),
  online: isOnline(u.lastSeenAt),
  lastSeenAt: u.lastSeenAt || null,
});

const canBeFriended = (u) => u && u.isActive && restrictionStatus(u.restriction) !== 'banned';
const SELECT = `${User.PUBLIC_SELECT} lastSeenAt isActive restriction`;

// @route GET /api/friends
// Everything the Friends tab needs in one call: friends (with online state),
// incoming requests, outgoing requests.
const listFriends = async (req, res, next) => {
  try {
    const me = req.user._id;
    const rows = await Friendship.find({ $or: [{ requester: me }, { recipient: me }] })
      .sort({ updatedAt: -1 })
      .lean();
    const otherId = (r) => (String(r.requester) === String(me) ? r.recipient : r.requester);
    const users = await User.find({ _id: { $in: rows.map(otherId) } }).select(SELECT).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const friends = [], incoming = [], outgoing = [];
    for (const r of rows) {
      const u = byId.get(String(otherId(r)));
      if (!canBeFriended(u)) continue; // deleted / banned accounts quietly disappear
      if (r.status === 'accepted') {
        friends.push({ ...withPresence(u), friendsSince: r.acceptedAt || r.updatedAt });
      } else if (String(r.recipient) === String(me)) {
        incoming.push({ requestId: r._id, createdAt: r.createdAt, user: User.toPublic(u) });
      } else {
        outgoing.push({ requestId: r._id, createdAt: r.createdAt, user: User.toPublic(u) });
      }
    }
    // Online first, then most recently seen, then name
    friends.sort((a, b) =>
      Number(b.online) - Number(a.online) ||
      new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0) ||
      (a.displayName || a.username).localeCompare(b.displayName || b.username)
    );
    res.status(200).json({ friends, incoming, outgoing });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/friends/request   body: { username } or { userId }
const sendRequest = async (req, res, next) => {
  try {
    const me = req.user._id;
    const { username, userId } = req.body || {};

    let target = null;
    if (typeof userId === 'string' && OBJECT_ID.test(userId)) {
      target = await User.findById(userId).select(SELECT);
    } else if (typeof username === 'string' && username.trim()) {
      const name = username.trim().replace(/^@/, '');
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return res.status(404).json({ message: 'No player with that username.' });
      target = await User.findOne({ username: name }).collation({ locale: 'en', strength: 2 }).select(SELECT);
    } else {
      return res.status(400).json({ message: 'Enter a username.' });
    }

    if (!canBeFriended(target)) return res.status(404).json({ message: 'No player with that username.' });
    if (String(target._id) === String(me)) return res.status(400).json({ message: "You can't add yourself." });

    const pairKey = Friendship.makePairKey(me, target._id);
    const existing = await Friendship.findOne({ pairKey });
    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ message: 'You are already friends.' });
      if (String(existing.requester) === String(me)) return res.status(409).json({ message: 'Request already sent.' });
      // They already asked you: sending one back just accepts theirs.
      existing.status = 'accepted';
      existing.acceptedAt = new Date();
      await existing.save();
      return res.status(200).json({ message: `You and @${target.username} are now friends.`, status: 'friends' });
    }

    const [friendCount, outCount] = await Promise.all([
      Friendship.countDocuments({ status: 'accepted', $or: [{ requester: me }, { recipient: me }] }),
      Friendship.countDocuments({ status: 'pending', requester: me }),
    ]);
    if (friendCount >= MAX_FRIENDS) return res.status(400).json({ message: 'Your friends list is full.' });
    if (outCount >= MAX_OUTGOING) return res.status(400).json({ message: 'Too many pending requests. Cancel some first.' });

    try {
      await Friendship.create({ requester: me, recipient: target._id, pairKey });
    } catch (e) {
      if (e && e.code === 11000) return res.status(409).json({ message: 'Request already sent.' });
      throw e;
    }
    res.status(201).json({ message: `Request sent to @${target.username}.`, status: 'sent' });
  } catch (err) {
    next(err);
  }
};

const findRequest = async (req, res) => {
  if (!OBJECT_ID.test(req.params.id)) { res.status(404).json({ message: 'Request not found.' }); return null; }
  const fr = await Friendship.findOne({ _id: req.params.id, status: 'pending' });
  const me = String(req.user._id);
  if (!fr || (String(fr.requester) !== me && String(fr.recipient) !== me)) {
    res.status(404).json({ message: 'Request not found.' });
    return null;
  }
  return fr;
};

// @route POST /api/friends/requests/:id/accept   (recipient only)
const acceptRequest = async (req, res, next) => {
  try {
    const fr = await findRequest(req, res);
    if (!fr) return;
    if (String(fr.recipient) !== String(req.user._id)) return res.status(403).json({ message: 'Only the person invited can accept.' });
    const count = await Friendship.countDocuments({ status: 'accepted', $or: [{ requester: req.user._id }, { recipient: req.user._id }] });
    if (count >= MAX_FRIENDS) return res.status(400).json({ message: 'Your friends list is full.' });
    fr.status = 'accepted';
    fr.acceptedAt = new Date();
    await fr.save();
    res.status(200).json({ message: 'Friend added.' });
  } catch (err) {
    next(err);
  }
};

// @route DELETE /api/friends/requests/:id   (decline if you received it, cancel if you sent it)
const removeRequest = async (req, res, next) => {
  try {
    const fr = await findRequest(req, res);
    if (!fr) return;
    await fr.deleteOne();
    res.status(200).json({ message: 'Request removed.' });
  } catch (err) {
    next(err);
  }
};

// @route DELETE /api/friends/:userId
const unfriend = async (req, res, next) => {
  try {
    if (!OBJECT_ID.test(req.params.userId)) return res.status(404).json({ message: 'Player not found.' });
    const pairKey = Friendship.makePairKey(req.user._id, req.params.userId);
    const r = await Friendship.deleteOne({ pairKey, status: 'accepted' });
    if (!r.deletedCount) return res.status(404).json({ message: 'You are not friends.' });
    res.status(200).json({ message: 'Friend removed.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { listFriends, sendRequest, acceptRequest, removeRequest, unfriend, withPresence, isOnline };
