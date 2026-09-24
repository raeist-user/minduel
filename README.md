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
src/emailService.js            # sends password-reset emails (or logs the link if SMTP isn't set)
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
  email/username exists, to prevent user enumeration.
- **Helmet**: standard security headers (X-Frame-Options, etc). CSP is
  currently disabled because the frontend loads Tailwind/fonts/icons from
  CDNs with inline scripts — tighten this once the frontend is bundled.
- **mongo-sanitize**: strips `$`/`.` from request input to block NoSQL
  injection (e.g. `{ "email": { "$gt": "" } }`).
- **Password reset tokens**: random 32-byte token, only its SHA-256 hash is
  stored in the DB, expires after 1 hour, single-use.

## Email (password reset)
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
| POST | `/api/auth/register` | — | `{ username, email, password }` |
| POST | `/api/auth/login` | — | `{ emailOrUsername, password }` |
| GET | `/api/auth/me` | Bearer token | current user |
| PATCH | `/api/auth/profile` | Bearer token | `{ displayName?, avatarColor? }` |
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
