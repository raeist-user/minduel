const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('./User');
const { sendPasswordResetEmail } = require('./emailService');

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existing) {
      return res.status(409).json({ message: 'Username or email already in use' });
    }

    const user = await User.create({ username, email, password, displayName: username });
    const token = generateToken(user._id);

    res.status(201).json({ token, user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ message: 'Email/username and password are required' });
    }

    const user = await User.findOne({
      $or: [{ email: emailOrUsername.toLowerCase() }, { username: emailOrUsername }],
    }).select('+password +failedLoginAttempts +lockUntil');

    // Same generic message whether the account doesn't exist or the
    // password is wrong, so we don't leak which emails/usernames exist.
    const invalidMsg = { message: 'Invalid credentials' };

    if (!user) {
      return res.status(401).json(invalidMsg);
    }

    if (user.isLocked) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(429).json({
        message: `Too many failed attempts. Try again in ${minutesLeft} minute(s).`,
      });
    }

    const passwordMatches = await user.comparePassword(password);
    if (!passwordMatches) {
      await user.registerFailedLogin();
      return res.status(401).json(invalidMsg);
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    await user.resetFailedLogins();

    const token = generateToken(user._id);
    res.status(200).json({ token, user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    res.status(200).json({ user: req.user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @route   PATCH /api/auth/profile
// @access  Private
// Personalization only: display name + avatar color (from a fixed palette).
const updateProfile = async (req, res, next) => {
  try {
    const { displayName, avatarColor } = req.body;
    const updates = {};

    if (displayName !== undefined) {
      const trimmed = String(displayName).trim();
      if (trimmed.length < 1 || trimmed.length > 30) {
        return res.status(400).json({ message: 'Display name must be 1-30 characters' });
      }
      updates.displayName = trimmed;
    }

    if (avatarColor !== undefined) {
      if (!User.AVATAR_COLORS.includes(avatarColor)) {
        return res.status(400).json({ message: 'Invalid avatar color' });
      }
      updates.avatarColor = avatarColor;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({ user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @route   PATCH /api/auth/password
// @access  Private
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id).select('+password');
    const matches = await user.comparePassword(currentPassword);
    if (!matches) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword; // pre-save hook re-hashes
    await user.save();

    res.status(200).json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
};

// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Always return the same generic response, whether or not the email
    // exists, so this endpoint can't be used to enumerate registered users.
    const genericResponse = {
      message: 'If an account with that email exists, a reset link has been sent.',
    };

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(200).json(genericResponse);
    }

    const rawToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const baseUrl = process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${baseUrl}/reset-password.html?token=${rawToken}`;

    try {
      await sendPasswordResetEmail({ to: user.email, resetUrl });
    } catch (emailErr) {
      // Don't leave the account in a state where the token is stored but
      // unusable because the email failed to send.
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });
      console.error('Failed to send password reset email:', emailErr);
      return res.status(502).json({ message: 'Could not send reset email. Please try again shortly.' });
    }

    res.status(200).json(genericResponse);
  } catch (err) {
    next(err);
  }
};

// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired' });
    }

    user.password = password; // pre-save hook re-hashes
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.resetFailedLogins();
    await user.save();

    res.status(200).json({ message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
