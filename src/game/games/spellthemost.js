// Spell the Most — a category is shown (Animals, Presidents, Countries, Fast
// food...); everyone races to type as many distinct valid items as they can
// before time runs out. Most correct items wins; ties broken by who reached
// that count first.
const BaseGame = require('../BaseGame');
const { pick, rint } = require('../util');
const { CATEGORIES } = require('../data/categories');

const DURATION_MS = 60000;
const MIN_SUBMIT_INTERVAL_MS = 250; // basic anti-paste-spam guard

const normalize = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

class SpellTheMost extends BaseGame {
  constructor(env, opts) {
    super(env, opts);
    this.category = (opts.settings && opts.settings.categoryId && CATEGORIES.find((c) => c.id === opts.settings.categoryId))
      || pick(this.env.rnd, CATEGORIES);
    this.lookup = new Map(); // normalized alias -> canonical name
    for (const item of this.category.items) {
      this.lookup.set(normalize(item.name), item.name);
      for (const al of item.aliases || []) this.lookup.set(normalize(al), item.name);
    }
    this.found = {};   // id -> Set(canonical names)
    this.lastAt = {};  // id -> ms of first reaching current count (for tie-break)
    this.timeline = {}; // id -> [{count, ms}] progress, first item = fastest
    for (const p of this.players) { this.found[p.id] = new Set(); this.timeline[p.id] = []; }
  }

  publicInit() {
    return { category: { id: this.category.id, label: this.category.label }, durationMs: DURATION_MS, itemCount: this.category.items.length };
  }

  begin() {
    if (this.state !== 'countdown') return;
    this.state = 'running';
    this.startedAt = this.env.now();
    this.env.emit('go', { serverTime: this.startedAt, endsAt: this.startedAt + DURATION_MS });
    this.timer = this.env.after(DURATION_MS, () => this.end());
    for (const b of this.bots) this.botPlay(b);
  }

  handle(pid, msg) {
    if (this.state !== 'running' || !msg || msg.type !== 'submit' || this.isForfeited(pid)) return;
    const set = this.found[pid];
    if (!set) return;
    const now = this.env.now();
    const canon = this.lookup.get(normalize(msg.value));
    if (!canon) { this.env.emitTo(pid, 'reject', { value: msg.value }); return; }
    if (set.has(canon)) { this.env.emitTo(pid, 'duplicate', { value: canon }); return; }
    set.add(canon);
    this.timeline[pid].push({ count: set.size, ms: now - this.startedAt });
    this.env.emit('found', { id: pid, count: set.size, item: canon });
  }

  botPlay(bot) {
    const rnd = this.env.rnd;
    const skill = Math.min(1, Math.max(0.25, (bot.rating - 700) / 1300)) * (bot.form || 1);
    const pool = this.env.rnd ? this.category.items.slice() : [];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    // How many they'll realistically recall, and the (slowing) pace they type them at.
    const knows = Math.min(pool.length, Math.round(pool.length * (0.12 + skill * 0.55)));
    let t = rint(rnd, 800, 2200);
    for (let i = 0; i < knows; i++) {
      const gap = rint(rnd, 900, 2600) * (1 + i * 0.02) / (0.6 + skill); // gets slower as easy answers run out
      t += gap;
      if (t > DURATION_MS - 300) break;
      this.env.after(t, () => this.handle(bot.id, { type: 'submit', value: pool[i].name }));
    }
  }

  end() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.env.cancel(this.timer);
    const entries = this.players.map((p) => {
      const count = this.found[p.id].size;
      const timeline = this.timeline[p.id];
      const msAtCount = timeline.length ? timeline[timeline.length - 1].ms : DURATION_MS;
      return { id: p.id, count, msAtCount, items: Array.from(this.found[p.id]) };
    });
    const ranked = this.rank(entries, (a, b) => b.count - a.count || a.msAtCount - b.msAtCount);
    this.env.finish(ranked.map((r) => ({ id: r.id, rank: r.rank, score: r.count, detail: { items: r.items } })));
  }

  snapshot() {
    return { category: this.category.label, counts: Object.fromEntries(this.players.map((p) => [p.id, this.found[p.id].size])) };
  }
}

SpellTheMost.id = 'spellthemost';
module.exports = SpellTheMost;
module.exports.normalize = normalize;
