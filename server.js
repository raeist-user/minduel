require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const connectDB = require('./src/db');
const authRoutes = require('./src/authRoutes');
const adminRoutes = require('./src/adminRoutes');
const userRoutes = require('./src/userRoutes');
const friendRoutes = require('./src/friendRoutes');
const dmRoutes = require('./src/dmRoutes');
const forumRoutes = require('./src/forumRoutes');
const { verifyEmailSetup } = require('./src/emailService');
const { notFound, errorHandler } = require('./src/errorMiddleware');
const { socketAuth } = require('./src/socketAuth');
const { MatchManager } = require('./src/game/MatchManager');

const app = express();
// Wrapping app in a plain http.Server so Socket.io can share the same port
// as the Express API, instead of running a second server/port.
const httpServer = http.createServer(app);

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
app.use('/api/friends', friendRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/forum', forumRoutes);

// --- Error handling (must be last) ---
app.use(notFound);
app.use(errorHandler);

// --- Socket.io: live forum updates + real-time games share one server ---
// Same CORS allowlist as the REST API, and the same JWT the client already
// holds is used to authenticate the handshake (see socketAuth.js).
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : '*', credentials: true },
});
io.use(socketAuth);
// Lets forumController.js and adminController.kickUser() reach live sockets
// from an HTTP request via req.app.get('io'), without importing server.js
// (which would create a require cycle).
app.set('io', io);

// Everything that turns a socket connection into parties/matchmaking/live
// games (see src/game/MatchManager.js for the full event list).
const matchManager = new MatchManager(io);

io.on('connection', (socket) => {
  // Everyone connected is in one "forum" room; the forum controller emits
  // post/reply/reaction/moderation events into it. Small-scale for now —
  // if the forum grows, per-tag rooms can be added without touching clients
  // that just listen on room "forum".
  socket.join('forum');
  matchManager.attach(socket);
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Aptiks backend running on port ${PORT}`);
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
