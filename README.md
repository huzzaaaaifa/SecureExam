# SecureExam — Secure Online Examination System
### SSD Assignment 3 — Group: 23I-2001 · 23I-2017 · 23I-2034

A **Zero-Trust secure prototype** of an online examination system, implementing the UMLsec-based design from Assignment 2. The system enforces authentication, role-based access control, object-level authorization, replay protection, and tamper-evident audit logging across every request.

---

## Security features implemented

| Category | Controls |
|---|---|
| **Authentication** | Argon2id password hashing · student self-registration (student role enforced server-side) · short-lived JWT (15 min TTL) · web-OTP MFA · forgot/reset password with MFA when enabled · login/registration/reset rate limiting · account lockout after N failures · generic error responses (no user enumeration) |
| **Authorization** | RBAC (student / instructor / admin) · instructors publish results for exams they own; students only see **published** scores · administrators can create users and manage the directory (role / active; guards against removing the last active admin) · object-level authorization (IDOR prevention) · Zero-Trust per-request validation (token + role + ownership + time window) |
| **Input validation** | Zod schema validation on every request body · email/password format rules · bounded string sizes · parameterized SQL (no injection) |
| **Data protection** | Argon2id hashed passwords · JWTs signed with secret from env · no hardcoded credentials/secrets in source code · token kept in JS memory only (never localStorage) |
| **Injection / XSS / CSRF** | Parameterized DB statements · Helmet CSP headers · React JSX auto-escaping on all rendered output · fixed client API endpoint whitelist |
| **Replay protection** | Per-submission cryptographic nonce · UNIQUE(exam\_id, student\_user\_id) DB constraint · server-side exam time-window enforcement |
| **Session management** | Stateless JWT · auto-logout on token expiry (401 detected client-side) · logout clears in-memory token |
| **Audit logging** | SHA-256 hash-chained append-only audit log · every event records actor, action, resource, outcome, IP, user-agent, and timestamp |

---

## Tech stack

**Backend**
- Node.js 20+ with ES Modules
- Express 5
- SQLite (better-sqlite3)
- Argon2id (argon2)
- JWT (jose)
- Zod input validation
- Helmet security headers
- express-rate-limit

**Frontend**
- React 19 with TypeScript (TSX)
- Vite 6 (dev server + production build)
- Plain CSS design system (no external UI framework)

---

## Folder structure

```
secureexam/
├── src/                        Backend (Express API)
│   ├── server.js               App entrypoint, middleware stack
│   ├── config.js               Environment variable validation
│   ├── db/
│   │   ├── db.js               SQLite connection
│   │   └── schema.js           Table definitions (users, exams, submissions, audit_log …)
│   ├── middleware/
│   │   ├── auth.js             JWT verification + RBAC guards
│   │   ├── validate.js         Zod body validation middleware
│   │   ├── errors.js           Centralised error handler (no stack traces to client)
│   │   ├── rateLimiters.js     Per-endpoint rate limits
│   │   ├── requestLogger.js    Optional file-based request logger
│   │   └── consoleRequestLogger.js  Dev terminal request summaries
│   ├── routes/
│   │   ├── auth.js             register · login · MFA · forgot/reset password
│   │   ├── exams.js            GET/POST exams · assign · list/publish per-exam results (instructor owner or admin)
│   │   ├── results.js          GET /api/results/me (student published scores only)
│   │   ├── submissions.js      POST/GET submission endpoints with replay protection
│   │   └── admin.js            POST/GET/PATCH /api/admin/users · GET /api/admin/audit · GET /api/admin/users/students
│   └── services/
│       ├── jwt.js              Issue / verify access, MFA, and reset JWTs
│       ├── loginMfaOtp.js      Short-lived web OTP storage helpers
│       ├── crypto.js           SHA-256 hashing · random nonce generation
│       └── audit.js            Tamper-evident hash-chained audit logging
│
├── client/                     Frontend (React + TypeScript + Vite)
│   ├── index.html              Vite HTML entry
│   ├── vite.config.ts          Builds to ../public; proxies /api to :3000 in dev
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx            React root
│       ├── App.tsx             Auth state, AppContext, top-level routing
│       ├── api.ts              Typed fetch client (token in memory, auto-logout on 401)
│       ├── types.ts            Shared TypeScript interfaces
│       ├── utils.ts            toUtcIso, createNonce
│       ├── styles.css          Design system (CSS variables, components)
│       └── components/
│           ├── LoginForm.tsx
│           ├── TopBar.tsx
│           ├── StatusBanner.tsx
│           ├── StudentPanel.tsx    Assigned exams + one-shot submission
│           ├── InstructorPanel.tsx Create exams · exam list · assign to students
│           └── AdminPanel.tsx      User directory + hash-chained audit log
│
├── public/                     Vite build output (served by Express)
├── data/                       SQLite database (created at runtime, excluded from git)
├── logs/                       Optional request logs (excluded from git)
├── docs/
│   ├── SECURITY_FEATURES.md    Full security controls documentation
│   └── ASSIGNMENT3_VERIFICATION.md  Design-to-implementation checklist
├── .env.example                Environment variable template
└── README.md
```

---

## Setup

### 1. Requirements

- Node.js 20+
- npm 9+

### 2. Install backend dependencies

```bash
npm install
```

### 3. Install and build the frontend

```bash
cd client
npm install
cd ..
npm run build:client
```

This installs React/Vite dependencies inside `client/` and compiles the frontend into `public/`.

### 4. Configure environment

```bash
copy .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `JWT_SECRET` | **Required.** Long random secret (min 32 chars; e.g. `openssl rand -base64 32`). |
| `ACCESS_TOKEN_TTL_SECONDS` | JWT lifetime in seconds (default: 900 = 15 min). |
| `LOGIN_MAX_ATTEMPTS` | Failed logins before lockout (default: 5). |
| `LOCKOUT_MINUTES` | Lock duration (default: 10). |
| `ENABLE_FILE_REQUEST_LOG` | Set to `1` to write sanitized request logs to `logs/app.log`. |
| `FORCE_HTTPS` | Optional. Set `1` only behind a TLS-terminating proxy. |
| `HTTPS_REDIRECT_HOST` | Required when `FORCE_HTTPS=1`; fixed redirect hostname, never taken from request headers. |
| `TRUST_PROXY` | Optional proxy hop count when HTTPS redirect is enabled. |

### 5. Run the server

```bash
npm run dev
```

Open `http://localhost:3000` — the Express server serves the built React app from `public/`.

---

## Development workflow (hot reload)

Run two terminals in parallel:

```bash
# Terminal 1 — backend
npm run dev

# Terminal 2 — frontend (Vite dev server with API proxy)
npm run dev:client
```

Then open `http://localhost:5173`. Vite proxies all `/api` requests to the Express server at `:3000`.

---

## API quickstart

Use the UI register tab to create a student account. Instructors/admins are created by an administrator from the user directory.

### Login

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.edu","password":"<PASSWORD>"}'
```

If MFA is enabled for the account, the login response contains `mfaRequired: true` and a short-lived `mfaToken`; complete the flow with `POST /api/auth/login/mfa`.

### Forgot / reset password

```bash
curl -s -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.edu"}'
```

The demo returns a short-lived `resetToken` in JSON instead of sending email. If the account has MFA enabled, reset requires the one-time reset code before `POST /api/auth/reset-password` succeeds.

### Use the access token

```bash
curl -s http://localhost:3000/api/exams/assigned \
  -H "Authorization: Bearer <TOKEN>"
```

### Create an exam (instructor/admin)

```bash
curl -s -X POST http://localhost:3000/api/exams \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"title":"Midterm","startsAtUtc":"2026-05-01T09:00:00Z","endsAtUtc":"2026-05-01T11:00:00Z"}'
```

### Assign exam to student (instructor/admin)

```bash
curl -s -X POST http://localhost:3000/api/exams/assign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"examId":1,"studentUserId":2}'
```

### View audit log (admin only)

```bash
curl -s http://localhost:3000/api/admin/audit \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listening port |
| `NODE_ENV` | `development` | `production` disables dev console logging |
| `JWT_SECRET` | — | **Required.** Min 32-char random secret |
| `JWT_ISSUER` | `secureexam` | JWT `iss` claim |
| `JWT_AUDIENCE` | `secureexam-api` | JWT `aud` claim |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Token lifetime (15 min) |
| `SQLITE_PATH` | `./data/secureexam.sqlite` | Must stay inside `./data/` |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failures before lockout |
| `LOCKOUT_MINUTES` | `10` | Lockout duration |
| `FORCE_HTTPS` | — | Set `1` to redirect cleartext requests to HTTPS behind a trusted proxy |
| `HTTPS_REDIRECT_HOST` | — | Required with `FORCE_HTTPS=1`; configured redirect hostname, never user-controlled |
| `TRUST_PROXY` | `1` when HTTPS redirect is enabled | Express trusted proxy hop count |
| `ENABLE_FILE_REQUEST_LOG` | — | Set `1` to enable `logs/app.log` |
| `CONSOLE_DEBUG` | — | `0` = suppress dev logs · `1` = force on in prod |

---

## Security documentation

See [`docs/SECURITY_FEATURES.md`](docs/SECURITY_FEATURES.md) for a full explanation of every security control, the authorization model, and the session management strategy.
