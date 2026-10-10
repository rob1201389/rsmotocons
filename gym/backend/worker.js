/* Cloudflare Workers entry. Same handler, D1 instead of sqlite.
   Bind a D1 database as `DB`, and set OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD
   as secrets (wrangler secret put), never in wrangler.toml. */
import { d1Db } from './src/db.js';
import { handle } from './src/api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    const db = d1Db(env.DB);
    return handle(request, { db, env, ip: request.headers.get('cf-connecting-ip') });
  }
};
