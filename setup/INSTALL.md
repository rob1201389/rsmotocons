
## Automatic deployment

A push to `main` deploys, via `.github/workflows/deploy.yml`.

It needs two repository secrets — GitHub → Settings → Secrets and variables →
Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | a token with **Workers Scripts: Edit** on the account |
| `CLOUDFLARE_ACCOUNT_ID` | `49579a2f6e0e3a3cfe6ab9cd31f1db59` |

Make a fresh token for this rather than reusing one that has been pasted into a
chat or an email. Workers Scripts: Edit is the only permission it needs — the
workflow does not touch D1, KV or Access.

`wrangler deploy` does not alter secrets. `DATA_KEY`, `SESSION_SECRET`,
`DRIVER_PIN` and `ADMIN_PASSWORD` are set on the worker, not in
`wrangler.jsonc`, so they survive every deploy.

The workflow skips `.md` files and `setup/`, so editing documentation does not
redeploy. "Run workflow" on the Actions tab republishes the current `main`
without needing a commit.
