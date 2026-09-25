// English word list for Word Chain validity checks, derived from the system
// hunspell en_US dictionary (base forms only, proper nouns excluded by
// filtering out originally-capitalized entries before lowercasing). ~62k words,
// covering every starting letter including the hard ones (q, x, z, j).
//
// Swap-in note: if you want a bigger/different dictionary later, replace
// dictionary.txt (one lowercase word per line) — nothing else needs to change.
const fs = require('fs');
const path = require('path');

const WORDS = new Set(
  fs.readFileSync(path.join(__dirname, 'dictionary.txt'), 'utf8')
    .split('\n')
    .map((w) => w.trim())
    .filter(Boolean)
);

// Precompute which letters actually start at least one word, so the game
// never opens a round on a letter nobody can answer (matters most for q/x/z).
const BY_FIRST_LETTER = {};
for (const w of WORDS) {
  const c = w[0];
  (BY_FIRST_LETTER[c] || (BY_FIRST_LETTER[c] = [])).push(w);
}
const STARTABLE_LETTERS = Object.keys(BY_FIRST_LETTER).filter((c) => BY_FIRST_LETTER[c].length >= 3);

const isWord = (w) => typeof w === 'string' && WORDS.has(w.toLowerCase());
const wordsStartingWith = (letter) => BY_FIRST_LETTER[letter.toLowerCase()] || [];

module.exports = { isWord, wordsStartingWith, STARTABLE_LETTERS, WORDS };
