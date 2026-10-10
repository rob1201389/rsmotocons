# Backup and restore

## What exists

D1 Time Travel keeps point-in-time history of the `recomp` database: 30 days on the Workers
Paid plan, 7 days on Free (Cloudflare documentation). Nothing has to be switched on. There
is no separate off-platform backup unless the operator makes one (below).

## Restore drill (do this once, then every quarter)

Run from `gym/` with a Cloudflare token that can edit D1.

```sh
# 1. Record where you are now, so the restore can be undone
npx wrangler d1 time-travel info recomp
# 2. Choose a time and see the bookmark for it (RFC 3339 or Unix seconds)
npx wrangler d1 time-travel info recomp --timestamp=2026-10-10T09:00:00+10:00
# 3. Restore (overwrites the live database; the command prints the bookmark to undo it)
npx wrangler d1 time-travel restore recomp --bookmark=<bookmark from step 2>
# 4. Check
npx wrangler d1 execute recomp --remote --command="SELECT COUNT(*) FROM users"
```

For a drill without touching production, create a scratch database, export production into
it and restore that instead:

```sh
npx wrangler d1 export recomp --remote --output=recomp-export.sql
npx wrangler d1 create recomp-drill
npx wrangler d1 execute recomp-drill --remote --file=recomp-export.sql
```

The export file holds personal and health information. Keep it encrypted, delete it after
the drill, and never commit it.

The audit triggers are part of the database, so they come back with a restore. If they are
missing, a newly started Worker recreates them on its first request (`src/protect.js`).

## What has been demonstrated

`security.test.js` "a database copy can be restored and the data verified" copies a live
SQLite database with `VACUUM INTO`, opens the copy and checks the row counts, that training
data is still encrypted and opens with the key, and that the audit triggers came with it. That shows a copy keeps its data, encryption and protection. A production Time Travel restore has
**not** been run yet: record the date and result here when it is.

| Date | Who | Database | Result |
|---|---|---|---|
| | | | |

## Encryption key

Encrypted fields need `DATA_ENC_KEY`. A restored database is useless without the key that was
active when the rows were written. Keep the key in a password manager outside Cloudflare.

Rotation: set `DATA_ENC_KEY_PREVIOUS` to the old key, `DATA_ENC_KEY` to a new one and
`DATA_ENC_KEY_ID` to a new label (for example `k2`). Rows are re-encrypted on their next write,
so keep the previous key until no row with the old label remains:

```sh
npx wrangler d1 execute recomp --remote --command="SELECT COUNT(*) FROM user_state WHERE doc LIKE 'enc1:k1:%'"
```
