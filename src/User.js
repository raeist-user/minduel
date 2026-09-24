const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const {
  ROLES,
  RESTRICTION_STATES,
  normalizeRole,
  badgeFor,
  restrictionStatus,
} = require('./moderation');

// Bump this whenever the Terms of Service or Privacy Policy change in a way
// people must re-accept. Accounts whose stored version differs get the
// "please accept" prompt on their next visit (see `needsTerms`).
const TERMS_VERSION = '2026-09-24';

const MAX_LOGIN_ATTEMPTS = 5;
// Players can change their username, but not constantly: once opponents see
// names in live duels and on leaderboards, rapid renaming enables impersonation
// and makes match history confusing.
const USERNAME_CHANGE_COOLDOWN_DAYS = 14;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      trim: true,
      minlength: 3,
      maxlength: 20,
      // NOTE: uniqueness is enforced by the case-insensitive index declared
      // below the schema, not by `unique: true` here (that would be
      // case-sensitive, letting "Neo" and "neo" both register).
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // never return password by default
    },

    // --- Personalization ---
    displayName: {
      type: String,
      trim: true,
      maxlength: 30,
      default: '',
    },
    // Profile picture. The image bytes live in avatarData (select:false so
    // they never ride along on normal user queries). avatarUrl is what the
    // frontend uses; it is empty when the user has no photo, in which case the
    // UI shows their initial on the fixed brand color.
    avatarUrl: { type: String, default: '' },
    avatarData: { type: Buffer, select: false },
    avatarContentType: { type: String, select: false },

    // About you (all optional). Social links are handles, not URLs (see profileFields.js).
    bio: { type: String, trim: true, maxlength: 160, default: '' },
    location: { type: String, trim: true, maxlength: 30, default: '' },
    socialLinks: {
      instagram: { type: String, default: '' },
      x: { type: String, default: '' },
      github: { type: String, default: '' },
      youtube: { type: String, default: '' },
      twitch: { type: String, default: '' },
      discord: { type: String, default: '' },
      website: { type: String, default: '', maxlength: 100 },
    },

    // Plain string in the database: "player" (default), "moderator" or "admin".
    // To make someone staff, edit this field on their user document (see the
    // README) or run `npm run set-role`. The getter normalises hand-typed values
    // (" Admin " -> "admin") and treats anything unknown as "player". The role
    // is never read from a request body, so a client can't set its own.
    role: {
      type: String,
      enum: ROLES,
      default: 'player',
      get: normalizeRole,
    },

    // --- Moderation: ban / suspension ---
    // One state at a time. A suspension lifts itself when `until` passes.
    restriction: {
      state: { type: String, enum: RESTRICTION_STATES, default: 'none' },
      until: { type: Date },
      reason: { type: String, maxlength: 200 },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },

    // --- Security: session invalidation ---
    // Every login token carries the version it was issued under. Changing or
    // resetting the password (and banning) bumps this number, which instantly
    // invalidates every token issued before it, on every device.
    tokenVersion: { type: Number, default: 0 },

    // --- Terms / age ---
    termsAcceptedAt: { type: Date },
    termsVersion: { type: String },
    ageConfirmed: { type: Boolean, default: false },

    // --- Rating & stats (used from Match/Results/Leaderboard features onward) ---
    rating: { type: Number, default: 1000 },
    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalCorrectAnswers: { type: Number, default: 0 },
    totalQuestionsAnswered: { type: Number, default: 0 },
    categoryStats: {
      type: Map,
      of: new mongoose.Schema(
        { correct: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
        { _id: false }
      ),
      default: {},
    },

    // --- Account changes ---
    usernameChangedAt: { type: Date },      // for the rename cooldown
    // Kept so old names can't be sniped instantly and support can trace
    // "who was @x last week". Newest last, capped in the controller.
    previousUsernames: { type: [String], default: [], select: false },

    // --- Security: password reset ---
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },

    // --- Security: brute-force login lockout ---
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },

    // Presence: refreshed by authenticated requests (see authMiddleware). Only
    // ever shown to accepted friends.
    lastSeenAt: { type: Date },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Case-insensitive unique username. strength:2 makes "Neo", "neo" and "NEO"
// collide, so the database itself rejects duplicates even when two signups
// race past the application-level check.
//
// If you already have users in production, Mongo will refuse to build this
// index while case-variant duplicates exist. Check first with:
//   db.users.aggregate([{ $group: { _id: { $toLower: "$username" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
userSchema.index({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

// Staff / moderation lists in the admin panel filter on these.
userSchema.index({ role: 1 });
userSchema.index({ 'restriction.state': 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// The account owner's own view (login, /me, profile updates). Sensitive
// internals are removed with a blocklist here; anything that goes to OTHER
// people must use toPublicObject() instead, which is an allowlist.
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  delete obj.avatarData;
  delete obj.avatarContentType;
  delete obj.tokenVersion;
  delete obj.restriction;
  delete obj.previousUsernames;
  delete obj.lastSeenAt;
  delete obj.__v;
  obj.role = this.role; // normalised value
  obj.badge = badgeFor(this.role);
  obj.needsTerms = this.termsVersion !== TERMS_VERSION;
  return obj;
};

// What OTHER players are allowed to see (opponent card, leaderboard, match
// history, public profile). Deliberately an allowlist: adding a new private
// field to the schema later can never leak by accident. `badge` is the staff
// badge ("moderator" / "admin" / null), not the raw role.
//
// Also works on plain objects from `.lean()` queries: User.toPublic(doc).
// Pair it with `.select(User.PUBLIC_SELECT)` so private fields never even
// leave the database.
const PUBLIC_SELECT = '_id username displayName avatarUrl rating role';
const toPublic = (src) => ({
  _id: src._id,
  username: src.username,
  displayName: src.displayName,
  avatarUrl: src.avatarUrl,
  rating: src.rating,
  badge: badgeFor(src.role),
});
userSchema.methods.toPublicObject = function () {
  return toPublic(this);
};

// What staff see in the admin panel. Moderators never get the email; only
// admins do (`includeEmail`).
userSchema.methods.toStaffObject = function ({ includeEmail = false } = {}) {
  const status = restrictionStatus(this.restriction);
  const r = this.restriction || {};
  const obj = {
    _id: this._id,
    username: this.username,
    displayName: this.displayName,
    avatarUrl: this.avatarUrl,
    rating: this.rating,
    matchesPlayed: this.matchesPlayed,
    role: this.role,
    badge: badgeFor(this.role),
    status,
    restriction: status === 'active' ? null : { state: status, until: r.until || null, reason: r.reason || '' },
    createdAt: this.createdAt,
  };
  if (includeEmail) obj.email = this.email;
  return obj;
};

userSchema.methods.moderationStatus = function () {
  return restrictionStatus(this.restriction);
};

// --- Account lockout helpers ---
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.methods.registerFailedLogin = async function () {
  // If a previous lock has expired, start counting fresh
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.failedLoginAttempts = 1;
    this.lockUntil = undefined;
  } else {
    this.failedLoginAttempts = (this.failedLoginAttempts || 0) + 1;
    if (this.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
      this.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
    }
  }
  await this.save();
};

userSchema.methods.resetFailedLogins = async function () {
  if (this.failedLoginAttempts || this.lockUntil) {
    this.failedLoginAttempts = 0;
    this.lockUntil = undefined;
    await this.save();
  }
};

// --- Password reset token ---
// Returns the RAW token (to email to the user); only the SHA-256 hash of it
// is stored, so a stolen/leaked DB can't be used to reset accounts directly.
userSchema.methods.createPasswordResetToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  return rawToken;
};

const User = mongoose.model('User', userSchema);
User.MAX_LOGIN_ATTEMPTS = MAX_LOGIN_ATTEMPTS;
User.USERNAME_CHANGE_COOLDOWN_DAYS = USERNAME_CHANGE_COOLDOWN_DAYS;
User.TERMS_VERSION = TERMS_VERSION;
User.PUBLIC_SELECT = PUBLIC_SELECT;
User.toPublic = toPublic;

module.exports = User;
