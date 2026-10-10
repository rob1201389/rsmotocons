# Deploying Recomp with accounts on Cloudflare

Your front end is already live at `gym.rsmotocons.com`. Nothing below breaks it:
with no backend reachable, the app runs exactly as it does now, locally, with no
sign-in screen. The gate only appears once the API answers at the same origin.

## Why same origin matters

The session cookie is `HttpOnly; SameSite=Lax`, and mutations carry a
same-origin check. Both depend on the API living at
`gym.rsmotocons.com/api/*` — not a separate `api.` subdomain. A Worker with an
assets binding does that in one deployment. Pages alone cannot, because Pages
serves static files only.

If the API ends up on a different host, the cookie stops being sent and every
request fails, so keep them together.

## Steps

```bash
# 1. the database
wrangler d1 create recomp
#    put the returned database_id into backend/wrangler.toml

# 2. the tables
wrangler d1 execute recomp --remote --file=backend/schema.sql

# 3. your owner password, generated on YOUR machine and never transmitted
node backend/setup.js rsmotocons@gmail.com --show-only
#    copy the password into a password manager, then:

wrangler secret put OWNER_EMAIL              # rsmotocons@gmail.com
wrangler secret put BOOTSTRAP_OWNER_PASSWORD # paste the generated password

# 4. deploy the Worker, which also serves the PWA
wrangler deploy
```

`wrangler.toml` binds `DB` to D1 and `ASSETS` to the static app. Secrets are
never in `wrangler.toml` and never in the repository.

### First run

Hit `POST /api/bootstrap` once (or let the Node server do it on start). The
owner account is created, then the bootstrap writes `bootstrap_done` to `meta`
and refuses to run again, so nobody can re-trigger it to mint a second owner.

Sign in. You are forced to change the password before anything else answers.

## What happens to the data already on your phone

Nothing is lost. On first sign-in the app notices the training data saved under
the old unscoped key, previews it (how many sessions are new, how many are
duplicates, the date range) and asks before importing. Duplicates are skipped by
session id, so running it twice changes nothing.

After that, local storage is namespaced per account —
`recomp.u.<accountId>.state` — so two people on one phone keep separate data and
signing out deletes only the account that signed out.

## Offline policy

The app works offline for about three days after the last successful session
check, then requires reconnecting. Local caches are cleared on logout and the
service worker never caches `/api/` responses.

**An honest limitation:** a device that is offline cannot be told its account
was revoked. It keeps what it already has until it next reaches the server.
That is inherent to offline-capable apps.

## Running it locally first

```bash
node backend/setup.js rsmotocons@gmail.com     # creates ./recomp.sqlite
DB_PATH=./recomp.sqlite STATIC_ROOT=. node backend/server.js
# → http://localhost:8787
```

Same code, same API, SQLite instead of D1.
