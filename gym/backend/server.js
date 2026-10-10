/* Node entry point. Serves the API and the static PWA from one origin, which
   is what makes the SameSite cookie and the same-origin CSRF check work. */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { nodeDb } from './src/db.js';
import { handle } from './src/api.js';
import { bootstrapOwner } from './src/auth.js';

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.png':'image/png', '.svg':'image/svg+xml' };

export async function createApp(opts = {}) {
  const db = nodeDb(DatabaseSync, opts.dbPath || ':memory:');
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  db.exec(schema);
  const env = opts.env || process.env;
  const staticRoot = opts.staticRoot || null;

  if (env.OWNER_EMAIL && env.BOOTSTRAP_OWNER_PASSWORD) {
    const r = await bootstrapOwner(db, env, Date.now());
    if (r.ok) console.log(`[bootstrap] owner created: ${r.email} (must change password on first login)`);
    else if (r.reason === 'weak_bootstrap_password') console.error('[bootstrap] ' + r.message);
    else console.log('[bootstrap] skipped: ' + r.reason);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
        });
        const out = await handle(request, { db, env, ip: req.socket.remoteAddress });
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
      if (!staticRoot) { res.writeHead(404); res.end('Not found'); return; }
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (p === '/' || p === '\\') p = '/index.html';
      const file = join(staticRoot, p);
      if (!file.startsWith(staticRoot)) { res.writeHead(403); res.end('Forbidden'); return; }
      try {
        const buf = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(buf);
      } catch (e) {
        const buf = await readFile(join(staticRoot, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(buf);
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error' }));
      console.error(e);
    }
  });
  return { server, db };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server } = await createApp({
    dbPath: process.env.DB_PATH || './recomp.sqlite',
    staticRoot: process.env.STATIC_ROOT || new URL('../', import.meta.url).pathname
  });
  const port = parseInt(process.env.PORT || '8787', 10);
  server.listen(port, () => console.log(`Recomp on http://localhost:${port}`));
}
