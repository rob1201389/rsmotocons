/* Shared test harness for the sign-up, AI and weekly-submission suites. */
import { createApp } from '../server.js';
import { hotp, base32Decode } from '../src/crypto.js';

/* A TOTP code for a secret, computed the way an authenticator app does. */
export async function totpCode(secret, stepOffset = 0) { return hotp(base32Decode(secret), Math.floor(Date.now() / 30000) + stepOffset, 6); }
export const CONSENT = { privacyNoticeVersion: '2026-10-11.1', healthConsent: true };

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
    BOOTSTRAP_OWNER_PASSWORD: OWNER_PW, MAIL_PROVIDER: 'outbox', HIBP_CHECK: 'off' }, opts.env || {});
  const { server, db } = await createApp({ env, fetch: opts.fetch, hibpFetch: opts.hibpFetch, aiTimeoutMs: opts.aiTimeoutMs });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  function client(ip) {
    let cookie = null; const jar = {};
    const addr = ip || nextIp();
    return {
      ip: addr,
      get cookie() { return cookie; },
      set cookie(v) { cookie = v; for (const k in jar) delete jar[k]; if (v) jar[v.split('=')[0]] = v; },
      async fetch(path, o = {}) {
        const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Recomp-Request': '1',
          'X-Forwarded-For': addr }, o.headers || {});
        if (cookie) headers.Cookie = cookie;
        const res = await fetch(BASE + path, { method: o.method || 'GET', headers,
          body: o.body !== undefined ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) : undefined });
        const scs = res.headers.getSetCookie();
        for (const sc of scs) { const v = sc.split(';')[0], name = v.split('=')[0]; jar[name] = v.endsWith('=') ? null : v; }
        if (scs.length) cookie = Object.values(jar).filter(Boolean).join('; ') || null;
        const sc = scs.length ? scs.join(', ') : null;
        let data = null; try { data = await res.json(); } catch (e) {}
        return { status: res.status, data, headers: res.headers, hadSetCookie: !!sc };
      },
      post(path, body) { return this.fetch(path, { method: 'POST', body: body || {} }); },
      patch(path, body) { return this.fetch(path, { method: 'PATCH', body: body || {} }); },
      put(path, body) { return this.fetch(path, { method: 'PUT', body: body || {} }); }
    };
  }
  /* Turns on two-step verification for a signed-in client and remembers the secret. */
  async function enrolTotp(c) {
    const b = await c.post('/api/auth/mfa/totp/begin', {});
    if (b.status !== 200) throw new Error('totp begin failed: ' + JSON.stringify(b.data));
    const conf = await c.post('/api/auth/mfa/totp/confirm', { code: await totpCode(b.data.secret) });
    if (conf.status !== 200) throw new Error('totp confirm failed: ' + JSON.stringify(conf.data));
    c.totpSecret = b.data.secret; c.recoveryCodes = conf.data.recoveryCodes;
    return c;
  }
  /* Signs the bootstrap owner in with the final password. Owners must use two-step
     verification, so the owner fixture enrols an authenticator app. */
  async function ownerClient() {
    const c = client();
    let r = await c.post('/api/auth/login', { email: 'owner@example.test', password: OWNER_PW });
    if (r.status === 200 && r.data.user && r.data.user.mustChangePassword) {
      await c.post('/api/auth/password', { current: OWNER_PW, next: OWNER_NEW });
    }
    if (r.status === 200 && r.data.mfaRequired) throw new Error('ownerClient: owner already has MFA; use loginWithMfa');
    await enrolTotp(c);
    app.ownerSecret = c.totpSecret;
    return c;
  }
  /* Password then authenticator code, as a person would. */
  async function loginWithMfa(c, email, password, secret, offset) {
    const r = await c.post('/api/auth/login', { email, password });
    if (r.status !== 200 || !r.data.mfaRequired) return r;
    return c.post('/api/auth/mfa/verify', { code: await totpCode(secret, offset == null ? 1 : offset) });
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
    if (role === 'admin' || role === 'owner') await enrolTotp(c);
    if (opts.aiOn) { const st = await c.put('/api/settings', { aiReviews: true }); if (st.status !== 200) throw new Error('aiOn failed: ' + JSON.stringify(st.data)); }
    return { id: r.data.id, c, email, password: pw, secret: c.totpSecret };
  }
  const app = { BASE, db, server, env, client, ownerClient, makeUser, enrolTotp, loginWithMfa, totpCode, close: () => { server.close(); db.close(); } };
  return app;
}
