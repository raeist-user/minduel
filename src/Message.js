const mongoose = require('mongoose');

const MESSAGE_MAX = 1000;

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

const Message = mongoose.model('Message', messageSchema);
Message.MESSAGE_MAX = MESSAGE_MAX;
module.exports = Message;
