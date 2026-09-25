// Builds the `env` a BaseGame talks to. One of these per live match; it is
// the only bridge between game logic and Socket.io, so games themselves never
// import socket.io and can be unit-tested with the plain TestEnv instead.
function createEnv(io, room) {
  const timers = new Set();
  let finishedCb = null, abortedCb = null;

  const env = {
    now: () => Date.now(),
    rnd: Math.random,
    after(ms, fn) {
      const t = setTimeout(() => { timers.delete(t); fn(); }, Math.max(0, ms));
      timers.add(t);
      return t;
    },
    cancel(t) { if (t) { clearTimeout(t); timers.delete(t); } },
    emit(type, data) { io.to(room).emit('match:event', { type, data }); },
    emitTo(userId, type, data) { io.to(`user:${userId}`).emit('match:event', { type, data }); },
    finish(rankings, extra) { if (finishedCb) finishedCb(rankings, extra); },
    abort() { if (abortedCb) abortedCb(); },
    // MatchManager wires these after construction, so the game module itself
    // never needs to know who's listening.
    _onFinish(cb) { finishedCb = cb; },
    _onAbort(cb) { abortedCb = cb; },
    _clearAllTimers() { for (const t of timers) clearTimeout(t); timers.clear(); },
  };
  return env;
}

module.exports = { createEnv };
