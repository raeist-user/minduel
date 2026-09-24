const mongoose = require('mongoose');

// Append-only record of every staff action. Names are copied in because
// usernames can change later; the log should read the way it did at the time.
const moderationLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetName: { type: String, required: true },
    action: {
      type: String,
      enum: ['ban', 'suspend', 'unban', 'unsuspend', 'promote', 'demote'],
      required: true,
    },
    reason: { type: String, default: '' },
    until: { type: Date }, // suspensions only
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

moderationLogSchema.index({ createdAt: -1 });
moderationLogSchema.index({ target: 1, createdAt: -1 });

module.exports = mongoose.model('ModerationLog', moderationLogSchema);
