// Wiki Race — same start + target page for everyone; first to reach the
// target by clicking real Wikipedia links wins. Every "click" is checked
// against the actual outgoing links of the page you're currently on (via
// wikiClient / env.wiki), so nobody can just type the target directly.
//
// Requires outbound network access to en.wikipedia.org in production. For
// tests or offline dev, pass `env.wiki` with the same shape as wikiClient.js
// (fetchLinks/isValidLink/canonicalTitle) backed by a small fixture graph.
const BaseGame = require('../BaseGame');
const { pick, rint } = require('../util');
const { PAIRS } = require('../data/wikiPairs');
const defaultWiki = require('../wikiClient');

const DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CLICKS = 40;              // a runaway bot/human clicking forever still stops eventually

class WikiRace extends BaseGame {
  constructor(env, opts) {
    super(env, opts);
    this.wiki = env.wiki || defaultWiki;
    const [start, target] = (opts.settings && opts.settings.start && opts.settings.target)
      ? [opts.settings.start, opts.settings.target]
      : pick(this.env.rnd, PAIRS);
    this.start = start;
    this.target = target;
    this.path = {};     // id -> [titles]
    this.clicks = {};   // id -> count
    this.busy = {};     // id -> true while resolving a click (prevents double-clicks racing)
    this.finishedAt = {}; // id -> ms
    for (const p of this.players) { this.path[p.id] = [start]; this.clicks[p.id] = 0; this.busy[p.id] = false; }
  }

  publicInit() {
    return { start: this.start, target: this.target, durationMs: DURATION_MS, maxClicks: MAX_CLICKS };
  }

  begin() {
    if (this.state !== 'countdown') return;
    this.state = 'running';
    this.startedAt = this.env.now();
    this.env.emit('go', { serverTime: this.startedAt, endsAt: this.startedAt + DURATION_MS, start: this.start, target: this.target });
    this.timer = this.env.after(DURATION_MS, () => this.end());
    for (const b of this.bots) this.botPlay(b);
  }

  handle(pid, msg) {
    if (this.state !== 'running' || !msg || msg.type !== 'navigate' || this.isForfeited(pid)) return;
    if (this.busy[pid] || this.finishedAt[pid]) return;
    if (this.clicks[pid] >= MAX_CLICKS) return;
    const target = typeof msg.title === 'string' ? msg.title : '';
    if (!target) return;
    this.busy[pid] = true;
    const from = this.path[pid][this.path[pid].length - 1];
    this.wiki.isValidLink(from, target)
      .then(async (ok) => {
        if (!ok || this.state !== 'running' || this.isForfeited(pid)) { this.busy[pid] = false; if (!ok) this.env.emitTo(pid, 'invalid-link', { title: target }); return; }
        const canonical = await this.wiki.canonicalTitle(target).catch(() => target);
        this.path[pid].push(canonical);
        this.clicks[pid]++;
        this.busy[pid] = false;
        const reached = this.wiki.norm(canonical) === this.wiki.norm(this.target);
        this.env.emit('moved', { id: pid, title: canonical, clicks: this.clicks[pid], reached });
        if (reached) {
          this.finishedAt[pid] = this.env.now() - this.startedAt;
          this.env.emit('finished', { id: pid, clicks: this.clicks[pid], ms: this.finishedAt[pid] });
          this.end();
        }
      })
      .catch(() => { this.busy[pid] = false; this.env.emitTo(pid, 'link-check-failed', { title: target }); });
  }

  // ── Bots ─────────────────────────────────────────────────────────────────
  // Fetches its own current page's real links and scores them by whether they
  // look like they lead toward the target (word overlap with the target
  // title is a crude but effective proxy — real wiki-racers do the same
  // "does this link look related" heuristic). Skill controls how good that
  // judgment is and how long it takes to read the page before clicking.
  botPlay(bot) {
    const rnd = this.env.rnd;
    const skill = Math.min(1, Math.max(0.2, (bot.rating - 700) / 1300)) * (bot.form || 1);
    const targetWords = this.target.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const visited = new Set([this.wiki.norm(this.start)]);

    const step = async () => {
      if (this.state !== 'running' || this.isForfeited(bot.id) || this.finishedAt[bot.id]) return;
      if (this.clicks[bot.id] >= MAX_CLICKS) return;
      const from = this.path[bot.id][this.path[bot.id].length - 1];
      let links;
      try { links = Array.from((await this.wiki.fetchLinks(from)).links); } catch { return; }
      const candidates = links.filter((l) => !visited.has(l));
      if (!candidates.length) return;
      const score = (l) => (l === this.wiki.norm(this.target) ? 1000 : targetWords.filter((w) => l.includes(w)).length + rnd() * (1 - skill) * 3);
      candidates.sort((a, b) => score(b) - score(a));
      const topN = Math.max(1, Math.round((1 - skill) * 6) + 1);
      const choice = candidates[Math.floor(rnd() * Math.min(topN, candidates.length))];
      visited.add(choice);
      const readMs = rint(rnd, 1500, 4500) * (2 - skill);
      this.env.after(readMs, () => {
        this.handle(bot.id, { type: 'navigate', title: choice });
        this.env.after(300, step);
      });
    };
    this.env.after(rint(rnd, 800, 2000), step);
  }

  end() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.env.cancel(this.timer);
    const entries = this.players.map((p) => ({ id: p.id, finished: !!this.finishedAt[p.id], ms: this.finishedAt[p.id] || Infinity, clicks: this.clicks[p.id] }));
    // Finishers ranked by time; everyone else ties for last (no reliable way
    // to say who was "closer" without a full link-graph search).
    const ranked = this.rank(entries, (a, b) => (b.finished - a.finished) || a.ms - b.ms);
    this.env.finish(ranked.map((r) => ({ id: r.id, rank: r.rank, score: r.finished ? 1 : 0, detail: { clicks: r.clicks, path: this.path[r.id] } })));
  }

  snapshot() {
    return { start: this.start, target: this.target, path: this.path, clicks: this.clicks };
  }
}

WikiRace.id = 'wikirace';
module.exports = WikiRace;
