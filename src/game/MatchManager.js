// Everything that turns "a game module" into "a live match": party rooms with
// join codes, matchmaking queues (with bot fallback), the match lifecycle
// (start -> action routing -> finish/abort -> settle), and reconnect handling.
//
// One MatchManager per server process (in-memory only — fine for a single
// instance; if this ever runs on more than one server, queues/rooms/matches
// would need to move to Redis or similar, same as most Socket.io apps at that
// point).
const User = require('../User');
const { genId, pick } = require('./util');
const { createEnv } = require('./env');
const { makeBot } = require('./bots');
const { BY_ID, QUICKPLAY_IDS } = require('./registry');
const { settleMatch } = require('./settle');

const COUNTDOWN_MS = 3000;
const DISCONNECT_GRACE_MS = 20000;
const BOT_FALLBACK_MS = 12000;
const REMATCH_WINDOW_MS = 45000;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: easy to read aloud/type

function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return s;
}

class MatchManager {
  constructor(io) {
    this.io = io;
    this.parties = new Map();   // code -> { code, ownerId, members: Map(userId -> {username, displayName, avatarUrl, rating}), createdAt }
    this.queues = new Map();    // gameId ('random' too) -> [{ userId, rating, matches, socket-info, joinedAt, timer }]
    this.matches = new Map();   // matchId -> MatchRecord
    this.userMatch = new Map(); // userId -> matchId (only one active match per user at a time)
    this.disconnectTimers = new Map(); // userId -> { matchId, timer }
    this.rematchable = new Map(); // matchId -> { gameId, mode, settings, partyCode, humanIds: Set, requested: Set, timer }
  }

  // ── Sockets ──────────────────────────────────────────────────────────────
  attach(socket) {
    const userId = socket.data.userId;

    socket.on('party:create', (payload, ack) => this._safe(ack, () => this.createParty(userId, payload)));
    socket.on('party:join', (payload, ack) => this._safe(ack, () => this.joinParty(userId, payload && payload.code)));
    socket.on('party:leave', (_payload, ack) => this._safe(ack, () => this.leaveParty(userId)));
    socket.on('party:invite', (payload, ack) => this._safe(ack, () => this.inviteToParty(userId, payload && payload.friendId)));
    socket.on('party:start', (payload, ack) => this._safe(ack, () => this.startPartyMatch(userId, payload)));

    socket.on('queue:join', (payload, ack) => this._safe(ack, () => this.joinQueue(userId, payload)));
    socket.on('queue:leave', (_payload, ack) => this._safe(ack, () => this.leaveQueue(userId)));

    socket.on('match:action', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const rec = this.matches.get(payload.matchId);
      if (!rec || !rec.playerIds.has(userId)) return;
      rec.game.handle(userId, payload.msg);
    });
    socket.on('match:leave', (payload) => {
      const rec = payload && this.matches.get(payload.matchId);
      if (!rec || !rec.playerIds.has(userId)) return;
      rec.game.forfeit(userId);
    });
    socket.on('match:rematch', (payload, ack) => this._safe(ack, () => this.requestRematch(userId, payload && payload.matchId)));

    socket.on('disconnect', () => this._onDisconnect(userId));
    this._onReconnect(userId);
  }

  _safe(ack, fn) {
    try { const result = fn(); if (ack) ack({ ok: true, ...(result || {}) }); }
    catch (err) { if (ack) ack({ ok: false, message: err.message }); }
  }

  // ── Presence: reconnect cancels any pending forfeit-on-disconnect ────────
  _onReconnect(userId) {
    const pending = this.disconnectTimers.get(userId);
    if (pending) { clearTimeout(pending.timer); this.disconnectTimers.delete(userId); }
    const matchId = this.userMatch.get(userId);
    if (matchId) {
      const rec = this.matches.get(matchId);
      if (rec) {
        this.io.in(`user:${userId}`).socketsJoin(`match:${matchId}`);
        this.io.to(`user:${userId}`).emit('match:resync', {
          matchId, gameId: rec.gameId, mode: rec.mode, players: rec.publicPlayers,
          init: rec.initPayload, snapshot: rec.game.snapshot(), state: rec.game.state,
        });
      }
    }
  }

  _onDisconnect(userId) {
    const matchId = this.userMatch.get(userId);
    this.leaveQueue(userId);
    if (!matchId) return;
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(userId);
      const rec = this.matches.get(matchId);
      if (rec) rec.game.forfeit(userId);
    }, DISCONNECT_GRACE_MS);
    this.disconnectTimers.set(userId, { matchId, timer });
  }

  // ── Parties ──────────────────────────────────────────────────────────────
  createParty(ownerId, payload) {
    this.leaveParty(ownerId);
    let code = makeRoomCode();
    while (this.parties.has(code)) code = makeRoomCode();
    const party = { code, ownerId, members: new Map(), createdAt: Date.now() };
    this.parties.set(code, party);
    this._joinPartyMembership(party, ownerId);
    for (const friendId of (payload && payload.friendIds) || []) this.inviteToParty(ownerId, friendId);
    return { code };
  }

  async _joinPartyMembership(party, userId) {
    const u = await User.findById(userId).select('username displayName avatarUrl rating').lean();
    if (!u) return;
    party.members.set(userId, { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, rating: u.rating });
    this.io.in(`user:${userId}`).socketsJoin(`party:${party.code}`);
    this._broadcastParty(party);
  }

  joinParty(userId, code) {
    const party = code && this.parties.get(String(code).toUpperCase());
    if (!party) throw new Error('No party with that code.');
    if (party.members.size >= 12) throw new Error('That party is full.');
    this.leaveParty(userId);
    this._joinPartyMembership(party, userId);
    return { code: party.code };
  }

  inviteToParty(fromUserId, friendId) {
    const party = this._partyOf(fromUserId);
    if (!party || !friendId) return;
    this.io.to(`user:${friendId}`).emit('party:invited', { code: party.code, from: fromUserId });
  }

  leaveParty(userId) {
    const party = this._partyOf(userId);
    if (!party) return;
    party.members.delete(userId);
    this.io.in(`user:${userId}`).socketsLeave(`party:${party.code}`);
    if (!party.members.size) { this.parties.delete(party.code); return; }
    if (party.ownerId === userId) party.ownerId = party.members.keys().next().value; // promote next member
    this._broadcastParty(party);
  }

  _partyOf(userId) {
    for (const p of this.parties.values()) if (p.members.has(userId)) return p;
    return null;
  }

  _broadcastParty(party) {
    this.io.to(`party:${party.code}`).emit('party:update', {
      code: party.code, ownerId: party.ownerId,
      members: Array.from(party.members, ([id, m]) => ({ id, ...m })),
    });
  }

  startPartyMatch(ownerId, payload) {
    const party = this._partyOf(ownerId);
    if (!party) throw new Error('You are not in a party.');
    if (party.ownerId !== ownerId) throw new Error('Only the party owner can start the game.');
    const gameId = payload && payload.gameId;
    if (!BY_ID[gameId]) throw new Error('Unknown game.');
    const memberIds = Array.from(party.members.keys()).filter((id) => !this.userMatch.has(id));
    if (memberIds.length < 1) throw new Error('Nobody here to play with.');
    this._createMatch(gameId, memberIds, payload && payload.settings, { partyCode: party.code });
    return {};
  }

  // ── Matchmaking ──────────────────────────────────────────────────────────
  async joinQueue(userId, payload) {
    this.leaveQueue(userId);
    const gameId = (payload && payload.gameId) || 'random';
    if (gameId !== 'random' && !BY_ID[gameId]) throw new Error('Unknown game.');
    const u = await User.findById(userId).select('rating matchesPlayed').lean();
    if (!u) throw new Error('Account not found.');
    if (this.userMatch.has(userId)) throw new Error('Already in a match.');

    const entry = { userId, rating: u.rating, matches: u.matchesPlayed, joinedAt: Date.now(), settings: (payload && payload.settings) || {} };
    const q = this.queues.get(gameId) || [];
    q.push(entry);
    this.queues.set(gameId, q);
    this.io.to(`user:${userId}`).emit('queue:waiting', { gameId });

    entry.botTimer = setTimeout(() => this._fillWithBot(gameId, userId), BOT_FALLBACK_MS);
    this._matchQueue(gameId);
    return { gameId };
  }

  leaveQueue(userId) {
    for (const [gameId, q] of this.queues) {
      const i = q.findIndex((e) => e.userId === userId);
      if (i !== -1) { clearTimeout(q[i].botTimer); q.splice(i, 1); if (!q.length) this.queues.delete(gameId); }
    }
  }

  // Greedy pairing by rating proximity; the wait grows the acceptable gap so
  // nobody waits forever just because they're off the curve.
  _matchQueue(gameId) {
    const q = this.queues.get(gameId);
    if (!q || q.length < 2) return;
    q.sort((a, b) => a.rating - b.rating);
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1];
      const waitMs = Date.now() - Math.min(a.joinedAt, b.joinedAt);
      const allowedGap = 60 + waitMs / 100; // widens ~10 pts/sec
      if (Math.abs(a.rating - b.rating) <= allowedGap) {
        clearTimeout(a.botTimer); clearTimeout(b.botTimer);
        q.splice(i, 2);
        const chosenGame = gameId === 'random' ? pick(Math.random, QUICKPLAY_IDS) : gameId;
        this._createMatch(chosenGame, [a.userId, b.userId], {});
        return this._matchQueue(gameId);
      }
    }
  }

  _fillWithBot(gameId, userId) {
    const q = this.queues.get(gameId);
    if (!q) return;
    const i = q.findIndex((e) => e.userId === userId);
    if (i === -1) return;
    q.splice(i, 1);
    const chosenGame = gameId === 'random' ? pick(Math.random, QUICKPLAY_IDS) : gameId;
    this._createMatch(chosenGame, [userId], {}, { withBot: true });
  }

  // ── Match lifecycle ───────────────────────────────────────────────────────
  async _createMatch(gameId, humanUserIds, settings, opts = {}) {
    const Game = BY_ID[gameId];
    if (!Game) return;
    const humans = await User.find({ _id: { $in: humanUserIds } })
      .select('username displayName avatarUrl rating matchesPlayed').lean();
    if (!humans.length) return;

    const players = humans.map((u) => ({
      id: String(u._id), rating: u.rating, matches: u.matchesPlayed, isBot: false,
      username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl,
    }));

    if (opts.withBot || players.length < 2) {
      const bot = makeBot(Math.random, players.map((p) => ({ rating: p.rating, avgWpm: null })));
      players.push(bot);
    }

    const matchId = genId(8);
    const room = `match:${matchId}`;
    for (const p of players) if (!p.isBot) this.io.in(`user:${p.id}`).socketsJoin(room);

    const level = Math.round(players.filter((p) => !p.isBot).reduce((s, p) => s + p.rating, 0) / Math.max(1, players.filter((p) => !p.isBot).length));
    const env = createEnv(this.io, room);
    const game = new Game(env, { id: matchId, mode: settings && settings.mode, players, level, settings: settings || {} });

    const rec = {
      matchId, gameId, mode: settings && settings.mode, settings: settings || {}, game, players,
      playerIds: new Set(players.map((p) => p.id)),
      publicPlayers: players.map((p) => ({ id: p.id, isBot: p.isBot, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl, rating: p.rating })),
      initPayload: game.publicInit(), startedAt: Date.now(), partyCode: opts.partyCode || null,
    };
    this.matches.set(matchId, rec);
    for (const p of players) if (!p.isBot) this.userMatch.set(p.id, matchId);

    this.io.to(room).emit('match:found', {
      matchId, gameId, mode: rec.mode, players: rec.publicPlayers, init: rec.initPayload, countdownMs: COUNTDOWN_MS,
    });

    env._onFinish((rankings, extra) => this._finishMatch(matchId, rankings, extra));
    env._onAbort(() => this._abortMatch(matchId));

    setTimeout(() => { if (this.matches.has(matchId)) game.begin(); }, COUNTDOWN_MS);
  }

  async _finishMatch(matchId, rankings, extra) {
    const rec = this.matches.get(matchId);
    if (!rec || rec.settled) return;
    rec.settled = true;
    let deltas = {};
    try {
      ({ deltas } = await settleMatch({
        gameId: rec.gameId, mode: rec.mode, players: rec.players, rankings, startedAt: rec.startedAt, extra,
      }));
    } catch (err) {
      console.error('settleMatch failed:', err);
    }
    this.io.to(`match:${matchId}`).emit('match:end', { matchId, rankings, deltas, extra: this._publicExtra(extra) });
    this._offerRematch(rec);
    this._cleanupMatch(rec);
  }

  // Keeps a finished match "rematch-able" for a short window: any human who
  // was in it can request a rematch, and once every human from the original
  // match has asked for one, a fresh match is started with the same roster,
  // game, and settings (fresh ratings are re-fetched, same as any new match).
  _offerRematch(rec) {
    const humanIds = new Set(rec.players.filter((p) => !p.isBot).map((p) => p.id));
    if (!humanIds.size) return;
    const timer = setTimeout(() => this._expireRematch(rec.matchId), REMATCH_WINDOW_MS);
    this.rematchable.set(rec.matchId, {
      gameId: rec.gameId, mode: rec.mode, settings: rec.settings, partyCode: rec.partyCode,
      humanIds, requested: new Set(), timer,
    });
  }
  _expireRematch(matchId) {
    const rr = this.rematchable.get(matchId);
    if (!rr) return;
    this.rematchable.delete(matchId);
    for (const id of rr.humanIds) this.io.to(`user:${id}`).emit('match:rematch-expired', { matchId });
  }
  requestRematch(userId, matchId) {
    const rr = matchId && this.rematchable.get(matchId);
    if (!rr) throw new Error('The rematch window has closed.');
    if (!rr.humanIds.has(userId)) throw new Error('You were not in that match.');
    if (this.userMatch.has(userId)) throw new Error('Finish your current match first.');
    rr.requested.add(userId);
    const waitingOn = Array.from(rr.humanIds).filter((id) => !rr.requested.has(id));
    for (const id of rr.humanIds) this.io.to(`user:${id}`).emit('match:rematch-status', { matchId, waitingOn });
    if (!waitingOn.length) {
      clearTimeout(rr.timer);
      this.rematchable.delete(matchId);
      this._createMatch(rr.gameId, Array.from(rr.humanIds), rr.settings, { partyCode: rr.partyCode });
    }
    return {};
  }

  _abortMatch(matchId) {
    const rec = this.matches.get(matchId);
    if (!rec || rec.settled) return;
    rec.settled = true;
    this.io.to(`match:${matchId}`).emit('match:aborted', { matchId });
    this._cleanupMatch(rec);
  }

  // Strip anything bulky/internal (e.g. full wiki paths, qLog) before sending
  // to clients that aren't the ones who need it — keep only small, useful bits.
  _publicExtra() { return undefined; }

  _cleanupMatch(rec) {
    rec.game.env && rec.game.env._clearAllTimers && rec.game.env._clearAllTimers();
    for (const p of rec.players) {
      if (p.isBot) continue;
      if (this.userMatch.get(p.id) === rec.matchId) this.userMatch.delete(p.id);
      this.io.in(`user:${p.id}`).socketsLeave(`match:${rec.matchId}`);
    }
    this.matches.delete(rec.matchId);
  }
}

module.exports = { MatchManager };
