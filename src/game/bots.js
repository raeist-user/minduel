// Bots fill empty seats. They are built to feel like people:
//  - a plausible username (checked against real accounts so it can't collide)
//  - skill centred on the player's own level, with per-match "form" so some
//    matches they're slightly better, some slightly worse (never a fixed opponent)
//  - they act through exactly the same game.handle() path as a human, so they
//    can't do anything a player couldn't (no peeking, same lockouts and limits)
const { rint, pick, clamp, gauss, logn, genId } = require('./util');

const ADJ = ['quiet', 'swift', 'lucky', 'calm', 'neon', 'pixel', 'cosmic', 'rapid', 'silent', 'bright', 'wild', 'nimble', 'brave', 'misty', 'urban', 'solar', 'lunar', 'crisp', 'sharp', 'mellow'];
const NOUN = ['fox', 'otter', 'falcon', 'panda', 'comet', 'tiger', 'raven', 'wolf', 'koala', 'orbit', 'ember', 'maple', 'cipher', 'nova', 'atlas', 'echo', 'drift', 'spark', 'quill', 'pebble'];
const FIRST = ['aarav', 'riya', 'kabir', 'mira', 'dev', 'sana', 'arjun', 'zoya', 'ishaan', 'anaya', 'rohan', 'tara', 'vihaan', 'diya', 'nikhil', 'meera', 'yash', 'kiara', 'omar', 'lena', 'mateo', 'nora', 'liam', 'hana', 'jonas', 'ava'];

function botName(rnd) {
  const style = rint(rnd, 0, 3);
  const n2 = () => String(rint(rnd, 1, 99)).padStart(2, '0');
  let name;
  if (style === 0) name = pick(rnd, ADJ) + pick(rnd, NOUN) + (rnd() < 0.6 ? n2() : '');
  else if (style === 1) name = pick(rnd, FIRST) + (rnd() < 0.5 ? '_' : '') + n2();
  else if (style === 2) name = pick(rnd, FIRST) + '_' + pick(rnd, NOUN);
  else { const w = pick(rnd, NOUN); name = w.charAt(0).toUpperCase() + w.slice(1) + pick(rnd, ADJ).charAt(0).toUpperCase() + pick(rnd, ADJ).slice(1); }
  return name.slice(0, 20);
}

// Typing speed a player of this rating typically has, used only when we have no
// real WPM history for the humans in the match.
const wpmFromRating = (rating) => clamp(28 + (rating - 800) * 0.055, 20, 120);

// humans: [{ rating, avgWpm|null }]. Returns the bot's public profile plus its private skill.
function makeBot(rnd, humans) {
  const avgRating = humans.reduce((s, h) => s + h.rating, 0) / humans.length;
  // Centred slightly BELOW the player, so bots are a little beatable rather than a wall.
  const rating = Math.round(clamp(avgRating + gauss(rnd) * 70 - 15, 400, 3000));
  const form = clamp(logn(rnd, 0.1), 0.75, 1.3);            // this match's "mood"

  const known = humans.filter((h) => h.avgWpm);
  const baseWpm = known.length
    ? known.reduce((s, h) => s + h.avgWpm, 0) / known.length // follow what the player actually types
    : wpmFromRating(avgRating);
  const wpm = clamp(baseWpm * form * 0.97, 15, 150);

  const username = botName(rnd);
  return {
    id: 'bot_' + genId(4),
    isBot: true,
    username,
    displayName: username,
    avatarUrl: '',
    rating,
    matches: 20,
    form,
    wpm,
  };
}

module.exports = { makeBot, botName, wpmFromRating };
