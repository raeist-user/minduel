# Aptiks — Backend (Auth + Security + Personalization + Moderation)

Accounts, authentication, password reset, and profile personalization for
Aptiks. Matchmaking, questions, and real-time gameplay come next.

## Stack
- Node.js + Express
- MongoDB + Mongoose
- JWT auth, bcrypt password hashing
- Helmet, mongo-sanitize, rate limiting for baseline security
- Nodemailer for password-reset emails

## Project structure
```
server.js                      # entry point
src/db.js                      # Mongo connection (auto-retries, never crashes the process)
src/User.js                    # user schema: profile, role, restriction (ban/suspend), tokenVersion, terms, rating/stats, lockout fields
src/moderation.js              # pure rules: roles, rank checks, badges, ban/suspend status (no DB, easy to test)
src/ModerationLog.js           # append-only record of every staff action
src/adminController.js         # staff: search accounts, ban, suspend, restore, set role, activity log
src/adminRoutes.js             # /api/admin/* (staff only) + rate limiters
src/userController.js          # leaderboard + player profile (allowlist view; friends also get stats/online)
src/userRoutes.js              # /api/users/leaderboard, /api/users/:id
src/Friendship.js              # one document per pair: pending | accepted
src/friendController.js        # friend list (+ online state), send/accept/decline/cancel/unfriend
src/friendRoutes.js            # /api/friends/*
src/profileFields.js           # validation for bio, location, social links (handles, not free URLs)
src/Conversation.js, Message.js # DMs: one conversation per pair (inbox preview + unread), messages
src/dmController.js, dmRoutes.js # /api/dm/*
src/authCore.js                # the ONE place that decides if a token may get in (HTTP + Socket.io both use it)
src/socketAuth.js              # Socket.io handshake auth + kickUser(), ready for live matches
scripts/set-role.js            # npm run set-role -- <username|email> <player|moderator|admin>
src/emailService.js            # sends password-reset emails, verifies SMTP at boot (logs the link if SMTP isn't set in dev)
src/authController.js          # register, login, me, profile, password, forgot/reset password
src/authRoutes.js               # routes + rate limiters
src/authMiddleware.js           # protect / staffOnly / adminOnly / requireRole
src/errorMiddleware.js          # centralized error handling (now logs to console always)
public/index.html               # login / register
public/forgot-password.html     # request a reset email
public/reset-password.html      # set new password from emailed link
public/home.html                # app shell: top bar + bottom nav (Home, Ranks, Staff*, Friends, Account)
public/app.js                  # router (real history entries so phone Back works in-app), tabs, friends, account, password pop-up
public/staff.js                # staff panel (moderators/admins), shown in the Staff tab
public/admin.html               # old URL: just redirects to /home.html#/staff
public/terms.html               # DRAFT Terms of Service (have it reviewed before launch)
public/privacy.html             # DRAFT Privacy Policy (have it reviewed before launch)
```

## Local setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `MONGO_URI`, `JWT_SECRET`, and (optionally
   for now) the `SMTP_*` values — see notes below.
3. `npm run dev`
4. Open `http://localhost:5000`.

## Security features
- **Password hashing**: bcrypt, 10 salt rounds.
- **JWT auth**: 7-day tokens by default (`JWT_EXPIRES_IN`).
- **Rate limiting**:
  - Login: 10 attempts / 15 min per IP.
  - Register: 10 accounts / hour per IP.
  - Forgot/reset password: 5 requests / hour per IP.
- **Account lockout**: after 5 failed login attempts on one account, it's
  locked for 15 minutes regardless of IP (stops distributed/credential-stuffing
  attempts against a single account).
- **Generic auth errors**: login and forgot-password never reveal whether an
  email/username exists, to prevent user enumeration. (Registration is the
  deliberate exception: it has to tell you a username is taken. That's why the
  live check below is rate-limited.)
- **Case-insensitive usernames**: `Neo`, `neo` and `NEO` are the same name,
  enforced by a collation index in MongoDB (not just in app code), so two
  simultaneous signups can't both win.
- **Helmet**: standard security headers (X-Frame-Options, etc). CSP is
  currently disabled because the frontend loads Tailwind/fonts/icons from
  CDNs with inline scripts — tighten this once the frontend is bundled.
- **mongo-sanitize**: strips `$`/`.` from request input to block NoSQL
  injection (e.g. `{ "email": { "$gt": "" } }`).
- **Password reset tokens**: random 32-byte token, only its SHA-256 hash is
  stored in the DB, expires after 1 hour, single-use.
- **Session invalidation**: every login token carries the account's
  `tokenVersion`. Changing the password, resetting it, or banning the account
  bumps that number, so every older token stops working on every device at
  once. The device that changed the password is handed a fresh token so it
  stays signed in. Tokens issued before this feature existed (no version) keep
  working until the first bump.
- **Ban / suspension checked on every request**, not only at login, so a
  banned player's still-valid 7-day token is useless the moment the ban lands.
- **Terms + age**: registration requires one checkbox ("I am at least 13 and
  agree to the Terms and Privacy Policy"). The server stores `termsAcceptedAt`,
  `termsVersion` and `ageConfirmed`. Older accounts, and everyone after you
  change `TERMS_VERSION` in `src/User.js`, get a blocking prompt on their next
  visit (`needsTerms` in the user object). The minimum age is 13; change the
  wording in `index.html`, `home.html`, `terms.html` if you need 16.

## Account changes (username / email / password)
- All three require the current password, asked in a pop-up when the person taps the final button (not as a form field). A wrong password keeps the pop-up open for another try. Wrong guesses count toward the same
  per-account lockout as login (5 failures -> locked 15 min), so a stolen
  session token can't be used to brute-force the password through these routes.
- Usernames can change once per 14 days. Old names are kept (last 10, hidden)
  so support can trace who used a name, and a name can't be sniped instantly.
- Email is never returned by `toPublicObject()`; anything shown to *other*
  players (opponent card, leaderboard, match history) must use that projection,
  never `toSafeObject()`. The email is also not stored in the browser's
  localStorage.

## Roles, moderation and the admin panel

There are three roles, stored as a plain string in the `role` field of the
user document: `"player"` (default), `"moderator"`, `"admin"`. The role is read
from the database on every request. It is never taken from the login token or
from anything the client sends, so changes apply immediately (a demoted
moderator loses access on their next click) and nobody can grant themselves a
role. Unknown or mistyped values (`"superadmin"`) count as `"player"`; extra
capitals or spaces (`" Admin "`) are tolerated.

**Making the first admin (or any moderator) by hand** — any of these:

1. **MongoDB Atlas**: Browse Collections → your database → `users` → find the
   person → edit the document → set `role` to the string `admin` (or
   `moderator`) → Update. If the field is missing, add it as type *String*.
2. **mongosh**: `db.users.updateOne({ username: "neo" }, { $set: { role: "admin" } })`
   (mongosh matching is case-sensitive; use the exact username or the email.)
3. **Command line**: `npm run set-role -- neo admin` (accepts username or
   email; uses `MONGO_URI` from `.env`, so run it with the production value to
   change the live database). Use `player` to remove a role.

The person just reloads the page; an "Admin panel" / "Moderation" entry
appears in their profile dropdown (`/admin.html`).

| Can do | Moderator | Admin |
|---|---|---|
| Open the staff panel, search accounts (by name / display name / id) | yes | yes, and also by email |
| See account emails | no | yes |
| Suspend (1 h – 30 d) or ban players; lift either | players only | players and moderators |
| Give / take the moderator role (badge on profile) | no | yes |
| See the activity log of all staff actions | no | yes |
| Ban or moderate another admin, or yourself | no | no |

Admins can only be created by hand in the database (above); the panel can only
move someone between `player` and `moderator`. Every ban / suspend / lift /
role change needs to be confirmed with a second tap, requires a reason for
ban/suspend, and is recorded in `ModerationLog` (who, whom, what, why, when).

**Badges**: `moderator` and `admin` accounts show a Discord-style badge next
to their name on their profile. The badge is part of the public view
(`badge: "moderator" | "admin" | null`); the raw role is not. To change who
shows a badge, edit `badgeFor()` in `src/moderation.js`.

**What a banned or suspended player experiences**: login is refused (after the
password is checked, so this never reveals anything to a stranger) with the
reason, and for suspensions the end time. Anyone already signed in is bounced
to the sign-in page on their next request with the same message. A suspension
lifts itself when its time passes; nothing has to run.

## Showing players to other players (leaderboard, opponent card, history)

Never send `toSafeObject()` (the owner's own view, includes email) to anyone
else. Use the allowlist view:

- Loaded document: `user.toPublicObject()`
- `.lean()` results / aggregates: `User.toPublic(doc)`, ideally with
  `.select(User.PUBLIC_SELECT)` so private fields never leave the database.

It returns only `_id, username, displayName, avatarUrl, rating, badge`. Because
it is an allowlist, a field added to the schema later cannot leak by accident.
`GET /api/users/:id` already uses it.

## Socket.io (for the live match)

`src/socketAuth.js` is ready but Socket.io is not installed yet
(`npm i socket.io` when you build matchmaking). The browser keeps the login
token in `localStorage` and sends it in the handshake `auth` payload, never in
the URL:

    const socket = io({ auth: { token: localStorage.getItem('minduel_token') } });

    // server
    const io = new Server(httpServer);
    io.use(require('./src/socketAuth').socketAuth);
    app.set('io', io);   // makes ban/suspend disconnect a player's live sockets

The handshake runs the same checks as an HTTP request (signature, account
active, token version, ban/suspension). Identity comes from the server
(`socket.data.userId`), never from a client-sent id. Re-check status when a
match starts. Keeping the token in `localStorage` means an XSS bug could steal
it, so keep rendering user-provided text with `textContent` (the admin panel
does) and tighten the CSP once assets are bundled.

## Profile pictures
- The user picks the region (drag + zoom/pinch in a circular preview); the
  browser then crops it to a square, resizes it to 256x256
  and re-encodes it as JPEG (about 15-45 KB), which also strips EXIF/GPS data. The
  server never receives the original.
- The server re-checks the file's leading bytes (JPEG/PNG/WebP only; SVG and
  HTML are refused since they can carry scripts), enforces a 150 KB cap, and
  stores the bytes in MongoDB (`avatarData`, hidden from normal queries).
- Stored in the database rather than on disk because Render's disk is wiped on
  every deploy. If photos ever become large or numerous, move them to S3 or
  Cloudinary and keep only the URL in `avatarUrl`. Nothing else has to change.
- No photo -> the UI shows the user's initial on one fixed brand color
  (`#E2B714`). Avatar background colors were removed; old `avatarColor` values
  still in the database are harmless and ignored.

## Email (password reset)

**Why reset emails might not arrive:** if `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS`
aren't all set, nothing is emailed. The link is only printed to the server
log. In `NODE_ENV=production` the API now returns a 503 in that case instead of
pretending it was sent. On startup the server logs one of:
- `[email] SMTP connection OK` — you're good.
- `[email] SMTP is NOT configured` — set the three variables.
- `[email] SMTP is configured but the connection/login FAILED` — wrong
  host/port/credentials (for Gmail you must use an App Password).

Forgot-password actually sends an email via Nodemailer over SMTP. Two ways
to get SMTP credentials:
- **Fastest for testing**: a Gmail account with an
  [App Password](https://myaccount.google.com/apppasswords) (not your normal
  password) — set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`
  to the Gmail address, `SMTP_PASS` to the app password.
- **Better long-term**: a transactional email provider like Resend or
  SendGrid (both have free tiers) — they give you an SMTP host/user/pass the
  same way.

If `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are left blank, the reset link is
just logged to the server console instead of emailed — useful for local dev
without setting up email yet.

Set `CLIENT_URL` to your deployed frontend's base URL so reset links point
to the right place (e.g. `https://minduel.onrender.com`).

## API

### Auth
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/auth/check-availability` | — | `?username=` and/or `?email=` → `{ username: { valid, available, message }, email: {...} }`. 30 req/min per IP. |
| POST | `/api/auth/register` | — | `{ username, email, password, acceptTerms: true }`. Username: 3-20 chars, letters/numbers/underscore. `acceptTerms` must be exactly `true` (400 otherwise). 409 responses include `field` (`username` or `email`). |
| POST | `/api/auth/login` | — | `{ emailOrUsername, password }`. 403 with `code: "BANNED"` or `"SUSPENDED"` (+ `reason`, and `until` for suspensions) after a correct password. |
| POST | `/api/auth/accept-terms` | Bearer token | `{ acceptTerms: true }` for accounts that predate the checkbox or the current `TERMS_VERSION`. Returns `{ user }`. |
| GET | `/api/auth/me` | Bearer token | current user |
| PATCH | `/api/auth/profile` | Bearer token | `{ displayName? }` |
| PUT | `/api/auth/avatar` | Bearer token | Body is the **raw image bytes** (`Content-Type: image/jpeg`, `image/png` or `image/webp`), max 150 KB. Verified by file header, not by the header/extension. 20 uploads/hour per IP. Returns `{ user }`. |
| DELETE | `/api/auth/avatar` | Bearer token | Removes the profile picture. Returns `{ user }`. |
| GET | `/api/auth/avatar/:id` | — | Serves a user's picture (public, cached 24h). 404 if none. |
| PATCH | `/api/auth/username` | Bearer token | `{ newUsername, password }`. Password required. 14-day cooldown (case-only changes exempt). 409 if taken, 429 during cooldown. |
| PATCH | `/api/auth/email` | Bearer token | `{ newEmail, password }`. Password required. 409 if taken. *(Will also require an emailed code once email verification exists.)* |
| PATCH | `/api/auth/password` | Bearer token | `{ currentPassword, newPassword }`. New password must differ from the current one. Signs out all other devices and returns `{ message, token }`: **store the new token**. |
| POST | `/api/auth/forgot-password` | — | `{ email }` → sends reset email |
| POST | `/api/auth/reset-password` | — | `{ token, password }` |

### Friends (all need a Bearer token)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/friends` | `{ friends (with online, lastSeenAt), incoming, outgoing }`. The app polls this every 45 s, which is also its presence heartbeat. |
| POST | `/api/friends/request` | `{ username }` or `{ userId }`. If they already asked you, this accepts it. 40/hour. |
| POST | `/api/friends/requests/:id/accept` | recipient only |
| DELETE | `/api/friends/requests/:id` | decline (recipient) or cancel (sender) |
| DELETE | `/api/friends/:userId` | unfriend |

Online = the server heard from the account in the last 2 minutes (`lastSeenAt`, written by `protect`, at most every 30 s). Only ever shown to accepted friends.

### Messages (friends only, all need a Bearer token)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/dm` | Inbox: conversations (newest first), unread counts, total `unread`. |
| GET | `/api/dm/with/:userId` | Latest 50 messages and marks the chat read. `?after=<id>` = only newer (polling), `?before=<id>` = older page. Returns `canSend` (false once you are no longer friends; history stays readable). |
| POST | `/api/dm/with/:userId` | `{ text }`, 1-1000 chars, friends only, 30/min. |

Delivery is polling (open chat every 4 s, inbox every 45 s). Swapping in Socket.IO later only changes how new messages arrive; the endpoints stay.

Profile fields: `PATCH /api/auth/profile` accepts `bio` (160), `location` (30) and `socialLinks` (`instagram, x, github, youtube, twitch, discord, website`). Links are stored as handles and the URL is built client-side from a fixed base.

### Players
| GET | `/api/users/leaderboard` | Bearer token | Top 50 by rating + your rank. |
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/users/:id` | Bearer token | Public profile + `relation` (`self/friend/incoming/outgoing/none`). Friends and yourself also get `stats`, `online`, `lastSeenAt`. 404 if missing or banned. |

### Admin (staff only; role is read from the database)
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/admin/users` | moderator, admin | `?q=&filter=all\|staff\|suspended\|banned&page=` → `{ users, page, pages, total }`, 20 per page. Email only in the admin response. |
| GET | `/api/admin/users/:id` | moderator, admin | Account + its last 10 moderation entries. |
| POST | `/api/admin/users/:id/ban` | moderator, admin | `{ reason }` (3-200 chars). Bumps `tokenVersion`, disconnects live sockets. |
| POST | `/api/admin/users/:id/suspend` | moderator, admin | `{ hours (1-8760), reason }` |
| POST | `/api/admin/users/:id/restore` | moderator, admin | `{ reason? }` lifts a ban or an active suspension |
| PATCH | `/api/admin/users/:id/role` | admin | `{ role: "moderator" \| "player" }` |
| GET | `/api/admin/log` | admin | `?limit=` most recent staff actions (max 100) |

Rank rules are enforced on the server: nobody can act on themselves or on an
equal/higher rank, so a moderator can only touch players, and an admin can
touch players and moderators.

### Other
- `GET /api/health` — uptime check for Render.

## Deploying to Render
Environment variables to set (Render dashboard → Environment):
`MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGINS`, `CLIENT_URL`,
`NODE_ENV=production`, and the `SMTP_*` / `EMAIL_FROM` vars once you're
ready to send real emails.

Build command: `npm install` — Start command: `npm start`.

## MongoDB
Atlas → Network Access → allow `0.0.0.0/0` (Render's IPs aren't static).
Atlas → Database Access → create a user, use its connection string as
`MONGO_URI` (URL-encode special characters in the password, e.g. `@` → `%40`).

## What's next
1. **Question model + admin CRUD** (category, difficulty, answer key,
   explanation, image, time limit). Mount it behind `protect, adminOnly` from
   `src/authMiddleware.js`; the role plumbing is already done.
2. **Answer-dispute model**: players report a wrong answer; majority vote
   replaces the answer key.
3. **Socket.io matchmaking + live match room**.
4. **Scoring engine** (correctness + speed + difficulty).
5. **Results + rating update** (Elo-style) + **leaderboard** + **match
   history**.


## Notes
- Staff badges/roles are never sent to other players (only to the account itself and to staff via the staff panel).
- DMs are deleted after 30 days (TTL indexes in `Message.js` / `Conversation.js`; Mongoose creates them at startup, so keep `autoIndex` on or create them manually in production).
- Accent color is `#E2B714` (Monkeytype yellow); presence dots and success text use `#4ADE80`.
- Browser storage keys are still prefixed `minduel_` on purpose, so renaming the app does not sign everyone out.

## Real-time games (Socket.io)

Live matches run over Socket.io, authenticated with the same JWT as the REST
API (see `src/socketAuth.js`). Everything game-related lives under `src/game/`:

```
src/game/BaseGame.js         # shared match-state-machine plumbing every game extends
src/game/env.js               # bridges a BaseGame to a real Socket.io room (emit/timers/finish)
src/game/registry.js          # game id -> class, + which ids Random Matchmaking can pick
src/game/rating.js            # Elo for 2..n players; bots count for half weight
src/game/bots.js              # bot names + skill/mood, so bot matches feel human
src/game/settle.js            # turns a finished game into rating/stat updates + MatchHistory row
src/game/MatchManager.js      # parties (join codes), matchmaking queues, match lifecycle, reconnects
src/game/wikiClient.js        # talks to the real Wikipedia API for Wiki Race link validation
src/game/util.js              # seeded-friendly rng/math helpers shared by every game
src/game/data/                # texts, word dictionary, categories (animals/presidents/countries/fast food), wiki start/target pairs
src/game/games/
  mathduel.js                  # 10 questions, rating-banded topics (arithmetic -> quadratics -> algebra -> calculus -> advanced)
  wpmduel.js                    # typing race: 30s paragraph mode, or 10-sentence speed mode
  wordchain.js                  # last-letter word chain, 3 hearts, dictionary-checked
  spellthemost.js               # type as many valid category items as you can before time's up
  guesscountry.js                # same shuffled country sequence for everyone, own pace, shared timer
  wikirace.js                    # same start/target Wikipedia page, first to click through wins
src/MatchHistory.js            # one row per finished match (players, ranks, rating deltas)
```

**Client socket events** (all under the same JWT-authenticated connection):
- `party:create` / `party:join` / `party:leave` / `party:invite` / `party:start`
- `queue:join` (`{ gameId: 'random' | 'mathduel' | ... , settings }`) / `queue:leave`
- `match:action` (`{ matchId, msg }` — forwarded straight to the game's `handle()`)
- `match:leave` (explicit forfeit / "leave" button)

**Server -> client events**: `party:update`, `party:invited`, `queue:waiting`,
`match:found` (roster + `publicInit()` + a 3s countdown), `match:event` (every
`env.emit`/`env.emitTo` a game sends — `{ type, data }`), `match:end`
(rankings + rating deltas), `match:aborted`, `match:resync` (sent automatically
on reconnect if you had an active match).

**Bots**: if a queue wait passes ~12s, or a party starts with only one real
player, an empty seat is filled with a bot built by `bots.js` — skill centered
on the human(s)' own rating/typing speed with per-match "form" (mood) so it
isn't a fixed wall. Rating changes from a bot match are halved (`rating.js`),
so they can't be farmed and a bad bot match doesn't cost a full loss.

**Disconnects**: a dropped connection gets a 20s grace period
(`DISCONNECT_GRACE_MS` in `MatchManager.js`) before counting as a forfeit —
enough for a phone to reconnect after a tab switch or a brief signal drop —
and reconnecting mid-match resyncs the roster + a live `snapshot()` of game
state rather than restarting.

**MathDuel topic bands** (`games/mathduel.js` -> `BANDS`): 1000-1200
arithmetic, 1200-1500 adds quadratics (per the brief); 1500+ algebra &
sequences, 1800+ calculus & counting, 2100+ advanced — all easy to retune
(just numbers) and reshuffle (topics are just arrays).

**Wiki Race** needs outbound network access to `en.wikipedia.org` in
production (`wikiClient.js`); tests inject a fake `env.wiki` instead (see
`test/run.js`) so the game logic itself has no network dependency.

### Tests
`node test/run.js` — offline, deterministic (fake clock + seeded RNG in
`test/harness.js`), runs every game to completion including full bot-vs-bot
matches, plus rating math and bot generation. No DB or network needed.

### Setup note
`npm install` will need to fetch `socket.io` (added to `package.json`) — it
wasn't installable from this sandbox (no outbound network here), so it hasn't
been test-installed; it's a very standard, stable package so this should be a
non-issue on your machine / Render.
