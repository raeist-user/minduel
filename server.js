require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./src/db');
const authRoutes = require('./src/authRoutes');
const { notFound, errorHandler } = require('./src/errorMiddleware');

const app = express();

// Render sits behind a reverse proxy; trust the first hop so req.ip and
// express-rate-limit read the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// --- DB ---
connectDB();

// --- Core middleware ---
app.use(express.json());

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

// --- Routes ---
app.use('/api/auth', authRoutes);

// --- Error handling (must be last) ---
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Minduel backend running on port ${PORT}`);
});

// Surface anything that would otherwise crash the process silently
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
