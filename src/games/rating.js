// Elo for 2..n players. Everyone gets a rank (1 = best, ties share a rank);
// each human's change is the average of their pairwise results.
//
// Bots: a bot opponent counts for half. So beating (or losing to) a bot moves
// your rating less than a real player would, which stops rating farming and
// keeps a bad bot match from costing you a full loss.

const BASE_K = 32;
const NEWBIE_K = 44;        // first matches move faster so people find their level quickly
const NEWBIE_MATCHES = 10;
const BOT_WEIGHT = 0.5;
const MIN_RATING = 100;

const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));

// players: [{ id, rating, rank, isBot, matches }]  ->  { [humanId]: delta }
function computeDeltas(players) {
  const out = {};
  if (players.length < 2) return out;
  for (const p of players) {
    if (p.isBot) continue;
    let sum = 0;
    let pairs = 0;
    for (const q of players) {
      if (q === p) continue;
      const w = q.isBot ? BOT_WEIGHT : 1;
      const s = p.rank < q.rank ? 1 : p.rank === q.rank ? 0.5 : 0;
      sum += w * (s - expected(p.rating, q.rating));
      pairs++;
    }
    const k = (p.matches || 0) < NEWBIE_MATCHES ? NEWBIE_K : BASE_K;
    let delta = Math.round((k * sum) / pairs);
    delta = Math.max(delta, MIN_RATING - p.rating); // never drop below the floor
    out[p.id] = delta;
  }
  return out;
}

module.exports = { computeDeltas, expected, MIN_RATING, BOT_WEIGHT };
