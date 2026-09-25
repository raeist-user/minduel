// Talks to Wikipedia so Word Chain-style trust ("did they actually click a
// real link?") also holds for Wiki Race: every navigate is checked against
// the real outgoing links of the page the player is currently on.
//
// Node 18+ has global fetch, so no extra dependency. Results are cached
// per-process (link sets rarely change mid-race) with a small TTL so a busy
// server doesn't hammer Wikipedia when many races touch the same hub pages.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // normTitle -> { at, links: Set<string>, displayTitle }

const norm = (title) => String(title || '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();

// Real outgoing wikilinks from mainspace (ns=0), stripped of disambiguation/
// redirect noise the API already resolves for us via `redirects: 1`.
async function fetchLinks(title) {
  const key = norm(title);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', redirects: '1',
    prop: 'links', pllimit: 'max', plnamespace: '0', titles: title,
  });
  const res = await fetch(url, { headers: { 'User-Agent': 'Aptiks-WikiRace/1.0' } });
  if (!res.ok) throw new Error(`Wikipedia API error ${res.status}`);
  const data = await res.json();
  const page = data && data.query && data.query.pages && data.query.pages[0];
  if (!page || page.missing) throw new Error(`Page not found: ${title}`);
  const links = new Set((page.links || []).map((l) => norm(l.title)));
  const entry = { at: Date.now(), links, displayTitle: page.title };
  cache.set(key, entry);
  cache.set(norm(page.title), entry);
  return entry;
}

// True if `linkTitle` is a real outgoing link from `fromTitle`, resolving the
// display title so the game can show it correctly either way.
async function isValidLink(fromTitle, linkTitle) {
  const from = await fetchLinks(fromTitle);
  return from.links.has(norm(linkTitle));
}

async function canonicalTitle(title) {
  const entry = await fetchLinks(title);
  return entry.displayTitle;
}

module.exports = { fetchLinks, isValidLink, canonicalTitle, norm };
