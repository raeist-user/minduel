const mongoose = require('mongoose');

// Forum posts for the Community/Forums tab. Replies are embedded (a forum
// thread never gets big enough to need its own collection, and embedding
// means one query loads the whole thread). Reactions are stored as
// { emoji: [userId, userId, ...] } on both the post and each reply, mirroring
// how the frontend prototype modeled them — but here userIds are real
// ObjectId refs, never client-supplied names.

const TAGS = ['general', 'strategy', 'bugs', 'feedback', 'offtopic'];
const REACTIONS = ['👍', '🔥', '❤️', '😂'];

// Map of emoji -> array of user ObjectIds who reacted with it. Only emojis
// in REACTIONS are ever written (enforced in the controller). Declared
// inline as { type: Map, of: [...] } directly on the owning schema — this
// shorthand only works as a path definition, NOT wrapped in its own
// mongoose.Schema(), which would create a subdocument with literal "type"
// and "of" fields instead of an actual Map. A factory (not a shared object)
// so each schema path gets its own definition object.
const reactionsField = () => ({ type: Map, of: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: () => ({}) });

const replySchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    reactions: reactionsField(),
    editedAt: { type: Date },
    deleted: { type: Boolean, default: false }, // soft-delete: keeps reply count/order stable
  },
  { timestamps: true }
);

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tag: { type: String, enum: TAGS, default: 'general' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 8000 },
    reactions: reactionsField(),
    replies: { type: [replySchema], default: [] },

    pinned: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false }, // soft-delete: staff "delete" hides, doesn't purge

    views: { type: Number, default: 0 },
    // Users who have viewed this post, so a repeat visit doesn't inflate the
    // count. Not returned to the client (select: false).
    viewedBy: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },

    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// List view: pinned-first, then sorted by whatever the query asks for.
postSchema.index({ pinned: -1, lastActivityAt: -1 });
postSchema.index({ pinned: -1, createdAt: -1 });
postSchema.index({ tag: 1 });
postSchema.index({ deleted: 1 });

postSchema.methods.bumpActivity = function () {
  this.lastActivityAt = new Date();
};

const Post = mongoose.model('Post', postSchema);
Post.TAGS = TAGS;
Post.REACTIONS = REACTIONS;

module.exports = Post;
