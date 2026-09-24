const User = require('./User');
const { restrictionStatus } = require('./moderation');

// @route   GET /api/users/:id
// @access  Private (logged-in players only, so it can't be scraped anonymously)
// The public view of a player: what an opponent card or profile popup shows.
// Always built with the allowlist projection, never toSafeObject().
const getPublicProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[a-f\d]{24}$/i.test(id)) return res.status(404).json({ message: 'Player not found' });

    const user = await User.findById(id).select(`${User.PUBLIC_SELECT} isActive restriction`);
    if (!user || !user.isActive || restrictionStatus(user.restriction) === 'banned') {
      return res.status(404).json({ message: 'Player not found' });
    }
    res.status(200).json({ user: user.toPublicObject() });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPublicProfile };
