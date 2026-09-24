const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Fixed palette so avatarColor can't be used to inject arbitrary CSS/values.
// Keep this in sync with AVATAR_COLORS in the frontend.
const AVATAR_COLORS = [
  '#A3E635', '#38BDF8', '#F472B6', '#FB923C',
  '#C084FC', '#F87171', '#2DD4BF', '#FACC15',
];

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
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
    avatarColor: {
      type: String,
      enum: AVATAR_COLORS,
      default: AVATAR_COLORS[0],
    },
    avatarUrl: {
      type: String,
      default: '',
    },

    role: {
      type: String,
      enum: ['player', 'admin'],
      default: 'player',
    },

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

    // --- Security: password reset ---
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },

    // --- Security: brute-force login lockout ---
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

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

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  delete obj.__v;
  return obj;
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
User.AVATAR_COLORS = AVATAR_COLORS;
User.MAX_LOGIN_ATTEMPTS = MAX_LOGIN_ATTEMPTS;

module.exports = User;
