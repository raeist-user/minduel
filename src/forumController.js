const User = require('./User');
const Post = require('./Post');
const { isStaff, badgeFor, restrictionStatus } = require('./moderation');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const TITLE_MAX = 120;
const BODY_MAX = 8000;
const REPLY_MAX = 4000;
const PAGE_SIZE = 30;

// Same shape the frontend prototype used for an author, plus role/badge so
// staff are recognisable without a second request. Always read live off the
// User document — never trust anything cached on the post.
const authorSummary = (u) => ({
  _id: u._id,
  username: u.username,
  displayName: u.displayName || u.username,
  avatarUrl: u.avatarUrl || '',
  role: u.role,
  badge: badgeFor(u.role),
});

const reactionsToObject = (m) => {
  const out = {};
  if (!m) return out;
  for (const [emoji, ids] of m.entries()) {
    if (ids && ids.length) out[emoji] = ids.map(String);
  }
  return out;
};

// Batches author lookups for a page of posts/replies into one query, so a
// 30-post page never fires 30+ user lookups.
const loadAuthors = async (ids) => {
  const unique = [...new Set(ids.map(String))].filter((id) => OBJECT_ID.test(id));
  const users = await User.find({ _id: { $in: unique } }).select(`${User.PUBLIC_SELECT} role`).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return byId;
};

const serializeReply = (reply, authorsById) => {
  const author = authorsById.get(String(reply.author));
  return {
    _id: reply._id,
    author: author ? authorSummary(author) : { _id: reply.author, username: '[deleted user]', displayName: '[deleted user]', avatarUrl: '', role: 'player', badge: null },
    body: reply.deleted ? '[deleted]' : reply.body,
    deleted: reply.deleted,
    reactions: reactionsToObject(reply.reactions),
    createdAt: reply.createdAt,
    editedAt: reply.editedAt || null,
  };
};

const serializePost = (post, authorsById, { includeBody = true } = {}) => {
  const author = authorsById.get(String(post.author));
  const base = {
    _id: post._id,
    author: author ? authorSummary(author) : { _id: post.author, username: '[deleted user]', displayName: '[deleted user]', avatarUrl: '', role: 'player', badge: null },
    tag: post.tag,
    title: post.title,
    pinned: post.pinned,
    locked: post.locked,
    views: post.views,
    replyCount: post.replies.filter((r) => !r.deleted).length,
    reactions: reactionsToObject(post.reactions),
    createdAt: post.createdAt,
    lastActivityAt: post.lastActivityAt,
  };
  if (includeBody) base.body = post.body;
  return base;
};

// Collects every author id a post touches (post author + reply authors) so
// the caller can load them all in one User.find.
const authorIdsOf = (post) => [post.author, ...post.replies.map((r) => r.author)];

// @route GET /api/forum/posts?tag=&sort=&search=&page=
const listPosts = async (req, res, next) => {
  try {
    const { tag, sort = 'active', search = '' } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const query = { deleted: false };
    if (tag && Post.TAGS.includes(tag)) query.tag = tag;
    if (search && search.trim()) {
      const term = search.trim().slice(0, 100);
      query.$or = [
        { title: { $regex: term, $options: 'i' } },
        { body: { $regex: term, $options: 'i' } },
      ];
    }

    const sortMap = {
      active: { pinned: -1, lastActivityAt: -1 },
      new: { pinned: -1, createdAt: -1 },
      top: { pinned: -1, views: -1 },
    };
    const sortSpec = sortMap[sort] || sortMap.active;

    const posts = await Post.find(query)
      .sort(sortSpec)
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select('-viewedBy')
      .lean();

    const authorsById = await loadAuthors(posts.flatMap(authorIdsOf));
    res.status(200).json({
      posts: posts.map((p) => serializePost(p, authorsById, { includeBody: false })),
      page,
      hasMore: posts.length === PAGE_SIZE,
    });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/forum/posts/:id
const getPost = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID.test(id)) return res.status(404).json({ message: 'Post not found' });

    const post = await Post.findOne({ _id: id, deleted: false });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    // Count a view once per user, not once per request.
    const uid = String(req.user._id);
    if (!post.viewedBy.some((v) => String(v) === uid)) {
      post.viewedBy.push(req.user._id);
      post.views += 1;
      await post.save();
    }

    const plain = post.toObject();
    const authorsById = await loadAuthors(authorIdsOf(plain));
    res.status(200).json({
      post: {
        ...serializePost(plain, authorsById),
        replies: plain.replies.map((r) => serializeReply(r, authorsById)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/forum/posts
const createPost = async (req, res, next) => {
  try {
    const status = restrictionStatus(req.user.restriction);
    if (status !== 'active') return res.status(403).json({ message: 'Your account is restricted from posting.' });

    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();
    const tag = Post.TAGS.includes(req.body.tag) ? req.body.tag : 'general';

    if (!title || title.length > TITLE_MAX) return res.status(400).json({ message: `Title is required and must be under ${TITLE_MAX} characters.` });
    if (!body || body.length > BODY_MAX) return res.status(400).json({ message: `Body is required and must be under ${BODY_MAX} characters.` });

    const post = await Post.create({ author: req.user._id, tag, title, body });
    const authorsById = await loadAuthors([req.user._id]);

    const serialized = { ...serializePost(post.toObject(), authorsById), replies: [] };
    req.app.get('io')?.to('forum').emit('forum:post-created', serialized);
    res.status(201).json({ post: serialized });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/forum/posts/:id/replies
const createReply = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID.test(id)) return res.status(404).json({ message: 'Post not found' });

    const status = restrictionStatus(req.user.restriction);
    if (status !== 'active') return res.status(403).json({ message: 'Your account is restricted from posting.' });

    const body = String(req.body.body || '').trim();
    if (!body || body.length > REPLY_MAX) return res.status(400).json({ message: `Reply is required and must be under ${REPLY_MAX} characters.` });

    const post = await Post.findOne({ _id: id, deleted: false });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.locked && !isStaff(req.user.role)) return res.status(403).json({ message: 'This thread is locked.' });

    post.replies.push({ author: req.user._id, body });
    post.bumpActivity();
    await post.save();

    const reply = post.replies[post.replies.length - 1];
    const authorsById = await loadAuthors([req.user._id]);
    const serialized = serializeReply(reply.toObject(), authorsById);

    req.app.get('io')?.to('forum').emit('forum:reply-created', { postId: post._id, reply: serialized });
    res.status(201).json({ reply: serialized });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/forum/posts/:id/react   body: { emoji, replyId? }
// Toggles the caller's reaction: adds it if absent, removes it if present.
const toggleReaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { emoji, replyId } = req.body;
    if (!OBJECT_ID.test(id)) return res.status(404).json({ message: 'Post not found' });
    if (!Post.REACTIONS.includes(emoji)) return res.status(400).json({ message: 'Unsupported reaction.' });

    const post = await Post.findOne({ _id: id, deleted: false });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    let target = post; // reacting to the post itself
    if (replyId) {
      if (!OBJECT_ID.test(replyId)) return res.status(404).json({ message: 'Reply not found' });
      target = post.replies.id(replyId);
      if (!target || target.deleted) return res.status(404).json({ message: 'Reply not found' });
    }

    const uid = String(req.user._id);
    const current = target.reactions.get(emoji) || [];
    const has = current.some((u) => String(u) === uid);
    const next_ = has ? current.filter((u) => String(u) !== uid) : [...current, req.user._id];
    if (next_.length) target.reactions.set(emoji, next_);
    else target.reactions.delete(emoji);

    await post.save();

    const payload = { postId: post._id, replyId: replyId || null, emoji, userId: req.user._id, added: !has };
    req.app.get('io')?.to('forum').emit('forum:reaction-updated', payload);
    res.status(200).json({ reactions: reactionsToObject(target.reactions) });
  } catch (err) {
    next(err);
  }
};

// @route PATCH /api/forum/posts/:id   body: { pinned?, locked? } — staff only
const updatePostFlags = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID.test(id)) return res.status(404).json({ message: 'Post not found' });
    if (!isStaff(req.user.role)) return res.status(403).json({ message: 'Staff access required' });

    const post = await Post.findOne({ _id: id, deleted: false });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (typeof req.body.pinned === 'boolean') post.pinned = req.body.pinned;
    if (typeof req.body.locked === 'boolean') post.locked = req.body.locked;
    await post.save();

    const payload = { postId: post._id, pinned: post.pinned, locked: post.locked };
    req.app.get('io')?.to('forum').emit('forum:post-updated', payload);
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

// @route DELETE /api/forum/posts/:id — author (own post) or staff
const deletePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID.test(id)) return res.status(404).json({ message: 'Post not found' });

    const post = await Post.findOne({ _id: id, deleted: false });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const isOwner = String(post.author) === String(req.user._id);
    if (!isOwner && !isStaff(req.user.role)) return res.status(403).json({ message: 'Not authorized to delete this post.' });

    post.deleted = true;
    await post.save();

    req.app.get('io')?.to('forum').emit('forum:post-deleted', { postId: post._id });
    res.status(200).json({ message: 'Post deleted' });
  } catch (err) {
    next(err);
  }
};

// @route DELETE /api/forum/posts/:id/replies/:replyId — author (own reply) or staff
const deleteReply = async (req, res, next) => {
  try {
    const { id, replyId } = req.params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(replyId)) return res.status(404).json({ message: 'Not found' });

    const post = await Post.findOne({ _id: id, deleted: false });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const reply = post.replies.id(replyId);
    if (!reply || reply.deleted) return res.status(404).json({ message: 'Reply not found' });

    const isOwner = String(reply.author) === String(req.user._id);
    if (!isOwner && !isStaff(req.user.role)) return res.status(403).json({ message: 'Not authorized to delete this reply.' });

    reply.deleted = true;
    await post.save();

    req.app.get('io')?.to('forum').emit('forum:reply-deleted', { postId: post._id, replyId });
    res.status(200).json({ message: 'Reply deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listPosts,
  getPost,
  createPost,
  createReply,
  toggleReaction,
  updatePostFlags,
  deletePost,
  deleteReply,
};
