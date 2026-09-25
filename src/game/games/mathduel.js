// Math Duel: 10 questions, first correct answer takes the point.
// A wrong answer locks you out for a moment (no spam-guessing).
// Which topics appear depends on the players' rating ("bands" below).
const BaseGame = require('../BaseGame');
const { rint, pick, clamp, logn } = require('../util');

// ── Topic bands: new topics unlock as rating rises ───────────────────────────
// The FIRST TWO are what you sketched (1000-1200 basic, 1200-1500 + quadratics).
// The rest are my draft, easy to change: just edit `min` or move topics around.
const BANDS = [
  { id: 'basic',     min: 0,    label: 'Arithmetic',          topics: ['add', 'sub', 'mul', 'div', 'mixed'] },
  { id: 'quadratic', min: 1200, label: 'Quadratics',          topics: ['quad_roots', 'quad_vieta', 'quad_eval', 'quad_disc'] },
  { id: 'algebra',   min: 1500, label: 'Algebra & sequences', topics: ['percent', 'simul', 'powers', 'seq_sum', 'seq_term'] },
  { id: 'calculus',  min: 1800, label: 'Calculus & counting', topics: ['deriv', 'limit', 'comb', 'perm'] },
  { id: 'advanced',  min: 2100, label: 'Advanced',            topics: ['integral', 'det2', 'log', 'deriv2'] },
];

const TOPIC_LABEL = {
  add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division', mixed: 'Order of operations',
  quad_roots: 'Quadratic roots', quad_vieta: 'Sum / product of roots', quad_eval: 'Evaluate f(x)', quad_disc: 'Discriminant',
  percent: 'Percentages', simul: 'Simultaneous equations', powers: 'Powers & roots', seq_sum: 'Series sum', seq_term: 'Sequences',
  deriv: 'Derivatives', limit: 'Limits', comb: 'Combinations', perm: 'Permutations',
  integral: 'Integrals', det2: 'Determinants', log: 'Logarithms', deriv2: 'Second derivative',
};

const TOTAL_QUESTIONS = 10;
const LOCKOUT_MS = 1500;      // after a wrong answer
const INTERMISSION_MS = 1300; // between questions

// ── Formatting helpers ───────────────────────────────────────────────────────
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const sup = (n) => String(n).split('').map((c) => SUP[c] || c).join('');
const sub = (n) => String(n).split('').map((c) => SUB[c] || c).join('');
const num = (n) => String(n).replace('-', '−'); // typographic minus

// [1, -5, 6] -> "x² − 5x + 6"   (coefficients high -> low)
function poly(coefs) {
  const deg = coefs.length - 1;
  let s = '';
  coefs.forEach((c, i) => {
    const p = deg - i;
    if (c === 0) return;
    const abs = Math.abs(c);
    let body = abs === 1 && p > 0 ? '' : String(abs);
    if (p >= 1) body += 'x';
    if (p >= 2) body += sup(p);
    if (!s) s = (c < 0 ? '−' : '') + body;
    else s += ` ${c < 0 ? '−' : '+'} ${body}`;
  });
  return s || '0';
}
const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
};
const nonzero = (rnd, lo, hi) => { let x = 0; while (x === 0) x = rint(rnd, lo, hi); return x; };

// ── Question generators ──────────────────────────────────────────────────────
// (rnd, t) -> { prompt, answer, baseMs, meta }
//   t in [0,1]: how far through its band the players are (scales the numbers)
//   baseMs: how long a player at this level typically needs (used for the time
//           limit and for calibrating bots)
//   meta: raw numbers, only used by the tests to double-check the answers
const GEN = {
  add(rnd, t) {
    const hi = Math.round(30 + t * 220);
    const a = rint(rnd, 12, hi), b = rint(rnd, 12, hi);
    return { prompt: `${a} + ${b}`, answer: a + b, baseMs: 2800 + t * 1800, meta: { a, b } };
  },
  sub(rnd, t) {
    const hi = Math.round(60 + t * 340);
    const a = rint(rnd, 30, hi), b = rint(rnd, 12, t > 0.6 ? hi : a);
    return { prompt: `${a} − ${b}`, answer: a - b, baseMs: 3000 + t * 1800, meta: { a, b } };
  },
  mul(rnd, t) {
    const a = rint(rnd, 3, Math.round(9 + t * 16)), b = rint(rnd, 3, Math.round(9 + t * 8));
    return { prompt: `${a} × ${b}`, answer: a * b, baseMs: 3500 + t * 3500, meta: { a, b } };
  },
  div(rnd, t) {
    const b = rint(rnd, 3, Math.round(9 + t * 7)), q = rint(rnd, 3, Math.round(12 + t * 20));
    return { prompt: `${b * q} ÷ ${b}`, answer: q, baseMs: 3800 + t * 3000, meta: { b, q } };
  },
  mixed(rnd, t) {
    const b = rint(rnd, 2, Math.round(9 + t * 4)), c = rint(rnd, 2, Math.round(9 + t * 4)), a = rint(rnd, 5, Math.round(40 + t * 90));
    if (rnd() < 0.5) return { prompt: `${a} + ${b} × ${c}`, answer: a + b * c, baseMs: 5200 + t * 2500, meta: { a, b, c } };
    return { prompt: `(${a} − ${b}) × ${c}`, answer: (a - b) * c, baseMs: 5500 + t * 2500, meta: { a, b, c } };
  },

  quad_roots(rnd, t) {
    const R = Math.round(5 + t * 6);
    let p = rint(rnd, -R, R + 2), q = rint(rnd, -R, R + 2);
    while (q === p) q = rint(rnd, -R, R + 2);
    const b = -(p + q), c = p * q;
    return { prompt: `Larger root of ${poly([1, b, c])} = 0`, answer: Math.max(p, q), baseMs: 9000 + t * 3000, meta: { a: 1, b, c, p, q } };
  },
  quad_vieta(rnd, t) {
    const a = rint(rnd, 1, 3);
    const p = rint(rnd, -7, 9), q = rint(rnd, -7, 9);
    const b = -a * (p + q), c = a * p * q;
    if (rnd() < 0.5) return { prompt: `Sum of the roots of ${poly([a, b, c])} = 0`, answer: p + q, baseMs: 6500 + t * 2000, meta: { a, b, c, p, q, kind: 'sum' } };
    return { prompt: `Product of the roots of ${poly([a, b, c])} = 0`, answer: p * q, baseMs: 6500 + t * 2000, meta: { a, b, c, p, q, kind: 'product' } };
  },
  quad_eval(rnd, t) {
    const a = rint(rnd, 1, 3), b = rint(rnd, -9, 9), c = rint(rnd, -9, 9), x = rint(rnd, -4, 5);
    return { prompt: `If f(x) = ${poly([a, b, c])}, find f(${num(x)})`, answer: a * x * x + b * x + c, baseMs: 8500 + t * 2500, meta: { a, b, c, x } };
  },
  quad_disc(rnd, t) {
    const a = rint(rnd, 1, 4), b = rint(rnd, -9, 9), c = rint(rnd, -9, 9);
    return { prompt: `Discriminant of ${poly([a, b, c])}`, answer: b * b - 4 * a * c, baseMs: 8500 + t * 2000, meta: { a, b, c } };
  },

  percent(rnd, t) {
    const pcts = t < 0.4 ? [10, 20, 25, 50, 75] : [5, 15, 30, 35, 40, 45, 60, 65, 80, 85, 90, 95, 120];
    const pct = pick(rnd, pcts), base = 20 * rint(rnd, 3, Math.round(20 + t * 30)); // multiples of 20 keep every answer whole
    return { prompt: `${pct}% of ${base}`, answer: (pct * base) / 100, baseMs: 6500 + t * 2500, meta: { pct, base } };
  },
  simul(rnd, t) {
    if (t < 0.5) {
      const x = rint(rnd, 3, 12), y = rint(rnd, 1, x - 1);
      return { prompt: `x + y = ${x + y} and x − y = ${x - y}. Find x · y`, answer: x * y, baseMs: 11000, meta: { x, y, a1: 1, b1: 1, a2: 1, b2: -1 } };
    }
    let a1, b1, a2, b2;
    do { a1 = rint(rnd, 1, 4); b1 = rint(rnd, 1, 4); a2 = rint(rnd, 1, 4); b2 = -rint(rnd, 1, 4); } while (a1 * b2 - a2 * b1 === 0);
    const x = rint(rnd, -4, 8), y = rint(rnd, -4, 8);
    const c1 = a1 * x + b1 * y, c2 = a2 * x + b2 * y;
    const eq = (a, b, c) => `${a}x ${b < 0 ? '−' : '+'} ${Math.abs(b)}y = ${num(c)}`;
    return { prompt: `${eq(a1, b1, c1)} and ${eq(a2, b2, c2)}. Find x + y`, answer: x + y, baseMs: 19000, meta: { x, y, a1, b1, a2, b2 } };
  },
  powers(rnd, t) {
    const k = rint(rnd, 0, 2);
    if (k === 0) { const e = rint(rnd, 6, 12); return { prompt: `2${sup(e)}`, answer: 2 ** e, baseMs: 5000, meta: { base: 2, e } }; }
    if (k === 1) { const n = rint(rnd, 11, 30); return { prompt: `√${n * n}`, answer: n, baseMs: 5500, meta: { root: n } }; }
    const b = pick(rnd, [3, 4, 5, 6]), e = b === 3 ? rint(rnd, 4, 6) : rint(rnd, 3, 4);
    return { prompt: `${b}${sup(e)}`, answer: b ** e, baseMs: 6500, meta: { base: b, e } };
  },
  seq_sum(rnd, t) {
    const a = rint(rnd, 1, 12), d = nonzero(rnd, -4, 9), n = rint(rnd, 8, 20);
    const shown = [0, 1, 2].map((i) => num(a + i * d)).join(', ');
    return { prompt: `Sum of the first ${n} terms of ${shown}, …`, answer: (n * (2 * a + (n - 1) * d)) / 2, baseMs: 16000, meta: { a, d, n } };
  },
  seq_term(rnd, t) {
    const a = rint(rnd, -5, 15), d = nonzero(rnd, -6, 9), n = rint(rnd, 10, 40);
    const shown = [0, 1, 2].map((i) => num(a + i * d)).join(', ');
    return { prompt: `${ordinal(n)} term of ${shown}, …`, answer: a + (n - 1) * d, baseMs: 9500, meta: { a, d, n } };
  },

  deriv(rnd, t) {
    const k = rint(rnd, -3, 4);
    if (t < 0.5) {
      const a = rint(rnd, 1, 5), b = rint(rnd, -9, 9), c = rint(rnd, -9, 9);
      return { prompt: `d/dx of ${poly([a, b, c])} at x = ${num(k)}`, answer: 2 * a * k + b, baseMs: 11000, meta: { coefs: [a, b, c], x: k } };
    }
    const a = rint(rnd, 1, 3), b = rint(rnd, -5, 5), c = rint(rnd, -9, 9), d = rint(rnd, -9, 9);
    return { prompt: `d/dx of ${poly([a, b, c, d])} at x = ${num(k)}`, answer: 3 * a * k * k + 2 * b * k + c, baseMs: 15000, meta: { coefs: [a, b, c, d], x: k } };
  },
  limit(rnd, t) {
    const a = rint(rnd, 2, 9);
    if (rnd() < 0.6) return { prompt: `lim (x→${a}) of (x² − ${a * a}) / (x − ${a})`, answer: 2 * a, baseMs: 11000, meta: { a, n: 2 } };
    return { prompt: `lim (x→${a}) of (x³ − ${a ** 3}) / (x − ${a})`, answer: 3 * a * a, baseMs: 14000, meta: { a, n: 3 } };
  },
  comb(rnd, t) {
    const n = rint(rnd, 5, 12), k = rint(rnd, 2, 4);
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return { prompt: `${n}C${k}  (ways to choose ${k} from ${n})`, answer: Math.round(r), baseMs: 12000, meta: { n, k } };
  },
  perm(rnd, t) {
    const n = rint(rnd, 5, 9), k = rint(rnd, 2, 3);
    let r = 1;
    for (let i = 0; i < k; i++) r *= n - i;
    return { prompt: `${n}P${k}  (ordered arrangements of ${k} from ${n})`, answer: r, baseMs: 9500, meta: { n, k } };
  },

  integral(rnd, t) {
    const a = rint(rnd, 1, 4), b = rint(rnd, -6, 8), k = rint(rnd, 2, 5);
    // ∫₀ᵏ (2a·x + b) dx = a·k² + b·k
    return { prompt: `∫ from 0 to ${k} of (${poly([2 * a, b])}) dx`, answer: a * k * k + b * k, baseMs: 15000, meta: { a, b, k } };
  },
  det2(rnd, t) {
    const a = rint(rnd, -6, 9), b = rint(rnd, -6, 9), c = rint(rnd, -6, 9), d = rint(rnd, -6, 9);
    return { prompt: `det [[${num(a)}, ${num(b)}], [${num(c)}, ${num(d)}]]`, answer: a * d - b * c, baseMs: 10000, meta: { a, b, c, d } };
  },
  log(rnd, t) {
    const base = pick(rnd, [2, 3, 5, 10]), k = base === 2 ? rint(rnd, 3, 10) : base === 3 ? rint(rnd, 2, 6) : base === 5 ? rint(rnd, 2, 4) : rint(rnd, 2, 6);
    return { prompt: `log${sub(base)}(${base ** k})`, answer: k, baseMs: 7000, meta: { base, k } };
  },
  deriv2(rnd, t) {
    const a = rint(rnd, 1, 3), b = rint(rnd, -4, 4), c = rint(rnd, -6, 6), k = rint(rnd, -3, 3);
    return { prompt: `f″(${num(k)}) for f(x) = ${poly([a, b, c, 0, 0])}`, answer: 12 * a * k * k + 6 * b * k + 2 * c, baseMs: 19000, meta: { a, b, c, x: k } };
  },
};

function unlockedBands(level) { return BANDS.filter((b) => level >= b.min); }

// How far through its band the level is (0..1): scales the numbers within a topic.
function bandProgress(band, level) {
  const start = band.min === 0 ? 800 : band.min;
  const i = BANDS.indexOf(band);
  const end = i + 1 < BANDS.length ? BANDS[i + 1].min : start + 600;
  return clamp((level - start) / (end - start), 0, 1);
}

// Half the questions come from the newest unlocked band, the rest from older ones.
function makeQuestion(rnd, level) {
  const un = unlockedBands(level);
  const band = un.length === 1 || rnd() < 0.5 ? un[un.length - 1] : pick(rnd, un.slice(0, -1));
  const topic = pick(rnd, band.topics);
  const q = GEN[topic](rnd, bandProgress(band, level));
  return { ...q, topic, band: band.id };
}

function parseAnswer(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return NaN;
  const s = String(v).replace(/[−–—]/g, '-').replace(/\s+/g, '');
  if (!/^[+-]?\d{1,12}(\.\d{1,6})?$/.test(s)) return NaN;
  return Number(s);
}

class MathDuel extends BaseGame {
  constructor(env, opts) {
    super(env, opts);
    this.total = TOTAL_QUESTIONS;
    this.qi = -1;
    this.q = null;
    this.scores = {};
    this.timeSum = {};
    this.lockUntil = {};
    this.qLog = []; // [{ topic, winner|null }] for stats
    for (const p of this.players) { this.scores[p.id] = 0; this.timeSum[p.id] = 0; this.lockUntil[p.id] = 0; }
  }

  publicInit() {
    return { total: this.total, topics: unlockedBands(this.level).map((b) => b.label), lockoutMs: LOCKOUT_MS };
  }

  begin() {
    if (this.state !== 'countdown') return;
    this.state = 'running';
    this.nextQuestion();
  }

  nextQuestion() {
    if (this.state !== 'running') return;
    if (this.qi + 1 >= this.total || this.decided()) return this.end();
    this.qi++;
    const raw = makeQuestion(this.env.rnd, this.level);
    const now = this.env.now();
    const limit = clamp(Math.round(raw.baseMs * 2.6), 12000, 45000);
    this.q = { i: this.qi, prompt: raw.prompt, answer: raw.answer, topic: raw.topic, baseMs: raw.baseMs, openedAt: now, deadline: now + limit, closed: false };
    this.env.emit('q', {
      i: this.q.i, total: this.total, prompt: this.q.prompt, topic: TOPIC_LABEL[raw.topic],
      deadline: this.q.deadline, serverTime: now, scores: this.scores,
    });
    this.q.timer = this.env.after(limit, () => this.closeQuestion(null));
    for (const b of this.bots) if (!this.isForfeited(b.id)) this.botPlan(b, this.q);
  }

  // Someone can't catch up any more: end early instead of playing out dead questions.
  decided() {
    const remaining = this.total - (this.qi + 1);
    const active = this.players.filter((p) => !this.isForfeited(p.id)).map((p) => this.scores[p.id]).sort((a, b) => b - a);
    return active.length >= 2 && active[0] - active[1] > remaining;
  }

  handle(pid, msg) {
    if (this.state !== 'running' || !msg || msg.type !== 'answer') return;
    const q = this.q;
    if (!q || q.closed || this.isForfeited(pid) || !(pid in this.scores)) return;
    if (msg.i !== undefined && msg.i !== q.i) return;                 // answer to an old question
    const now = this.env.now();
    if (now < this.lockUntil[pid]) return;
    const val = parseAnswer(msg.value);
    if (Number.isNaN(val)) return;
    if (Math.abs(val - q.answer) < 1e-6) {
      this.closeQuestion(pid);
    } else {
      this.lockUntil[pid] = now + LOCKOUT_MS;
      this.env.emitTo(pid, 'wrong', { i: q.i, until: this.lockUntil[pid], serverTime: now });
      this.env.emit('opp-wrong', { id: pid, i: q.i });
    }
  }

  closeQuestion(winner) {
    const q = this.q;
    if (!q || q.closed) return;
    q.closed = true;
    this.env.cancel(q.timer);
    const ms = this.env.now() - q.openedAt;
    if (winner) { this.scores[winner]++; this.timeSum[winner] += ms; }
    this.qLog.push({ topic: q.topic, winner: winner || null });
    this.env.emit('q-end', { i: q.i, answer: q.answer, winner: winner || null, ms, scores: this.scores, timedOut: !winner });
    this.env.after(INTERMISSION_MS, () => this.nextQuestion());
  }

  // ── Bots ───────────────────────────────────────────────────────────────────
  // Timing = what a player of that level typically needs for this question,
  // scaled by the bot's skill and mood, plus reading and typing time. Sometimes
  // wrong (then fixes it after the lockout), sometimes too slow to answer at all.
  botPlan(bot, q) {
    const rnd = this.env.rnd;
    const diff = (bot.rating - this.level) / 400;
    const speed = Math.pow(2, -diff) / bot.form * 1.05;               // slightly slower than an equal human
    const think = q.baseMs * speed * logn(rnd, 0.32);
    const typing = String(q.answer).length * rint(rnd, 180, 320);
    const t = Math.max(1500 + rint(rnd, 0, 500), think) + typing + rint(rnd, 300, 800);
    const pCorrect = clamp(0.9 + diff * 0.08, 0.6, 0.97);
    const send = (value, at) => this.env.after(at, () => this.handle(bot.id, { type: 'answer', i: q.i, value: String(value) }));
    if (t > q.deadline - q.openedAt - 400) return;                    // couldn't solve it in time
    if (rnd() < pCorrect) return void send(q.answer, t);
    // a slip: near-miss answer first, then (usually) correct it
    const off = pick(rnd, [-10, -1, 1, 2, 10]);
    send(q.answer + (Math.abs(q.answer) < 10 ? pick(rnd, [-2, -1, 1, 2]) : off), t);
    if (rnd() < 0.65) send(q.answer, t + LOCKOUT_MS + rint(rnd, 900, 2600));
  }

  // ── Ending ─────────────────────────────────────────────────────────────────
  end() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    const entries = this.players.map((p) => ({ id: p.id, score: this.scores[p.id], ms: this.timeSum[p.id] }));
    // Most points wins; if level on points, the faster total time on the questions they won.
    const ranked = this.rank(entries, (a, b) => b.score - a.score || (a.score === 0 && b.score === 0 ? 0 : a.ms - b.ms));
    const qs = this.qLog;
    this.env.finish(
      ranked.map((r) => ({ id: r.id, rank: r.rank, score: r.score, detail: { avgMs: r.score ? Math.round(r.ms / r.score) : null } })),
      { qLog: qs }
    );
  }

  snapshot() {
    const q = this.q;
    return {
      total: this.total, scores: this.scores,
      q: q ? { i: q.i, prompt: q.prompt, deadline: q.deadline, closed: q.closed, topic: TOPIC_LABEL[q.topic] } : null,
      lockUntil: this.lockUntil,
    };
  }
}

MathDuel.id = 'mathduel';
module.exports = MathDuel;
module.exports.GEN = GEN;
module.exports.BANDS = BANDS;
module.exports.makeQuestion = makeQuestion;
module.exports.parseAnswer = parseAnswer;
module.exports.poly = poly;
