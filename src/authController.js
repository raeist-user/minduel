const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('./User');
const { sendPasswordResetEmail } = require('./emailService');
const { restrictionStatus } = require('./moderation');
const { restrictionBody } = require('./authCore');

// Usernames: letters, numbers, underscore only, 3-20 chars. Keeps names
// clean for leaderboards / opponent display and avoids lookalike tricks.
const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

// Escape user input before putting it inside a RegExp (case-insensitive
// exact-match lookups), so characters like . or * can't change the match.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive exact match. "Neo" and "neo" must count as the same
// username, otherwise two players could look identical on the leaderboard.
const usernameQuery = (username) => ({
  username: { $regex: new RegExp(`^${escapeRegex(username)}$`, 'i') },
});

// `tv` is the user's tokenVersion at the moment of issue. If the password is
// changed or reset (or the account is banned) the stored version goes up and
// every older token stops working (see authCore.authenticateToken).
const generateToken = (user) => {
  return jwt.sign({ id: user._id, tv: user.tokenVersion || 0 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};


// Verifies the logged-in user's password for sensitive actions (change
// username/email/password). Wrong guesses feed the SAME per-account lockout the
// login uses, so a stolen session token can't be used to brute-force the
// password through these endpoints. Returns { ok: true, user } or
// { ok: false, status, body } for the caller to send.
const verifyPasswordForSensitiveAction = async (userId, password, extraSelect = '') => {
  const user = await User.findById(userId).select(`+password +failedLoginAttempts +lockUntil ${extraSelect}`.trim());
  if (!user) return { ok: false, status: 404, body: { message: 'Account not found' } };

  if (user.isLocked) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    return {
      ok: false,
      status: 429,
      body: { message: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` },
    };
  }

  if (!(await user.comparePassword(password))) {
    await user.registerFailedLogin();
    return { ok: false, status: 401, body: { message: 'Password is incorrect', field: 'password' } };
  }

  await user.resetFailedLogins();
  return { ok: true, user };
};

// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email and password are required' });
    }
    // One checkbox on the form covers both: "I am at least 13 and I agree to the
    // Terms and Privacy Policy". Only a real `true` counts, never "true"/1.
    if (req.body.acceptTerms !== true) {
      return res.status(400).json({
        message: 'You must confirm you are at least 13 and accept the Terms and Privacy Policy',
        field: 'acceptTerms',
      });
    }
    if (!USERNAME_REGEX.test(username)) {
      return res.status(400).json({
        message: 'Username must be 3-20 characters: letters, numbers and underscores only',
      });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check separately so the message says WHICH field is taken. This is the
    // final authority; the live check on the form is only a convenience.
    const [usernameTaken, emailTaken] = await Promise.all([
      User.exists(usernameQuery(username)),
      User.exists({ email }),
    ]);
    if (usernameTaken) {
      return res.status(409).json({ message: 'That username is already taken', field: 'username' });
    }
    if (emailTaken) {
      return res.status(409).json({ message: 'An account with that email already exists', field: 'email' });
    }

    let user;
    try {
      user = await User.create({
        username,
        email,
        password,
        displayName: username,
        termsAcceptedAt: new Date(),
        termsVersion: User.TERMS_VERSION,
        ageConfirmed: true,
      });
    } catch (err) {
      // Two people can pass the check above at the same instant; the unique
      // index in MongoDB is what actually stops the duplicate. Translate that
      // low-level error into a friendly one instead of a 500.
      if (err && err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0] || 'username';
        return res.status(409).json({
          message: field === 'email' ? 'An account with that email already exists' : 'That username is already taken',
          field,
        });
      }
      throw err;
    }

    const token = generateToken(user);
    res.status(201).json({ token, user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @route   GET /api/auth/check-availability?username=...&email=...
// @access  Public
// Powers the live "is this taken?" feedback on the register form. Either
// query param may be sent on its own.
const checkAvailability = async (req, res, next) => {
  try {
    const result = {};

    if (req.query.username !== undefined) {
      const username = String(req.query.username).trim();
      if (!USERNAME_REGEX.test(username)) {
        result.username = {
          valid: false,
          available: false,
          message: 'Use 3-20 letters, numbers or underscores',
        };
      } else {
        const taken = await User.exists(usernameQuery(username));
        result.username = {
          valid: true,
          available: !taken,
          message: taken ? 'That username is already taken' : 'Username is available',
        };
      }
    }

    if (req.query.email !== undefined) {
      const email = String(req.query.email).trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        result.email = { valid: false, available: false, message: 'Enter a valid email address' };
      } else {
        const taken = await User.exists({ email });
        result.email = {
          valid: true,
          available: !taken,
          message: taken ? 'An account with that email already exists' : 'Email is available',
        };
      }
    }

    if (!Object.keys(result).length) {
      return res.status(400).json({ message: 'Provide a username and/or email to check' });
    }

    res.status(200).json(result);
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

    const identifier = String(emailOrUsername).trim();
    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, usernameQuery(identifier)],
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

    // Only reached with the correct password, so this never reveals whether an
    // account exists or is banned to someone who doesn't know the password.
    const status = restrictionStatus(user.restriction);
    if (status !== 'active') {
      return res.status(403).json(restrictionBody(user, status));
    }

    const token = generateToken(user);
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
// Personalization: display name only. (The profile picture has its own
// endpoints below; avatar background colors no longer exist.)
const updateProfile = async (req, res, next) => {
  try {
    const { displayName } = req.body;
    const updates = {};

    if (displayName !== undefined) {
      const trimmed = String(displayName).trim();
      if (trimmed.length < 1 || trimmed.length > 30) {
        return res.status(400).json({ message: 'Display name must be 1-30 characters' });
      }
      updates.displayName = trimmed;
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

// ---------- Profile picture ----------
const MAX_AVATAR_BYTES = 150 * 1024; // the browser sends ~20-30 KB; this is just a ceiling

// Never trust the Content-Type header or file extension: identify the image
// by its actual leading bytes. Anything else (SVG, HTML, scripts) is rejected,
// so nothing executable can be stored and served back from our origin.
const detectImageType = (buf) => {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';
  return null;
};

// @route   PUT /api/auth/avatar        (body = raw image bytes)
// @access  Private
const uploadAvatar = async (req, res, next) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ message: 'Send the image as a JPEG, PNG or WebP file' });
    }
    if (body.length > MAX_AVATAR_BYTES) {
      return res.status(413).json({ message: 'Image is too large. Please choose a smaller photo.' });
    }
    const contentType = detectImageType(body);
    if (!contentType) {
      return res.status(400).json({ message: 'That file is not a valid JPEG, PNG or WebP image' });
    }

    // ?v= changes on every upload so browsers/CDNs never show a stale photo
    const avatarUrl = `/api/auth/avatar/${req.user._id}?v=${Date.now()}`;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatarData: body, avatarContentType: contentType, avatarUrl },
      { new: true }
    );

    res.status(200).json({ user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @route   DELETE /api/auth/avatar
// @access  Private
const removeAvatar = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $unset: { avatarData: 1, avatarContentType: 1 }, avatarUrl: '' },
      { new: true }
    );
    res.status(200).json({ user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @route   GET /api/auth/avatar/:id
// @access  Public (avatars are shown to opponents and on leaderboards)
const getAvatar = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[a-f\d]{24}$/i.test(id)) {
      return res.status(404).end();
    }
    const user = await User.findById(id).select('+avatarData +avatarContentType');
    if (!user || !user.avatarData || !user.avatarContentType) {
      return res.status(404).end();
    }
    // Content-Type comes from what WE verified at upload time, never from the client.
    res.set({
      'Content-Type': user.avatarContentType,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).send(Buffer.from(user.avatarData));
  } catch (err) {
    next(err);
  }
};

// ---------- Change username (requires password) ----------
// @route   PATCH /api/auth/username
// @access  Private
const changeUsername = async (req, res, next) => {
  try {
    const newUsername = String(req.body.newUsername || '').trim();
    const password = String(req.body.password || '');

    if (!newUsername || !password) {
      return res.status(400).json({ message: 'New username and your password are required' });
    }
    if (!USERNAME_REGEX.test(newUsername)) {
      return res.status(400).json({
        message: 'Username must be 3-20 characters: letters, numbers and underscores only',
      });
    }

    // Verify the password FIRST, so this endpoint can't be used by someone
    // holding a stolen session token to probe which usernames are taken.
    const check = await verifyPasswordForSensitiveAction(req.user._id, password, '+previousUsernames');
    if (!check.ok) return res.status(check.status).json(check.body);
    const user = check.user;

    if (newUsername === user.username) {
      return res.status(400).json({ message: 'That is already your username' });
    }

    // Cooldown. Case-only changes (neo -> Neo) are always allowed since they
    // don't create a new identity.
    const caseOnlyChange = newUsername.toLowerCase() === user.username.toLowerCase();
    if (!caseOnlyChange && user.usernameChangedAt) {
      const nextAllowed = new Date(
        user.usernameChangedAt.getTime() + User.USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
      );
      if (nextAllowed > new Date()) {
        const daysLeft = Math.ceil((nextAllowed - Date.now()) / (24 * 60 * 60 * 1000));
        return res.status(429).json({
          message: `You can change your username again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
          field: 'username',
          retryAfterDays: daysLeft,
        });
      }
    }

    // Taken by someone ELSE? (their own old casing doesn't count as taken)
    if (!caseOnlyChange) {
      const clash = await User.exists({ ...usernameQuery(newUsername), _id: { $ne: user._id } });
      if (clash) {
        return res.status(409).json({ message: 'That username is already taken', field: 'username' });
      }
    }

    const oldUsername = user.username;
    user.username = newUsername;
    if (!caseOnlyChange) {
      user.usernameChangedAt = new Date();
      user.previousUsernames = [...(user.previousUsernames || []), oldUsername].slice(-10);
    }
    // If the display name was just the old username (the default at signup),
    // keep it in sync so the person doesn't keep showing under the old name.
    if (user.displayName === oldUsername) user.displayName = newUsername;

    try {
      await user.save();
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ message: 'That username is already taken', field: 'username' });
      }
      throw err;
    }

    res.status(200).json({ user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// ---------- Change email (requires password) ----------
// @route   PATCH /api/auth/email
// @access  Private
//
// TODO(email-verification): once email-code verification exists, this should
// stop applying the change directly. Instead: check the password, store the
// new address as `pendingEmail` with a hashed 6-digit code + expiry, email the
// code TO THE NEW ADDRESS, and only swap `email` in a second call
// (POST /email/confirm) after the code is entered. The password check and the
// availability check below stay exactly as they are.
const changeEmail = async (req, res, next) => {
  try {
    const newEmail = String(req.body.newEmail || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!newEmail || !password) {
      return res.status(400).json({ message: 'New email and your password are required' });
    }
    if (!EMAIL_REGEX.test(newEmail)) {
      return res.status(400).json({ message: 'Please provide a valid email', field: 'email' });
    }

    const check = await verifyPasswordForSensitiveAction(req.user._id, password);
    if (!check.ok) return res.status(check.status).json(check.body);
    const user = check.user;

    if (newEmail === user.email) {
      return res.status(400).json({ message: 'That is already your email' });
    }

    const clash = await User.exists({ email: newEmail, _id: { $ne: user._id } });
    if (clash) {
      return res.status(409).json({ message: 'An account with that email already exists', field: 'email' });
    }

    user.email = newEmail;
    try {
      await user.save();
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ message: 'An account with that email already exists', field: 'email' });
      }
      throw err;
    }

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
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const check = await verifyPasswordForSensitiveAction(req.user._id, String(currentPassword));
    if (!check.ok) {
      // keep the message this page already shows for a wrong password
      if (check.status === 401) check.body.message = 'Current password is incorrect';
      return res.status(check.status).json(check.body);
    }
    const user = check.user;

    if (String(newPassword) === String(currentPassword)) {
      return res.status(400).json({ message: 'New password must be different from your current one' });
    }

    user.password = String(newPassword); // pre-save hook re-hashes
    // Ends every other session (any device that still holds an old token).
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // This device stays signed in: hand it a token for the new version.
    res.status(200).json({ message: 'Password updated', token: generateToken(user) });
  } catch (err) {
    next(err);
  }
};

// @route   POST /api/auth/accept-terms   { acceptTerms: true }
// @access  Private
// For accounts created before the Terms/age checkbox existed, or after the
// Terms version changes. Registration records this itself.
const acceptTerms = async (req, res, next) => {
  try {
    if (req.body.acceptTerms !== true) {
      return res.status(400).json({ message: 'You must confirm you are at least 13 and accept the Terms and Privacy Policy' });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { termsAcceptedAt: new Date(), termsVersion: User.TERMS_VERSION, ageConfirmed: true },
      { new: true }
    );
    res.status(200).json({ user: user.toSafeObject() });
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
      const result = await sendPasswordResetEmail({ to: user.email, resetUrl });

      // SMTP isn't set up. In development that's fine (the link was printed
      // to the console). In production it means users would be told "sent"
      // while nothing is delivered, so fail loudly instead.
      if (!result.delivered && process.env.NODE_ENV === 'production') {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save({ validateBeforeSave: false });
        console.error('[email] Password reset requested but SMTP is not configured on this server.');
        return res.status(503).json({
          message: 'Password reset email is temporarily unavailable. Please contact support.',
        });
      }
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
    user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out every existing session
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
  checkAvailability,
  login,
  getMe,
  updateProfile,
  uploadAvatar,
  removeAvatar,
  getAvatar,
  changePassword,
  changeUsername,
  changeEmail,
  acceptTerms,
  forgotPassword,
  resetPassword,
};
