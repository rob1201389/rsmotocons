/* Cloudflare Workers entry. Same handler, D1 instead of sqlite.
   Bind a D1 database as `DB` and set OWNER_EMAIL as a secret. The owner chooses
   their own password in the app the first time (POST /api/auth/setup).

   Only /api/* reaches this code (run_worker_first in wrangler.jsonc); static
   files are served straight from the assets binding. */
import { d1Db } from './src/db.js';
import { handle } from './src/api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    try {
    const db = d1Db(env.DB);
    const res = await handle(request, { db, env, ip: request.headers.get('cf-connecting-ip'), trustIp: true });
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    out.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    out.headers.set('X-Frame-Options', 'DENY');
    return out;
    } catch (e) {
      // Plain JSON instead of Cloudflare's error page; detail stays in the log.
      console.error('api error:', e && e.message);
      return new Response(JSON.stringify({ error: 'Server error.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
  }
};
