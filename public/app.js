// ─────────────────────────────────────────────────────────────
// Minduel app shell: one page, five bottom-nav tabs, in-app back button.
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
        h('span', { class: 'online-dot ' + (online ? 'bg-accent-green' : 'bg-[#555]') }));
}

// Discord-style staff badge. Everything in here is a fixed string, never user text.
const BADGE_ICONS = {
    admin: '<path d="M3 18h18M4 18 3 7l5 4 4-7 4 7 5-4-1 11"/>',
    moderator: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/>',
};
const BADGES = {
    admin: { label: 'Admin', title: 'Administrator', cls: 'text-amber-300 bg-amber-300/10 border-amber-300/30' },
    moderator: { label: 'Mod', title: 'Moderator', cls: 'text-sky-300 bg-sky-300/10 border-sky-300/30' },
};
function badgeEl(badge) {
    const b = BADGES[badge];
    if (!b) return null;
    return h('span', {
        class: `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide shrink-0 ${b.cls}`,
        title: b.title,
        html: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${BADGE_ICONS[badge]}</svg>${b.label}`,
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
    el.className = 'text-xs mb-3 ' + (kind === 'ok' ? 'text-accent-green' : 'text-red-400');
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
    const want = (e.state && e.state.ov) || 0;
    while (overlays.length > want) closeTopOverlay();
    render();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissOverlay(); });

function isStaff() { return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'moderator'); }

function render(force) {
    if (!currentUser) return;
    if (!force && location.hash === renderedHash) return; // e.g. a modal closing: page underneath stays as it is
    renderedHash = location.hash;

    let [tab, a, b] = currentRoute();
    if (!['home', 'leaderboard', 'staff', 'friends', 'account', 'u'].includes(tab)) tab = 'home';
    if (tab === 'staff' && !isStaff()) tab = 'home';
    if (tab === 'u' && !(a && /^[a-f\d]{24}$/i.test(a))) tab = 'friends';

    const view = tab === 'u' ? 'profile' : tab;
    ['home', 'leaderboard', 'staff', 'friends', 'account', 'profile'].forEach((v) =>
        $('view-' + v).classList.toggle('hidden', v !== view));

    if (tab !== 'u') lastTab = tab;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.tab === lastTab));
    scrollTo0();

    if (tab === 'home') renderHome();
    else if (tab === 'leaderboard') loadLeaderboard();
    else if (tab === 'staff') Staff.enter();
    else if (tab === 'friends') { renderFriends(); refreshFriends(); }
    else if (tab === 'account') renderAccount(a);
    else if (tab === 'u') loadPlayer(a);
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
setInterval(() => { if (!document.hidden && currentUser) refreshFriends(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentUser) refreshFriends(); });

const presenceText = (u) => (u.online ? 'Online' : u.lastSeenAt ? 'Last seen ' + ago(u.lastSeenAt) : 'Offline');

// ── Home ─────────────────────────────────────────────────────
function renderHome() { renderHomeFriends(); }
function renderHomeFriends() {
    const box = $('home-friends');
    if (!friendsData) { box.classList.add('hidden'); return; }
    const online = friendsData.friends.filter((f) => f.online);
    const req = friendsData.incoming.length;
    if (!online.length && !req) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.textContent = '';
    box.append(h('button', {
        class: 'btn-press w-full text-left bg-card-bg border border-border-color rounded-2xl px-4 py-3 hover:border-accent-green/50 transition-colors duration-150',
        onclick: () => go('friends'),
    },
        h('div', { class: 'flex items-center justify-between mb-2' },
            h('span', { class: 'text-sm font-semibold' }, online.length ? `${online.length} friend${online.length === 1 ? '' : 's'} online` : 'Friends'),
            req ? h('span', { class: 'text-[11px] font-bold text-app-bg bg-accent-green rounded-full px-2 py-0.5' }, `${req} request${req === 1 ? '' : 's'}`) : null),
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
            h('div', { class: 'text-xl font-bold text-accent-green' }, String(data.me.rating))));

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
                (mine ? 'border-accent-green/50' : 'border-border-color hover:border-accent-green/50'),
            onclick: () => go('u/' + p._id),
        },
            h('span', { class: 'w-7 text-center text-sm font-bold shrink-0 ' + (medal[p.rank] || 'text-text-secondary') }, String(p.rank)),
            avatarEl(p, 'w-10 h-10', 'text-sm'),
            h('span', { class: 'flex-1 min-w-0' },
                h('span', { class: 'flex items-center gap-2 min-w-0' },
                    h('span', { class: 'text-sm font-semibold truncate' }, p.displayName || p.username), badgeEl(p.badge),
                    mine ? h('span', { class: 'text-[10px] font-bold text-accent-green shrink-0' }, 'YOU') : null),
                h('span', { class: 'block text-xs text-text-secondary truncate' }, '@' + p.username)),
            h('span', { class: 'text-sm font-bold text-accent-green shrink-0' }, String(p.rating))));
    });
}

// ── Friends tab ──────────────────────────────────────────────
function friendRow(u, sub, right, onclick) {
    return h(onclick ? 'button' : 'div', {
        class: 'w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3 text-left ' +
            (onclick ? 'btn-press hover:border-accent-green/50 transition-colors duration-150' : ''),
        onclick,
    },
        avatarEl(u, 'w-10 h-10', 'text-sm', u.online === undefined ? undefined : u.online),
        h('span', { class: 'flex-1 min-w-0' },
            h('span', { class: 'flex items-center gap-2 min-w-0' },
                h('span', { class: 'text-sm font-semibold truncate' }, u.displayName || u.username), badgeEl(u.badge)),
            h('span', { class: 'block text-xs truncate ' + (u.online ? 'text-accent-green' : 'text-text-secondary') }, sub)),
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
                smallBtn('Accept', 'bg-accent-green text-app-bg', () => friendAction('POST', `/api/friends/requests/${r.requestId}/accept`)),
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
        friends.forEach((f) => wrap.append(friendRow(f, presenceText(f), h('i', { 'data-lucide': 'chevron-right', class: 'w-4 h-4 text-text-secondary shrink-0' }), () => go('u/' + f._id))));
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
    el.className = 'text-xs mt-2 ' + (ok ? 'text-accent-green' : 'text-red-400');
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
        h('div', { class: 'text-lg font-bold truncate ' + (accent ? 'text-accent-green' : '') }, String(value)));
}
function renderPlayer(u) {
    const body = $('player-body');
    body.textContent = '';
    const shows = u.relation === 'friend' || u.relation === 'self';
    const name = u.displayName || u.username;

    body.append(h('div', { class: 'flex flex-col items-center text-center mb-6' },
        avatarEl(u, 'w-24 h-24', 'text-3xl', shows ? u.online : undefined),
        h('div', { class: 'flex items-center justify-center gap-2 mt-4 min-w-0 max-w-full' },
            h('div', { class: 'text-xl font-bold truncate' }, name), badgeEl(u.badge)),
        h('div', { class: 'text-sm text-text-secondary' }, '@' + u.username),
        shows ? h('div', { class: 'text-xs mt-2 font-semibold ' + (u.online ? 'text-accent-green' : 'text-text-muted') }, presenceText(u)) : null));

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
        const b = h('button', { class: big + 'bg-accent-green text-app-bg shadow-[0_0_15px_rgba(163,230,53,0.25)]' }, 'Add friend');
        b.addEventListener('click', () => run(b, 'POST', '/api/friends/request', { userId: u._id }));
        body.append(b);
    } else if (u.relation === 'outgoing') {
        const b = h('button', { class: big + 'bg-pill-bg border border-border-color text-text-secondary' }, 'Request sent · Cancel');
        b.addEventListener('click', () => run(b, 'DELETE', `/api/friends/requests/${u.requestId}`));
        body.append(b);
    } else if (u.relation === 'incoming') {
        const acc = h('button', { class: big + 'bg-accent-green text-app-bg mb-2' }, 'Accept request');
        acc.addEventListener('click', () => run(acc, 'POST', `/api/friends/requests/${u.requestId}/accept`));
        const dec = h('button', { class: big + 'bg-pill-bg border border-border-color text-text-secondary' }, 'Decline');
        dec.addEventListener('click', () => run(dec, 'DELETE', `/api/friends/requests/${u.requestId}`));
        body.append(acc, dec);
    } else if (u.relation === 'friend') {
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
    fb.className = 'text-xs font-semibold ' + (copied ? 'text-accent-green' : 'text-red-400');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => fb.classList.add('hidden'), 1500);
}

const CATEGORIES = [
    { id: 'personalize', icon: 'palette', label: 'Personalize', desc: 'Photo, display name & username' },
    { id: 'security', icon: 'lock', label: 'Login & security', desc: 'Email & password' },
];

function renderProfileMenu() {
    $('profile-menu').innerHTML = CATEGORIES.map(c => `
        <button onclick="go('account/${c.id}')" class="btn-press w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3.5 text-left hover:border-accent-green/50 transition-colors duration-150">
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
        if (sub === 'personalize') { body.innerHTML = buildPersonalizeHTML(); refreshPzPreview(); }
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
                    class="btn-press text-sm font-semibold bg-pill-bg border border-border-color hover:border-accent-green/50 rounded-lg px-4 py-2 transition-colors duration-150">
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
            class="btn-press w-full bg-accent-green text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(163,230,53,0.25)]">
            Save name
        </button>
    </div>

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
        (kind === 'error' ? 'text-red-400' : kind === 'ok' ? 'text-accent-green' : 'text-text-secondary');
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
            class="btn-press w-full bg-accent-green text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(163,230,53,0.25)]">
            Update username
        </button>
    </div>`;
}

function setUnStatus(kind, msg) {
    const el = $('un-status');
    const input = $('un-new');
    if (!el || !input) return;
    const colors = { idle: 'text-text-muted', checking: 'text-text-secondary', ok: 'text-accent-green', bad: 'text-red-400' };
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
            class="btn-press w-full bg-accent-green text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(163,230,53,0.25)]">
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
            class="btn-press w-full bg-accent-green text-app-bg font-bold text-sm py-3 rounded-xl shadow-[0_0_15px_rgba(163,230,53,0.25)]">
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
    const colors = { idle: 'text-text-muted', checking: 'text-text-secondary', ok: 'text-accent-green', bad: 'text-red-400' };
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
        icons();
    } catch (err) {
        console.error(err);
        $('splash').textContent = '';
        $('splash').append(h('div', { class: 'text-center px-8' },
            h('p', { class: 'text-sm text-text-secondary mb-4' }, err.message || 'Something went wrong.'),
            h('button', { class: 'btn-press bg-accent-green text-app-bg font-bold text-sm px-6 py-3 rounded-xl', onclick: () => location.reload() }, 'Try again')));
    }
})();
