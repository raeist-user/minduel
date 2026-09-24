const mongoose = require('mongoose');

// One document per pair of players. `pairKey` is the two ids sorted and joined,
// so A->B and B->A can never both exist (the unique index stops it even if two
// requests race). "pending" = requested, waiting for the recipient;
// "accepted" = friends.
const friendshipSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
    pairKey: { type: String, required: true, unique: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true }
);

friendshipSchema.index({ requester: 1, status: 1 });
friendshipSchema.index({ recipient: 1, status: 1 });

friendshipSchema.statics.makePairKey = (a, b) => [String(a), String(b)].sort().join('_');

module.exports = mongoose.model('Friendship', friendshipSchema);
