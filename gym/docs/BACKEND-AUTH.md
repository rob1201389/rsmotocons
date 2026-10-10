# Backend: sign-up, approval, reset, AI review, weekly submissions

All enforcement is server-side, on every request. The browser is never trusted:
the session cookie identifies the user, the user row is re-read each time, and
role, permissions and account status are checked in the API.

## Account states

| `users.status` | Meaning | Can sign in | Can use the app |
|---|---|---|---|
| `pending` | signed up, not yet approved | yes (restricted session) | no |
| `active` | approved | yes | per role and permissions |
| `suspended`, `revoked`, `rejected` | blocked | no (403 with `accountStatus`) | no, an existing session dies on its next request |

`accountState` (returned by `/api/auth/session`, `/me`, `/account-status`) is
`pending_verification`, `pending_approval` or `active`.

### The pending guard

One check in `handle()` (`src/api.js`) allows a pending user only:
`GET /api/auth/session`, `GET /api/auth/me`, `POST /api/auth/logout`,
`POST /api/auth/password`, `POST /api/auth/resend-verification`,
`GET /api/auth/account-status`. Every other route, including unknown ones,
answers `403 {"error":"Your account is awaiting approval.","code":"pending","accountState":...}`.
New routes are therefore restricted by default.

## Flows

**Sign-up.** `POST /api/auth/signup {name,email,password,website}`. `website` is a
honeypot (filled means a normal-looking 200 and nothing happens). Role is never
read from the body: new accounts are `member`, `pending`. The email, lower-cased,
is the login. A hashed one-time token (48 hours) is emailed. The response is
`{ok:true,status:"pending_verification",emailSent}` and a session cookie is issued
so the person can see their account-status page. An email that already has an
account or request gets the same response shape and nothing new is created. For
an unverified pending request the verification email is re-sent (rate limited).
Limits: 5 per IP and 3 per email per hour.

**Verify.** `POST /api/auth/verify {token}` marks the email verified and moves the
request to `pending_approval`. Tokens are single use and stored only as SHA-256.
`POST /api/auth/resend-verification` (session required, 3 per user and 10 per IP
per hour) issues a fresh token and invalidates the older one.

**Approval.** Admins list `GET /api/admin/requests?status=` and decide with
`POST /api/admin/requests/:id/decision {action:"approve"|"reject",role,permissions,note,overrideVerification}`.
Admins may grant `member` or `coach`; only the owner may grant `admin`; `owner`
can never be granted this way. Approval of an unverified email is refused (409
`email_not_verified`) unless `overrideVerification` is exactly `true`, which is
audited. When email is not configured an admin can attest an address with
`POST /api/admin/requests/:id/verify-email`. Rejecting sets the account to
`rejected` and ends its sessions. Later suspension or revocation uses the
existing `PATCH /api/admin/users/:id` and takes effect on the next request.

**Private notes.** `GET/PUT /api/admin/users/:id/note` (admin only, 2000 characters).
Notes are in their own table and are never part of any `/api/auth`, state or
member response. Audit entries record that a note changed, never its text.

**Password reset.** `POST /api/auth/forgot {email}` always answers
`{ok:true,emailSent}` and sends mail only if the account exists and is not
rejected or revoked (3 per email, 10 per IP per hour). `POST /api/auth/reset {token,password}`
applies the password policy, sets the password, clears `must_change_pw`, revokes
all sessions, and spends the token (valid 1 hour). A weak password does not spend it.

## AI weekly review

`POST /api/ai/weekly-review {payload}` needs an active user with the `reviews`
permission. The payload is validated strictly (unknown keys rejected, 40 KB total,
string and array caps; see `validatePayload` in `src/ai.js`). The server owns the
system prompt and calls the Anthropic Messages API (20 second timeout, 1200
tokens). User notes travel only inside a JSON data block in the user message.
The reply is parsed and validated; unknown keys are dropped; a number guard
rejects any digit sequence not present in the supplied statistics or in the fact,
attention and proposal text; basis ids, note ids and proposal ids must exist in
the payload. Limits: 12 per hour and 60 per day per user. Results: 200, 400, 429,
502 `ai_unavailable`, 502 `ai_invalid_output`, 503 `ai_not_configured`. The
payload, notes and key are never logged.

## Weekly submissions

`POST /api/weekly-submissions {weekStart,report,planVersionId}` (needs `reviews` and
an assigned coach, else 409 `no_coach`). One open submission per user and week;
resubmitting while `submitted` or `changes_requested` replaces it. `GET` lists your
own; `?inbox=1` lists assigned members' reports for reviewers (reads are audited).
`PATCH /:id {action:"approve"|"changes_requested"|"withdraw",note}`: only the
assigned reviewer may approve or request changes (never your own report), only the
member may withdraw.

## Environment

Secrets are set with `wrangler secret put NAME`; nothing is in the source or `wrangler.toml`.

| Variable | Purpose | Configured by default? |
|---|---|---|
| `OWNER_LOGIN` (or `OWNER_EMAIL`) | login allowed to claim the owner account on first run | set per deployment |
| `BOOTSTRAP_OWNER_PASSWORD` | optional, creates the owner at start-up | no |
| `RESEND_API_KEY` + `MAIL_FROM` | send email through Resend | **no** (sign-up still works, `emailSent:false`) |
| `MAIL_PROVIDER=outbox` | keep mail in memory (tests, local development only) | **no** |
| `PUBLIC_URL` | base for `/?verify=` and `/?reset=` links, else the request origin | **no** |
| `ANTHROPIC_API_KEY` | enables the AI weekly review | **no** (endpoint answers 503 `ai_not_configured`) |
| `AI_MODEL` | model id, default `claude-sonnet-5-5` | **no** (default used) |
| `DATA_ENC_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the state document, weekly reports, review messages, admin notes, request messages and TOTP secrets with AES-256-GCM. **Losing it makes that data unreadable.** Keep a copy offline | **no** (data stored unencrypted at the application layer; D1 still encrypts at rest) |
| `DATA_ENC_KEY_ID` | short label written with each value, default `k1`. Change it when rotating | **no** |
| `DATA_ENC_KEY_PREVIOUS` | the old key during a rotation, so older values stay readable until rewritten | **no** |
| `HIBP_CHECK` | `off` disables breached-password screening (tests only) | **no** (screening on) |
| `RP_ID` | passkey relying-party id, else the host of `PUBLIC_URL`, else the request host | **no** |

Until email is configured, new people cannot receive a confirmation link; an
administrator can attest the address or approve with the audited override.

## Database

`schema.sql` only adds `CREATE TABLE/INDEX IF NOT EXISTS` objects and is safe to
re-run on every deploy: `signup_requests`, `email_tokens`, `admin_notes`,
`rate_events`, `weekly_submissions`.

## Notes on client addresses

On Workers the rate limits use `cf-connecting-ip`. On Node (`server.js`) the first
`X-Forwarded-For` value is used when present, so run it behind a proxy that sets
that header, or the per-IP limits can be sidestepped by a caller who forges it.
