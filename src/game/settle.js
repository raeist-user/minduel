// Turns a finished game's rankings into real changes: rating, win/loss/draw
// counts, per-topic stats (when the game reports them), and one MatchHistory
// row. Kept separate from MatchManager so it's easy to unit-test in
// isolation with a fake User/MatchHistory pair if needed later.
const User = require('../User');
const MatchHistory = require('../MatchHistory');
const { computeDeltas } = require('./rating');

// rankings: [{ id, rank, score, detail }]  (id is a real userId or 'bot_xxxx')
// players:  the same roster the game was built with -> { id, rating, matches, isBot, username }
async function settleMatch({ gameId, mode, players, rankings, startedAt, extra }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const forRating = rankings.map((r) => ({ id: r.id, rating: byId.get(r.id).rating, rank: r.rank, matches: byId.get(r.id).matches, isBot: byId.get(r.id).isBot }));
  const deltas = computeDeltas(forRating);

  const humanRankings = rankings.filter((r) => !byId.get(r.id).isBot);
  const bestRank = Math.min(...rankings.map((r) => r.rank));

  const historyPlayers = [];
  const bulkOps = [];

  for (const r of rankings) {
    const p = byId.get(r.id);
    const delta = deltas[r.id] || 0;
    historyPlayers.push({
      user: p.isBot ? undefined : p.id,
      isBot: !!p.isBot,
      username: p.username,
      rank: r.rank,
      score: r.score,
      ratingBefore: p.rating,
      ratingDelta: delta,
    });
    if (p.isBot) continue;

    const isWin = r.rank === bestRank && rankings.filter((x) => x.rank === bestRank).length < rankings.length;
    const isDraw = rankings.filter((x) => x.rank === r.rank).length > 1;
    const inc = {
      rating: delta,
      matchesPlayed: 1,
      wins: isWin && !isDraw ? 1 : 0,
      losses: !isWin && !isDraw ? 1 : 0,
      draws: isDraw ? 1 : 0,
    };
    const update = { $inc: inc };

    // Topic-level stats, currently only reported by MathDuel's qLog.
    if (extra && Array.isArray(extra.qLog)) {
      const perTopic = {};
      for (const q of extra.qLog) {
        perTopic[q.topic] = perTopic[q.topic] || { correct: 0, total: 0 };
        perTopic[q.topic].total++;
        if (q.winner === r.id) perTopic[q.topic].correct++;
      }
      for (const [topic, v] of Object.entries(perTopic)) {
        inc[`categoryStats.${topic}.correct`] = v.correct;
        inc[`categoryStats.${topic}.total`] = v.total;
      }
      inc.totalCorrectAnswers = Object.values(perTopic).reduce((s, v) => s + v.correct, 0);
      inc.totalQuestionsAnswered = Object.values(perTopic).reduce((s, v) => s + v.total, 0);
    }

    bulkOps.push({ updateOne: { filter: { _id: p.id }, update: { $inc: inc }, upsert: false } });
  }

  const ops = [];
  if (bulkOps.length) ops.push(User.bulkWrite(bulkOps));
  ops.push(MatchHistory.create({
    gameId, mode, players: historyPlayers,
    startedAt: new Date(startedAt), endedAt: new Date(), aborted: false,
  }));
  await Promise.all(ops);

  return { deltas };
}

module.exports = { settleMatch };
