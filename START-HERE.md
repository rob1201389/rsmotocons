# RSMotoCons — Trade Plate Log

Your site with the trade plate app added. It serves from
`rsmotocons.com/members/tradeplate` as a Cloudflare Pages Function, using your
existing `site.css`, header and footer.

## What's in here

```
site/     ← deploy this folder to Cloudflare Pages
setup/    ← run these once, do NOT deploy them
```

**Deploy `site/`, not the whole zip.** `setup/plates.sql` holds every plate's
scan code. Cloudflare Pages serves any file it doesn't recognise, so a copy of
it sitting in the deployed folder would be readable at
`rsmotocons.com/plates.sql` by anyone. I checked this on a real Pages build:
`.dev.vars`, `.sql` files and `wrangler.toml` all return 200 by default.

`site/_redirects` is a safety net that bounces those four filenames to the 404
page, so a stray copy can't leak. Treat it as the second line of defence, not
the first — keep the files out of `site/`.

## What changed in `site/`

Everything else is exactly as you sent it.

| File | Change |
| --- | --- |
| `functions/members/tradeplate/[[path]].ts` | new — the whole app |
| `members/tradeplate/app.js` | new — signature pad, "Now" button, QR rendering |
| `members/tradeplate/tradeplate.css` | new — extends `site.css`, reuses its tokens |
| `members/tradeplate/qrcode.min.js` | new — QR library, vendored so the CSP stays as-is |
| `members/index.html` | Trade Plate Log tile added, marked Live |
| `_headers` | four rules appended for `/members/tradeplate/*` |
| `_redirects` | new — blocks `.dev.vars`, `.sql` and `wrangler.toml` from being served |
| `wrangler.toml` | new — the D1 binding, so `wrangler d1` commands work from `site/` |

## Get it running (about ten minutes)

From inside `site/`:

```bash
# 1. Database, in Oceania
npx wrangler d1 create tradeplate --location oc

# 2. Put the printed database_id into site/wrangler.toml, then:
npx wrangler d1 execute tradeplate --remote --file=../setup/schema.sql
npx wrangler d1 execute tradeplate --remote --file=../setup/plates.sql
```

Then in the Cloudflare Pages dashboard for the site:

- **Settings → Functions → D1 database bindings**: variable `DB` → database `tradeplate`
- **Settings → Environment variables**: set `ADMIN_PASSWORD`, `SESSION_SECRET`
  and `DRIVER_PIN` as **Secrets**, plus `ORG_NAME`, `PRIVACY_CONTACT`,
  `PRIVACY_CONTACT_EMAIL` and `RETENTION_YEARS` as plain variables.

Deploy `site/`, then open `/members/tradeplate/admin`, sign in, and set the
expiry date against each of the twelve plates.

Last step: `/members/tradeplate/admin/plates/print` gives you the QR label
sheet. Print on adhesive stock, laminate, fix one to the back of the matching
plate. Each code is unique to its plate, so they can't be swapped by mistake.

`setup/INSTALL.md` has the detail — local testing, retention, backups, and why
each piece is built the way it is.

## Try it locally first

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

In a second terminal:

```bash
cd site
npx wrangler d1 execute DB --local --file=../setup/schema.sql
npx wrangler d1 execute DB --local --file=../setup/plates.sql
```

Open <http://localhost:8788/members/tradeplate/>. Sign in to the office with
`test-password`, and the driver PIN is `4821`.

Delete `.dev.vars` and the `.wrangler/` folder from `site/` before you deploy.
