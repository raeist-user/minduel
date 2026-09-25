const User = require('./User');
const Friendship = require('./Friendship');
const { restrictionStatus } = require('./moderation');
const { withPresence } = require('./friendController');
const { SOCIAL_KEYS } = require('./profileFields');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const LEADERBOARD_SIZE = 50;

const activeFilter = { isActive: true, 'restriction.state': { $ne: 'banned' } };

// @route   GET /api/users/leaderboard
// Top players by rating (public fields only) plus the caller's own rank.
const getLeaderboard = async (req, res, next) => {
  try {
    const rows = await User.find(activeFilter)
      .sort({ rating: -1, _id: 1 })
      .limit(LEADERBOARD_SIZE)
      .select(User.PUBLIC_SELECT)
      .lean();

    // Ties share a rank ("1, 2, 2, 4")
    let lastRating = null, lastRank = 0;
    const players = rows.map((u, i) => {
      const rank = u.rating === lastRating ? lastRank : i + 1;
      lastRating = u.rating; lastRank = rank;
      return { rank, ...User.toPublic(u) };
    });

    const better = await User.countDocuments({ ...activeFilter, rating: { $gt: req.user.rating } });
    res.status(200).json({ players, me: { rank: better + 1, rating: req.user.rating } });
  } catch (err) {
    next(err);
  }
};

// @route   GET /api/users/:id
// @access  Private (logged-in players only, so it can't be scraped anonymously)
// Everyone gets the public view + how they relate to you. Friends (and you)
// additionally get stats and online status. Always built from an allowlist,
// never toSafeObject().
const getPublicProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID.test(id)) return res.status(404).json({ message: 'Player not found' });

    const user = await User.findById(id).select(
      `${User.PUBLIC_SELECT} isActive restriction lastSeenAt createdAt bio location socialLinks matchesPlayed wins losses draws totalCorrectAnswers totalQuestionsAnswered`
    );
    if (!user || !user.isActive || restrictionStatus(user.restriction) === 'banned') {
      return res.status(404).json({ message: 'Player not found' });
    }

    const me = String(req.user._id);
    let relation = 'none', friendsSince = null, requestId = null;
    if (String(user._id) === me) {
      relation = 'self';
    } else {
      const fr = await Friendship.findOne({ pairKey: Friendship.makePairKey(me, user._id) }).lean();
      if (fr) {
        requestId = fr._id;
        if (fr.status === 'accepted') { relation = 'friend'; friendsSince = fr.acceptedAt || fr.updatedAt; }
        else relation = String(fr.requester) === me ? 'outgoing' : 'incoming';
      }
    }

    const out = { user: { ...user.toPublicObject(), relation, requestId } };
    // About-you fields are public: the person chose to write them.
    out.user.bio = user.bio || '';
    out.user.location = user.location || '';
    out.user.socialLinks = Object.fromEntries(
      SOCIAL_KEYS.map((k) => [k, (user.socialLinks && user.socialLinks[k]) || '']).filter(([, v]) => v)
    );
    if (relation === 'friend' || relation === 'self') {
      const total = user.totalQuestionsAnswered || 0;
      Object.assign(out.user, {
        online: withPresence(user).online,
        lastSeenAt: user.lastSeenAt || null,
        memberSince: user.createdAt,
        friendsSince,
        stats: {
          matchesPlayed: user.matchesPlayed || 0,
          wins: user.wins || 0,
          losses: user.losses || 0,
          draws: user.draws || 0,
          accuracy: total ? Math.round(((user.totalCorrectAnswers || 0) / total) * 100) : null,
        },
      });
    }
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
};

module.exports = { getPublicProfile, getLeaderboard };
