// Word Chain — free-for-all, turn order goes around the table.
//   - Round 1 opens on a random letter with no other constraint.
//   - Whoever's turn it is has TURN_MS to type any real dictionary word
//     starting with the required letter, not already used this match.
//   - The next player's required letter is the last letter of that word
//     (e.g. "goat" -> next starts with T).
//   - Wrong / repeated / timeout costs one of three hearts. At 0 hearts
//     you're out: you can keep watching or leave (BaseGame.forfeit() handles
//     "leave", no popup needed — that's a client-side affordance).
//   - Last player standing wins; if two are eliminated on the same turn
//     (shouldn't normally happen, only one player acts per turn) they'd tie.
const BaseGame = require('../BaseGame');
const { pick, rint } = require('../util');
const { isWord, wordsStartingWith, STARTABLE_LETTERS } = require('../data/dictionary');

const TURN_MS = 12000;
const START_HEARTS = 3;
const REVEAL_MS = 1400; // pause after a turn resolves, before the next opens

class WordChain extends BaseGame {
  constructor(env, opts) {
    super(env, opts);
    this.hearts = {};
    this.order = this.players.map((p) => p.id);
    for (const p of this.players) this.hearts[p.id] = START_HEARTS;
    this.used = new Set();
    this.turnIdx = -1;
    this.required = null;
    this.round = 0;
  }

  publicInit() {
    return { hearts: START_HEARTS, turnMs: TURN_MS, order: this.order };
  }

  begin() {
    if (this.state !== 'countdown') return;
    this.state = 'running';
    this.required = pick(this.env.rnd, STARTABLE_LETTERS).toUpperCase();
    this.openTurn(this.order[0]);
  }

  alive() { return this.order.filter((id) => this.hearts[id] > 0 && !this.isForfeited(id)); }

  nextAlive(afterId) {
    const alive = this.alive();
    if (!alive.length) return null;
    const i = this.order.indexOf(afterId);
    for (let step = 1; step <= this.order.length; step++) {
      const cand = this.order[(i + step) % this.order.length];
      if (alive.includes(cand)) return cand;
    }
    return null;
  }

  openTurn(pid) {
    if (this.state !== 'running') return;
    const alive = this.alive();
    if (alive.length <= 1) return this.end();
    this.current = pid;
    const now = this.env.now();
    this.deadline = now + TURN_MS;
    this.env.emit('turn', { id: pid, letter: this.required, deadline: this.deadline, serverTime: now, hearts: this.hearts });
    this.turnTimer = this.env.after(TURN_MS, () => this.resolveTurn(pid, { ok: false, reason: 'timeout' }));
    const bot = this.players.find((p) => p.id === pid && p.isBot);
    if (bot) this.botPlay(bot);
  }

  handle(pid, msg) {
    if (this.state !== 'running' || !msg || msg.type !== 'word' || pid !== this.current) return;
    const raw = typeof msg.value === 'string' ? msg.value.trim().toLowerCase() : '';
    this.env.cancel(this.turnTimer);
    this.resolveTurn(pid, this.judge(raw));
  }

  judge(word) {
    if (!word) return { ok: false, reason: 'empty' };
    if (!/^[a-z]+$/.test(word)) return { ok: false, reason: 'invalid-chars' };
    if (word[0] !== this.required.toLowerCase()) return { ok: false, reason: 'wrong-letter' };
    if (this.used.has(word)) return { ok: false, reason: 'used' };
    if (!isWord(word)) return { ok: false, reason: 'not-a-word' };
    return { ok: true, word };
  }

  resolveTurn(pid, result) {
    if (this.state !== 'running' || pid !== this.current) return;
    this.round++;
    let eliminated = false;
    if (result.ok) {
      this.used.add(result.word);
      this.required = result.word[result.word.length - 1].toUpperCase();
    } else {
      this.hearts[pid] = Math.max(0, this.hearts[pid] - 1);
      if (this.hearts[pid] === 0) eliminated = true;
      // required letter carries over unchanged so the next player gets the same prompt
    }
    this.env.emit('turn-end', {
      id: pid, ok: result.ok, reason: result.reason || null, word: result.word || null,
      hearts: this.hearts, eliminated,
    });
    if (eliminated) this.env.emit('eliminated', { id: pid });

    const alive = this.alive();
    if (alive.length <= 1) return this.env.after(REVEAL_MS, () => this.end());
    const next = this.nextAlive(pid);
    this.env.after(REVEAL_MS, () => this.openTurn(next));
  }

  // ── Bots ─────────────────────────────────────────────────────────────────
  // A bot with more hearts / higher rating answers faster and misses less; a
  // bot down to its last heart plays a little more cautiously (slower, but
  // safer words), which reads as "trying not to lose" rather than uniform skill.
  botPlay(bot) {
    const rnd = this.env.rnd;
    const skill = Math.min(1, Math.max(0.3, (bot.rating - 700) / 1200)) * (bot.form || 1);
    const pMiss = Math.max(0.03, 0.22 - skill * 0.18);
    const pool = wordsStartingWith(this.required).filter((w) => !this.used.has(w));
    const thinkMs = rint(rnd, 1200, 4200) * (2 - skill) + (this.hearts[bot.id] === 1 ? rint(rnd, 500, 1500) : 0);
    const delay = Math.min(thinkMs, TURN_MS - 600);
    this.env.after(delay, () => {
      if (this.state !== 'running' || this.current !== bot.id) return;
      if (!pool.length || rnd() < pMiss) {
        // either stuck for a real word, or a deliberate miss — send garbage / say nothing in time
        if (rnd() < 0.5 && pool.length) this.handle(bot.id, { type: 'word', value: pool[0] + 'zzz' });
        return; // otherwise let the clock run out, same as a human blanking
      }
      const word = pick(rnd, pool);
      this.handle(bot.id, { type: 'word', value: word });
    });
  }

  end() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.env.cancel(this.turnTimer);
    // Winner: last one standing. Everyone else ranked by hearts left, then by
    // how many turns they survived isn't tracked precisely, so ties share rank.
    const entries = this.players.map((p) => ({ id: p.id, hearts: this.hearts[p.id] }));
    const ranked = this.rank(entries, (a, b) => b.hearts - a.hearts);
    this.env.finish(ranked.map((r) => ({ id: r.id, rank: r.rank, score: r.hearts, detail: {} })));
  }

  snapshot() {
    return { hearts: this.hearts, required: this.required, current: this.current, deadline: this.deadline, usedCount: this.used.size };
  }
}

WordChain.id = 'wordchain';
module.exports = WordChain;
