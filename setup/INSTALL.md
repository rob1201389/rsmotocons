# Installing on rsmotocons.com

The trade plate app runs as a Cloudflare Pages Function on the site you already
have. No second host, no proxy, no extra bill — it serves from
`rsmotocons.com/members/tradeplate` and uses the site's own stylesheet, so it
looks like the rest of the members area.

Everything in this folder is a drop-in for the site repo.

| From here | Goes in the site repo at |
| --- | --- |
| `functions/members/tradeplate/[[path]].ts` | `functions/members/tradeplate/[[path]].ts` |
| `members/tradeplate/app.js` | `members/tradeplate/app.js` |
| `members/tradeplate/tradeplate.css` | `members/tradeplate/tradeplate.css` |
| `members/tradeplate/qrcode.min.js` | `members/tradeplate/qrcode.min.js` |
| `members/index.html` | `members/index.html` (replaces it — adds the live tile) |
| `_headers.add` | append its contents to the existing `_headers` |
| `_redirects` | new — keeps `.dev.vars`, `.sql` and `wrangler.toml` from being served |

`schema.sql`, `plates.sql` and `wrangler.toml` stay out of the deployed site —
they are setup files you run once.

## One-time setup

### 1. Create the database

```bash
npx wrangler d1 create tradeplate --location oc
```

`--location oc` asks for Oceania, which keeps the data in this part of the
world. Check the dashboard afterwards and confirm where it actually landed; if
Oceania is not offered on your plan, `apac` is the next closest. This matters
because the records hold driver names, licence numbers and signatures.

The command prints a `database_id`. Put it in `site/wrangler.toml`, and add the
same binding in the Pages dashboard under **Settings → Functions → D1 database
bindings**:

- Variable name: `DB`
- Database: `tradeplate`

### 2. Create the tables and load the plates

Run these from `site/`, where `wrangler.toml` lives:

```bash
npx wrangler d1 execute tradeplate --remote --file=../setup/schema.sql
npx wrangler d1 execute tradeplate --remote --file=../setup/plates.sql
```

`plates.sql` loads A3178, A3180, A3181, A3182, A3263, A3264, A3265, A3266,
A3281, A3282, A3283 and A3284, each with its own random scan code. Expiry dates
are left blank — set them in the app once it is up.

### 3. Set the secrets

In the Pages dashboard, **Settings → Environment variables**, for Production
(and Preview if you use it). Mark the first three as **Secret**, not plaintext.

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | the office password |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 32`) |
| `DRIVER_PIN` | a short PIN the drivers share, e.g. `4821` |
| `ORG_NAME` | the business name for the privacy notice |
| `PRIVACY_CONTACT` | e.g. `the Privacy Officer` |
| `PRIVACY_CONTACT_EMAIL` | e.g. `info@rsmotocons.com` |
| `PRIVACY_CONTACT_PHONE` | optional |
| `RETENTION_YEARS` | e.g. `5` |

`DRIVER_PIN` is optional. Leave it unset and anyone holding a plate's QR link
can write a record; set it and each phone is asked once every 60 days. Set it.

Changing `SESSION_SECRET` signs everyone out immediately, which is what you
want when someone leaves.

### 4. Deploy

Push the site repo as usual, or:

```bash
npx wrangler pages deploy .
```

Then open `rsmotocons.com/members/tradeplate/admin`, sign in, and set the expiry
date against each plate.

### 5. Print the labels

`/members/tradeplate/admin/plates/print` gives you a cut-out sheet — one QR per
plate, each encoding that plate's own link. Print on adhesive label stock,
laminate, fix to the back of the matching plate.

Each code is unique to its plate, so they cannot be swapped around by mistake.
Reprint the sheet whenever you add a plate.

## Running it locally first

```bash
cd site
cat > .dev.vars <<'EOF'
ADMIN_PASSWORD=test-password
SESSION_SECRET=local-dev-session-secret-0123456789
DRIVER_PIN=4821
ORG_NAME=RS Motocons Pty Ltd
PRIVACY_CONTACT_EMAIL=info@rsmotocons.com
RETENTION_YEARS=5
EOF

npx wrangler pages dev . --port 8788
```

Then in a second terminal, from `site/`:

```bash
npx wrangler d1 execute DB --local --file=../setup/schema.sql
npx wrangler d1 execute DB --local --file=../setup/plates.sql
```

Then open `http://localhost:8788/members/tradeplate/`.

## How it fits the existing site

- **CSP.** The site forbids inline scripts. All behaviour is in
  `/members/tradeplate/app.js`, and the QR library is served from your own
  origin rather than a CDN, so nothing in the existing policy needs loosening.
- **The catch-all route.** `[[path]].ts` matches everything under
  `/members/tradeplate`, including its own `app.js` and `tradeplate.css`. The
  Function passes those three filenames straight through to Pages. If you add
  another static file under that path, add its name to `STATIC_FILES` at the top
  of the Function or it will 404.
- **Headers.** `/members/*` is already `noindex` and `no-store`. The addition in
  `_headers.add` adds `no-referrer` for the plate pages, because a plate URL is
  effectively a key and should not leak in a referrer header.
- **Driver IPs.** Cloudflare supplies `CF-Connecting-IP`, so each entry records
  the phone that made it without any extra configuration.
- **Files Pages serves by default.** Anything in the deployed folder is public
  unless something stops it. Checked on a real build: `.dev.vars`, `.sql` files
  and `wrangler.toml` all return 200. `_redirects` bounces those four to the 404
  page. Keep the setup files out of the deployed folder regardless — the
  redirect is the second line of defence, not the first.

## Costs

At a dozen plates and a few hundred trips a month this sits inside the
Cloudflare free tier: Pages Functions bill per request, D1 per row read and
written, and neither will come close to the free allowance. Signatures are stored
inline in the record as PNG data, so there is no object storage to pay for.

## Retention

Nothing is deleted automatically. When you are ready to enforce the retention
period, from the site repo:

```bash
npx wrangler d1 execute tradeplate --remote --command \
  "DELETE FROM trips WHERE in_at IS NOT NULL AND out_at < date('now','-5 year')"
```

Check what it would remove first:

```bash
npx wrangler d1 execute tradeplate --remote --command \
  "SELECT COUNT(*) FROM trips WHERE in_at IS NOT NULL AND out_at < date('now','-5 year')"
```

Open records are never touched — a plate that has not come back is still in use.
Confirm the period that applies to you before deleting anything; once it is
gone it is gone.

## Backups

D1 has time travel: `npx wrangler d1 time-travel restore tradeplate --timestamp=...`
restores to a point in the last 30 days. For anything longer, export on a
schedule:

```bash
npx wrangler d1 export tradeplate --remote --output=tradeplate-$(date +%F).sql
```

A record of use you cannot produce is worse than no system at all, so take an
export before any change to the plates and keep it somewhere off Cloudflare.
