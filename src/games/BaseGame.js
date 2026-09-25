// Shared plumbing for every game. A game is a small state machine that talks to
// the outside world only through `env`:
//   env.emit(type, data)        -> to every human in the match
//   env.emitTo(id, type, data)  -> to one human
//   env.after(ms, fn) / env.cancel(h)   -> timers that are cleaned up when the match ends
//   env.now(), env.rnd()
//   env.finish(rankings, extra) -> ends the match (ratings, history and the results screen happen outside)
//   env.abort()                 -> ends it with no rating changes (nobody left to play)
//
// Because games never touch sockets, they run the same in tests and in production.
class BaseGame {
  constructor(env, { id, mode, players, level }) {
    this.env = env;
    this.id = id;
    this.mode = mode;
    this.players = players;
    this.level = level;
    this.state = 'countdown'; // countdown -> running -> ended
    this.forfeited = new Set();
  }

  get humans() { return this.players.filter((p) => !p.isBot); }
  get bots() { return this.players.filter((p) => p.isBot); }
  isForfeited(id) { return this.forfeited.has(id); }

  // A player left (or was gone too long). They rank below everyone still playing.
  forfeit(id) {
    if (this.state === 'ended' || this.forfeited.has(id)) return;
    if (!this.players.some((p) => p.id === id)) return;
    this.forfeited.add(id);
    this.env.emit('left', { id });
    const alive = this.players.filter((p) => !this.forfeited.has(p.id));
    if (!alive.some((p) => !p.isBot)) return this.env.abort();   // only bots left: pointless, no rating change
    if (alive.length < 2) this.end();                            // last one standing wins
  }

  // entries: [{ id, ... }], cmp(a, b) < 0 means a is better. Forfeited players go last.
  // Equal by cmp => equal rank.
  rank(entries, cmp) {
    const active = entries.filter((e) => !this.forfeited.has(e.id)).sort(cmp);
    const gone = entries.filter((e) => this.forfeited.has(e.id)).sort(cmp);
    const out = [];
    let offset = 0;
    for (const group of [active, gone]) {
      group.forEach((e, i) => {
        const tied = i > 0 && cmp(group[i - 1], e) === 0;
        const rank = tied ? out[out.length - 1].rank : offset + i + 1;
        out.push({ ...e, rank });
      });
      offset += group.length;
    }
    return out;
  }

  // Subclasses implement:
  publicInit() { return {}; }
  begin() {}
  handle() {}
  end() {}
  snapshot() { return {}; }
}

module.exports = BaseGame;
