/* Cloudflare Workers entry. Same handler, D1 instead of sqlite.
   Bind a D1 database as `DB`, and set OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD
   as secrets, never in wrangler config.

   Only /api/* reaches this code (run_worker_first in wrangler.jsonc); static
   files are served straight from the assets binding. */
import { d1Db } from './src/db.js';
import { handle } from './src/api.js';
import { bootstrapOwner } from './src/auth.js';

// The owner is created from the secrets on the first API request after they
// exist, so no one has to POST /api/bootstrap by hand. bootstrapOwner is
// idempotent and disables itself once it has run.
let bootstrapped = false;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    const db = d1Db(env.DB);
    if (!bootstrapped) {
      const r = await bootstrapOwner(db, env, Date.now());
      if (r.ok || r.reason === 'already_bootstrapped' || r.reason === 'owner_exists') bootstrapped = true;
      else console.warn('bootstrap pending:', r.reason);
    }
    const res = await handle(request, { db, env, ip: request.headers.get('cf-connecting-ip') });
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    out.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    out.headers.set('X-Frame-Options', 'DENY');
    return out;
  }
};
