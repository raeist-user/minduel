const mongoose = require('mongoose');

// One document per pair of players (same idea as Friendship). Holds the inbox
// preview and each person's unread counter, so listing the inbox is one query.
const conversationSchema = new mongoose.Schema(
  {
    pairKey: { type: String, required: true, unique: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastMessage: {
      text: { type: String, default: '' },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },
    // unread.<userId> = messages that person has not opened yet
    unread: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, 'lastMessage.at': -1 });
conversationSchema.statics.makePairKey = (a, b) => [String(a), String(b)].sort().join('_');

module.exports = mongoose.model('Conversation', conversationSchema);
