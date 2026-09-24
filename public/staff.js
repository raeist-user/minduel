// Staff panel (moderators / admins), rendered inside the Staff tab of home.html.
// Relies on the shared helpers in app.js (h, authedFetch, badgeEl, avatarEl, armButton, overlays...).
window.Staff = (function () {

    const state = { q: '', filter: 'all', page: 1, pages: 1, total: 0, users: [], seq: 0 };
    let openId = null;
    let started = false;

    // Called by the router each time the Staff tab is shown.
    function enter() {
        if (!isStaff()) return;
        const isAdmin = currentUser.role === 'admin';
        $('panel-title').textContent = isAdmin ? 'Admin panel' : 'Moderation';
        const slot = $('me-badge');
        slot.textContent = '';
        const b = badgeEl(currentUser.badge);
        if (b) slot.append(b);
        $('panel-sub').textContent = isAdmin
            ? 'Search accounts, ban or suspend players, and choose moderators.'
            : 'Search players, and suspend or ban those who break the rules.';
        $('staff-tabs').classList.toggle('hidden', !isAdmin);
        if (!started) {
            started = true;
            wire();
            renderChips();
            switchTab('accounts');
            loadUsers(true);
        }
    }

    function wire() {
        $('tab-btn-accounts').addEventListener('click', () => switchTab('accounts'));
        $('tab-btn-activity').addEventListener('click', () => switchTab('activity'));
        $('more-btn').addEventListener('click', loadMore);
        $('search').addEventListener('input', debounce((e) => {
            state.q = e.target.value.trim();
            loadUsers(true);
        }, 300));
    }

    // Same rank rule as the server (which is what actually enforces it).
    const RANK = { player: 1, moderator: 2, admin: 3 };
    const canModerate = (actor, target) => RANK[actor] >= 2 && RANK[actor] > RANK[target];

    function statusPill(u) {
        if (u.status === 'banned') return h('span', { class: 'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border text-red-400 bg-red-400/10 border-red-400/30 shrink-0' }, 'Banned');
        if (u.status === 'suspended') return h('span', { class: 'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border text-orange-300 bg-orange-300/10 border-orange-300/30 shrink-0' }, 'Suspended');
        return null;
    }


    function switchTab(name) {
        const isAdmin = currentUser && currentUser.role === 'admin';
        if (name === 'activity' && !isAdmin) name = 'accounts';
        $('tab-accounts').classList.toggle('hidden', name !== 'accounts');
        $('tab-activity').classList.toggle('hidden', name !== 'activity');
        const on = 'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 bg-[#333] text-accent';
        const off = 'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 text-text-secondary hover:text-text-primary';
        $('tab-btn-accounts').className = name === 'accounts' ? on : off;
        $('tab-btn-activity').className = name === 'activity' ? on : off;
        if (name === 'activity') loadLog();
    }

    // ── Accounts: search + list ──────────────────────────────
    const FILTERS = [['all', 'All'], ['staff', 'Staff'], ['suspended', 'Suspended'], ['banned', 'Banned']];
    function renderChips() {
        const box = $('chips');
        box.textContent = '';
        FILTERS.forEach(([id, label]) => {
            const active = state.filter === id;
            box.append(h('button', {
                class: 'btn-press shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-150 ' +
                    (active ? 'bg-accent text-app-bg border-accent' : 'bg-pill-bg text-text-secondary border-border-color hover:border-white/30'),
                onclick: () => { state.filter = id; renderChips(); loadUsers(true); },
            }, label));
        });
    }

    
    async function loadUsers(reset) {
        const seq = ++state.seq;
        if (reset) { state.page = 1; state.users = []; }
        else state.page += 1;
        $('list-msg').classList.add('hidden');
        if (reset) { $('list').textContent = ''; $('count').textContent = 'Searching...'; $('more-btn').classList.add('hidden'); }
        try {
            const qs = new URLSearchParams({ q: state.q, filter: state.filter, page: String(state.page) });
            const data = await authedFetch('/api/admin/users?' + qs);
            if (seq !== state.seq) return; // a newer search superseded this one
            state.users = reset ? data.users : state.users.concat(data.users);
            state.pages = data.pages;
            state.total = data.total;
            renderList();
        } catch (err) {
            if (seq !== state.seq) return;
            $('count').textContent = '';
            $('list-msg').textContent = err.message;
            $('list-msg').classList.remove('hidden');
        }
    }
    function loadMore() { if (state.page < state.pages) loadUsers(false); }

    function renderList() {
        const list = $('list');
        list.textContent = '';
        $('count').textContent = state.total === 1 ? '1 account' : `${state.total} accounts`;
        if (!state.users.length) {
            $('list-msg').textContent = 'No accounts match.';
            $('list-msg').classList.remove('hidden');
        } else {
            $('list-msg').classList.add('hidden');
        }
        state.users.forEach((u) => list.append(userRow(u)));
        $('more-btn').classList.toggle('hidden', state.page >= state.pages);
    }

    function userRow(u) {
        return h('button', {
            class: 'btn-press w-full flex items-center gap-3 bg-card-bg border border-border-color rounded-2xl px-4 py-3 text-left hover:border-accent/50 transition-colors duration-150',
            onclick: () => openSheet(u._id),
        },
            avatarEl(u, 'w-10 h-10', 'text-sm'),
            h('span', { class: 'flex-1 min-w-0' },
                h('span', { class: 'flex items-center gap-2 min-w-0' },
                    h('span', { class: 'text-sm font-semibold truncate' }, u.displayName || u.username),
                    badgeEl(u.badge), statusPill(u)),
                h('span', { class: 'block text-xs text-text-secondary truncate' }, '@' + u.username + (u.email ? '  ·  ' + u.email : ''))),
            h('span', { class: 'text-xs font-semibold text-accent shrink-0' }, u.rating + ' pts'));
    }

    // ── Account sheet ────────────────────────────────────────
    async function openSheet(id) {
        openId = id;
        if (!overlays.some((o) => o.el === $('sheet'))) openOverlay($('sheet'), () => { openId = null; });
        $('sheet-body').textContent = '';
        $('sheet-body').append(h('div', { class: 'text-sm text-text-secondary py-8 text-center' }, 'Loading...'));
        try {
            const data = await authedFetch('/api/admin/users/' + encodeURIComponent(id));
            if (openId !== id) return;
            renderSheet(data.user, data.history);
        } catch (err) {
            if (openId !== id) return;
            $('sheet-body').textContent = '';
            $('sheet-body').append(h('div', { class: 'text-sm text-red-400 py-8 text-center' }, err.message),
                h('button', { class: 'btn-press w-full py-3 rounded-xl text-sm font-semibold bg-pill-bg border border-border-color', onclick: dismissOverlay }, 'Close'));
        }
    }

    function updateInList(user) {
        const i = state.users.findIndex((u) => u._id === user._id);
        if (i !== -1) { state.users[i] = user; renderList(); }
    }

    const ACTION_TEXT = {
        ban: 'banned', suspend: 'suspended', unban: 'lifted the ban on', unsuspend: 'lifted the suspension on',
        promote: 'made moderator', demote: 'removed moderator from',
    };

    function historyEl(history) {
        if (!history.length) return h('div', { class: 'text-xs text-text-muted' }, 'No moderation history.');
        return h('div', { class: 'flex flex-col gap-2' }, history.map((e) => h('div', { class: 'text-xs text-text-secondary' },
            h('span', { class: 'text-text-primary font-semibold' }, e.actorName), ' ', ACTION_TEXT[e.action] || e.action,
            e.until ? ' until ' + fmtDate(e.until) : '',
            e.reason ? h('span', { class: 'block text-text-muted' }, '“' + e.reason + '”') : null,
            h('span', { class: 'block text-text-muted' }, ago(e.createdAt)))));
    }

    function renderSheet(u, history) {
        const body = $('sheet-body');
        body.textContent = '';
        const isAdmin = currentUser.role === 'admin';
        const canAct = canModerate(currentUser.role, u.role) && u._id !== currentUser._id;

        body.append(
            h('div', { class: 'flex items-center gap-4 mb-4' },
                avatarEl(u, 'w-14 h-14', 'text-lg'),
                h('div', { class: 'min-w-0 flex-1' },
                    h('div', { class: 'flex items-center gap-2 min-w-0' },
                        h('div', { class: 'text-lg font-bold truncate' }, u.displayName || u.username), badgeEl(u.badge)),
                    h('div', { class: 'text-xs text-text-secondary truncate' }, '@' + u.username),
                    u.email ? h('div', { class: 'text-xs text-text-muted truncate' }, u.email) : null)),
            h('div', { class: 'grid grid-cols-3 gap-2 mb-4' },
                sTile('Rating', u.rating), sTile('Matches', u.matchesPlayed || 0), sTile('Joined', new Date(u.createdAt).toLocaleDateString([], { dateStyle: 'medium' }))));

        // Current restriction
        if (u.status !== 'active' && u.restriction) {
            const banned = u.status === 'banned';
            body.append(h('div', { class: 'rounded-xl border px-3 py-2.5 mb-4 text-xs ' + (banned ? 'border-red-400/30 bg-red-400/10 text-red-300' : 'border-orange-300/30 bg-orange-300/10 text-orange-200') },
                h('div', { class: 'font-bold mb-0.5' }, banned ? 'Banned' : 'Suspended until ' + fmtDate(u.restriction.until)),
                u.restriction.reason ? h('div', {}, 'Reason: ' + u.restriction.reason) : null));
        }

        const msg = h('div', { class: 'hidden text-xs mb-3' });
        const showMsg = (text, ok) => { msg.textContent = text; msg.className = 'text-xs mb-3 ' + (ok ? 'text-online' : 'text-red-400'); };

        const run = async (btn, url, options, okText) => {
            btn.disabled = true; btn.style.opacity = '.6';
            try {
                const data = await authedFetch(url, options);
                updateInList(data.user);
                if (openId === u._id) await openSheet(u._id); // re-render with fresh history
                return data;
            } catch (err) {
                showMsg(err.message, false);
                btn.disabled = false; btn.style.opacity = '';
            }
        };

        if (canAct) {
            const actions = h('div', { class: 'mb-4' });

            // Ban / suspend form (a banned account only offers "lift ban")
            if (u.status !== 'banned') {
                let mode = 'suspend';
                const reason = h('input', { type: 'text', maxlength: '200', placeholder: 'Reason (shown to the player)', class: 'field w-full rounded-lg px-3 py-2.5 text-sm mb-3' });
                const hours = h('select', { class: 'field w-full rounded-lg px-3 py-2.5 text-sm mb-3' },
                    [[1, '1 hour'], [24, '24 hours'], [72, '3 days'], [168, '7 days'], [720, '30 days']].map(([v, l]) => h('option', { value: String(v) }, l)));
                hours.value = '24';
                const segOn = 'flex-1 py-2 rounded-lg text-xs font-bold bg-[#333] ';
                const segOff = 'flex-1 py-2 rounded-lg text-xs font-semibold text-text-secondary hover:text-text-primary ';
                const bSus = h('button', { type: 'button' }, 'Suspend');
                const bBan = h('button', { type: 'button' }, 'Ban');
                const go = h('button', { class: 'btn-press w-full font-bold text-sm py-3 rounded-xl' }, 'Suspend player');
                const paint = () => {
                    bSus.className = (mode === 'suspend' ? segOn + 'text-orange-300' : segOff);
                    bBan.className = (mode === 'ban' ? segOn + 'text-red-400' : segOff);
                    hours.classList.toggle('hidden', mode !== 'suspend');
                    go.textContent = mode === 'suspend' ? 'Suspend player' : 'Ban player';
                    go.className = 'btn-press w-full font-bold text-sm py-3 rounded-xl ' + (mode === 'suspend' ? 'bg-orange-300 text-app-bg' : 'bg-red-400 text-app-bg');
                };
                bSus.addEventListener('click', () => { mode = 'suspend'; paint(); });
                bBan.addEventListener('click', () => { mode = 'ban'; paint(); });
                paint();
                armButton(go, 'Tap again to confirm', () => {
                    const r = reason.value.trim();
                    if (r.length < 3) return showMsg('Give a reason (at least 3 characters).', false);
                    if (mode === 'suspend') run(go, `/api/admin/users/${u._id}/suspend`, { method: 'POST', body: JSON.stringify({ hours: Number(hours.value), reason: r }) });
                    else run(go, `/api/admin/users/${u._id}/ban`, { method: 'POST', body: JSON.stringify({ reason: r }) });
                });
                actions.append(
                    h('div', { class: 'text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2' }, u.status === 'suspended' ? 'Change restriction' : 'Restrict account'),
                    h('div', { class: 'flex bg-input-bg border border-border-color rounded-xl p-1 gap-1 mb-3' }, bSus, bBan),
                    hours, reason, go);
            }

            if (u.status !== 'active') {
                const lift = h('button', { class: 'btn-press w-full font-bold text-sm py-3 rounded-xl bg-accent text-app-bg mt-3' },
                    u.status === 'banned' ? 'Lift ban' : 'Lift suspension');
                armButton(lift, 'Tap again to confirm', () => run(lift, `/api/admin/users/${u._id}/restore`, { method: 'POST', body: JSON.stringify({}) }));
                actions.append(lift);
            }
            body.append(actions, msg);
        } else {
            body.append(h('div', { class: 'text-xs text-text-muted mb-4' },
                u._id === currentUser._id ? 'This is your own account.' : 'You can\'t moderate this account.'), msg);
        }

        // Admin only: choose moderators (admins themselves are set in the database)
        if (isAdmin && u._id !== currentUser._id && (u.role === 'player' || u.role === 'moderator')) {
            const toMod = u.role === 'player';
            const btn = h('button', { class: 'btn-press w-full font-bold text-sm py-3 rounded-xl border ' + (toMod ? 'bg-sky-300/10 text-sky-300 border-sky-300/30' : 'bg-pill-bg text-text-primary border-border-color') },
                toMod ? 'Make moderator' : 'Remove moderator');
            armButton(btn, 'Tap again to confirm', () => run(btn, `/api/admin/users/${u._id}/role`, { method: 'PATCH', body: JSON.stringify({ role: toMod ? 'moderator' : 'player' }) }));
            body.append(h('div', { class: 'mb-4' },
                h('div', { class: 'text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2' }, 'Role'),
                btn,
                h('p', { class: 'text-[11px] text-text-muted mt-2' }, 'Moderators get a badge on their profile and can suspend or ban players.')));
        }

        body.append(
            h('div', { class: 'text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2' }, 'History'),
            h('div', { class: 'mb-5' }, historyEl(history)),
            h('button', { class: 'btn-press w-full py-3 rounded-xl text-sm font-semibold bg-pill-bg border border-border-color hover:border-white/30 transition-colors duration-150', onclick: dismissOverlay }, 'Close'));
    }

    function sTile(label, value) {
        return h('div', { class: 'bg-pill-bg border border-border-color rounded-xl px-3 py-2' },
            h('div', { class: 'text-[10px] text-text-muted uppercase tracking-wide' }, label),
            h('div', { class: 'text-sm font-bold truncate' }, String(value)));
    }

    // ── Activity log (admin) ─────────────────────────────────
    async function loadLog() {
        const box = $('log-list');
        $('log-msg').classList.add('hidden');
        box.textContent = '';
        try {
            const data = await authedFetch('/api/admin/log?limit=50');
            if (!data.entries.length) {
                $('log-msg').textContent = 'No staff activity yet.';
                $('log-msg').classList.remove('hidden');
                return;
            }
            data.entries.forEach((e) => box.append(h('div', { class: 'bg-card-bg border border-border-color rounded-2xl px-4 py-3 text-sm text-text-secondary' },
                h('span', { class: 'text-text-primary font-semibold' }, e.actorName),
                h('span', { class: 'text-[10px] uppercase text-text-muted ml-1' }, e.actorRole), ' ',
                ACTION_TEXT[e.action] || e.action, ' ',
                h('span', { class: 'text-text-primary font-semibold' }, e.targetName),
                e.until ? ' until ' + fmtDate(e.until) : '',
                e.reason ? h('span', { class: 'block text-xs text-text-muted mt-0.5' }, '“' + e.reason + '”') : null,
                h('span', { class: 'block text-xs text-text-muted mt-0.5' }, ago(e.createdAt)))));
        } catch (err) {
            $('log-msg').textContent = err.message;
            $('log-msg').classList.remove('hidden');
        }
    }

    return { enter };
})();
