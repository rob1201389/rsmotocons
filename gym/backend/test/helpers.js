/* Shared test harness for the sign-up, AI and weekly-submission suites. */
import { createApp } from '../server.js';

export function harness() {
  const h = { pass: 0, fail: 0, fails: [] };
  h.t = async (n, f) => { try { await f(); h.pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
    catch (e) { h.fail++; h.fails.push([n, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + n + '\n       ' + e.message); } };
  h.ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
  h.eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
  h.sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');
  h.finish = (...closers) => {
    console.log('\n' + '='.repeat(62));
    console.log(`  ${h.pass} passed, ${h.fail} failed`);
    console.log('='.repeat(62));
    if (h.fail) h.fails.forEach(([n, m]) => console.log(` - ${n}\n   ${m}`));
    closers.forEach(c => { try { c(); } catch (e) {} });
    process.exit(h.fail ? 1 : 0);
  };
  return h;
}

export const OWNER_PW = 'Owner-Passphrase-99';
export const OWNER_NEW = 'Owner-New-Passphrase-7';
export const GOOD_PW = 'Sign-Up-Pass-12';

let ipCounter = 0;
export const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`;

/* Starts an app and returns a client factory. Each client has its own cookie jar
   and, unless told otherwise, its own client address (so per-IP limits do not
   leak between unrelated tests). */
export async function startApp(opts = {}) {
  const env = Object.assign({ OWNER_EMAIL: 'owner@example.test', OWNER_NAME: 'Owner',
    BOOTSTRAP_OWNER_PASSWORD: OWNER_PW, MAIL_PROVIDER: 'outbox' }, opts.env || {});
  const { server, db } = await createApp({ env, fetch: opts.fetch, aiTimeoutMs: opts.aiTimeoutMs });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  function client(ip) {
    let cookie = null;
    const addr = ip || nextIp();
    return {
      ip: addr,
      get cookie() { return cookie; },
      set cookie(v) { cookie = v; },
      async fetch(path, o = {}) {
        const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Recomp-Request': '1',
          'X-Forwarded-For': addr }, o.headers || {});
        if (cookie) headers.Cookie = cookie;
        const res = await fetch(BASE + path, { method: o.method || 'GET', headers,
          body: o.body !== undefined ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) : undefined });
        const sc = res.headers.get('set-cookie');
        if (sc) { const v = sc.split(';')[0]; cookie = v.endsWith('=') ? null : v; }
        let data = null; try { data = await res.json(); } catch (e) {}
        return { status: res.status, data, headers: res.headers, hadSetCookie: !!sc };
      },
      post(path, body) { return this.fetch(path, { method: 'POST', body: body || {} }); },
      patch(path, body) { return this.fetch(path, { method: 'PATCH', body: body || {} }); },
      put(path, body) { return this.fetch(path, { method: 'PUT', body: body || {} }); }
    };
  }
  /* Signs the bootstrap owner in with the final password. */
  async function ownerClient() {
    const c = client();
    let r = await c.post('/api/auth/login', { email: 'owner@example.test', password: OWNER_PW });
    if (r.status === 200 && r.data.user.mustChangePassword) {
      await c.post('/api/auth/password', { current: OWNER_PW, next: OWNER_NEW });
    }
    return c;
  }
  /* Creates an active account directly and signs it in. */
  async function makeUser(owner, email, role, extra = {}) {
    const pw = extra.password || 'Member-Pass-4567';
    const r = await owner.post('/api/admin/users', { email, password: pw, role: role || 'member',
      status: extra.status || 'active', name: extra.name || email.split('@')[0], permissions: extra.permissions });
    if (r.status !== 200) throw new Error('makeUser failed: ' + JSON.stringify(r.data));
    db.run('UPDATE users SET must_change_pw = 0 WHERE id = ?', r.data.id);
    const c = client();
    const l = await c.post('/api/auth/login', { email, password: pw });
    if (l.status !== 200) throw new Error('makeUser login failed: ' + JSON.stringify(l.data));
    return { id: r.data.id, c, email, password: pw };
  }
  return { BASE, db, server, env, client, ownerClient, makeUser, close: () => { server.close(); db.close(); } };
}
