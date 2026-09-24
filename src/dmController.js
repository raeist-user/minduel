const User = require('./User');
const Friendship = require('./Friendship');
const Conversation = require('./Conversation');
const Message = require('./Message');
const { restrictionStatus } = require('./moderation');
const { withPresence } = require('./friendController');
const { cleanText } = require('./profileFields');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const PAGE = 50;
const SELECT = `${User.PUBLIC_SELECT} lastSeenAt isActive restriction`;
const usable = (u) => u && u.isActive && restrictionStatus(u.restriction) !== 'banned';

const areFriends = async (a, b) =>
  !!(await Friendship.exists({ pairKey: Friendship.makePairKey(a, b), status: 'accepted' }));

const shape = (m) => ({ _id: m._id, sender: m.sender, text: m.text, createdAt: m.createdAt });

// @route GET /api/dm
// Inbox: conversations, newest first, with unread counts.
const listConversations = async (req, res, next) => {
  try {
    const me = String(req.user._id);
    const cutoff = new Date(Date.now() - Message.RETENTION_MS);
    const convs = await Conversation.find({ participants: req.user._id, 'lastMessage.at': { $gte: cutoff } })
      .sort({ 'lastMessage.at': -1 })
      .limit(50)
      .lean();
    const otherOf = (c) => c.participants.map(String).find((p) => p !== me);
    const ids = convs.map(otherOf).filter(Boolean);
    const [users, friendRows] = await Promise.all([
      User.find({ _id: { $in: ids } }).select(SELECT).lean(),
      Friendship.find({ status: 'accepted', pairKey: { $in: ids.map((id) => Friendship.makePairKey(me, id)) } }).select('pairKey').lean(),
    ]);
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const friendKeys = new Set(friendRows.map((f) => f.pairKey));

    let totalUnread = 0;
    const conversations = [];
    for (const c of convs) {
      const oid = otherOf(c);
      const u = byId.get(oid);
      if (!usable(u)) continue;
      const unread = (c.unread && c.unread[me]) || 0;
      totalUnread += unread;
      const friend = friendKeys.has(Friendship.makePairKey(me, oid));
      conversations.push({
        user: friend ? withPresence(u) : User.toPublic(u),
        isFriend: friend,
        unread,
        last: { text: c.lastMessage.text, mine: String(c.lastMessage.sender) === me, at: c.lastMessage.at },
      });
    }
    res.status(200).json({ conversations, unread: totalUnread });
  } catch (err) {
    next(err);
  }
};

const loadTarget = async (req, res) => {
  const { userId } = req.params;
  if (!OBJECT_ID.test(userId) || userId === String(req.user._id)) { res.status(404).json({ message: 'Player not found' }); return null; }
  const target = await User.findById(userId).select(SELECT);
  if (!usable(target)) { res.status(404).json({ message: 'Player not found' }); return null; }
  return target;
};

// @route GET /api/dm/with/:userId?after=<msgId>|before=<msgId>
// Default: latest 50. `after` = only newer messages (used for polling).
// `before` = the page of older messages. Opening a chat marks it read.
const getMessages = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;
    const me = req.user._id;
    const pairKey = Conversation.makePairKey(me, target._id);
    const conv = await Conversation.findOne({ pairKey }).select('_id').lean();
    const friend = await areFriends(me, target._id);

    let messages = [], hasMore = false;
    if (conv) {
      const { after, before } = req.query;
      const q = { conversation: conv._id, createdAt: { $gte: new Date(Date.now() - Message.RETENTION_MS) } };
      if (typeof after === 'string' && OBJECT_ID.test(after)) {
        q._id = { $gt: after };
        messages = await Message.find(q).sort({ _id: 1 }).limit(100).lean();
      } else {
        if (typeof before === 'string' && OBJECT_ID.test(before)) q._id = { $lt: before };
        const rows = await Message.find(q).sort({ _id: -1 }).limit(PAGE + 1).lean();
        hasMore = rows.length > PAGE;
        messages = rows.slice(0, PAGE).reverse();
      }
      if (!req.query.before) {
        await Conversation.updateOne({ _id: conv._id }, { $set: { [`unread.${me}`]: 0 } });
      }
    }
    res.status(200).json({
      user: friend ? withPresence(target) : User.toPublic(target),
      canSend: friend,
      hasMore,
      messages: messages.map(shape),
    });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/dm/with/:userId   body: { text }
// Friends only. Text is stored raw and always rendered with textContent.
const sendMessage = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;
    const me = req.user._id;

    const t = cleanText(req.body && req.body.text, Message.MESSAGE_MAX, { multiline: true });
    if (!t.ok) return res.status(400).json({ message: `Messages can be up to ${Message.MESSAGE_MAX} characters.` });
    if (!t.value) return res.status(400).json({ message: 'Type a message first.' });
    if (!(await areFriends(me, target._id))) {
      return res.status(403).json({ message: 'You can only message friends.' });
    }

    const now = new Date();
    const pairKey = Conversation.makePairKey(me, target._id);
    const conv = await Conversation.findOneAndUpdate(
      { pairKey },
      {
        $setOnInsert: { participants: [me, target._id] },
        $set: { lastMessage: { text: t.value.slice(0, 120), sender: me, at: now } },
        $inc: { [`unread.${target._id}`]: 1 },
      },
      { upsert: true, new: true }
    );
    const msg = await Message.create({ conversation: conv._id, sender: me, text: t.value });
    res.status(201).json({ message: shape(msg) });
  } catch (err) {
    if (err && err.code === 11000) return sendMessage(req, res, next); // two first messages raced on the upsert
    next(err);
  }
};

module.exports = { listConversations, getMessages, sendMessage };
