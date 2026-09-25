const assert = require('assert');
const { TestEnv } = require('./harness');
const MathDuel = require('../src/game/games/mathduel');
const WpmDuel = require('../src/game/games/wpmduel');
const WordChain = require('../src/game/games/wordchain');
const SpellTheMost = require('../src/game/games/spellthemost');
const GuessCountry = require('../src/game/games/guesscountry');
const WikiRace = require('../src/game/games/wikirace');
const { computeDeltas } = require('../src/game/rating');
const { makeBot } = require('../src/game/bots');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('OK  ', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}

// ── MathDuel: two bots play out all 10 questions, ratings/ranks come out sane
test('mathduel: bots play to completion', () => {
  const env = new TestEnv(42);
  const p1 = { id: 'b1', isBot: true, rating: 1050, form: 1 };
  const p2 = { id: 'b2', isBot: true, rating: 1150, form: 1 };
  const g = new MathDuel(env, { players: [p1, p2], level: 1000 });
  g.begin();
  env.advance(20 * 60 * 1000);
  assert(env.finished, 'game should have finished');
  assert.equal(env.finished.rankings.length, 2);
  const ranks = env.finished.rankings.map((r) => r.rank).sort();
  assert(ranks[0] === 1);
});

test('mathduel: wrong answer locks out but does not crash', () => {
  const env = new TestEnv(3);
  const p1 = { id: 'h1', rating: 1000 };
  const p2 = { id: 'h2', rating: 1000 };
  const g = new MathDuel(env, { players: [p1, p2], level: 1000 });
  g.begin();
  const q = g.q;
  g.handle('h1', { type: 'answer', i: q.i, value: 'not-a-number' });
  g.handle('h1', { type: 'answer', i: q.i, value: String(q.answer + 999) });
  assert(env.now() < g.lockUntil['h1']);
  g.handle('h1', { type: 'answer', i: q.i, value: String(q.answer) }); // still locked out
  assert(!q.closed);
  env.advance(2000);
  g.handle('h1', { type: 'answer', i: g.q.i, value: String(g.q.answer) });
  assert.equal(g.scores['h1'], 1);
});

// ── WpmDuel paragraph mode
test('wpmduel paragraph: correct progress tracked, ends on time', () => {
  const env = new TestEnv(5);
  const p1 = { id: 'h1' }, p2 = { id: 'h2', isBot: true, rating: 1200, wpm: 60, form: 1 };
  const g = new WpmDuel(env, { players: [p1, p2], level: 1000, settings: { mode: 'paragraph' } });
  g.begin();
  const text = g.text;
  g.handle('h1', { type: 'progress', text: text.slice(0, 10) });
  assert.equal(g.progress['h1'].correct, 10);
  env.advance(31000);
  assert(env.finished);
});

// ── WordChain: bots duel until one is eliminated
test('wordchain: bots play until someone is eliminated or time advances', () => {
  const env = new TestEnv(11);
  const p1 = { id: 'b1', isBot: true, rating: 1000, form: 1 };
  const p2 = { id: 'b2', isBot: true, rating: 1000, form: 1 };
  const g = new WordChain(env, { players: [p1, p2], level: 1000 });
  g.begin();
  env.advance(5 * 60 * 1000);
  assert(env.finished || env.aborted, 'should have ended or aborted within 5 sim-minutes');
});

test('wordchain: judge() logic', () => {
  const env = new TestEnv(1);
  const p1 = { id: 'h1' }, p2 = { id: 'h2' };
  const g = new WordChain(env, { players: [p1, p2], level: 1000 });
  g.required = 'G';
  assert.equal(g.judge('goat').ok, true);
  assert.equal(g.judge('trex').ok, false); // wrong letter
  assert.equal(g.judge('gxyz').ok, false); // not a word
  g.used.add('goat');
  assert.equal(g.judge('goat').ok, false); // reused
});

// ── SpellTheMost: normalization + alias matching
test('spellthemost: normalize/lookup handles aliases and dupes', () => {
  const env = new TestEnv(2);
  const p1 = { id: 'h1' }, p2 = { id: 'h2' };
  const g = new SpellTheMost(env, { players: [p1, p2], level: 1000, settings: { categoryId: 'countries' } });
  g.begin();
  g.handle('h1', { type: 'submit', value: 'USA' });
  g.handle('h1', { type: 'submit', value: "united states" }); // same country, should NOT double count
  assert.equal(g.found['h1'].size, 1);
  env.advance(61000);
  assert(env.finished);
});

// ── GuessCountry: correct guess advances index
test('guesscountry: correct guess advances, wrong does not', () => {
  const env = new TestEnv(9);
  const p1 = { id: 'h1' }, p2 = { id: 'h2' };
  const g = new GuessCountry(env, { players: [p1, p2], level: 1000 });
  g.begin();
  const want = g.current('h1').name;
  g.handle('h1', { type: 'guess', value: 'not-a-real-country' });
  assert.equal(g.index['h1'], 0);
  g.handle('h1', { type: 'guess', value: want });
  assert.equal(g.index['h1'], 1);
  env.advance(91000);
  assert(env.finished);
});

// ── WikiRace with a mock wiki graph (offline)
const tick = () => new Promise((r) => setImmediate(r));
async function testWikiRace() {
  const graph = {
    'a': new Set(['b', 'c']),
    'b': new Set(['target page']),
    'c': new Set(['dead end']),
    'target page': new Set([]),
  };
  const mockWiki = {
    norm: (t) => String(t).toLowerCase().trim(),
    fetchLinks: async (t) => ({ links: graph[mockWiki.norm(t)] || new Set() }),
    isValidLink: async (from, to) => (graph[mockWiki.norm(from)] || new Set()).has(mockWiki.norm(to)),
    canonicalTitle: async (t) => t,
  };
  const env = new TestEnv(4);
  env.wiki = mockWiki;
  const p1 = { id: 'h1' }, p2 = { id: 'h2' };
  const g = new WikiRace(env, { players: [p1, p2], level: 1000, settings: { start: 'a', target: 'target page' } });
  g.begin();
  g.handle('h1', { type: 'navigate', title: 'z' }); // invalid link
  await tick(); await tick();
  assert.equal(g.clicks['h1'], 0);
  g.handle('h1', { type: 'navigate', title: 'b' });
  await tick(); await tick();
  assert.equal(g.clicks['h1'], 1);
  g.handle('h1', { type: 'navigate', title: 'target page' });
  await tick(); await tick();
  assert(env.finished, 'should finish once target reached');
  assert.equal(env.finished.rankings.find((r) => r.id === 'h1').rank, 1);
}

// ── Rating math
test('rating: winner gains, loser loses, zero-sum-ish among humans', () => {
  const players = [
    { id: 'a', rating: 1000, rank: 1, matches: 20 },
    { id: 'b', rating: 1000, rank: 2, matches: 20 },
  ];
  const d = computeDeltas(players);
  assert(d.a > 0 && d.b < 0);
  assert.equal(d.a, -d.b);
});

test('rating: bot opponent counts for half weight', () => {
  const players = [
    { id: 'a', rating: 1000, rank: 1, matches: 20 },
    { id: 'bot_1', rating: 1000, rank: 2, matches: 20, isBot: true },
  ];
  const d = computeDeltas(players);
  const humanOnly = computeDeltas([
    { id: 'a', rating: 1000, rank: 1, matches: 20 },
    { id: 'b', rating: 1000, rank: 2, matches: 20 },
  ]);
  assert(d.a < humanOnly.a, 'beating a bot should move rating less than beating a human');
});

// ── Bots: name generation + skill centering
test('bots: makeBot centers near player level and produces a name', () => {
  const env = new TestEnv(6);
  const bot = makeBot(env.rnd, [{ rating: 1200, avgWpm: 50 }]);
  assert(bot.username.length >= 2);
  assert(bot.rating > 600 && bot.rating < 1900);
  assert(bot.id.startsWith('bot_'));
});

testWikiRace()
  .then(() => { pass++; console.log('OK  ', 'wikirace: navigate validated against mock graph, finishes on reaching target'); })
  .catch((e) => { fail++; console.log('FAIL', 'wikirace', '-', e.message); })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
