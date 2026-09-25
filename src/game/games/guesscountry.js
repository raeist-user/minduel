// Guess Country — everyone gets the same shuffled sequence of country
// silhouettes (the frontend renders the actual shape; this game only decides
// which country is "up" and judges answers) but moves through it at their own
// pace: guess correctly, get the next one immediately. A shared timer ends
// the match for everyone at once; the live scoreboard is just each player's
// current index, which is what makes the race visible ("who's ahead").
const BaseGame = require('../BaseGame');
const { shuffle } = require('../util');
const { CATEGORIES } = require('../data/categories');
const { normalize } = require('./spellthemost');

const DURATION_MS = 90000;
const SEQUENCE_LENGTH = 40;
const COUNTRIES = CATEGORIES.find((c) => c.id === 'countries').items;

class GuessCountry extends BaseGame {
  constructor(env, opts) {
    super(env, opts);
    this.sequence = shuffle(this.env.rnd, COUNTRIES).slice(0, SEQUENCE_LENGTH);
    this.lookup = new Map();
    this.sequence.forEach((item, i) => {
      this.lookup.set(normalize(item.name), i);
      for (const al of item.aliases || []) this.lookup.set(normalize(al), i);
    });
    this.index = {};    // id -> how many they've solved (== which silhouette they're on)
    this.solvedAt = {}; // id -> ms of last correct guess
    for (const p of this.players) { this.index[p.id] = 0; this.solvedAt[p.id] = 0; }
  }

  publicInit() {
    return { durationMs: DURATION_MS, total: this.sequence.length };
  }

  current(pid) { return this.sequence[this.index[pid]] || null; }

  begin() {
    if (this.state !== 'countdown') return;
    this.state = 'running';
    this.startedAt = this.env.now();
    this.env.emit('go', { serverTime: this.startedAt, endsAt: this.startedAt + DURATION_MS, total: this.sequence.length });
    for (const p of this.players) this.sendCurrent(p.id);
    this.timer = this.env.after(DURATION_MS, () => this.end());
    for (const b of this.bots) this.botPlay(b);
  }

  sendCurrent(pid) {
    const c = this.current(pid);
    // "code" is just the sequence position; the frontend maps it to a
    // shape/flag from its own country-geometry data, not sent here.
    this.env.emitTo(pid, 'country', { index: this.index[pid], total: this.sequence.length, code: c ? c.name : null });
  }

  handle(pid, msg) {
    if (this.state !== 'running' || !msg || msg.type !== 'guess' || this.isForfeited(pid)) return;
    if (!(pid in this.index)) return;
    const want = this.current(pid);
    if (!want) return;
    const guessedIndex = this.lookup.get(normalize(msg.value));
    if (guessedIndex !== this.index[pid]) { this.env.emitTo(pid, 'reject', { value: msg.value }); return; }
    this.index[pid]++;
    this.solvedAt[pid] = this.env.now() - this.startedAt;
    this.env.emit('score', { id: pid, count: this.index[pid] });
    if (this.index[pid] >= this.sequence.length) { this.env.emitTo(pid, 'country', { index: this.index[pid], total: this.sequence.length, code: null }); return; } // ran out; they wait for time to end
    this.sendCurrent(pid);
  }

  // ── Bots ─────────────────────────────────────────────────────────────────
  botPlay(bot) {
    const rnd = this.env.rnd;
    const skill = Math.min(1, Math.max(0.2, (bot.rating - 700) / 1300)) * (bot.form || 1);
    const step = () => {
      if (this.state !== 'running' || this.isForfeited(bot.id)) return;
      const c = this.current(bot.id);
      if (!c) return;
      const know = rnd() < (0.35 + skill * 0.55);
      const thinkMs = know ? (1400 + rnd() * 2600) / (0.5 + skill) : (3000 + rnd() * 4000);
      this.env.after(thinkMs, () => {
        if (this.state !== 'running' || this.isForfeited(bot.id)) return;
        if (know) this.handle(bot.id, { type: 'guess', value: c.name });
        step(); // whether they got it or not, they keep trying (a miss just repeats/moves on next tick)
      });
    };
    step();
  }

  end() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.env.cancel(this.timer);
    const entries = this.players.map((p) => ({ id: p.id, count: this.index[p.id], ms: this.solvedAt[p.id] }));
    const ranked = this.rank(entries, (a, b) => b.count - a.count || a.ms - b.ms);
    this.env.finish(ranked.map((r) => ({ id: r.id, rank: r.rank, score: r.count, detail: {} })));
  }

  snapshot() {
    return { total: this.sequence.length, index: this.index };
  }
}

GuessCountry.id = 'guesscountry';
module.exports = GuessCountry;
