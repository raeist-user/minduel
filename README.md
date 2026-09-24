# Minduel — Backend (Auth + Security + Personalization)

Accounts, authentication, password reset, and profile personalization for
Minduel. Matchmaking, questions, and real-time gameplay come next.

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
src/User.js                    # user schema: profile, rating/stats, reset-token, lockout fields
src/emailService.js            # sends password-reset emails, verifies SMTP at boot (logs the link if SMTP isn't set in dev)
src/authController.js          # register, login, me, profile, password, forgot/reset password
src/authRoutes.js               # routes + rate limiters
src/authMiddleware.js           # protect / adminOnly
src/errorMiddleware.js          # centralized error handling (now logs to console always)
public/index.html               # login / register
public/forgot-password.html     # request a reset email
public/reset-password.html      # set new password from emailed link
public/home.html                # nav bar, profile dropdown, personalization + account settings
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

## Profile pictures
- The browser crops the chosen photo to a centered square, resizes it to 256x256
  and re-encodes it as JPEG (about 15-45 KB), which also strips EXIF/GPS data. The
  server never receives the original.
- The server re-checks the file's leading bytes (JPEG/PNG/WebP only; SVG and
  HTML are refused since they can carry scripts), enforces a 150 KB cap, and
  stores the bytes in MongoDB (`avatarData`, hidden from normal queries).
- Stored in the database rather than on disk because Render's disk is wiped on
  every deploy. If photos ever become large or numerous, move them to S3 or
  Cloudinary and keep only the URL in `avatarUrl`. Nothing else has to change.
- No photo -> the UI shows the user's initial on one fixed brand color
  (`#A3E635`). Avatar background colors were removed; old `avatarColor` values
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
| POST | `/api/auth/register` | — | `{ username, email, password }`. Username: 3-20 chars, letters/numbers/underscore. 409 responses include `field` (`username` or `email`). |
| POST | `/api/auth/login` | — | `{ emailOrUsername, password }` |
| GET | `/api/auth/me` | Bearer token | current user |
| PATCH | `/api/auth/profile` | Bearer token | `{ displayName? }` |
| PUT | `/api/auth/avatar` | Bearer token | Body is the **raw image bytes** (`Content-Type: image/jpeg`, `image/png` or `image/webp`), max 150 KB. Verified by file header, not by the header/extension. 20 uploads/hour per IP. Returns `{ user }`. |
| DELETE | `/api/auth/avatar` | Bearer token | Removes the profile picture. Returns `{ user }`. |
| GET | `/api/auth/avatar/:id` | — | Serves a user's picture (public, cached 24h). 404 if none. |
| PATCH | `/api/auth/password` | Bearer token | `{ currentPassword, newPassword }` |
| POST | `/api/auth/forgot-password` | — | `{ email }` → sends reset email |
| POST | `/api/auth/reset-password` | — | `{ token, password }` |

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
   explanation, image, time limit).
2. **Answer-dispute model**: players report a wrong answer; majority vote
   replaces the answer key.
3. **Socket.io matchmaking + live match room**.
4. **Scoring engine** (correctness + speed + difficulty).
5. **Results + rating update** (Elo-style) + **leaderboard** + **match
   history**.
