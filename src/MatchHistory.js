const mongoose = require('mongoose');

// One document per finished match. Deliberately small — enough for "recent
// matches" on a profile and for support to look up a dispute — not a full
// replay log (that would be the per-question qLog living only in memory).
const matchHistorySchema = new mongoose.Schema(
  {
    gameId: { type: String, required: true },       // e.g. 'mathduel'
    mode: { type: String },                          // e.g. 'sentence' for wpmduel
    players: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // absent for bots
      isBot: { type: Boolean, default: false },
      username: { type: String },                    // snapshot: still readable if the account is later deleted/renamed
      rank: { type: Number, required: true },
      score: { type: Number, default: 0 },
      ratingBefore: { type: Number },
      ratingDelta: { type: Number, default: 0 },
    }],
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    aborted: { type: Boolean, default: false },      // true if it ended with no rating changes (e.g. everyone left)
  },
  { timestamps: true }
);

matchHistorySchema.index({ 'players.user': 1, createdAt: -1 });

module.exports = mongoose.model('MatchHistory', matchHistorySchema);
