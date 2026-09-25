// ─────────────────────────────────────────────────────────────
// Aptiks app shell: one page, five bottom-nav tabs, in-app back button.
// ─────────────────────────────────────────────────────────────

// let (not const): changing your password issues a fresh token for this device.
let token = localStorage.getItem('minduel_token');
if (!token) {
    window.location.replace('/index.html');
    throw new Error('No session'); // stop this script
}

let currentUser = null;

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

const $ = (id) => document.getElementById(id);

// ── Session ──────────────────────────────────────────────────
// `notice` is shown on the sign-in page (e.g. why the person was signed out).
// replace(): the app page must not stay in history behind the login page.
function sessionExpired(notice) {
    localStorage.removeItem('minduel_token');
    localStorage.removeItem('minduel_user');
    if (notice) sessionStorage.setItem('minduel_notice', notice);
    window.location.replace('/index.html');
}

function logout() {
    localStorage.removeItem('minduel_token');
    localStorage.removeItem('minduel_user');
    window.location.replace('/index.html');
}

async function authedFetch(url, options = {}) {
    let res;
    try {
        res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token,
                ...(options.headers || {}),
            },
        });
    } catch (_) {
        throw new Error('Could not reach the server.');
    }
    // A wrong-password 401 from a sensitive action must NOT log the user out;
    // only an expired/invalid session does. The server marks password errors with `field`.
    let data = {};
    try { data = await res.json(); } catch (_) {}
    // Banned or suspended: the server blocks every call, so end the session and say why.
    if (res.status === 403 && (data.code === 'BANNED' || data.code === 'SUSPENDED')) {
        let msg = data.message;
        if (data.code === 'SUSPENDED' && data.until) {
            msg += ' It ends ' + new Date(data.until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) + '.';
        }
        sessionExpired(msg);
        throw new Error(data.message);
    }
    if (res.status === 401 && data.field !== 'password' && !/password is incorrect/i.test(data.message || '')) {
        // SESSION_REVOKED = password was changed/reset elsewhere
        sessionExpired(data.code === 'SESSION_REVOKED' ? data.message : '');
        throw new Error('Session expired');
    }
    if (!res.ok) {
        const err = new Error(data.message || 'Request failed');
        err.field = data.field;
        err.status = res.status;
        throw err;
    }
    return data;
}

// ── Small DOM helpers ────────────────────────────────────────
// Builds DOM with textContent only, so names/reasons from the database can
// never inject markup.
function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v; // fixed strings only (badge icons)
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
    }
    kids.flat(Infinity).forEach((c) => {
        if (c === null || c === undefined || c === false) return;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
const fmtDate = (d) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
function ago(d) {
    const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return new Date(d).toLocaleDateString([], { dateStyle: 'medium' });
}
function icons() { if (window.lucide) lucide.createIcons(); }

// Photo if the user has one, otherwise their initial on the fixed brand color.
function setAvatar(el, user) {
    const name = user.displayName || user.username;
    el.textContent = '';
    if (user.avatarUrl) {
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.onerror = () => {
            el.classList.remove('has-photo');
            el.textContent = name.charAt(0).toUpperCase();
        };
        img.src = user.avatarUrl;
        el.classList.add('has-photo');
        el.appendChild(img);
    } else {
        el.classList.remove('has-photo');
        el.textContent = name.charAt(0).toUpperCase();
    }
}
// `online`: true/false draws a status dot, undefined draws none.
function avatarEl(user, sizeCls, textCls, online) {
    const av = h('span', { class: `avatar ${sizeCls} rounded-full overflow-hidden flex items-center justify-center font-bold flex-shrink-0 ${textCls}` });
    setAvatar(av, user);
    if (online === undefined) return av;
    return h('span', { class: 'relative shrink-0 inline-block' }, av,
        h('span', { class: 'online-dot ' + (online ? 'bg-online' : 'bg-[#555]') }));
}

// Staff badge: a small icon only (no text, no pill). Admin = verified seal in
// gold, moderator = shield in blue. Meaning is in the tooltip / aria-label.
// Everything in here is a fixed string, never user text.
const BADGE_ICONS = {
    admin: '<path fill="currentColor" fill-opacity=".18" d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
    moderator: '<path fill="currentColor" fill-opacity=".18" d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
};
const BADGES = {
    admin: { title: 'Administrator', color: '#F2B84B' },
    moderator: { title: 'Moderator', color: '#6FB1FC' },
};
function badgeEl(badge, size = 16) {
    const b = BADGES[badge];
    if (!b) return null;
    return h('span', {
        class: 'inline-flex items-center shrink-0',
        role: 'img', title: b.title, 'aria-label': b.title,
        style: `color:${b.color}`,
        html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BADGE_ICONS[badge]}</svg>`,
    });
}
function badgeHTML(badge) {
    const el = badgeEl(badge);
    return el ? el.outerHTML : '';
}

// Two-tap confirm for anything destructive.
function armButton(btn, armedLabel, onConfirm) {
    const idle = btn.textContent;
    let armed = false, timer = null;
    btn.addEventListener('click', () => {
        if (!armed) {
            armed = true;
            btn.textContent = armedLabel;
            timer = setTimeout(() => { armed = false; btn.textContent = idle; }, 4000);
            return;
        }
        clearTimeout(timer);
        armed = false;
        btn.textContent = idle;
        onConfirm();
    });
    return btn;
}

function showMsg(id, text, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'text-xs mb-3 ' + (kind === 'ok' ? 'text-online' : 'text-red-400');
}
function hideMsg(id) {
    const el = $(id);
    if (el) el.className = 'hidden text-xs mb-3';
}
function setBusy(btnId, busy, idleText, busyText) {
    const b = $(btnId);
    if (!b) return;
    b.disabled = busy;
    b.textContent = busy ? busyText : idleText;
    b.style.opacity = busy ? '.7' : '';
}

// ── Navigation: real history entries, so the phone's Back button walks
//    through the app (tab -> tab, profile -> list, modal -> page) and only
//    leaves the site when there is nothing left inside it. ──────────────
const overlays = []; // open modals, top last: { el, onClose }
let renderedHash = null;
let lastTab = 'home';
let matchScreenOpen = false;

function currentRoute() {
    return (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
}

function go(path) {
    const target = '#/' + path;
    if (location.hash === target) { scrollTo0(); return; }
    history.pushState({ r: 1, ov: 0 }, '', target);
    render();
}

// In-app "back" arrow. Uses real history when the previous entry is ours;
// after a reload/deep link there may be none, so fall back to the parent page.
function goBack(fallback) {
    if (history.state && history.state.r) history.back();
    else {
        history.replaceState({ r: 0, ov: 0 }, '', '#/' + fallback);
        render();
    }
}

function scrollTo0() { $('scroller').scrollTop = 0; }

// Modals get their own history entry: Back closes the modal, not the page.
function openOverlay(el, onClose) {
    el.classList.remove('hidden');
    overlays.push({ el, onClose });
    history.pushState({ r: 1, ov: overlays.length }, '', location.href);
}
function closeTopOverlay() {
    const o = overlays.pop();
    if (!o) return;
    o.el.classList.add('hidden');
    if (o.onClose) o.onClose();
}
// For Cancel / X buttons: go through history so the entry is consumed too.
function dismissOverlay() {
    if (overlays.length) history.back();
}

window.addEventListener('popstate', (e) => {
    // A match screen owns its own history entry (pushed in openMatchScreen);
    // back navigation off of it means "leave the match", not "close a modal".
    if (matchScreenOpen && !(e.state && e.state.match)) { _closeMatchScreenUI(); return; }
    const want = (e.state && e.state.ov) || 0;
    while (overlays.length > want) closeTopOverlay();
    render();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissOverlay(); });

function isStaff() { return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'moderator'); }

const OID = /^[a-f\d]{24}$/i;

function render(force) {
    if (!currentUser) return;
    if (matchScreenOpen) return; // a live match owns the screen; see openMatchScreen()/popstate handler
    if (!force && location.hash === renderedHash) return; // e.g. a modal closing: page underneath stays as it is
    renderedHash = location.hash;

    let [tab, a] = currentRoute();
    if (!['home', 'leaderboard', 'staff', 'friends', 'account', 'u', 'messages'].includes(tab)) tab = 'home';
    if (tab === 'staff' && !isStaff()) tab = 'home';
    if (tab === 'u' && !(a && OID.test(a))) tab = 'friends';
    const inChat = tab === 'messages' && !!a && OID.test(a);

    // A chat is a full screen: it hides the top bar and the bottom nav.
    ['top-bar', 'scroller', 'bottom-nav'].forEach((id) => $(id).classList.toggle('hidden', inChat));
    $('chat-screen').classList.toggle('hidden', !inChat);
    if (!inChat) chatStop();

    const view = tab === 'u' ? 'profile' : tab;
    ['home', 'leaderboard', 'staff', 'friends', 'account', 'profile', 'messages'].forEach((v) =>
        $('view-' + v).classList.toggle('hidden', v !== view));

    if (tab !== 'u' && tab !== 'messages') lastTab = tab;
    document.querySelectorAll('.nav-item').forEach((n) =>
        n.classList.toggle('active', tab !== 'messages' && n.dataset.tab === lastTab));
    scrollTo0();

    if (tab === 'home') renderHome();
    else if (tab === 'leaderboard') loadLeaderboard();
    else if (tab === 'staff') Staff.enter();
    else if (tab === 'friends') { renderFriends(); refreshFriends(); }
    else if (tab === 'account') renderAccount(a);
    else if (tab === 'u') loadPlayer(a);
    else if (tab === 'messages') { maybeShowDmNotice(); if (inChat) openChat(a); else { renderInbox(); refreshDMs(); refreshFriends(); } }
    icons();
}

// ── Signed-in user ───────────────────────────────────────────
function renderUser(user) {
    currentUser = user;
    const name = user.displayName || user.username;
    const staff = isStaff();

    $('nav-staff').classList.toggle('hidden', !staff);
    $('nav-staff').classList.toggle('flex', staff);
    $('nav-staff-label').textContent = user.role === 'admin' ? 'Admin' : 'Mod';
    $('terms-modal').classList.toggle('hidden', !user.needsTerms);

    $('nav-rating-num').textContent = user.rating;
    $('welcome-name').textContent = name;

    $('profile-badge').innerHTML = badgeHTML(user.badge);
    setAvatar($('profile-avatar-big'), user);
    $('profile-display-name').textContent = name;
    // Email is intentionally NOT shown here. It lives under Login & security.
    $('profile-username').textContent = user.username;
    const about = $('profile-about');
    about.textContent = '';
    const el = aboutEl(user);
    if (el) about.append(el);
}

function saveLocalUser(user) {
    // Never keep the email in localStorage: it's not needed on this device between visits.
    const { email, ...rest } = user;
    localStorage.setItem('minduel_user', JSON.stringify(rest));
}

async function acceptTerms() {
    const err = $('terms-error');
    err.classList.add('hidden');
    if (!$('terms-check').checked) {
        err.textContent = 'Please tick the box to continue.';
        err.classList.remove('hidden');
        return;
    }
    setBusy('terms-accept-btn', true, 'Continue', 'Saving...');
    try {
        const data = await authedFetch('/api/auth/accept-terms', {
            method: 'POST',
            body: JSON.stringify({ acceptTerms: true }),
        });
        renderUser(data.user);
        saveLocalUser(data.user);
    } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
    } finally {
        setBusy('terms-accept-btn', false, 'Continue', 'Saving...');
    }
}

// ── Password prompt ──────────────────────────────────────────
// Sensitive changes (username, email, password) collect their new values
// first; only when the person taps the final button does this pop-up ask for
// the password. `run(password)` does the request. A wrong password keeps the
// pop-up open for another try; any other error closes it and is thrown to the
// caller. Resolves with run()'s result, or null if the person cancelled.
let pwPrompt = null;

function askPassword({ title, desc, confirmLabel, run }) {
    return new Promise((resolve, reject) => {
        pwPrompt = { run, resolve, reject, settled: false, confirmLabel: confirmLabel || 'Confirm' };
        $('pw-title').textContent = title || "Confirm it's you";
        $('pw-desc').textContent = desc || 'Enter your password to continue.';
        $('pw-input').value = '';
        $('pw-err').classList.add('hidden');
        $('pw-confirm').textContent = pwPrompt.confirmLabel;
        openOverlay($('pw-modal'), () => {
            const p = pwPrompt;
            pwPrompt = null;
            $('pw-input').value = ''; // never leave the password sitting in the DOM
            if (p && !p.settled) { p.settled = true; p.resolve(null); }
        });
        icons();
        setTimeout(() => $('pw-input').focus(), 60);
    });
}

async function submitPwPrompt() {
    const p = pwPrompt;
    if (!p || p.busy) return;
    const input = $('pw-input');
    const err = $('pw-err');
    const showErr = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    err.classList.add('hidden');
    if (!input.value) return showErr('Enter your password.');

    p.busy = true;
    $('pw-confirm').disabled = $('pw-cancel').disabled = true;
    $('pw-confirm').textContent = 'Checking...';
    try {
        const result = await p.run(input.value);
        p.settled = true;
        p.resolve(result === undefined ? true : result);
        dismissOverlay();
    } catch (e) {
        if (e.field === 'password' || (e.status === 429 && !e.field)) {
            showErr(e.message);            // wrong password / locked: try again here
            input.value = '';
            input.focus();
        } else {
            p.settled = true;              // anything else belongs to the form behind
            p.reject(e);
            dismissOverlay();
        }
    } finally {
        p.busy = false;
        $('pw-confirm').disabled = $('pw-cancel').disabled = false;
        $('pw-confirm').textContent = p.confirmLabel;
    }
}
$('pw-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitPwPrompt(); } });

// ── Friends data + presence ──────────────────────────────────
// One call returns friends (with online state) and requests. Polling it also
// tells the server we're online, which is what other friends see.
let friendsData = null;
const POLL_MS = 45 * 1000;

async function refreshFriends() {
    try {
        friendsData = await authedFetch('/api/friends');
        updateFriendsBadge();
        const [tab] = currentRoute();
        if (tab === 'friends') renderFriends();
        if (!tab || tab === 'home') renderHomeFriends();
    } catch (_) { /* transient; next poll retries */ }
}
function updateFriendsBadge() {
    const n = friendsData ? friendsData.incoming.length : 0;
    const b = $('nav-friends-badge');
    b.textContent = n > 9 ? '9+' : String(n);
    b.classList.toggle('hidden', n === 0);
}
setInterval(() => { if (!document.hidden && currentUser) { refreshFriends(); refreshDMs(); } }, POLL_MS);
document.addEventListener('visibilitychange', () => {
    if (document.hidden || !currentUser) return;
    refreshFriends(); refreshDMs(); pollChat();
});

const presenceText = (u) => (u.online ? 'Online' : u.lastSeenAt ? 'Last seen ' + ago(u.lastSeenAt) : 'Offline');

// ── Home ─────────────────────────────────────────────────────
function renderHome() { renderHomeFriends(); renderHomeGames(); renderHomePartyCTA(); }

// ── Toast + generic bottom sheet (reuses the #sheet element also used elsewhere) ──
let toastTimer = null;
function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
function openSheet(draw) {
    if (!overlays.some((o) => o.el === $('sheet'))) openOverlay($('sheet'), () => {});
    const body = $('sheet-body');
    body.textContent = '';
    draw(body);
    icons();
}

// ── Games / real-time matches ───────────────────────────────────────────
// Everything below talks to the Socket.io layer in src/game/MatchManager.js.
// See README.md → "Real-time games" for the full event list.
const GAME_DEFS = [
    { id: 'mathduel', label: 'MathDuel', icon: 'sigma', blurb: '10 questions. Fastest correct answer scores.', grid: true },
    { id: 'wordchain', label: 'Word Chain', icon: 'link-2', blurb: "Chain words by last letter. Don't run out of hearts.", grid: true },
    {
        id: 'wpmduel', label: 'WPM Duel', icon: 'keyboard', blurb: 'Type fast and clean.', grid: true,
        modes: [{ id: 'paragraph', label: 'Paragraph · 30s' }, { id: 'sentence', label: '10 Sentences' }],
    },
    {
        id: 'spellthemost', label: 'Spell the Most', icon: 'list-checks', blurb: 'Name as many as you can in 60s.', grid: true,
        categories: [{ id: '', label: 'Random' }, { id: 'animals', label: 'Animals' }, { id: 'presidents', label: 'US Presidents' }, { id: 'countries', label: 'Countries' }, { id: 'fastfood', label: 'Fast Food' }],
    },
    { id: 'guesscountry', label: 'Guess Country', icon: 'globe', blurb: 'Same countries for everyone. Race the clock.', grid: false },
    { id: 'wikirace', label: 'Wiki Race', icon: 'route', blurb: 'Click your way from the start page to the target.', grid: false },
];
const gameDef = (id) => GAME_DEFS.find((g) => g.id === id);

let socket = null;
let partyState = null;  // { code, ownerId, members: [{id, username, displayName, avatarUrl, rating}] }
let queueState = null;  // { gameId }
let matchState = null;  // { matchId, gameId, mode, players, init, phase, ...per-game fields keyed by short game id }

function initSocket() {
    if (socket) return;
    socket = io({ auth: { token } });
    socket.on('connect_error', (err) => console.warn('socket:', err.message));
    socket.on('party:update', (p) => { partyState = p; if (!location.hash || location.hash === '#/home') renderHomePartyCTA(); });
    socket.on('party:invited', ({ code, from }) => {
        const f = (friendsData && friendsData.friends || []).find((x) => x._id === from);
        showToast((f ? (f.displayName || f.username) : 'A friend') + ' invited you to a party — code ' + code);
    });
    socket.on('queue:waiting', ({ gameId }) => { queueState = { gameId }; renderHomePartyCTA(); });
    socket.on('match:found', onMatchFound);
    socket.on('match:event', ({ type, data }) => onMatchEvent(type, data));
    socket.on('match:end', onMatchEnd);
    socket.on('match:aborted', onMatchAborted);
    socket.on('match:resync', onMatchResync);
}

// ── Home screen: games grid + party/queue card ──────────────────────────
function renderHomeGames() {
    const grid = $('home-games-grid');
    grid.textContent = '';
    GAME_DEFS.filter((g) => g.grid).forEach((g) => grid.append(gameTile(g)));
    const other = $('home-other-games');
    other.textContent = '';
    GAME_DEFS.filter((g) => !g.grid).forEach((g) => other.append(gameTileWide(g)));
    icons();
}
function gameTile(g) {
    return h('button', {
        class: 'btn-press bg-card-bg border border-border-color rounded-2xl p-4 text-left hover:border-accent/50 transition-colors duration-150',
        onclick: () => openGameSheet(g.id),
    },
        h('div', { class: 'w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-3' }, h('i', { 'data-lucide': g.icon, class: 'w-5 h-5' })),
        h('div', { class: 'text-sm font-bold mb-0.5' }, g.label),
        h('div', { class: 'text-[11px] text-text-secondary leading-snug' }, g.blurb));
}
function gameTileWide(g) {
    return h('button', {
        class: 'btn-press w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3 text-left hover:border-accent/50 transition-colors duration-150',
        onclick: () => openGameSheet(g.id),
    },
        h('div', { class: 'w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0' }, h('i', { 'data-lucide': g.icon, class: 'w-5 h-5' })),
        h('div', { class: 'min-w-0 flex-1' }, h('div', { class: 'text-sm font-bold' }, g.label), h('div', { class: 'text-[11px] text-text-secondary truncate' }, g.blurb)),
        h('i', { 'data-lucide': 'chevron-right', class: 'w-4 h-4 text-text-muted shrink-0' }));
}

function openGameSheet(id) {
    if (matchState) return showToast('Finish your current match first.');
    const def = gameDef(id);
    if (partyState && partyState.ownerId !== currentUser._id) return showToast('Only the party host can start a game.');
    let mode = def.modes ? def.modes[0].id : undefined;
    let categoryId = def.categories ? def.categories[0].id : undefined;
    openSheet((body) => {
        const draw = () => {
            body.textContent = '';
            body.append(h('div', { class: 'flex items-center gap-3 mb-1' },
                h('div', { class: 'w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0' }, h('i', { 'data-lucide': def.icon, class: 'w-5 h-5' })),
                h('div', { class: 'min-w-0' }, h('div', { class: 'font-bold' }, def.label), h('div', { class: 'text-xs text-text-secondary' }, def.blurb))));
            if (def.modes) {
                body.append(h('div', { class: 'mt-4 mb-1.5 text-[10px] font-bold text-text-muted uppercase tracking-widest' }, 'Mode'),
                    h('div', { class: 'flex gap-2 flex-wrap' }, def.modes.map((m) => h('button', {
                        class: 'btn-press text-xs font-semibold px-3 py-2 rounded-full border ' + (mode === m.id ? 'bg-accent text-app-bg border-accent' : 'border-border-color text-text-secondary'),
                        onclick: () => { mode = m.id; draw(); },
                    }, m.label))));
            }
            if (def.categories) {
                body.append(h('div', { class: 'mt-4 mb-1.5 text-[10px] font-bold text-text-muted uppercase tracking-widest' }, 'Category'),
                    h('div', { class: 'flex gap-2 flex-wrap' }, def.categories.map((c) => h('button', {
                        class: 'btn-press text-xs font-semibold px-3 py-2 rounded-full border ' + (categoryId === c.id ? 'bg-accent text-app-bg border-accent' : 'border-border-color text-text-secondary'),
                        onclick: () => { categoryId = c.id; draw(); },
                    }, c.label))));
            }
            const settings = {};
            if (mode) settings.mode = mode;
            if (categoryId) settings.categoryId = categoryId;
            body.append(h('div', { class: 'mt-5' }, partyState
                ? h('button', { class: 'btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl', onclick: () => { dismissOverlay(); startPartyGame(id, settings); } }, 'Start for Party')
                : h('button', { class: 'btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl', onclick: () => { dismissOverlay(); quickMatch(id, settings); } }, 'Quick Match')));
            icons();
        };
        draw();
    });
}

function quickMatch(gameId, settings) {
    initSocket();
    if (matchState) return showToast('Finish your current match first.');
    socket.emit('queue:join', { gameId, settings }, (res) => {
        if (!res || !res.ok) return showToast((res && res.message) || 'Could not join matchmaking.');
        queueState = { gameId };
        renderHomePartyCTA();
    });
}
function cancelQueue() {
    if (socket) socket.emit('queue:leave');
    queueState = null;
    renderHomePartyCTA();
}
function startRandomMatch() {
    if (partyState) return showToast('Leave your party to use random matchmaking, or start a game for the party instead.');
    quickMatch('random', {});
}

// ── Party ─────────────────────────────────────────────────────────────
function createParty() {
    initSocket();
    socket.emit('party:create', {}, (res) => { if (!res || !res.ok) showToast((res && res.message) || 'Could not create a party.'); });
}
function joinPartyByCode(code) {
    if (!code) return;
    initSocket();
    socket.emit('party:join', { code: code.toUpperCase() }, (res) => { if (!res || !res.ok) showToast((res && res.message) || 'Invalid code.'); });
}
function leaveParty() {
    if (socket) socket.emit('party:leave');
    partyState = null;
    renderHomePartyCTA();
}
function inviteFriendToParty(friendId) {
    if (socket) socket.emit('party:invite', { friendId });
    showToast('Invite sent.');
}
function startPartyGame(gameId, settings) {
    if (!socket) return;
    socket.emit('party:start', { gameId, settings }, (res) => { if (!res || !res.ok) showToast((res && res.message) || 'Could not start the game.'); });
}
function openInviteSheet() {
    openSheet((body) => {
        body.append(h('div', { class: 'font-bold mb-3' }, 'Invite friends'));
        const list = (friendsData && friendsData.friends) || [];
        if (!list.length) { body.append(h('p', { class: 'text-sm text-text-secondary py-6 text-center' }, "You don't have any friends yet.")); return; }
        list.forEach((f) => {
            const already = partyState && partyState.members.some((m) => m.id === f._id);
            body.append(h('div', { class: 'flex items-center gap-3 py-2' },
                avatarEl(f, 'w-9 h-9', 'text-xs', f.online),
                h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'text-sm font-semibold truncate' }, f.displayName || f.username)),
                already ? h('span', { class: 'text-xs text-text-muted' }, 'In party')
                    : h('button', { class: 'btn-press text-xs font-bold text-accent px-3 py-1.5 rounded-full border border-accent/40', onclick: () => inviteFriendToParty(f._id) }, 'Invite')));
        });
    });
}

function renderHomePartyCTA() {
    const box = $('home-party-cta');
    if (!box) return;
    box.textContent = '';
    if (queueState) {
        const label = queueState.gameId === 'random' ? 'Random Matchmaking' : ((gameDef(queueState.gameId) || {}).label || queueState.gameId);
        box.append(h('div', { class: 'bg-card-bg border border-accent/40 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3' },
            h('div', { class: 'flex items-center gap-3 min-w-0' },
                h('div', { class: 'w-7 h-7 rounded-full border-2 border-accent/25 border-t-accent animate-spin shrink-0' }),
                h('div', { class: 'min-w-0' }, h('div', { class: 'text-sm font-bold' }, 'Finding a match…'), h('div', { class: 'text-xs text-text-secondary truncate' }, label))),
            h('button', { class: 'btn-press text-xs font-bold text-red-400 shrink-0', onclick: cancelQueue }, 'Cancel')));
        icons();
        return;
    }
    if (partyState) {
        const isOwner = partyState.ownerId === currentUser._id;
        box.append(h('div', { class: 'bg-card-bg border border-border-color rounded-2xl p-4' },
            h('div', { class: 'flex items-center justify-between mb-3' },
                h('div', {},
                    h('div', { class: 'text-[10px] font-bold text-text-muted uppercase tracking-widest' }, 'Party code'),
                    h('div', { class: 'text-2xl font-extrabold tracking-[0.15em] text-accent' }, partyState.code)),
                h('div', { class: 'flex gap-2' },
                    h('button', { class: 'btn-press w-9 h-9 rounded-full bg-white/5 flex items-center justify-center', onclick: () => { navigator.clipboard.writeText(partyState.code); showToast('Code copied.'); } }, h('i', { 'data-lucide': 'copy', class: 'w-4 h-4' })),
                    h('button', { class: 'btn-press w-9 h-9 rounded-full bg-white/5 flex items-center justify-center text-red-400', onclick: leaveParty }, h('i', { 'data-lucide': 'log-out', class: 'w-4 h-4' })))),
            h('div', { class: 'flex -space-x-2 mb-3' }, partyState.members.map((m) => avatarEl(m, 'w-8 h-8', 'text-xs'))),
            h('div', { class: 'flex gap-2 items-center' },
                h('button', { class: 'btn-press flex-1 text-xs font-bold border border-border-color rounded-xl py-2.5', onclick: openInviteSheet }, 'Invite Friends'),
                !isOwner ? h('span', { class: 'flex-1 text-xs text-text-secondary text-center' }, 'Waiting for the host to start…')
                    : h('span', { class: 'flex-1 text-xs text-text-secondary text-center' }, 'Pick a game below to start'))));
        icons();
        return;
    }
    box.append(h('div', { class: 'bg-card-bg border border-border-color rounded-2xl p-4' },
        h('button', { class: 'btn-press w-full flex items-center justify-center gap-2 bg-white/5 border border-border-color font-bold text-sm py-3 rounded-xl mb-2', onclick: createParty },
            h('i', { 'data-lucide': 'user-plus', class: 'w-4 h-4' }), 'Create a Party'),
        h('div', { class: 'flex gap-2' },
            h('input', { id: 'party-code-input', placeholder: 'Have a code?', maxlength: '5', class: 'flex-1 bg-transparent border border-border-color rounded-xl px-3 py-2 text-sm uppercase tracking-widest focus:outline-none focus:border-accent', oninput: (e) => { e.target.value = e.target.value.toUpperCase(); } }),
            h('button', { class: 'btn-press px-4 rounded-xl bg-white/5 border border-border-color text-xs font-bold', onclick: () => joinPartyByCode($('party-code-input').value.trim()) }, 'Join'))));
    icons();
}

// ── Match screen shell ───────────────────────────────────────────────────
function openMatchScreen() {
    matchScreenOpen = true;
    ['top-bar', 'scroller', 'bottom-nav'].forEach((id) => $(id).classList.add('hidden'));
    $('match-screen').classList.remove('hidden');
    $('match-screen').classList.add('flex');
    history.pushState({ r: 1, ov: overlays.length, match: 1 }, '', location.href);
    icons();
}
function _closeMatchScreenUI() {
    matchScreenOpen = false;
    $('match-screen').classList.add('hidden');
    $('match-screen').classList.remove('flex');
    ['top-bar', 'scroller', 'bottom-nav'].forEach((id) => $(id).classList.remove('hidden'));
    Object.values(GAME_UI).forEach((ui) => ui.cleanup && ui.cleanup());
    matchState = null;
    render(true);
}
function leaveMatch() { if (matchScreenOpen) history.back(); }

function sendAction(msg) {
    if (!socket || !matchState) return;
    socket.emit('match:action', { matchId: matchState.matchId, msg });
}

let pendingMatchEvents = [];
function onMatchFound(payload) {
    matchState = { matchId: payload.matchId, gameId: payload.gameId, mode: payload.mode, players: payload.players, init: payload.init, phase: 'countdown' };
    queueState = null;
    pendingMatchEvents = [];
    openMatchScreen();
    renderMatchShell();
    let n = Math.max(1, Math.ceil((payload.countdownMs || 3000) / 1000));
    const tick = () => {
        if (!matchState || matchState.matchId !== payload.matchId) return;
        const body = $('match-body');
        body.textContent = '';
        body.append(h('div', { class: 'h-full flex flex-col items-center justify-center gap-3' },
            h('div', { class: 'text-xs font-bold uppercase tracking-widest text-text-muted' }, (gameDef(matchState.gameId) || {}).label),
            h('div', { class: 'text-6xl font-extrabold text-accent' }, n > 0 ? String(n) : 'Go!')));
        icons();
        if (n <= 0) { matchState.phase = 'playing'; initGameUI(); return; }
        n--;
        setTimeout(tick, 1000);
    };
    tick();
}
function initGameUI() {
    const ui = GAME_UI[matchState.gameId];
    if (ui && ui.init) ui.init();
    renderScoreboard();
    const q = pendingMatchEvents; pendingMatchEvents = [];
    q.forEach(({ type, data }) => dispatchMatchEvent(type, data));
}
function onMatchEvent(type, data) {
    if (!matchState) return;
    if (matchState.phase !== 'playing') { pendingMatchEvents.push({ type, data }); return; }
    dispatchMatchEvent(type, data);
}
function dispatchMatchEvent(type, data) {
    const ui = GAME_UI[matchState.gameId];
    if (ui && ui.onEvent) ui.onEvent(type, data);
    renderScoreboard();
}
function onMatchResync(payload) {
    matchState = { matchId: payload.matchId, gameId: payload.gameId, mode: payload.mode, players: payload.players, init: payload.init, phase: payload.state === 'ended' ? 'ended' : 'playing' };
    pendingMatchEvents = [];
    openMatchScreen();
    renderMatchShell();
    if (matchState.phase === 'ended') { renderResults([], {}, true); return; }
    initGameUI(); // best-effort: the next live event fills in anything the snapshot doesn't cover
}
function onMatchEnd({ matchId, rankings, deltas }) {
    if (!matchState || matchState.matchId !== matchId) return;
    matchState.phase = 'ended';
    Object.values(GAME_UI).forEach((ui) => ui.cleanup && ui.cleanup());
    renderResults(rankings, deltas, false);
}
function onMatchAborted({ matchId }) {
    if (!matchState || matchState.matchId !== matchId) return;
    matchState.phase = 'ended';
    Object.values(GAME_UI).forEach((ui) => ui.cleanup && ui.cleanup());
    renderResults([], {}, true);
}
function renderMatchShell() {
    const def = gameDef(matchState.gameId) || {};
    $('match-title').textContent = def.label + (matchState.mode ? ' · ' + matchState.mode : '');
    renderScoreboard();
}
function renderScoreboard() {
    if (!matchState) return;
    const box = $('match-scoreboard');
    if (!box) return;
    box.textContent = '';
    const ui = GAME_UI[matchState.gameId];
    matchState.players.forEach((p) => {
        const mine = currentUser && p.id === currentUser._id;
        const val = ui && ui.scoreboardValue ? ui.scoreboardValue(p.id) : '';
        box.append(h('div', { class: 'flex flex-col items-center gap-1 shrink-0' },
            h('div', { class: 'relative' }, avatarEl(p, 'w-9 h-9', 'text-xs'),
                mine ? h('span', { class: 'absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent' }) : null),
            h('div', { class: 'text-[10px] font-bold text-text-secondary max-w-[54px] truncate' }, (p.displayName || p.username || '?') + (p.isBot ? ' 🤖' : '')),
            h('div', { class: 'text-xs font-extrabold text-accent' }, val)));
    });
    icons();
}
function renderResults(rankings, deltas, aborted) {
    $('match-scoreboard').textContent = '';
    const body = $('match-body');
    body.textContent = '';
    if (aborted) {
        body.append(h('div', { class: 'h-full flex flex-col items-center justify-center gap-3 text-center' },
            h('i', { 'data-lucide': 'circle-slash', class: 'w-8 h-8 text-text-muted' }),
            h('p', { class: 'text-sm text-text-secondary' }, "Match ended — not enough players stuck around, so nobody's rating changed."),
            h('button', { class: 'btn-press bg-accent text-app-bg font-bold text-sm px-6 py-3 rounded-xl mt-2', onclick: leaveMatch }, 'Back to Home')));
        icons();
        return;
    }
    const byId = new Map((matchState ? matchState.players : []).map((p) => [p.id, p]));
    const sorted = rankings.slice().sort((a, b) => a.rank - b.rank);
    const list = sorted.map((r) => {
        const p = byId.get(r.id) || {};
        const delta = deltas ? deltas[r.id] : undefined;
        const mine = currentUser && r.id === currentUser._id;
        return h('div', { class: 'flex items-center gap-3 py-2.5 px-3 rounded-xl ' + (mine ? 'bg-accent/10 border border-accent/30' : '') },
            h('div', { class: 'w-7 text-center text-sm font-extrabold ' + (r.rank === 1 ? 'text-accent' : 'text-text-muted') }, '#' + r.rank),
            avatarEl(p, 'w-9 h-9', 'text-xs'),
            h('div', { class: 'flex-1 min-w-0' },
                h('div', { class: 'text-sm font-semibold truncate' }, (p.displayName || p.username || 'Player') + (p.isBot ? ' 🤖' : '')),
                h('div', { class: 'text-[11px] text-text-secondary' }, r.score + ' pts')),
            (delta !== undefined) ? h('div', { class: 'text-xs font-bold ' + (delta > 0 ? 'text-online' : delta < 0 ? 'text-red-400' : 'text-text-muted') }, (delta > 0 ? '+' : '') + delta) : null);
    });
    body.append(
        h('div', { class: 'text-center mb-5' },
            h('i', { 'data-lucide': 'trophy', class: 'w-8 h-8 text-accent mx-auto mb-2' }),
            h('div', { class: 'text-lg font-extrabold' }, 'Match Complete')),
        h('div', { class: 'flex flex-col gap-1' }, list),
        h('button', { class: 'btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl mt-6', onclick: leaveMatch }, 'Back to Home'));
    icons();
}

// ── Per-game UI modules ──────────────────────────────────────────────────
const MathDuelUI = (() => {
    let timerInt = null;
    const clearTimer = () => { if (timerInt) clearInterval(timerInt); timerInt = null; };
    function init() {
        matchState.md = { scores: {}, q: null };
        const body = $('match-body');
        body.textContent = '';
        body.append(
            h('div', { class: 'text-[11px] text-text-secondary text-center mb-4' }, (matchState.init.topics || []).join(' · ')),
            h('div', { id: 'md-wait', class: 'text-center text-sm text-text-secondary py-10' }, 'Waiting for the first question…'),
            h('div', { id: 'md-question', class: 'hidden' },
                h('div', { id: 'md-topic-label', class: 'text-[11px] text-text-muted text-center mb-1' }),
                h('div', { class: 'h-1 bg-white/10 rounded-full overflow-hidden mb-4' }, h('div', { id: 'md-bar', class: 'h-full bg-accent', style: 'width:100%' })),
                h('div', { id: 'md-prompt', class: 'text-3xl font-extrabold text-center mb-6' }),
                h('div', { class: 'flex gap-2' },
                    h('input', { id: 'md-input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Your answer', class: 'flex-1 bg-transparent border border-border-color rounded-xl px-4 py-3 text-base focus:outline-none focus:border-accent', onkeydown: (e) => { if (e.key === 'Enter') mdSubmit(); } }),
                    h('button', { class: 'btn-press bg-accent text-app-bg font-bold px-5 rounded-xl', onclick: mdSubmit }, 'Go')),
                h('div', { id: 'md-feedback', class: 'text-center text-sm font-semibold mt-3 h-5' })));
    }
    function onEvent(type, data) {
        if (type === 'q') {
            matchState.md.q = { ...data, receivedAt: Date.now() };
            matchState.md.scores = data.scores;
            $('md-wait').classList.add('hidden');
            $('md-question').classList.remove('hidden');
            $('md-topic-label').textContent = data.topic + '  ·  Q' + (data.i + 1) + '/' + data.total;
            $('md-prompt').textContent = data.prompt;
            $('md-feedback').textContent = '';
            const input = $('md-input');
            input.value = ''; input.disabled = false; input.focus();
            clearTimer();
            timerInt = setInterval(() => {
                const q = matchState.md.q;
                if (!q || !$('md-bar')) return clearTimer();
                const total = q.deadline - q.receivedAt;
                const left = Math.max(0, q.deadline - Date.now());
                $('md-bar').style.width = Math.max(0, (left / total) * 100) + '%';
                if (left <= 0) clearTimer();
            }, 100);
        } else if (type === 'wrong') {
            const fb = $('md-feedback');
            if (fb) { fb.textContent = 'Not quite — try again in a moment'; fb.className = 'text-center text-sm font-semibold mt-3 h-5 text-red-400'; }
            const input = $('md-input');
            if (input) { input.disabled = true; setTimeout(() => { if ($('md-input') && matchState.md.q) { $('md-input').disabled = false; $('md-input').focus(); } }, Math.max(0, data.until - Date.now())); }
        } else if (type === 'q-end') {
            clearTimer();
            matchState.md.scores = data.scores;
            const input = $('md-input');
            if (input) input.disabled = true;
            const mine = data.winner && currentUser && data.winner === currentUser._id;
            const fb = $('md-feedback');
            if (fb) {
                fb.textContent = data.timedOut ? `Time's up — answer was ${data.answer}` : (mine ? 'You got it! ' : 'Opponent got it — ') + `answer: ${data.answer}`;
                fb.className = 'text-center text-sm font-semibold mt-3 h-5 ' + (mine ? 'text-online' : 'text-text-secondary');
            }
        }
    }
    function scoreboardValue(id) { return String((matchState.md && matchState.md.scores && matchState.md.scores[id]) || 0); }
    function cleanup() { clearTimer(); }
    return { init, onEvent, scoreboardValue, cleanup };
})();
function mdSubmit() {
    const input = $('md-input');
    if (!input || input.disabled || !input.value.trim() || !matchState.md.q) return;
    sendAction({ type: 'answer', i: matchState.md.q.i, value: input.value.trim() });
}

const WpmDuelUI = (() => {
    const sendProgress = debounce((text) => sendAction({ type: 'progress', text }), 120);
    function cleanup() {}
    function init() {
        const cfg = matchState.init;
        matchState.wpm = { mode: cfg.mode, sentenceIndex: 0, oppWpm: {}, oppIndex: {} };
        const body = $('match-body');
        body.textContent = '';
        if (cfg.mode === 'paragraph') {
            matchState.wpm.target = cfg.text;
            body.append(
                h('div', { id: 'wpm-display', class: 'text-base leading-relaxed mb-4 p-3 bg-card-bg border border-border-color rounded-xl' }),
                h('textarea', { id: 'wpm-input', rows: '4', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'w-full bg-transparent border border-border-color rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent', placeholder: 'Start typing once the race begins…', oninput: wpmOnInput }));
            wpmRenderParagraph();
        } else {
            body.append(
                h('div', { id: 'wpm-si', class: 'text-[11px] text-text-muted text-center mb-1' }, 'Sentence 1 / 10'),
                h('div', { id: 'wpm-sentence', class: 'text-xl font-bold text-center mb-6 leading-snug' }),
                h('input', { id: 'wpm-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'w-full bg-transparent border border-border-color rounded-xl px-4 py-3 text-base focus:outline-none focus:border-accent', placeholder: 'Type the sentence exactly…', onkeydown: (e) => { if (e.key === 'Enter') wpmSubmitSentence(); }, oninput: wpmOnInput }));
        }
    }
    function wpmRenderParagraph() {
        const target = matchState.wpm.target;
        const input = $('wpm-input');
        const val = input ? input.value : '';
        const disp = $('wpm-display');
        if (!disp) return;
        disp.textContent = '';
        for (let i = 0; i < target.length; i++) {
            const span = document.createElement('span');
            span.textContent = target[i];
            span.className = i >= val.length ? 'text-text-secondary' : (val[i] === target[i] ? 'text-online' : 'text-red-400 underline');
            disp.append(span);
        }
    }
    function wpmOnInput(e) {
        if (matchState.wpm.mode === 'paragraph') wpmRenderParagraph();
        sendProgress(e.target.value);
    }
    function onEvent(type, data) {
        const w = matchState.wpm;
        if (type === 'go' && w.mode === 'sentence') {
            w.sentence = data.sentence;
            $('wpm-si').textContent = 'Sentence ' + (data.index + 1) + ' / ' + data.total;
            $('wpm-sentence').textContent = data.sentence;
        } else if (type === 'progress') {
            if (currentUser && data.id === currentUser._id) { if (w.mode === 'paragraph') w.myWpm = data.wpm; }
            else {
                if (data.wpm !== undefined) w.oppWpm[data.id] = data.wpm;
                if (data.index !== undefined) w.oppIndex[data.id] = (data.correct >= data.len) ? data.index + 1 : data.index;
            }
        } else if (type === 'next-sentence') {
            if (currentUser && data.id === currentUser._id) {
                w.sentenceIndex = data.index; w.sentence = data.sentence;
                if ($('wpm-si')) $('wpm-si').textContent = 'Sentence ' + (data.index + 1) + ' / 10';
                if ($('wpm-sentence')) $('wpm-sentence').textContent = data.sentence;
                if ($('wpm-input')) $('wpm-input').value = '';
            }
        } else if (type === 'finished') {
            if (currentUser && data.id === currentUser._id) { w.done = true; w.myWpm = data.wpm; if ($('wpm-input')) $('wpm-input').disabled = true; }
            else w.oppIndex[data.id] = 10;
        }
    }
    function scoreboardValue(id) {
        const w = matchState.wpm; if (!w) return '';
        const mine = currentUser && id === currentUser._id;
        if (w.mode === 'paragraph') return mine ? (w.myWpm || 0) + ' wpm' : (w.oppWpm[id] !== undefined ? w.oppWpm[id] + ' wpm' : '…');
        return (mine ? w.sentenceIndex : (w.oppIndex[id] || 0)) + '/10';
    }
    return { init, onEvent, scoreboardValue, cleanup };
})();
function wpmSubmitSentence() {
    const input = $('wpm-input');
    if (!input || !matchState.wpm.sentence) return;
    sendAction({ type: 'submit', text: input.value });
}

const WordChainUI = (() => {
    let timerInt = null;
    const clearTimer = () => { if (timerInt) clearInterval(timerInt); timerInt = null; };
    function init() {
        matchState.wc = { hearts: {}, current: null, deadline: 0 };
        const body = $('match-body');
        body.textContent = '';
        body.append(
            h('div', { id: 'wc-turn', class: 'text-center text-sm text-text-secondary mb-4' }, 'Get ready…'),
            h('div', { class: 'h-1 bg-white/10 rounded-full overflow-hidden mb-6' }, h('div', { id: 'wc-bar', class: 'h-full bg-accent', style: 'width:100%' })),
            h('div', { class: 'text-center mb-6' }, h('span', { id: 'wc-letter', class: 'text-6xl font-extrabold text-accent' }, '?')),
            h('div', { class: 'flex gap-2' },
                h('input', { id: 'wc-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', disabled: 'true', class: 'flex-1 bg-transparent border border-border-color rounded-xl px-4 py-3 text-base focus:outline-none focus:border-accent', placeholder: 'Type a word…', onkeydown: (e) => { if (e.key === 'Enter') wcSubmit(); } }),
                h('button', { class: 'btn-press bg-accent text-app-bg font-bold px-5 rounded-xl', onclick: wcSubmit }, 'Go')),
            h('div', { id: 'wc-feedback', class: 'text-center text-sm font-semibold mt-3 h-5' }));
    }
    function onEvent(type, data) {
        const w = matchState.wc;
        if (type === 'turn') {
            w.current = data.id; w.deadline = data.deadline; w.receivedAt = Date.now(); w.hearts = data.hearts;
            const mine = currentUser && data.id === currentUser._id;
            const p = matchState.players.find((x) => x.id === data.id) || {};
            $('wc-turn').textContent = mine ? 'Your turn' : (p.displayName || p.username) + "'s turn";
            $('wc-letter').textContent = data.letter;
            $('wc-input').disabled = !mine;
            $('wc-input').value = '';
            $('wc-feedback').textContent = '';
            if (mine) $('wc-input').focus();
            clearTimer();
            timerInt = setInterval(() => {
                if (!$('wc-bar')) return clearTimer();
                const total = w.deadline - w.receivedAt;
                const left = Math.max(0, w.deadline - Date.now());
                $('wc-bar').style.width = Math.max(0, (left / total) * 100) + '%';
                if (left <= 0) clearTimer();
            }, 100);
        } else if (type === 'turn-end') {
            clearTimer();
            const p = matchState.players.find((x) => x.id === data.id) || {};
            const name = (currentUser && data.id === currentUser._id) ? 'You' : (p.displayName || p.username);
            const fb = $('wc-feedback');
            if (fb) {
                fb.textContent = data.ok ? `${name} played "${data.word}"` : `${name} ${data.reason === 'timeout' ? 'ran out of time' : "missed it"} — lost a heart`;
                fb.className = 'text-center text-sm font-semibold mt-3 h-5 ' + (data.ok ? 'text-online' : 'text-red-400');
            }
            w.hearts = data.hearts;
        }
    }
    function scoreboardValue(id) {
        const hearts = matchState.wc && matchState.wc.hearts;
        if (!hearts || !(id in hearts)) return '';
        return hearts[id] > 0 ? '♥'.repeat(hearts[id]) : '💀';
    }
    function cleanup() { clearTimer(); }
    return { init, onEvent, scoreboardValue, cleanup };
})();
function wcSubmit() {
    const input = $('wc-input');
    if (!input || input.disabled || !input.value.trim()) return;
    sendAction({ type: 'word', value: input.value.trim() });
    input.value = '';
}

const SpellUI = (() => {
    let timerInt = null;
    const clearTimer = () => { if (timerInt) clearInterval(timerInt); timerInt = null; };
    function init() {
        const cfg = matchState.init;
        matchState.stm = { counts: {} };
        const body = $('match-body');
        body.textContent = '';
        body.append(
            h('div', { class: 'text-center mb-1' }, h('span', { class: 'text-[11px] font-bold text-text-muted uppercase tracking-widest' }, cfg.category.label)),
            h('div', { id: 'stm-timer', class: 'text-center text-3xl font-extrabold text-accent mb-4' }, Math.round(cfg.durationMs / 1000) + 's'),
            h('input', { id: 'stm-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'w-full bg-transparent border border-border-color rounded-xl px-4 py-3 text-base focus:outline-none focus:border-accent mb-4', placeholder: 'Type an answer and hit Enter…', onkeydown: (e) => { if (e.key === 'Enter') stmSubmit(); } }),
            h('div', { id: 'stm-list', class: 'flex flex-wrap gap-1.5' }));
    }
    function onEvent(type, data) {
        const s = matchState.stm;
        if (type === 'go') {
            clearTimer();
            timerInt = setInterval(() => {
                if (!$('stm-timer')) return clearTimer();
                const left = Math.max(0, Math.round((data.endsAt - Date.now()) / 1000));
                $('stm-timer').textContent = left + 's';
                if (left <= 0) clearTimer();
            }, 250);
        } else if (type === 'found') {
            s.counts[data.id] = data.count;
            if (currentUser && data.id === currentUser._id) {
                const list = $('stm-list');
                if (list) list.append(h('span', { class: 'text-xs font-semibold bg-accent/15 text-accent px-2.5 py-1 rounded-full' }, data.item));
                const input = $('stm-input'); if (input) input.value = '';
            }
        }
    }
    function scoreboardValue(id) { return String((matchState.stm && matchState.stm.counts[id]) || 0); }
    function cleanup() { clearTimer(); }
    return { init, onEvent, scoreboardValue, cleanup };
})();
function stmSubmit() {
    const input = $('stm-input');
    if (!input || !input.value.trim()) return;
    sendAction({ type: 'submit', value: input.value.trim() });
}

// No shape/flag art bundled yet, so the "silhouette" is a masked letter
// pattern instead (first letter shown, rest blanked) — playable without
// spoiling the answer, and easy to swap for real art later.
function maskCountry(name) {
    let seenFirst = false;
    return name.split('').map((c) => {
        if (/[a-zA-Z]/.test(c)) { if (!seenFirst) { seenFirst = true; return c.toUpperCase(); } return '_'; }
        return c;
    }).join(' ');
}
const CountryUI = (() => {
    let timerInt = null;
    const clearTimer = () => { if (timerInt) clearInterval(timerInt); timerInt = null; };
    function init() {
        const cfg = matchState.init;
        matchState.gc = { counts: {} };
        const body = $('match-body');
        body.textContent = '';
        body.append(
            h('div', { id: 'gc-timer', class: 'text-center text-xs text-text-secondary mb-4' }),
            h('div', { id: 'gc-progress', class: 'text-center text-[11px] text-text-muted mb-2' }, '1 / ' + cfg.total),
            h('div', { id: 'gc-mask', class: 'text-center text-2xl font-extrabold tracking-widest mb-6 min-h-[2.5rem]' }, '…'),
            h('div', { class: 'flex gap-2' },
                h('input', { id: 'gc-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'flex-1 bg-transparent border border-border-color rounded-xl px-4 py-3 text-base focus:outline-none focus:border-accent', placeholder: 'Name the country…', onkeydown: (e) => { if (e.key === 'Enter') gcSubmit(); } }),
                h('button', { class: 'btn-press bg-accent text-app-bg font-bold px-5 rounded-xl', onclick: gcSubmit }, 'Go')),
            h('p', { class: 'text-[11px] text-text-muted text-center mt-4' }, 'Map art is on the way — for now, guess from the letter pattern.'));
    }
    function onEvent(type, data) {
        const g = matchState.gc;
        if (type === 'go') {
            clearTimer();
            timerInt = setInterval(() => {
                if (!$('gc-timer')) return clearTimer();
                const left = Math.max(0, Math.round((data.endsAt - Date.now()) / 1000));
                $('gc-timer').textContent = left + 's left';
                if (left <= 0) clearTimer();
            }, 250);
        } else if (type === 'country') {
            const mask = $('gc-mask'), prog = $('gc-progress'), input = $('gc-input');
            if (prog) prog.textContent = Math.min(data.index + 1, data.total) + ' / ' + data.total;
            if (data.code) { if (mask) mask.textContent = maskCountry(data.code); if (input) { input.value = ''; input.disabled = false; } }
            else { if (mask) mask.textContent = "You've cleared the set!"; if (input) input.disabled = true; }
        } else if (type === 'score') {
            g.counts[data.id] = data.count;
        }
    }
    function scoreboardValue(id) { return String((matchState.gc && matchState.gc.counts[id]) || 0); }
    function cleanup() { clearTimer(); }
    return { init, onEvent, scoreboardValue, cleanup };
})();
function gcSubmit() {
    const input = $('gc-input');
    if (!input || input.disabled || !input.value.trim()) return;
    sendAction({ type: 'guess', value: input.value.trim() });
    input.value = '';
}

const WikiUI = (() => {
    function cleanup() {}
    function init() {
        const cfg = matchState.init;
        matchState.wr = { clicks: 0, oppClicks: {} };
        const body = $('match-body');
        body.textContent = '';
        body.append(
            h('div', { class: 'grid grid-cols-2 gap-2 mb-4' },
                h('div', { class: 'bg-card-bg border border-border-color rounded-xl p-3' }, h('div', { class: 'text-[10px] text-text-muted uppercase font-bold mb-1' }, 'Start'), h('div', { class: 'text-sm font-bold' }, cfg.start)),
                h('div', { class: 'bg-card-bg border border-accent/40 rounded-xl p-3' }, h('div', { class: 'text-[10px] text-accent uppercase font-bold mb-1' }, 'Target'), h('div', { class: 'text-sm font-bold' }, cfg.target))),
            h('div', { class: 'bg-card-bg border border-border-color rounded-xl p-3 mb-4' },
                h('div', { class: 'text-[10px] text-text-muted uppercase font-bold mb-1' }, 'You are on'),
                h('div', { id: 'wr-current', class: 'text-base font-bold mb-2' }, cfg.start),
                h('a', { id: 'wr-open', href: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(cfg.start.replace(/ /g, '_')), target: '_blank', rel: 'noopener', class: 'btn-press inline-flex items-center gap-1.5 text-xs font-bold text-accent' },
                    h('i', { 'data-lucide': 'external-link', class: 'w-3.5 h-3.5' }), 'Open on Wikipedia')),
            h('div', { class: 'flex gap-2' },
                h('input', { id: 'wr-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'flex-1 bg-transparent border border-border-color rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent', placeholder: 'Type the link title you clicked…', onkeydown: (e) => { if (e.key === 'Enter') wrSubmit(); } }),
                h('button', { class: 'btn-press bg-accent text-app-bg font-bold px-5 rounded-xl', onclick: wrSubmit }, 'Go')),
            h('div', { id: 'wr-feedback', class: 'text-center text-sm font-semibold mt-3 h-5' }),
            h('div', { id: 'wr-clicks', class: 'text-center text-[11px] text-text-muted mt-1' }, '0 clicks'));
        icons();
    }
    function onEvent(type, data) {
        const w = matchState.wr;
        if (type === 'moved') {
            if (currentUser && data.id === currentUser._id) {
                w.clicks = data.clicks;
                if ($('wr-current')) $('wr-current').textContent = data.title;
                if ($('wr-open')) $('wr-open').href = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(data.title.replace(/ /g, '_'));
                if ($('wr-clicks')) $('wr-clicks').textContent = data.clicks + (data.clicks === 1 ? ' click' : ' clicks');
                if ($('wr-feedback')) $('wr-feedback').textContent = '';
                if ($('wr-input')) $('wr-input').value = '';
            } else w.oppClicks[data.id] = data.clicks;
        } else if (type === 'invalid-link') {
            if ($('wr-feedback')) { $('wr-feedback').textContent = `"${data.title}" isn't a link on this page`; $('wr-feedback').className = 'text-center text-sm font-semibold mt-3 h-5 text-red-400'; }
        } else if (type === 'finished') {
            const mine = currentUser && data.id === currentUser._id;
            if ($('wr-feedback')) { $('wr-feedback').textContent = mine ? 'You reached the target! 🎉' : 'Opponent reached the target first.'; $('wr-feedback').className = 'text-center text-sm font-semibold mt-3 h-5 ' + (mine ? 'text-online' : 'text-text-secondary'); }
            if ($('wr-input')) $('wr-input').disabled = true;
        }
    }
    function scoreboardValue(id) {
        const w = matchState.wr; if (!w) return '';
        return String((currentUser && id === currentUser._id) ? w.clicks : (w.oppClicks[id] || 0));
    }
    return { init, onEvent, scoreboardValue, cleanup };
})();
function wrSubmit() {
    const input = $('wr-input');
    if (!input || input.disabled || !input.value.trim()) return;
    sendAction({ type: 'navigate', title: input.value.trim() });
}

const GAME_UI = { mathduel: MathDuelUI, wpmduel: WpmDuelUI, wordchain: WordChainUI, spellthemost: SpellUI, guesscountry: CountryUI, wikirace: WikiUI };

function renderHomeFriends() {
    const box = $('home-friends');
    if (!friendsData) { box.classList.add('hidden'); return; }
    const online = friendsData.friends.filter((f) => f.online);
    const req = friendsData.incoming.length;
    if (!online.length && !req) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.textContent = '';
    box.append(h('button', {
        class: 'btn-press w-full text-left bg-card-bg border border-border-color rounded-2xl px-4 py-3 hover:border-accent/50 transition-colors duration-150',
        onclick: () => go('friends'),
    },
        h('div', { class: 'flex items-center justify-between mb-2' },
            h('span', { class: 'text-sm font-semibold' }, online.length ? `${online.length} friend${online.length === 1 ? '' : 's'} online` : 'Friends'),
            req ? h('span', { class: 'text-[11px] font-bold text-app-bg bg-accent rounded-full px-2 py-0.5' }, `${req} request${req === 1 ? '' : 's'}`) : null),
        online.length ? h('div', { class: 'flex -space-x-2' }, online.slice(0, 6).map((f) => avatarEl(f, 'w-8 h-8', 'text-xs'))) : null));
    icons();
}

// ── Leaderboard ──────────────────────────────────────────────
let lbSeq = 0;
async function loadLeaderboard() {
    const seq = ++lbSeq;
    const list = $('lb-list');
    const msg = $('lb-msg');
    msg.classList.add('hidden');
    if (!list.children.length) { msg.textContent = 'Loading...'; msg.classList.remove('hidden'); }
    try {
        const data = await authedFetch('/api/users/leaderboard');
        if (seq !== lbSeq) return;
        renderLeaderboard(data);
    } catch (err) {
        if (seq !== lbSeq) return;
        list.textContent = '';
        msg.textContent = err.message;
        msg.classList.remove('hidden');
    }
}
function renderLeaderboard(data) {
    const list = $('lb-list');
    const msg = $('lb-msg');
    list.textContent = '';
    msg.classList.add('hidden');

    const me = $('lb-me');
    me.classList.remove('hidden');
    me.textContent = '';
    me.append(
        h('div', {}, h('div', { class: 'text-[10px] text-text-muted uppercase tracking-wide' }, 'Your rank'),
            h('div', { class: 'text-xl font-bold' }, '#' + data.me.rank)),
        h('div', { class: 'text-right' }, h('div', { class: 'text-[10px] text-text-muted uppercase tracking-wide' }, 'Rating'),
            h('div', { class: 'text-xl font-bold text-accent' }, String(data.me.rating))));

    if (!data.players.length) {
        msg.textContent = 'No players yet.';
        msg.classList.remove('hidden');
        return;
    }
    const medal = { 1: 'text-amber-300', 2: 'text-slate-300', 3: 'text-orange-400' };
    data.players.forEach((p) => {
        const mine = p._id === currentUser._id;
        list.append(h('button', {
            class: 'btn-press w-full flex items-center gap-3 bg-card-bg border rounded-2xl px-4 py-3 text-left transition-colors duration-150 ' +
                (mine ? 'border-accent/50' : 'border-border-color hover:border-accent/50'),
            onclick: () => go('u/' + p._id),
        },
            h('span', { class: 'w-7 text-center text-sm font-bold shrink-0 ' + (medal[p.rank] || 'text-text-secondary') }, String(p.rank)),
            avatarEl(p, 'w-10 h-10', 'text-sm'),
            h('span', { class: 'flex-1 min-w-0' },
                h('span', { class: 'flex items-center gap-2 min-w-0' },
                    h('span', { class: 'text-sm font-semibold truncate' }, p.displayName || p.username), badgeEl(p.badge),
                    mine ? h('span', { class: 'text-[10px] font-bold text-accent shrink-0' }, 'YOU') : null),
                h('span', { class: 'block text-xs text-text-secondary truncate' }, '@' + p.username)),
            h('span', { class: 'text-sm font-bold text-accent shrink-0' }, String(p.rating))));
    });
}

// ── Friends tab ──────────────────────────────────────────────
function friendRow(u, sub, right, onclick) {
    return h(onclick ? 'button' : 'div', {
        class: 'w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3 text-left ' +
            (onclick ? 'btn-press hover:border-accent/50 transition-colors duration-150' : ''),
        onclick,
    },
        avatarEl(u, 'w-10 h-10', 'text-sm', u.online === undefined ? undefined : u.online),
        h('span', { class: 'flex-1 min-w-0' },
            h('span', { class: 'flex items-center gap-2 min-w-0' },
                h('span', { class: 'text-sm font-semibold truncate' }, u.displayName || u.username), badgeEl(u.badge)),
            h('span', { class: 'block text-xs truncate ' + (u.online ? 'text-online' : 'text-text-secondary') }, sub)),
        right);
}
function sectionTitle(text, count) {
    return h('div', { class: 'text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2 mt-5' }, count ? `${text} · ${count}` : text);
}
const smallBtn = (label, cls, onclick) =>
    h('button', { class: 'btn-press shrink-0 text-xs font-bold px-3 py-2 rounded-lg ' + cls, onclick: (e) => { e.stopPropagation(); onclick(e); } }, label);

function renderFriends() {
    const box = $('friends-lists');
    box.textContent = '';
    if (!friendsData) { box.append(h('div', { class: 'text-sm text-text-secondary text-center py-8' }, 'Loading...')); return; }
    const { friends, incoming, outgoing } = friendsData;

    if (incoming.length) {
        box.append(sectionTitle('Requests', incoming.length));
        const wrap = h('div', { class: 'flex flex-col gap-2' });
        incoming.forEach((r) => wrap.append(friendRow(
            r.user, '@' + r.user.username,
            h('span', { class: 'flex gap-2 shrink-0' },
                smallBtn('Accept', 'bg-accent text-app-bg', () => friendAction('POST', `/api/friends/requests/${r.requestId}/accept`)),
                smallBtn('Decline', 'bg-pill-bg border border-border-color text-text-secondary', () => friendAction('DELETE', `/api/friends/requests/${r.requestId}`))),
            () => go('u/' + r.user._id))));
        box.append(wrap);
    }

    box.append(sectionTitle('Friends', friends.length));
    if (!friends.length) {
        box.append(h('div', { class: 'bg-card-bg border border-border-color rounded-2xl p-6 text-center text-sm text-text-secondary' },
            'No friends yet. Send a request using a username above, or tap a player on the leaderboard.'));
    } else {
        const wrap = h('div', { class: 'flex flex-col gap-2' });
        friends.forEach((f) => wrap.append(friendRow(f, presenceText(f),
            h('button', {
                class: 'btn-press shrink-0 w-9 h-9 rounded-lg bg-pill-bg border border-border-color text-text-secondary hover:text-accent hover:border-accent/50 flex items-center justify-center transition-colors duration-150',
                'aria-label': 'Message ' + (f.displayName || f.username),
                onclick: (e) => { e.stopPropagation(); go('messages/' + f._id); },
            }, h('i', { 'data-lucide': 'message-circle', class: 'w-4 h-4' })),
            () => go('u/' + f._id))));
        box.append(wrap);
    }

    if (outgoing.length) {
        box.append(sectionTitle('Sent requests', outgoing.length));
        const wrap = h('div', { class: 'flex flex-col gap-2' });
        outgoing.forEach((r) => wrap.append(friendRow(
            r.user, 'Waiting for reply',
            smallBtn('Cancel', 'bg-pill-bg border border-border-color text-text-secondary', () => friendAction('DELETE', `/api/friends/requests/${r.requestId}`)),
            () => go('u/' + r.user._id))));
        box.append(wrap);
    }
    icons();
}

async function friendAction(method, url, body) {
    try {
        const data = await authedFetch(url, { method, body: body ? JSON.stringify(body) : undefined });
        await refreshFriends();
        return data;
    } catch (err) {
        flashFriendMsg(err.message, false);
        throw err;
    }
}
let frMsgTimer = null;
function flashFriendMsg(text, ok) {
    const el = $('fr-msg');
    el.textContent = text;
    el.className = 'text-xs mt-2 ' + (ok ? 'text-accent' : 'text-red-400');
    clearTimeout(frMsgTimer);
    frMsgTimer = setTimeout(() => el.classList.add('hidden'), 5000);
}
async function sendFriendRequest() {
    const input = $('fr-username');
    const username = input.value.trim().replace(/^@/, '');
    if (!username) return flashFriendMsg('Enter a username.', false);
    $('fr-send').disabled = true;
    try {
        const data = await friendAction('POST', '/api/friends/request', { username });
        input.value = '';
        flashFriendMsg(data.message, true);
    } catch (_) { /* message already shown */ }
    finally { $('fr-send').disabled = false; }
}
$('fr-send').addEventListener('click', sendFriendRequest);
$('fr-username').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendFriendRequest(); });


// ── About you: bio, location, social links ───────────────────
// Links are built here from a fixed base + the stored handle, so a stored
// value can never become an arbitrary URL. (Website is validated by the server
// and re-checked to be http(s) here.)
const SOCIALS = {
    instagram: { label: 'Instagram', url: (v) => 'https://instagram.com/' + encodeURIComponent(v) },
    x: { label: 'X', url: (v) => 'https://x.com/' + encodeURIComponent(v) },
    github: { label: 'GitHub', url: (v) => 'https://github.com/' + encodeURIComponent(v) },
    youtube: { label: 'YouTube', url: (v) => 'https://youtube.com/@' + encodeURIComponent(v) },
    twitch: { label: 'Twitch', url: (v) => 'https://twitch.tv/' + encodeURIComponent(v) },
    discord: { label: 'Discord', url: null }, // no public profile URL: tap copies the name
    website: { label: 'Website', url: (v) => (/^https?:\/\//i.test(v) ? v : null) },
};
function socialChip(key, value) {
    const meta = SOCIALS[key];
    const shown = key === 'website' ? value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') : '@' + value;
    const cls = 'btn-press inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-full bg-pill-bg border border-border-color text-xs hover:border-accent/50 transition-colors duration-150';
    const inner = [h('span', { class: 'font-semibold text-text-secondary' }, meta.label), h('span', { class: 'truncate text-text-primary' }, shown)];
    const href = meta.url ? meta.url(value) : null;
    if (href) return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer nofollow' }, inner);
    const b = h('button', { class: cls, type: 'button', title: 'Tap to copy' }, inner);
    b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(value); b.lastChild.textContent = 'Copied!'; setTimeout(() => { b.lastChild.textContent = shown; }, 1200); } catch (_) {}
    });
    return b;
}
// Returns an element, or null when the person has filled in nothing.
function aboutEl(u, centered) {
    const links = Object.entries(u.socialLinks || {}).filter(([k, v]) => v && SOCIALS[k]);
    if (!u.bio && !u.location && !links.length) return null;
    const box = h('div', { class: centered ? 'text-center' : '' });
    if (u.bio) box.append(h('p', { class: 'text-sm text-text-secondary whitespace-pre-wrap break-words mt-3' }, u.bio));
    if (u.location) box.append(h('div', { class: 'flex items-center gap-1 text-xs text-text-muted mt-2 ' + (centered ? 'justify-center' : '') },
        h('i', { 'data-lucide': 'map-pin', class: 'w-3.5 h-3.5' }), h('span', { class: 'truncate' }, u.location)));
    if (links.length) box.append(h('div', { class: 'flex flex-wrap gap-2 mt-3 ' + (centered ? 'justify-center' : '') }, links.map(([k, v]) => socialChip(k, v))));
    return box;
}


// ── Messages (DMs) ───────────────────────────────────────────
// Friends only. Plain polling: the inbox refreshes with the friends poll, an
// open chat asks for newer messages every few seconds.
let dmData = null;
const CHAT_POLL_MS = 4000;

async function refreshDMs() {
    try {
        dmData = await authedFetch('/api/dm');
        const n = dmData.unread;
        const b = $('nav-dm-badge');
        b.textContent = n > 9 ? '9+' : String(n);
        b.classList.toggle('hidden', n === 0);
        const [tab, a] = currentRoute();
        if (tab === 'messages' && !a) renderInbox();
    } catch (_) { /* next poll retries */ }
}

const clockTime = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(d) {
    const t = new Date(d), n = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(t, n)) return 'Today';
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (same(t, y)) return 'Yesterday';
    return t.toLocaleDateString([], { dateStyle: 'medium' });
}

function renderInbox() {
    const box = $('inbox-list');
    box.textContent = '';
    if (!dmData) { box.append(h('div', { class: 'text-sm text-text-secondary text-center py-8' }, 'Loading...')); return; }
    const convs = dmData.conversations;

    if (convs.length) {
        const wrap = h('div', { class: 'flex flex-col gap-2' });
        convs.forEach((c) => {
            const u = c.user;
            const preview = (c.last.mine ? 'You: ' : '') + c.last.text.replace(/\s+/g, ' ');
            wrap.append(h('button', {
                class: 'btn-press w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3 text-left hover:border-accent/50 transition-colors duration-150',
                onclick: () => go('messages/' + u._id),
            },
                avatarEl(u, 'w-11 h-11', 'text-sm', c.isFriend ? u.online : undefined),
                h('span', { class: 'flex-1 min-w-0' },
                    h('span', { class: 'flex items-center justify-between gap-2' },
                        h('span', { class: 'flex items-center gap-1.5 min-w-0' },
                            h('span', { class: 'text-sm truncate ' + (c.unread ? 'font-bold' : 'font-semibold') }, u.displayName || u.username), badgeEl(u.badge)),
                        h('span', { class: 'text-[11px] shrink-0 ' + (c.unread ? 'text-accent' : 'text-text-muted') }, ago(c.last.at))),
                    h('span', { class: 'flex items-center justify-between gap-2 mt-0.5' },
                        h('span', { class: 'text-xs truncate ' + (c.unread ? 'text-text-primary' : 'text-text-secondary') }, preview),
                        c.unread ? h('span', { class: 'shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-app-bg text-[11px] font-bold leading-5 text-center' }, c.unread > 99 ? '99+' : String(c.unread)) : null))));
        });
        box.append(wrap);
    }

    const started = new Set(convs.map((c) => c.user._id));
    const fresh = (friendsData ? friendsData.friends : []).filter((f) => !started.has(f._id));
    if (fresh.length) {
        box.append(sectionTitle('Start a chat'));
        const wrap = h('div', { class: 'flex flex-col gap-2' });
        fresh.forEach((f) => wrap.append(friendRow(f, presenceText(f), h('i', { 'data-lucide': 'message-circle', class: 'w-4 h-4 text-text-secondary shrink-0' }), () => go('messages/' + f._id))));
        box.append(wrap);
    }
    if (!convs.length && !fresh.length) {
        box.append(h('div', { class: 'bg-card-bg border border-border-color rounded-2xl p-6 text-center' },
            h('p', { class: 'text-sm text-text-secondary mb-4' }, 'You can message your friends here. Add some friends to get started.'),
            h('button', { class: 'btn-press bg-accent text-app-bg font-bold text-sm px-5 py-2.5 rounded-xl', onclick: () => go('friends') }, 'Find friends')));
    }
    icons();
}

// First time on this device: explain the 30-day message retention.
function maybeShowDmNotice() {
    const key = 'aptiks_dm_notice_' + currentUser._id;
    if (localStorage.getItem(key)) return;
    openOverlay($('dm-notice'), () => localStorage.setItem(key, '1'));
    icons();
}

// ---- Chat screen ----
const chat = { id: null, user: null, canSend: false, messages: [], pending: [], hasMore: false, timer: null, seq: 0, chain: Promise.resolve(), polling: false };

function chatStop() {
    clearInterval(chat.timer);
    chat.timer = null;
    chat.seq++;
    chat.id = null;
}

async function openChat(id) {
    chatStop();
    const seq = chat.seq;
    Object.assign(chat, { id, user: null, canSend: false, messages: [], pending: [], hasMore: false, chain: Promise.resolve() });
    $('chat-input').value = '';
    $('chat-input').style.height = 'auto';
    renderChatHead();
    renderChat(true);
    try {
        const data = await authedFetch('/api/dm/with/' + encodeURIComponent(id));
        if (seq !== chat.seq) return;
        chat.user = data.user;
        chat.canSend = data.canSend;
        chat.messages = data.messages;
        chat.hasMore = data.hasMore;
        renderChatHead();
        renderChat(true);
        chat.timer = setInterval(pollChat, CHAT_POLL_MS);
        refreshDMs(); // opening a chat clears its unread count
        if (chat.canSend && matchMedia('(pointer:fine)').matches) $('chat-input').focus();
    } catch (err) {
        if (seq !== chat.seq) return;
        const box = $('chat-msgs');
        box.textContent = '';
        box.append(h('div', { class: 'text-sm text-red-400 text-center py-10' }, err.message));
    }
}

async function pollChat() {
    if (!chat.id || document.hidden || chat.polling) return;
    const seq = chat.seq;
    chat.polling = true;
    try {
        const last = chat.messages.length ? chat.messages[chat.messages.length - 1]._id : null;
        const data = await authedFetch('/api/dm/with/' + encodeURIComponent(chat.id) + (last ? '?after=' + last : ''));
        if (seq !== chat.seq) return;
        let changed = false;
        data.messages.forEach((m) => {
            if (!chat.messages.some((x) => x._id === m._id)) { chat.messages.push(m); changed = true; }
        });
        if (data.canSend !== chat.canSend || (chat.user && data.user.online !== chat.user.online)) changed = true;
        chat.canSend = data.canSend;
        chat.user = data.user;
        renderChatHead();
        if (changed) renderChat(false);
    } catch (_) { /* transient */ }
    finally { chat.polling = false; }
}

function renderChatHead() {
    const head = $('chat-head');
    head.textContent = '';
    if (!chat.user) { head.append(h('span', { class: 'text-sm text-text-secondary' }, 'Loading...')); return; }
    const u = chat.user;
    head.append(
        avatarEl(u, 'w-9 h-9', 'text-sm', chat.canSend ? u.online : undefined),
        h('span', { class: 'min-w-0' },
            h('span', { class: 'flex items-center gap-1.5 min-w-0' }, h('span', { class: 'text-sm font-bold truncate' }, u.displayName || u.username), badgeEl(u.badge)),
            h('span', { class: 'block text-[11px] truncate ' + (chat.canSend && u.online ? 'text-online' : 'text-text-muted') },
                chat.canSend ? presenceText(u) : 'Not friends')));
    head.onclick = () => go('u/' + u._id);
}

function bubble(text, mine, time, extra) {
    return h('div', { class: 'flex ' + (mine ? 'justify-end' : 'justify-start') },
        h('div', {
            class: 'max-w-[80%] px-3.5 py-2 text-sm leading-snug ' +
                (mine ? 'bg-accent text-app-bg rounded-2xl rounded-br-md' : 'bg-card-bg border border-border-color rounded-2xl rounded-bl-md') +
                (extra && extra.failed ? ' opacity-70 ring-1 ring-red-400' : ''),
            onclick: extra && extra.onclick,
        },
            h('div', { class: 'whitespace-pre-wrap break-words' }, text),
            h('div', { class: 'text-[10px] mt-0.5 text-right ' + (mine ? 'text-app-bg/60' : 'text-text-muted') }, (extra && extra.note) || time)));
}

function renderChat(stick) {
    const box = $('chat-msgs');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    box.textContent = '';
    if (chat.hasMore) {
        box.append(h('button', { class: 'btn-press self-center text-xs font-semibold text-text-secondary bg-pill-bg border border-border-color rounded-full px-4 py-1.5 mb-2', onclick: loadOlder }, 'Load older messages'));
    }
    if (chat.user && !chat.messages.length && !chat.pending.length) {
        box.append(h('div', { class: 'text-xs text-text-muted text-center py-10' }, chat.canSend ? 'No messages yet. Say hi!' : 'No messages.'));
    }
    let lastDay = '';
    chat.messages.forEach((m) => {
        const day = new Date(m.createdAt).toDateString();
        if (day !== lastDay) {
            lastDay = day;
            box.append(h('div', { class: 'text-[11px] text-text-muted text-center my-2' }, dayLabel(m.createdAt)));
        }
        box.append(bubble(m.text, m.sender === currentUser._id, clockTime(m.createdAt)));
    });
    chat.pending.forEach((p) => box.append(bubble(p.text, true, '', {
        failed: p.failed,
        note: p.failed ? 'Not sent · tap to retry' : 'Sending...',
        onclick: p.failed ? () => retrySend(p) : null,
    })));

    const composer = $('chat-form'), locked = $('chat-locked');
    composer.classList.toggle('hidden', !chat.canSend && !!chat.user);
    locked.classList.toggle('hidden', chat.canSend || !chat.user);
    locked.textContent = "You're no longer friends, so you can't send messages here.";
    if (stick || nearBottom) box.scrollTop = box.scrollHeight;
}

async function loadOlder() {
    if (!chat.messages.length) return;
    const seq = chat.seq;
    const box = $('chat-msgs');
    const prevHeight = box.scrollHeight;
    try {
        const data = await authedFetch(`/api/dm/with/${encodeURIComponent(chat.id)}?before=${chat.messages[0]._id}`);
        if (seq !== chat.seq) return;
        chat.messages = data.messages.concat(chat.messages);
        chat.hasMore = data.hasMore;
        renderChat(false);
        box.scrollTop = box.scrollHeight - prevHeight; // stay where you were reading
    } catch (_) {}
}

function sendChat() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text || !chat.canSend) return;
    input.value = '';
    input.style.height = 'auto';
    const p = { text, failed: false };
    chat.pending.push(p);
    renderChat(true);
    queueSend(p);
}
function retrySend(p) {
    p.failed = false;
    renderChat(true);
    queueSend(p);
}
// One request at a time, so messages arrive in the order they were typed.
function queueSend(p) {
    const seq = chat.seq;
    chat.chain = chat.chain.then(async () => {
        if (seq !== chat.seq) return;
        try {
            const data = await authedFetch('/api/dm/with/' + encodeURIComponent(chat.id), { method: 'POST', body: JSON.stringify({ text: p.text }) });
            if (seq !== chat.seq) return;
            chat.pending = chat.pending.filter((x) => x !== p);
            if (!chat.messages.some((x) => x._id === data.message._id)) chat.messages.push(data.message);
            chat.messages.sort((a, b) => (a._id < b._id ? -1 : 1));
        } catch (err) {
            if (seq !== chat.seq) return;
            p.failed = true;
            if (err.status === 403) { chat.canSend = false; chat.pending = chat.pending.filter((x) => x !== p); }
        }
        renderChat(true);
    });
}

$('chat-send').addEventListener('click', () => { sendChat(); $('chat-input').focus(); });
$('chat-input').addEventListener('input', (e) => {
    const t = e.target;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 128) + 'px';
});
$('chat-input').addEventListener('keydown', (e) => {
    // Desktop: Enter sends, Shift+Enter = new line. Phones: Enter is a new line, use the send button.
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); sendChat(); }
});

// ── Player profile (friend / leaderboard) ────────────────────
let playerSeq = 0;
async function loadPlayer(id) {
    const seq = ++playerSeq;
    const body = $('player-body');
    body.textContent = '';
    body.append(h('div', { class: 'text-sm text-text-secondary text-center py-10' }, 'Loading...'));
    try {
        const data = await authedFetch('/api/users/' + encodeURIComponent(id));
        if (seq !== playerSeq) return;
        renderPlayer(data.user);
    } catch (err) {
        if (seq !== playerSeq) return;
        body.textContent = '';
        body.append(h('div', { class: 'text-sm text-red-400 text-center py-10' }, err.message));
    }
}
function statTile(label, value, accent) {
    return h('div', { class: 'bg-card-bg border border-border-color rounded-xl px-3 py-3' },
        h('div', { class: 'text-[10px] text-text-muted uppercase tracking-wide' }, label),
        h('div', { class: 'text-lg font-bold truncate ' + (accent ? 'text-accent' : '') }, String(value)));
}
function renderPlayer(u) {
    const body = $('player-body');
    body.textContent = '';
    const shows = u.relation === 'friend' || u.relation === 'self';
    const name = u.displayName || u.username;

    body.append(h('div', { class: 'flex items-center gap-4 mb-6' },
        avatarEl(u, 'w-20 h-20', 'text-2xl', shows ? u.online : undefined),
        h('div', { class: 'min-w-0 flex-1' },
            h('div', { class: 'flex items-center gap-2 min-w-0' },
                h('div', { class: 'text-xl font-bold truncate' }, name), badgeEl(u.badge)),
            h('div', { class: 'text-sm text-text-secondary truncate' }, '@' + u.username),
            shows && u.relation !== 'self' ? h('div', { class: 'text-xs mt-1 font-semibold ' + (u.online ? 'text-online' : 'text-text-muted') }, presenceText(u)) : null)));
    const about = aboutEl(u, false);
    if (about) body.append(h('div', { class: 'mb-6' }, about));

    if (shows && u.stats) {
        const s = u.stats;
        const played = s.matchesPlayed;
        body.append(h('div', { class: 'grid grid-cols-2 gap-2 mb-2' },
            statTile('Rating', u.rating, true),
            statTile('Matches', played),
            statTile('Wins', s.wins),
            statTile('Losses', s.losses),
            statTile('Win rate', played ? Math.round((s.wins / played) * 100) + '%' : '—'),
            statTile('Accuracy', s.accuracy === null ? '—' : s.accuracy + '%')));
        const since = u.relation === 'friend' && u.friendsSince
            ? 'Friends since ' + new Date(u.friendsSince).toLocaleDateString([], { dateStyle: 'medium' })
            : 'Joined ' + new Date(u.memberSince).toLocaleDateString([], { dateStyle: 'medium' });
        body.append(h('div', { class: 'text-xs text-text-muted text-center mb-6' }, since));
    } else {
        body.append(h('div', { class: 'grid grid-cols-1 gap-2 mb-2' }, statTile('Rating', u.rating, true)));
        body.append(h('p', { class: 'text-xs text-text-muted text-center mb-6' }, 'Become friends to see their stats and when they are online.'));
    }

    const msg = h('div', { class: 'hidden text-xs text-center mb-3' });
    const run = async (btn, method, url, body2) => {
        btn.disabled = true; btn.style.opacity = '.6';
        try {
            await friendAction(method, url, body2);
            await loadPlayer(u._id); // re-render with the new relationship
        } catch (err) {
            msg.textContent = err.message;
            msg.className = 'text-xs text-center mb-3 text-red-400';
            btn.disabled = false; btn.style.opacity = '';
        }
    };
    const big = 'btn-press w-full font-bold text-sm py-3 rounded-xl ';
    if (u.relation === 'none') {
        const b = h('button', { class: big + 'bg-accent text-app-bg shadow-[0_0_15px_rgba(226,183,20,0.25)]' }, 'Add friend');
        b.addEventListener('click', () => run(b, 'POST', '/api/friends/request', { userId: u._id }));
        body.append(b);
    } else if (u.relation === 'outgoing') {
        const b = h('button', { class: big + 'bg-pill-bg border border-border-color text-text-secondary' }, 'Request sent · Cancel');
        b.addEventListener('click', () => run(b, 'DELETE', `/api/friends/requests/${u.requestId}`));
        body.append(b);
    } else if (u.relation === 'incoming') {
        const acc = h('button', { class: big + 'bg-accent text-app-bg mb-2' }, 'Accept request');
        acc.addEventListener('click', () => run(acc, 'POST', `/api/friends/requests/${u.requestId}/accept`));
        const dec = h('button', { class: big + 'bg-pill-bg border border-border-color text-text-secondary' }, 'Decline');
        dec.addEventListener('click', () => run(dec, 'DELETE', `/api/friends/requests/${u.requestId}`));
        body.append(acc, dec);
    } else if (u.relation === 'friend') {
        const dm = h('button', { class: big + 'bg-accent text-app-bg mb-2 shadow-[0_0_15px_rgba(226,183,20,0.25)]' }, 'Message');
        dm.addEventListener('click', () => go('messages/' + u._id));
        body.append(dm);
        const b = h('button', { class: big + 'bg-pill-bg border border-border-color text-red-400' }, 'Remove friend');
        armButton(b, 'Tap again to remove', () => run(b, 'DELETE', '/api/friends/' + u._id));
        body.append(b);
    }
    body.append(msg);
    icons();
}

// ── Account tab ──────────────────────────────────────────────
let copyTimer = null;
async function copyUsername() {
    const text = currentUser ? currentUser.username : '';
    if (!text) return;
    let copied = false;
    try {
        await navigator.clipboard.writeText(text);
        copied = true;
    } catch (_) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            copied = document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (__) { copied = false; }
    }
    const fb = $('copy-feedback');
    fb.textContent = copied ? 'Copied!' : 'Copy failed';
    fb.className = 'text-xs font-semibold ' + (copied ? 'text-accent' : 'text-red-400');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => fb.classList.add('hidden'), 1500);
}

const CATEGORIES = [
    { id: 'personalize', icon: 'palette', label: 'Personalize', desc: 'Photo, display name & username' },
    { id: 'security', icon: 'lock', label: 'Login & security', desc: 'Email & password' },
];

function renderProfileMenu() {
    $('profile-menu').innerHTML = `
        <button onclick="go('u/' + currentUser._id)" class="btn-press w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3.5 text-left hover:border-accent/50 transition-colors duration-150">
            <span class="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0"><i data-lucide="id-card" class="w-4 h-4 text-text-secondary"></i></span>
            <span class="flex-1 min-w-0"><span class="block text-sm font-semibold">My profile</span><span class="block text-xs text-text-secondary truncate">See how others see you</span></span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-text-secondary flex-shrink-0"></i>
        </button>` + CATEGORIES.map(c => `
        <button onclick="go('account/${c.id}')" class="btn-press w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3.5 text-left hover:border-accent/50 transition-colors duration-150">
            <span class="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                <i data-lucide="${c.icon}" class="w-4 h-4 text-text-secondary"></i>
            </span>
            <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">${c.label}</span>
                <span class="block text-xs text-text-secondary truncate">${c.desc}</span>
            </span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-text-secondary flex-shrink-0"></i>
        </button>`).join('') + `
        <button onclick="logout()" class="btn-press w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3.5 text-left text-red-400 hover:bg-white/5 transition-colors duration-150 mt-4">
            <span class="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0"><i data-lucide="log-out" class="w-4 h-4"></i></span>
            <span class="text-sm font-semibold">Sign out</span>
        </button>`;
}

function renderAccount(sub) {
    if (sub === 'personalize' || sub === 'security') {
        $('acct-root').classList.add('hidden');
        $('acct-sub').classList.remove('hidden');
        const body = $('profile-body');
        if (sub === 'personalize') { body.innerHTML = buildPersonalizeHTML(); refreshPzPreview(); wireAbout(); }
        else { body.innerHTML = buildAccountHTML(); fillAccountEmail(); }
    } else {
        $('acct-sub').classList.add('hidden');
        $('acct-root').classList.remove('hidden');
        renderProfileMenu();
    }
    icons();
}
// Re-draw the sub page in place (after a save) without touching history
function rerenderAccountSub(msgId, text) {
    const [, sub] = currentRoute();
    renderAccount(sub);
    if (msgId) showMsg(msgId, text, 'ok');
}

// ── Personalize: photo (with crop) + display name ────────────
const AVATAR_SIZE = 256;                    // output: 256x256 square
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;  // refuse absurdly large originals up front
const CROP_VIEW = 280;                      // on-screen crop circle diameter (px)

function buildPersonalizeHTML() {
    return `
    <div class="bg-card-bg border border-border-color rounded-2xl p-4 mb-4">
        <label class="text-xs text-text-secondary block mb-3">Profile picture</label>
        <div class="flex items-center gap-4 mb-2">
            <div id="pz-avatar-preview" class="avatar w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold flex-shrink-0"></div>
            <div class="flex flex-col gap-2 min-w-0">
                <button type="button" onclick="document.getElementById('pz-file').click()" id="pz-upload-btn"
                    class="btn-press text-sm font-semibold bg-pill-bg border border-border-color hover:border-accent/50 rounded-lg px-4 py-2 transition-colors duration-150">
                    Choose photo
                </button>
                <button type="button" onclick="removePhoto()" id="pz-remove-btn"
                    class="btn-press text-xs font-semibold text-red-400 hover:text-red-300 text-left px-1 transition-colors duration-150 ${currentUser.avatarUrl ? '' : 'hidden'}">
                    Remove photo
                </button>
            </div>
        </div>
        <input id="pz-file" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="onPhotoChosen(event)">
        <div id="pz-photo-status" class="text-xs min-h-[16px] mt-2 text-text-secondary">You'll choose which part of the photo to use.</div>
    </div>

    <div class="bg-card-bg border border-border-color rounded-2xl p-4 mb-4">
        <label class="text-xs text-text-secondary block mb-2">Display name</label>
        <input id="pz-displayname" type="text" maxlength="30" value="${escapeHtml(currentUser.displayName || currentUser.username)}"
            class="field w-full rounded-lg px-3 py-2.5 text-sm">
        <p class="text-[11px] text-text-muted mt-2 mb-3">Shown to opponents. Your @username is changed separately below.</p>
        <div id="pz-error" class="hidden text-xs mb-3"></div>
        <button onclick="savePersonalize()" id="pz-save-btn"
            class="btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(226,183,20,0.25)]">
            Save name
        </button>
    </div>

    ${buildAboutHTML()}

    ${buildUsernameHTML()}`;
}

function refreshPzPreview() {
    const el = $('pz-avatar-preview');
    if (el) setAvatar(el, currentUser);
    const rm = $('pz-remove-btn');
    if (rm) rm.classList.toggle('hidden', !currentUser.avatarUrl);
}

function setPhotoStatus(msg, kind) {
    const el = $('pz-photo-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'text-xs min-h-[16px] mt-2 ' +
        (kind === 'error' ? 'text-red-400' : kind === 'ok' ? 'text-online' : 'text-text-secondary');
}

// ---- Crop tool: the user chooses which part of the photo becomes the avatar ----
// ---- Crop tool state ----
// The image is drawn at (offX, offY) with uniform scale `scale`, inside a
// CROP_VIEW x CROP_VIEW circle. minScale makes the image just cover the
// circle, so there can never be empty space inside the crop.
const crop = { img: null, url: null, nw: 0, nh: 0, scale: 1, minScale: 1, maxScale: 1, offX: 0, offY: 0, drag: null, pinch: null };

function clampCrop() {
    const w = crop.nw * crop.scale, h = crop.nh * crop.scale;
    // offset is the top-left of the image relative to the circle's box
    crop.offX = Math.min(0, Math.max(CROP_VIEW - w, crop.offX));
    crop.offY = Math.min(0, Math.max(CROP_VIEW - h, crop.offY));
}
function paintCrop() {
    const el = document.getElementById('crop-img');
    el.style.transform = `translate(${crop.offX}px, ${crop.offY}px) scale(${crop.scale})`;
}
// Zoom keeping a chosen point (in circle coordinates) fixed under the finger/cursor
function zoomAt(newScale, cx, cy) {
    newScale = Math.min(crop.maxScale, Math.max(crop.minScale, newScale));
    const ratio = newScale / crop.scale;
    crop.offX = cx - (cx - crop.offX) * ratio;
    crop.offY = cy - (cy - crop.offY) * ratio;
    crop.scale = newScale;
    clampCrop();
    paintCrop();
    const range = document.getElementById('crop-zoom');
    range.value = crop.maxScale === crop.minScale ? 0 : Math.round(((newScale - crop.minScale) / (crop.maxScale - crop.minScale)) * 100);
}

function openCropper(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = document.getElementById('crop-img');
        img.onload = () => {
            crop.img = img; crop.url = url;
            crop.nw = img.naturalWidth; crop.nh = img.naturalHeight;
            if (!crop.nw || !crop.nh) { URL.revokeObjectURL(url); return reject(new Error('Could not read that image. Try a different photo.')); }
            crop.minScale = CROP_VIEW / Math.min(crop.nw, crop.nh); // shorter side exactly fills the circle
            crop.maxScale = crop.minScale * 4;                       // up to 4x zoom
            crop.scale = crop.minScale;
            crop.offX = (CROP_VIEW - crop.nw * crop.scale) / 2;      // start centered
            crop.offY = (CROP_VIEW - crop.nh * crop.scale) / 2;
            img.style.width = crop.nw + 'px';
            img.style.height = crop.nh + 'px';
            clampCrop(); paintCrop();
            document.getElementById('crop-zoom').value = 0;
            hideMsg('crop-error');
            openOverlay(document.getElementById('crop-modal'), teardownCropper);
            lucide.createIcons();
            resolve();
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image. Try a different photo.')); };
        img.src = url;
    });
}

// Runs whenever the crop overlay closes (Cancel, Use photo, or the phone's Back button)
function teardownCropper() {
    if (crop.url) URL.revokeObjectURL(crop.url);
    crop.url = null; crop.img = null; crop.drag = null; crop.pinch = null;
    document.getElementById('crop-img').removeAttribute('src');
}

// Pointer events cover mouse, touch and pen with one code path.
(function wireCropGestures() {
    const stage = document.getElementById('crop-stage');
    const pointers = new Map();
    const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    stage.addEventListener('pointerdown', (e) => {
        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 1) {
            crop.drag = { sx: e.clientX, sy: e.clientY, ox: crop.offX, oy: crop.offY };
            crop.pinch = null;
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            crop.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: crop.scale };
            crop.drag = null;
        }
    });
    stage.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2 && crop.pinch) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            zoomAt(crop.pinch.scale * (d / crop.pinch.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
        } else if (crop.drag) {
            crop.offX = crop.drag.ox + (e.clientX - crop.drag.sx);
            crop.offY = crop.drag.oy + (e.clientY - crop.drag.sy);
            clampCrop(); paintCrop();
        }
    });
    const end = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) crop.pinch = null;
        if (pointers.size === 1) { // continue as a drag from the remaining finger
            const [p] = [...pointers.values()];
            const r = stage.getBoundingClientRect();
            crop.drag = { sx: p.x + r.left, sy: p.y + r.top, ox: crop.offX, oy: crop.offY };
        } else if (pointers.size === 0) crop.drag = null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = local(e);
        zoomAt(crop.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y);
    }, { passive: false });

    document.getElementById('crop-zoom').addEventListener('input', (e) => {
        const t = Number(e.target.value) / 100;
        zoomAt(crop.minScale + (crop.maxScale - crop.minScale) * t, CROP_VIEW / 2, CROP_VIEW / 2);
    });
})();

// Render exactly the region inside the circle to a 256x256 JPEG. Re-encoding
// through a canvas also strips EXIF data (GPS location, camera info).
function renderCropBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#252525';
    ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    ctx.imageSmoothingQuality = 'high';
    // Visible square in SOURCE-image pixels
    const sx = -crop.offX / crop.scale;
    const sy = -crop.offY / crop.scale;
    const side = CROP_VIEW / crop.scale;
    ctx.drawImage(crop.img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process that image.'))), 'image/jpeg', 0.85));
}

async function confirmCrop() {
    hideMsg('crop-error');
    const saveBtn = document.getElementById('crop-save');
    const cancelBtn = document.getElementById('crop-cancel');
    saveBtn.disabled = cancelBtn.disabled = true;
    saveBtn.textContent = 'Uploading...';
    try {
        const blob = await renderCropBlob();
        const res = await fetch('/api/auth/avatar', {
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + token },
            body: blob,
        });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (res.status === 401) { sessionExpired(); return; }
        if (!res.ok) throw new Error(data.message || `Upload failed (status ${res.status})`);

        renderUser(data.user);
        saveLocalUser(data.user);
        dismissOverlay();
        refreshPzPreview();
        setPhotoStatus('Profile picture updated.', 'ok');
    } catch (err) {
        // Keep the cropper open so the user doesn't lose their framing
        showMsg('crop-error', err.message, 'error');
    } finally {
        saveBtn.disabled = cancelBtn.disabled = false;
        saveBtn.textContent = 'Use photo';
    }
}


async function onPhotoChosen(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = ''; // lets the user pick the same file again later
    if (!file) return;

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        return setPhotoStatus('Please choose a JPG, PNG or WebP image.', 'error');
    }
    if (file.size > MAX_SOURCE_BYTES) {
        return setPhotoStatus('That photo is too large (max 10 MB).', 'error');
    }
    try {
        await openCropper(file);
    } catch (err) {
        setPhotoStatus(err.message, 'error');
    }
}

async function removePhoto() {
    const btn = document.getElementById('pz-remove-btn');
    btn.disabled = true;
    setPhotoStatus('Removing...', 'info');
    try {
        const data = await authedFetch('/api/auth/avatar', { method: 'DELETE' });
        renderUser(data.user);
        saveLocalUser(data.user);
        refreshPzPreview();
        setPhotoStatus('Photo removed.', 'ok');
    } catch (err) {
        setPhotoStatus(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}


async function savePersonalize() {
    hideMsg('pz-error');
    const displayName = $('pz-displayname').value.trim();
    if (!displayName) return showMsg('pz-error', 'Display name cannot be empty.', 'error');

    setBusy('pz-save-btn', true, 'Save name', 'Saving...');
    try {
        const data = await authedFetch('/api/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify({ displayName }),
        });
        renderUser(data.user);
        saveLocalUser(data.user);
        showMsg('pz-error', 'Name saved.', 'ok');
    } catch (err) {
        showMsg('pz-error', err.message, 'error');
    } finally {
        setBusy('pz-save-btn', false, 'Save name', 'Saving...');
    }
}


// ── About you (bio, location, links) ─────────────────────────
const SOCIAL_FIELDS = [
    ['instagram', 'Instagram', 'username'], ['x', 'X', 'username'], ['github', 'GitHub', 'username'],
    ['youtube', 'YouTube', 'handle'], ['twitch', 'Twitch', 'username'], ['discord', 'Discord', 'username'],
    ['website', 'Website', 'yoursite.com'],
];
const SOCIAL_FIELD_MAP = Object.fromEntries(SOCIAL_FIELDS.map((f) => [f[0], f]));

// Working list of links while the About panel is open: [{ key, value }].
// Kept separate from currentUser so unsaved edits don't leak elsewhere.
let abLinks = [];

function buildAboutHTML() {
    const links = currentUser.socialLinks || {};
    abLinks = SOCIAL_FIELDS.filter(([k]) => links[k]).map(([k]) => ({ key: k, value: links[k] }));
    return `
    <div class="bg-card-bg border border-border-color rounded-2xl p-4 mb-4">
        <div class="text-sm font-semibold mb-1">About you</div>
        <p class="text-xs text-text-secondary mb-4">Shown on your public profile. Everything here is optional.</p>

        <label class="text-xs text-text-secondary block mb-1">Bio</label>
        <textarea id="ab-bio" rows="3" maxlength="160" class="field w-full rounded-lg px-3 py-2.5 text-sm resize-none" placeholder="Tell people a bit about yourself">${escapeHtml(currentUser.bio || '')}</textarea>
        <p id="ab-count" class="text-[11px] text-text-muted text-right mt-1 mb-3"></p>

        <label class="text-xs text-text-secondary block mb-1">Location</label>
        <input id="ab-location" maxlength="30" class="field w-full rounded-lg px-3 py-2.5 text-sm mb-4" placeholder="City, country" value="${escapeHtml(currentUser.location || '')}">

        <div class="text-xs text-text-secondary mb-2">Links</div>
        <div id="ab-links-list" class="flex flex-col gap-2 mb-3"></div>

        <div class="flex items-center gap-2 mb-3">
            <select id="ab-add-platform" class="field rounded-lg pl-3 pr-8 py-2 text-sm w-28 shrink-0"></select>
            <input id="ab-add-value" maxlength="100" autocomplete="off" autocapitalize="none" spellcheck="false"
                class="field flex-1 min-w-0 rounded-lg px-3 py-2 text-sm" placeholder="username">
            <button type="button" onclick="addAboutLink()" id="ab-add-btn" aria-label="Add link"
                class="btn-press shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-pill-bg border border-border-color text-text-secondary hover:text-accent hover:border-accent/50 transition-colors duration-150">
                <i data-lucide="plus" class="w-4 h-4"></i>
            </button>
        </div>

        <div id="ab-error" class="hidden text-xs mb-3"></div>
        <button onclick="saveAbout()" id="ab-save-btn"
            class="btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(226,183,20,0.25)]">
            Save
        </button>
    </div>`;
}

// Redraws the added-link rows and the platform dropdown (only platforms not
// already added are offered, so the same one can't be added twice).
function renderAboutLinks() {
    const list = $('ab-links-list');
    if (!list) return;
    list.innerHTML = abLinks.length ? '' : '<p class="text-xs text-text-muted">No links added yet.</p>';
    abLinks.forEach(({ key, value }, i) => {
        const [, label] = SOCIAL_FIELD_MAP[key];
        const row = h('div', { class: 'flex items-center gap-2' },
            h('span', { class: 'w-20 shrink-0 text-xs text-text-secondary truncate' }, label),
            h('span', { class: 'field flex-1 min-w-0 rounded-lg px-3 py-2 text-sm truncate' }, value),
            h('button', { type: 'button', 'aria-label': 'Remove ' + label, onclick: () => removeAboutLink(i),
                class: 'btn-press shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary hover:text-red-400 transition-colors duration-150' },
                h('i', { 'data-lucide': 'x', class: 'w-4 h-4' })));
        list.append(row);
    });

    const remaining = SOCIAL_FIELDS.filter(([k]) => !abLinks.some((l) => l.key === k));
    const sel = $('ab-add-platform');
    const addRow = sel ? sel.closest('.flex') : null;
    sel.innerHTML = remaining.map(([k, label]) => `<option value="${k}">${label}</option>`).join('');
    if (addRow) addRow.classList.toggle('hidden', !remaining.length);
    const val = $('ab-add-value');
    const updatePh = () => { val.placeholder = sel.value ? (SOCIAL_FIELD_MAP[sel.value][2]) : ''; };
    sel.onchange = updatePh;
    updatePh();
    icons();
}

function addAboutLink() {
    hideMsg('ab-error');
    const sel = $('ab-add-platform');
    const val = $('ab-add-value');
    const key = sel.value;
    const value = val.value.trim();
    if (!key) return;
    if (!value) return showMsg('ab-error', 'Enter a username or link first.', 'error');
    abLinks.push({ key, value });
    val.value = '';
    renderAboutLinks();
}

function removeAboutLink(i) {
    abLinks.splice(i, 1);
    renderAboutLinks();
}

function wireAbout() {
    const bio = $('ab-bio');
    if (!bio) return;
    const upd = () => { $('ab-count').textContent = bio.value.length + ' / 160'; };
    bio.addEventListener('input', upd);
    upd();
    renderAboutLinks();
}
async function saveAbout() {
    hideMsg('ab-error');
    // Send every known key: '' clears a link that was removed from the list.
    const socialLinks = {};
    SOCIAL_FIELDS.forEach(([k]) => { socialLinks[k] = ''; });
    abLinks.forEach(({ key, value }) => { socialLinks[key] = value; });
    setBusy('ab-save-btn', true, 'Save', 'Saving...');
    try {
        const data = await authedFetch('/api/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify({ bio: $('ab-bio').value, location: $('ab-location').value, socialLinks }),
        });
        renderUser(data.user);
        saveLocalUser(data.user);
        // show what the server actually kept (e.g. a pasted link reduced to a username)
        const kept = data.user.socialLinks || {};
        abLinks = SOCIAL_FIELDS.filter(([k]) => kept[k]).map(([k]) => ({ key: k, value: kept[k] }));
        $('ab-bio').value = data.user.bio || '';
        wireAbout();
        showMsg('ab-error', 'Saved.', 'ok');
    } catch (err) {
        showMsg('ab-error', err.message, 'error');
    } finally {
        setBusy('ab-save-btn', false, 'Save', 'Saving...');
    }
}

// ── Username change (card inside Personalize) ────────────────
// No password field here: it is asked in a pop-up when you tap Update.
let unSeq = 0;

function buildUsernameHTML() {
    unSeq = 0;
    return `
    <div class="bg-card-bg border border-border-color rounded-2xl p-4 mb-4">
        <div class="text-sm font-semibold mb-1">Change username</div>
        <p class="text-xs text-text-secondary mb-4">Current: <span class="text-text-primary font-semibold">@${escapeHtml(currentUser.username)}</span>. You can change it once every 14 days.</p>

        <label class="text-xs text-text-secondary block mb-1">New username</label>
        <input id="un-new" maxlength="20" autocomplete="off" autocapitalize="none" spellcheck="false" oninput="onUsernameInput()"
            class="field w-full rounded-lg px-3 py-2.5 text-sm">
        <p id="un-status" class="text-[11px] mt-1.5 mb-3 min-h-[16px] text-text-muted">3-20 letters, numbers or underscores.</p>

        <div id="un-error" class="hidden text-xs mb-3"></div>
        <button onclick="saveUsername()" id="un-save-btn"
            class="btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(226,183,20,0.25)]">
            Update username
        </button>
    </div>`;
}

function setUnStatus(kind, msg) {
    const el = $('un-status');
    const input = $('un-new');
    if (!el || !input) return;
    const colors = { idle: 'text-text-muted', checking: 'text-text-secondary', ok: 'text-online', bad: 'text-red-400' };
    el.className = 'text-[11px] mt-1.5 mb-3 min-h-[16px] ' + colors[kind];
    el.textContent = msg;
    input.classList.toggle('bad', kind === 'bad');
    input.classList.toggle('good', kind === 'ok');
}

const checkUsernameLive = debounce(async (value, seq) => {
    try {
        const res = await fetch('/api/auth/check-availability?' + new URLSearchParams({ username: value }));
        if (res.status === 429) { if (seq === unSeq) setUnStatus('idle', 'Checking paused — you can still submit.'); return; }
        const data = await res.json();
        if (seq !== unSeq) return; // stale reply for older text
        const r = data.username;
        if (!r) return setUnStatus('idle', '');
        setUnStatus(r.available ? 'ok' : 'bad', r.message);
    } catch (_) {
        if (seq === unSeq) setUnStatus('idle', '');
    }
}, 400);

function onUsernameInput() {
    const value = $('un-new').value.trim();
    const seq = ++unSeq;
    if (!value) return setUnStatus('idle', '3-20 letters, numbers or underscores.');
    if (value === currentUser.username) return setUnStatus('bad', 'That is already your username.');
    if (!USERNAME_RE.test(value)) {
        return value.length < 3
            ? setUnStatus('idle', 'Keep typing — at least 3 characters.')
            : setUnStatus('bad', 'Only letters, numbers and underscores (3-20 characters).');
    }
    // Changing only the letter case of your own name is always fine and needs no check.
    if (value.toLowerCase() === currentUser.username.toLowerCase()) return setUnStatus('ok', 'Only the capitalization changes.');
    setUnStatus('checking', 'Checking...');
    checkUsernameLive(value, seq);
}

async function saveUsername() {
    hideMsg('un-error');
    const newUsername = $('un-new').value.trim();
    if (!USERNAME_RE.test(newUsername)) return showMsg('un-error', 'Enter a valid new username first.', 'error');
    if (newUsername === currentUser.username) return showMsg('un-error', 'That is already your username.', 'error');

    try {
        const data = await askPassword({
            title: 'Confirm username change',
            desc: `Enter your password to change your username to @${newUsername}.`,
            confirmLabel: 'Update username',
            run: (password) => authedFetch('/api/auth/username', {
                method: 'PATCH',
                body: JSON.stringify({ newUsername, password }),
            }),
        });
        if (!data || !data.user) return; // cancelled
        renderUser(data.user);
        saveLocalUser(data.user);
        rerenderAccountSub('un-error', 'Username updated.');
    } catch (err) {
        // Only a "taken" rejection (409) says something is wrong with the NAME.
        // A cooldown (429) says nothing about the name, so only the message changes.
        if (err.status === 409) setUnStatus('bad', err.message);
        showMsg('un-error', err.message, 'error');
    }
}

// ── Login & security: email + password ───────────────────────
let emSeq = 0;

function buildAccountHTML() {
    emSeq = 0;
    return `
    <div class="bg-card-bg border border-border-color rounded-2xl p-4 mb-4">
        <div class="text-sm font-semibold mb-1">Email</div>
        <p class="text-xs text-text-secondary mb-3">Current: <span id="acct-email" class="text-text-primary font-semibold break-all"></span></p>

        <label class="text-xs text-text-secondary block mb-1">New email</label>
        <input id="em-new" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" oninput="onEmailInput()"
            class="field w-full rounded-lg px-3 py-2.5 text-sm">
        <p id="em-status" class="text-[11px] mt-1.5 mb-3 min-h-[16px] text-text-muted"></p>

        <div id="em-error" class="hidden text-xs mb-3"></div>
        <button onclick="saveEmail()" id="em-save-btn"
            class="btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(226,183,20,0.25)]">
            Update email
        </button>
    </div>

    <div class="bg-card-bg border border-border-color rounded-2xl p-4 mb-4">
        <div class="text-sm font-semibold mb-3">Change password</div>
        <label class="text-xs text-text-secondary block mb-1">New password</label>
        <input id="pw-new" type="password" autocomplete="new-password" placeholder="Min 6 characters" class="field w-full rounded-lg px-3 py-2.5 text-sm mb-3">
        <label class="text-xs text-text-secondary block mb-1">Confirm new password</label>
        <input id="pw-confirm" type="password" autocomplete="new-password" class="field w-full rounded-lg px-3 py-2.5 text-sm mb-3">
        <div id="pw-error" class="hidden text-xs mb-3"></div>
        <button onclick="savePassword()" id="pw-save-btn"
            class="btn-press w-full bg-accent text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(226,183,20,0.25)]">
            Update password
        </button>
    </div>`;
}

function fillAccountEmail() {
    const el = $('acct-email');
    if (el && currentUser && currentUser.email) el.textContent = currentUser.email;
}

function setEmStatus(kind, msg) {
    const el = $('em-status');
    const input = $('em-new');
    if (!el || !input) return;
    const colors = { idle: 'text-text-muted', checking: 'text-text-secondary', ok: 'text-online', bad: 'text-red-400' };
    el.className = 'text-[11px] mt-1.5 mb-3 min-h-[16px] ' + colors[kind];
    el.textContent = msg;
    input.classList.toggle('bad', kind === 'bad');
    input.classList.toggle('good', kind === 'ok');
}

const checkEmailLive = debounce(async (value, seq) => {
    try {
        const res = await fetch('/api/auth/check-availability?' + new URLSearchParams({ email: value }));
        if (res.status === 429) { if (seq === emSeq) setEmStatus('idle', 'Checking paused — you can still submit.'); return; }
        const data = await res.json();
        if (seq !== emSeq) return;
        const r = data.email;
        if (!r) return setEmStatus('idle', '');
        setEmStatus(r.available ? 'ok' : 'bad', r.message);
    } catch (_) {
        if (seq === emSeq) setEmStatus('idle', '');
    }
}, 400);

function onEmailInput() {
    const value = $('em-new').value.trim();
    const seq = ++emSeq;
    if (!value) return setEmStatus('idle', '');
    if (currentUser.email && value.toLowerCase() === currentUser.email.toLowerCase()) return setEmStatus('bad', 'That is already your email.');
    if (!EMAIL_RE.test(value)) return setEmStatus('idle', '');
    setEmStatus('checking', 'Checking...');
    checkEmailLive(value, seq);
}

async function saveEmail() {
    hideMsg('em-error');
    const newEmail = $('em-new').value.trim();
    if (!EMAIL_RE.test(newEmail)) return showMsg('em-error', 'Enter a valid email address.', 'error');

    try {
        const data = await askPassword({
            title: 'Confirm email change',
            desc: `Enter your password to change your email to ${newEmail}.`,
            confirmLabel: 'Update email',
            run: (password) => authedFetch('/api/auth/email', {
                method: 'PATCH',
                body: JSON.stringify({ newEmail, password }),
            }),
        });
        if (!data || !data.user) return; // cancelled
        renderUser(data.user);
        currentUser = data.user; // keep the email in memory only, for this page
        saveLocalUser(data.user);
        rerenderAccountSub('em-error', 'Email updated.');
    } catch (err) {
        if (err.status === 409) setEmStatus('bad', err.message);
        showMsg('em-error', err.message, 'error');
    }
}

async function savePassword() {
    hideMsg('pw-error');
    const next = $('pw-new').value;
    const confirm = $('pw-confirm').value;

    if (!next || !confirm) return showMsg('pw-error', 'Fill in both fields.', 'error');
    if (next.length < 6) return showMsg('pw-error', 'New password must be at least 6 characters.', 'error');
    if (next !== confirm) return showMsg('pw-error', "New password and confirmation don't match.", 'error');

    try {
        const data = await askPassword({
            title: 'Confirm password change',
            desc: 'Enter your current password to set the new one. Your other devices will be signed out.',
            confirmLabel: 'Update password',
            run: (current) => authedFetch('/api/auth/password', {
                method: 'PATCH',
                body: JSON.stringify({ currentPassword: current, newPassword: next }),
            }),
        });
        if (!data) return; // cancelled
        // Every other device was just signed out; this one gets a fresh token.
        if (data.token) {
            token = data.token;
            localStorage.setItem('minduel_token', data.token);
        }
        if ($('pw-new')) { $('pw-new').value = ''; $('pw-confirm').value = ''; }
        showMsg('pw-error', 'Password updated. Other devices have been signed out.', 'ok');
    } catch (err) {
        showMsg('pw-error', err.message, 'error');
    }
}

// ── Start ────────────────────────────────────────────────────
(async function init() {
    try {
        const data = await authedFetch('/api/auth/me');
        renderUser(data.user);
        saveLocalUser(data.user);
        // Tag the current entry as ours (keeps any earlier in-app entries usable after a reload)
        history.replaceState({ r: (history.state && history.state.r) || 0, ov: 0 }, '', location.hash || '#/home');
        $('splash').classList.add('hidden');
        render(true);
        refreshFriends();
        refreshDMs();
        initSocket();
        icons();
    } catch (err) {
        console.error(err);
        $('splash').textContent = '';
        $('splash').append(h('div', { class: 'text-center px-8' },
            h('p', { class: 'text-sm text-text-secondary mb-4' }, err.message || 'Something went wrong.'),
            h('button', { class: 'btn-press bg-accent text-app-bg font-bold text-sm px-6 py-3 rounded-xl', onclick: () => location.reload() }, 'Try again')));
    }
})();
