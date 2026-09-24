require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const connectDB = require('./src/db');
const authRoutes = require('./src/authRoutes');
const adminRoutes = require('./src/adminRoutes');
const userRoutes = require('./src/userRoutes');
const { verifyEmailSetup } = require('./src/emailService');
const { notFound, errorHandler } = require('./src/errorMiddleware');

const app = express();

// Render sits behind a reverse proxy; trust the first hop so req.ip and
// express-rate-limit read the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// --- DB ---
connectDB();

// --- Security headers ---
// CSP is disabled for now because the frontend pages load Tailwind/fonts/
// icons from CDNs and use inline <script> tags; a default CSP would block
// them. Once the frontend build is more settled, tighten this with an
// explicit allowlist (or move to bundled assets + nonces).
app.use(helmet({ contentSecurityPolicy: false }));

// --- Core middleware ---
app.use(express.json());

// Strips any keys starting with "$" or containing "." from
// req.body/query/params, so user input can't be crafted into a MongoDB
// operator injection (e.g. { "email": { "$gt": "" } }). Must run after
// express.json() so req.body is already parsed.
app.use(mongoSanitize());

const allowedOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : '*',
    credentials: true,
  })
);

// Serve the simple test page at /
app.use(express.static(path.join(__dirname, 'public')));

// --- Health check (useful for Render) ---
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// Fail fast with a clear message if the DB isn't connected yet, instead of
// letting requests hang until Mongoose's internal buffering timeout
app.use('/api', (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Database is not connected yet, please try again shortly' });
  }
  next();
});

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);

// --- Error handling (must be last) ---
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Minduel backend running on port ${PORT}`);
  // Report email status in the logs right away so a misconfigured SMTP
  // setup is obvious at deploy time, not when a user first needs a reset.
  verifyEmailSetup();
});

// Surface anything that would otherwise crash the process silently
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
