const mongoose = require('mongoose');

const MESSAGE_MAX = 1000;
// Storage: messages are deleted after 30 days (MongoDB TTL index, checked every
// minute or so). Queries also filter on the cutoff so nothing older is ever shown.
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: MESSAGE_MAX },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Newest-first paging inside one conversation
messageSchema.index({ conversation: 1, _id: -1 });
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

const Message = mongoose.model('Message', messageSchema);
Message.MESSAGE_MAX = MESSAGE_MAX;
Message.RETENTION_MS = RETENTION_MS;
module.exports = Message;
