const nodemailer = require('nodemailer');

let transporter = null;

const isConfigured = () =>
  !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for 587/others
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
};

/**
 * Sends the password-reset email. If SMTP isn't configured (e.g. local dev,
 * or Render env vars not set yet), logs the link instead so development
 * and testing are never blocked on email setup.
 */
const sendPasswordResetEmail = async ({ to, resetUrl }) => {
  if (!isConfigured()) {
    console.log('--------------------------------------------------');
    console.log('SMTP not configured — logging reset link instead of emailing it.');
    console.log(`Password reset requested for: ${to}`);
    console.log(`Reset link: ${resetUrl}`);
    console.log('--------------------------------------------------');
    return { delivered: false, reason: 'smtp_not_configured' };
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Reset your Minduel password</h2>
      <p>We received a request to reset your password. This link expires in 1 hour.</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background:#A3E635;color:#0D0D0D;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Reset Password
        </a>
      </p>
      <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="color:#888;font-size:12px;">If the button doesn't work, copy this link: ${resetUrl}</p>
    </div>
  `;

  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || 'Minduel <no-reply@minduel.app>',
    to,
    subject: 'Reset your Minduel password',
    html,
  });

  return { delivered: true };
};

module.exports = { sendPasswordResetEmail, isConfigured };
