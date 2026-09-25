// WPM Duel — two modes, same text for every player in the match.
//   paragraph: one paragraph, 30 seconds, most correct characters wins.
//   sentence:  10 short sentences one at a time, first to clear all 10 wins
//              (ranked by how far/fast everyone else got if nobody finishes).
//
// The client streams "progress" as the person types (throttled client-side,
// ~every 200-300ms is plenty) rather than every keystroke. Correctness is the
// length of the longest correct prefix against the target text — the same
// approach Monkeytype-style tests use, and it keeps validation trivial and
// cheat-proof (the server, not the client, decides what's "correct").
const BaseGame = require('../BaseGame');
const { commonPrefix, clamp, rint, logn } = require('../util');
const { PARAGRAPHS, SENTENCES } = require('../data/texts');

const PARAGRAPH_MS = 30000;
const SENTENCE_TIMEOUT_MS = 150000; // safety net if nobody finishes all 10
const SENTENCES_TOTAL = 10;
const PROGRESS_MIN_INTERVAL_MS = 120; // ignore spammier updates than this

const wordsIn = (s) => s.trim().split(/\s+/).filter(Boolean).length;

class WpmDuel extends BaseGame {
  constructor(env, opts) {
    super(env, opts);
    this.sub = (opts.settings && opts.settings.mode === 'sentence') ? 'sentence' : 'paragraph';
    this.progress = {};      // id -> { text, correct, ms, lastAt, done, finishedAt, sentenceIndex, wpm }
    for (const p of this.players) this.progress[p.id] = { text: '', correct: 0, ms: 0, lastAt: -Infinity, done: false, finishedAt: null, sentenceIndex: 0, wpm: 0 };

    if (this.sub === 'paragraph') {
      this.text = this.env.rnd() < 1 ? PARAGRAPHS[Math.floor(this.env.rnd() * PARAGRAPHS.length)] : PARAGRAPHS[0];
    } else {
      const shuffled = SENTENCES.slice();
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(this.env.rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      this.sentences = shuffled.slice(0, SENTENCES_TOTAL);
    }
  }

  publicInit() {
    if (this.sub === 'paragraph') return { mode: 'paragraph', durationMs: PARAGRAPH_MS, text: this.text };
    return { mode: 'sentence', total: SENTENCES_TOTAL };
  }

  begin() {
    if (this.state !== 'countdown') return;
    this.state = 'running';
    this.startedAt = this.env.now();
    if (this.sub === 'paragraph') {
      this.endsAt = this.startedAt + PARAGRAPH_MS;
      this.env.emit('go', { serverTime: this.startedAt, endsAt: this.endsAt });
      this.timer = this.env.after(PARAGRAPH_MS, () => this.end());
      for (const b of this.bots) this.botTypeParagraph(b);
    } else {
      this.env.emit('go', { serverTime: this.startedAt, sentence: this.sentences[0], index: 0, total: SENTENCES_TOTAL });
      this.timer = this.env.after(SENTENCE_TIMEOUT_MS, () => this.end());
      for (const b of this.bots) this.botTypeSentences(b);
    }
  }

  handle(pid, msg) {
    if (this.state !== 'running' || !msg || this.isForfeited(pid)) return;
    const p = this.progress[pid];
    if (!p || p.done) return;
    const now = this.env.now();

    if (this.sub === 'paragraph') {
      if (msg.type !== 'progress' || typeof msg.text !== 'string') return;
      if (now - p.lastAt < PROGRESS_MIN_INTERVAL_MS) return;
      p.lastAt = now;
      const text = msg.text.slice(0, this.text.length + 20);
      const correct = commonPrefix(text, this.text);
      p.text = text; p.correct = Math.max(p.correct, correct); p.ms = now - this.startedAt;
      p.wpm = Math.round((p.correct / 5) / ((now - this.startedAt) / 60000) || 0);
      if (correct >= this.text.length) { p.done = true; p.finishedAt = now; }
      this.env.emit('progress', { id: pid, correct: p.correct, len: this.text.length, wpm: p.wpm, done: p.done });
      if (this.everyoneDone()) this.end();
      return;
    }

    // sentence mode
    if (msg.type === 'progress' && typeof msg.text === 'string') {
      if (now - p.lastAt < PROGRESS_MIN_INTERVAL_MS) return;
      p.lastAt = now;
      const target = this.sentences[p.sentenceIndex];
      const correct = commonPrefix(msg.text, target);
      this.env.emit('progress', { id: pid, index: p.sentenceIndex, correct, len: target.length });
    } else if (msg.type === 'submit' && typeof msg.text === 'string') {
      const target = this.sentences[p.sentenceIndex];
      if (commonPrefix(msg.text.trim(), target) < target.length) return; // not actually correct yet; client re-syncs
      p.sentenceIndex++;
      if (p.sentenceIndex >= SENTENCES_TOTAL) {
        p.done = true; p.finishedAt = now; p.ms = now - this.startedAt;
        p.wpm = Math.round(this.sentences.reduce((s, x) => s + wordsIn(x), 0) / (p.ms / 60000));
        this.env.emit('finished', { id: pid, ms: p.ms, wpm: p.wpm });
        this.end(); // sentence mode: first finisher ends it
      } else {
        this.env.emit('next-sentence', { id: pid, index: p.sentenceIndex, sentence: this.sentences[p.sentenceIndex] });
      }
    }
  }

  everyoneDone() { return this.players.every((p) => this.isForfeited(p.id) || this.progress[p.id].done); }

  // ── Bots ─────────────────────────────────────────────────────────────────
  botTypeParagraph(bot) {
    const rnd = this.env.rnd;
    const cps = clamp(bot.wpm * 5 / 60, 0.8, 14) * logn(rnd, 0.08); // chars/sec, human-ish jitter per match
    let i = 0;
    const tick = () => {
      if (this.state !== 'running' || this.isForfeited(bot.id)) return;
      const elapsed = (this.env.now() - this.startedAt) / 1000;
      i = Math.min(this.text.length, Math.round(elapsed * cps));
      // occasional stumble: brief pause, like a real typo + correction
      const stumble = rnd() < 0.03 ? rint(rnd, 150, 500) : 0;
      this.handle(bot.id, { type: 'progress', text: this.text.slice(0, i) });
      if (i < this.text.length && this.state === 'running') this.env.after(180 + stumble, tick);
    };
    this.env.after(rint(rnd, 250, 700), tick);
  }

  botTypeSentences(bot) {
    const rnd = this.env.rnd;
    const typeOne = () => {
      if (this.state !== 'running' || this.isForfeited(bot.id)) return;
      const p = this.progress[bot.id];
      if (!p || p.sentenceIndex >= SENTENCES_TOTAL) return;
      const target = this.sentences[p.sentenceIndex];
      const cps = clamp(bot.wpm * 5 / 60, 0.8, 14) * logn(rnd, 0.1);
      const ms = (target.length / cps) * 1000 + rint(rnd, 200, 700);
      this.env.after(ms, () => {
        this.handle(bot.id, { type: 'submit', text: target });
        this.env.after(rint(rnd, 150, 400), typeOne);
      });
    };
    this.env.after(rint(rnd, 300, 900), typeOne);
  }

  // ── Ending ───────────────────────────────────────────────────────────────
  end() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.env.cancel(this.timer);
    const entries = this.players.map((p) => {
      const g = this.progress[p.id];
      return this.sub === 'paragraph'
        ? { id: p.id, correct: g.correct, wpm: g.wpm }
        : { id: p.id, sentenceIndex: g.sentenceIndex, ms: g.done ? g.ms : Infinity, wpm: g.wpm };
    });
    const cmp = this.sub === 'paragraph'
      ? (a, b) => b.correct - a.correct
      : (a, b) => b.sentenceIndex - a.sentenceIndex || a.ms - b.ms;
    const ranked = this.rank(entries, cmp);
    this.env.finish(ranked.map((r) => ({
      id: r.id, rank: r.rank,
      score: this.sub === 'paragraph' ? r.correct : r.sentenceIndex,
      detail: { wpm: r.wpm },
    })));
  }

  snapshot() {
    return {
      mode: this.sub,
      progress: Object.fromEntries(Object.entries(this.progress).map(([id, p]) => [id, { correct: p.correct, sentenceIndex: p.sentenceIndex, done: p.done }])),
    };
  }
}

WpmDuel.id = 'wpmduel';
module.exports = WpmDuel;
