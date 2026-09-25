const nodemailer = require('nodemailer');

let transporter = null;

const isConfigured = () =>
  !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // true for 465 (implicit TLS), false for 587 (STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Without these, a blocked/wrong SMTP host makes the request hang for
    // minutes instead of failing fast with a useful error.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transporter;
};

/**
 * Called once at server boot. Tells you immediately (in the logs) whether
 * email will work, instead of finding out when a real user hits "forgot
 * password". Never throws and never blocks startup.
 */
const verifyEmailSetup = async () => {
  if (!isConfigured()) {
    console.warn(
      '[email] SMTP is NOT configured (SMTP_HOST / SMTP_USER / SMTP_PASS missing). ' +
        'Password-reset emails will NOT be sent; reset links will only be printed in this log.'
    );
    return { ok: false, reason: 'smtp_not_configured' };
  }
  try {
    await getTransporter().verify();
    console.log(`[email] SMTP connection OK (${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}).`);
    return { ok: true };
  } catch (err) {
    console.error(
      `[email] SMTP is configured but the connection/login FAILED: ${err.message}. ` +
        'Reset emails will fail until this is fixed (check host, port, user, and that you are using an App Password for Gmail).'
    );
    return { ok: false, reason: 'smtp_verify_failed', error: err.message };
  }
};

/**
 * Sends the password-reset email.
 *
 * Returns { delivered: true } on success.
 * Returns { delivered: false, reason: 'smtp_not_configured' } when SMTP env
 * vars are missing — in that case the link is logged to the console so local
 * development is never blocked on email setup. The caller decides what to do
 * with that (in production it should be treated as a failure).
 * Throws if SMTP is configured but sending fails.
 */
const sendPasswordResetEmail = async ({ to, resetUrl }) => {
  if (!isConfigured()) {
    console.log('--------------------------------------------------');
    console.log('[email] SMTP not configured — logging reset link instead of emailing it.');
    console.log(`[email] Password reset requested for: ${to}`);
    console.log(`[email] Reset link: ${resetUrl}`);
    console.log('--------------------------------------------------');
    return { delivered: false, reason: 'smtp_not_configured' };
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Reset your Aptiks password</h2>
      <p>We received a request to reset your password. This link expires in 1 hour.</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background:#E2B714;color:#0D0D0D;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Reset Password
        </a>
      </p>
      <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="color:#888;font-size:12px;">If the button doesn't work, copy this link: ${resetUrl}</p>
    </div>
  `;

  const text =
    `Reset your Aptiks password\n\n` +
    `We received a request to reset your password. This link expires in 1 hour:\n${resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email.`;

  const info = await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || 'Aptiks <no-reply@aptiks.app>',
    to,
    subject: 'Reset your Aptiks password',
    text, // plain-text alternative also helps deliverability / spam scoring
    html,
  });

  console.log(`[email] Reset email sent to ${to} (messageId: ${info.messageId}).`);
  return { delivered: true };
};

module.exports = { sendPasswordResetEmail, verifyEmailSetup, isConfigured };
