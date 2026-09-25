// Pure validation for the "about you" fields: bio, location, social links.
// Social links are stored as HANDLES, never as free-form URLs, and the link is
// built from a fixed base on the client. That way nobody can store a
// javascript: or phishing URL behind a friendly-looking label.
// (`website` is the one exception; it must be a plain http(s) URL.)

const BIO_MAX = 160;
const LOCATION_MAX = 30;

const PLATFORMS = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
  github: /^[A-Za-z0-9-]{1,39}$/,
  youtube: /^[A-Za-z0-9._-]{1,30}$/,
  twitch: /^[A-Za-z0-9_]{1,25}$/,
  discord: /^[A-Za-z0-9._]{2,32}$/,
};
const LABELS = { instagram: 'Instagram', x: 'X', github: 'GitHub', youtube: 'YouTube', twitch: 'Twitch', discord: 'Discord', website: 'Website' };
const SOCIAL_KEYS = [...Object.keys(PLATFORMS), 'website'];

// Strip control characters (keep \n), normalise line breaks, allow at most one
// blank line in a row.
const cleanText = (value, max, { multiline = false } = {}) => {
  let s = String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, '');
  if (!multiline) s = s.replace(/\s+/g, ' ');
  else s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  s = s.trim();
  return s.length <= max ? { ok: true, value: s } : { ok: false };
};

const cleanBio = (v) => cleanText(v, BIO_MAX, { multiline: true });
const cleanLocation = (v) => cleanText(v, LOCATION_MAX);

// Accepts "@name", "name", or a pasted profile link (uses the last path piece).
const extractHandle = (raw) => {
  let s = String(raw).trim().replace(/^@/, '');
  if (s.includes('/')) {
    s = s.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
    s = s.replace(/^@/, '');
  }
  return s;
};

// input: object { instagram: 'x', ... }. Missing keys are left unchanged by the
// caller; empty string clears that link. Returns { ok, value } or { ok:false, message }.
const cleanSocials = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: 'Invalid social links.' };
  const out = {};
  for (const key of Object.keys(input)) {
    if (!SOCIAL_KEYS.includes(key)) continue; // ignore unknown keys
    const raw = input[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') { out[key] = ''; continue; }
    if (key === 'website') {
      const s = String(raw).trim();
      if (s.length > 100) return { ok: false, message: 'Website link is too long.' };
      let url;
      try { url = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (_) { return { ok: false, message: 'Enter a valid website link.' }; }
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) {
        return { ok: false, message: 'Enter a valid website link.' };
      }
      out.website = url.toString();
      continue;
    }
    const handle = extractHandle(raw);
    if (!PLATFORMS[key].test(handle)) return { ok: false, message: `That doesn't look like a valid ${LABELS[key]} username.` };
    out[key] = handle;
  }
  return { ok: true, value: out };
};

module.exports = { cleanText, BIO_MAX, LOCATION_MAX, SOCIAL_KEYS, cleanBio, cleanLocation, cleanSocials };
