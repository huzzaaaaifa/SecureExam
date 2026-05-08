# Fuzzing artefacts (Assignment 4)

Payload files list **malicious / boundary / malformed** inputs for three API surfaces. Each file has **≥10** cases covering the brief’s categories (SQLi, command injection, XSS, boundaries, type confusion, path traversal).

## Surfaces

1. `payloads_login.json` — `POST /api/auth/login`
2. `payloads_register.json` — `POST /api/auth/register`
3. `payloads_submissions.json` — `POST /api/submissions` (requires Bearer token; see runner env vars)

## Run

From repository root `SecureExam/` (with server running, default `http://localhost:3000`):

```bash
node scripts/security-testing/run-fuzz.mjs
```

Optional env:

- `SECUREEXAM_BASE_URL` — default `http://localhost:3000`
- `SECUREEXAM_EMAIL` / `SECUREEXAM_PASSWORD` — student login used to obtain JWT for submission fuzz cases (403/400 expected without assignment)

Logs append to `artefacts/fuzzing/fuzz_run.log` (delete or archive between runs if you want a clean file for submission).
