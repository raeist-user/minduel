// Minimal offline test env: fake clock (advance() drives timers), synchronous
// event capture, and a deterministic RNG. Lets every game run start-to-finish
// in a unit test without sockets, real timers, or (for WikiRace) the network.
class TestEnv {
  constructor(seed = 1) {
    this._t = 0;
    this._timers = []; // {id, at, fn, cancelled}
    this._tid = 0;
    this.events = []; // {type, data, to}
    let s = seed;
    this.rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    this.finished = null;
    this.aborted = false;
  }
  now() { return this._t; }
  after(ms, fn) { const id = ++this._tid; this._timers.push({ id, at: this._t + Math.max(0, ms), fn }); return id; }
  cancel(id) { const t = this._timers.find((x) => x.id === id); if (t) t.cancelled = true; }
  emit(type, data) { this.events.push({ type, data }); }
  emitTo(id, type, data) { this.events.push({ type, data, to: id }); }
  finish(rankings, extra) { this.finished = { rankings, extra }; }
  abort() { this.aborted = true; }

  // Runs timers in order up to `ms` from now, including ones scheduled by
  // other timers as we go (so a chain of after() calls plays out correctly).
  advance(ms) {
    const stop = this._t + ms;
    for (;;) {
      const due = this._timers.filter((t) => !t.cancelled && !t.done && t.at <= stop).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      due.done = true;
      this._t = due.at;
      due.fn();
    }
    this._t = stop;
  }
}

module.exports = { TestEnv };
