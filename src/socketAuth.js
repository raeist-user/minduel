// Socket.io authentication, ready for when live matches are added.
//
//   const { Server } = require('socket.io');
//   const io = new Server(httpServer);
//   io.use(require('./socketAuth').socketAuth);
//   app.set('io', io);   // lets ban/suspend kick live connections
//
// The client sends the same JWT it already uses for the API, in the handshake
// `auth` payload (NEVER in the URL, which ends up in logs):
//
//   const socket = io({ auth: { token: localStorage.getItem('minduel_token') } });
//
// It goes through exactly the same checks as an HTTP request (signature,
// account active, token version, ban/suspension), so a player who is banned
// or changes their password cannot open a new connection with an old token.
const { authenticateToken } = require('./authCore');

const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
    const result = await authenticateToken(token);
    if (!result.ok) {
      const err = new Error(result.body.message);
      err.data = { status: result.status, code: result.body.code || 'UNAUTHORIZED', until: result.body.until || null };
      return next(err);
    }
    // Trust the server-side identity, never an id sent by the client.
    socket.data.userId = String(result.user._id);
    socket.data.username = result.user.username;
    socket.data.role = result.user.role;
    socket.join(`user:${socket.data.userId}`); // lets us target one player from anywhere
    next();
  } catch (err) {
    console.error('Socket auth error:', err);
    next(new Error('Authentication error'));
  }
};

// Called when someone is banned or suspended: tell their open sockets why, then
// drop them. Game code should also re-check status when a match starts.
const kickUser = (io, userId, reason = 'Your account has been restricted.') => {
  if (!io) return;
  const room = `user:${userId}`;
  io.to(room).emit('force-disconnect', { reason });
  io.in(room).disconnectSockets(true);
};

module.exports = { socketAuth, kickUser };
