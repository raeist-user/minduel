# Minduel — Backend (Auth Foundation)

Starting point for the Minduel analytical duel game. This slice covers user
accounts and authentication only — matchmaking, questions, and real-time
gameplay come next.

## Stack
- Node.js + Express
- MongoDB + Mongoose
- JWT auth, bcrypt password hashing

## Project structure
```
server.js                    # entry point
src/config/db.js             # Mongo connection
src/models/User.js           # user schema (rating/stats fields pre-added for later)
src/controllers/authController.js
src/routes/authRoutes.js
src/middleware/authMiddleware.js   # protect / adminOnly
src/middleware/errorMiddleware.js
public/index.html            # manual test page for register/login/me
```

## Local setup
1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in:
   - `MONGO_URI` — your MongoDB Atlas connection string
   - `JWT_SECRET` — any long random string
   - `CLIENT_ORIGINS` — your frontend URL(s), comma separated
3. Run in dev mode:
   ```
   npm run dev
   ```
4. Open `http://localhost:5000` to use the manual test page, or hit the API
   directly (see below).

## API

### `POST /api/auth/register`
Body: `{ "username": "...", "email": "...", "password": "..." }`
Returns: `{ token, user }`

### `POST /api/auth/login`
Body: `{ "emailOrUsername": "...", "password": "..." }`
Returns: `{ token, user }`

### `GET /api/auth/me`
Header: `Authorization: Bearer <token>`
Returns: `{ user }`

### `GET /api/health`
Simple uptime check, useful for Render.

## Deploying to Render
1. Push this repo to GitHub.
2. In Render: **New → Web Service**, connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables in Render's dashboard (same keys as `.env`):
   `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGINS`, `NODE_ENV=production`
6. Deploy. Render assigns `PORT` automatically — the app already reads
   `process.env.PORT`, so no change needed.

## MongoDB
Use a free MongoDB Atlas cluster:
1. Create a cluster → create a database user → allow network access
   (0.0.0.0/0 is easiest for MVP, tighten later).
2. Copy the connection string into `MONGO_URI`, replacing `<user>`,
   `<password>`, and adding a database name (e.g. `/minduel`).

## What's next
This gives you accounts + login only. Natural next slices, in order:
1. **Question model + admin CRUD** (category, difficulty, answer key,
   explanation, time limit, image support) — needed before anything else
   can be tested end-to-end.
2. **Answer-dispute model**: players report a wrong answer; a review page
   tallies votes per question and the majority answer replaces the key.
3. **Socket.io matchmaking + live match room**: queue, pairing, synced
   timer, submission locking, live score updates.
4. **Scoring engine**: correctness + speed + difficulty weighting.
5. **Results + rating update** (Elo-style) + **leaderboard** + **match
   history**.

Each of these can be built as its own slice on top of this auth layer —
happy to do the Question model + admin CRUD next, since matchmaking and the
game screen both depend on it.
