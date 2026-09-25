const crypto = require('crypto');

// All randomness goes through an injectable `rnd` (defaults to Math.random) so
// tests can be deterministic.
const rint = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const shuffle = (rnd, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// Standard normal (Box-Muller)
const gauss = (rnd) => {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
// Multiplicative noise centred on 1 (human timing is skewed: rarely much faster, sometimes much slower)
const logn = (rnd, sigma) => Math.exp(gauss(rnd) * sigma);
const genId = (bytes = 6) => crypto.randomBytes(bytes).toString('hex');
const commonPrefix = (a, b) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};

module.exports = { rint, pick, clamp, shuffle, gauss, logn, genId, commonPrefix };
