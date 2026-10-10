# Recomp backend

A single Web-standard `fetch` handler. The same code runs on Cloudflare Workers
with D1 (your existing stack) and on Node with `node:sqlite` for local running
and the test suite.

## Security model, in one paragraph

The browser is never trusted. The signed-in user comes from the session cookie,
never from a request body or a URL segment, so changing an id in a request gets
you a 403 rather than someone else's data. Permissions are checked per request,
not per screen: hiding a tab is presentation, `can()` is the boundary. Every
request re-reads the user row, so suspending an account takes effect on that
account's very next request rather than when a cached claim expires.

## Running it locally

```bash
cd backend
OWNER_EMAIL='you@yourdomain' \
BOOTSTRAP_OWNER_PASSWORD='a-passphrase-you-choose' \
DB_PATH=./recomp.sqlite \
node server.js
# → http://localhost:8787
```

The owner account is created once, from those environment values, and the
bootstrap then disables itself in the `meta` table. **No password is in the
source, the bundle, or git.** There is a test that walks the whole repository
and fails if one appears.

On first login you are forced to change the password before any other endpoint
will answer.

If the password you set is rejected, the server says what the policy requires
and refuses to create the account. It does not lower the bar for the owner.

## Deploying to Cloudflare

```bash
wrangler d1 create recomp
wrangler d1 execute recomp --file=backend/schema.sql
wrangler secret put OWNER_EMAIL
wrangler secret put BOOTSTRAP_OWNER_PASSWORD
wrangler deploy
```

`wrangler.toml` binds `DB` to the D1 database and `ASSETS` to the static PWA.
Put the secrets in `wrangler secret`, never in `wrangler.toml`.

Serve the API and the PWA from the **same origin**. The session cookie is
`SameSite=Lax` and mutations carry a same-origin check, both of which depend on it.

## Roles and features

| Role | Can |
|---|---|
| owner | everything, and is the only role that can grant admin or owner |
| admin | manage accounts; **cannot** read a member's records without an explicit assignment |
| coach | review only the members assigned to them |
| member | their own data only |

Features gated independently per user: `training`, `library`, `nutrition`,
`recipes`, `garmin`, `progress`, `reviews`. Role presets with per-user overrides.

## Endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login` | anyone |
| GET | `/api/auth/session` | anyone (returns `authenticated:false` when not) |
| POST | `/api/auth/logout` | signed in |
| POST | `/api/auth/password` | signed in |
| GET | `/api/auth/me` | signed in |
| GET/PUT | `/api/state` | own data, needs `training` |
| GET | `/api/users/:id/state` | self, or an **assigned** reviewer (audited) |
| POST | `/api/import/preview` · `/api/import/commit` | own data |
| GET/POST | `/api/reviews` | own; `?inbox=1` for assigned reviewers |
| PATCH | `/api/reviews/:id` · GET/POST `/api/reviews/:id/messages` | participants |
| GET/POST | `/api/proposals` · PATCH `/api/proposals/:id` | reviewer proposes, **user decides** |
| GET/POST | `/api/admin/users` · PATCH `/api/admin/users/:id` | admin (owner for roles) |
| POST | `/api/admin/assign` | admin |
| GET | `/api/admin/audit` | admin |

## Tests

```bash
node test/api.test.js    # 45 tests, real HTTP, real database
```
