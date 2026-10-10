/* Front-end auth integration: a real jsdom browser against the real backend. */
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createApp } from './backend/server.js';

let pass = 0, fail = 0; const fails = [];
const t = async (n, f) => { try { await f(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  catch (e) { fail++; fails.push([n, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + n + '\n       ' + e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const eq = (a,b,m) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error((m||'')+` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');
const wait = ms => new Promise(r => setTimeout(r, ms));

const OWNER_PW = 'Owner-Setup-Passphrase-1';
const { server, db } = await createApp({
  env: { OWNER_EMAIL: 'owner@test.local', OWNER_NAME: 'Owner', BOOTSTRAP_OWNER_PASSWORD: OWNER_PW },
  staticRoot: new URL('./', import.meta.url).pathname
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* Seed accounts through the API, the way an admin would. */
async function raw(path, opts = {}, cookie) {
  const h = { 'Content-Type': 'application/json', 'X-Recomp-Request': '1' };
  if (cookie) h.Cookie = cookie;
  const res = await fetch(BASE + path, { method: opts.method || 'GET', headers: h,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const sc = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => ({})),
           cookie: sc ? sc.split(';')[0] : null };
}
let ownerCk = (await raw('/api/auth/login', { method: 'POST',
  body: { email: 'owner@test.local', password: OWNER_PW } })).cookie;
await raw('/api/auth/password', { method: 'POST',
  body: { current: OWNER_PW, next: 'Owner-Live-Passphrase-2' } }, ownerCk);
ownerCk = (await raw('/api/auth/login', { method: 'POST',
  body: { email: 'owner@test.local', password: 'Owner-Live-Passphrase-2' } })).cookie; // gitleaks:allow (synthetic test credential)
const mk = async (email, pw, role, perms) => (await raw('/api/admin/users', { method: 'POST',
  body: { email, password: pw, role, permissions: perms } }, ownerCk)).data.id;
const ALICE = await mk('alice@test.local', 'Alice-Temp-Passphrase-1', 'member');
const BOB   = await mk('bob@test.local',   'Bob-Temp-Passphrase-2',   'member', { nutrition: false, progress: false });

function browser() {
  return new Promise(async resolve => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    const jar = new Map();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: BASE + '/index.html',
      pretendToBeVisual: true,
      beforeParse(w) {
        w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 16);
        w.cancelAnimationFrame = i => clearTimeout(i);
        w.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
        w.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){} });
        w.indexedDB = undefined; w.scrollTo = () => {}; w.confirm = () => true; w.alert = () => {};
        w.navigator.vibrate = () => true;
        /* jsdom ships no fetch, and no cookie jar for one. Provide both, so
           the page talks to the real server exactly as a browser would. */
        w.fetch = (url, opts = {}) => {
          const abs = String(url).startsWith('http') ? String(url) : BASE + String(url);
          const headers = Object.assign({}, opts.headers || {});
          const ck = [...jar.entries()].map(([k,v]) => `${k}=${v}`).join('; ');
          if (ck) headers.Cookie = ck;
          return globalThis.fetch(abs, Object.assign({}, opts, { headers })).then(res => {
            const sc = res.headers.get('set-cookie');
            if (sc) sc.split(/,(?=[^;]+=)/).forEach(one => {
              const [kv, ...attrs] = one.split(';');
              const [k, v] = kv.trim().split('=');
              const maxAge = attrs.find(a => /max-age/i.test(a));
              if (maxAge && /=\s*0\s*$/.test(maxAge)) jar.delete(k); else jar.set(k, v);
            });
            return res;
          });
        };
        w.Headers = globalThis.Headers; w.Request = globalThis.Request; w.Response = globalThis.Response;
        w.caches = undefined;
      }
    });
    setTimeout(() => resolve({ dom, w: dom.window, d: dom.window.document, jar }), 900);
  });
}

/* ========================================================================= */
sec('THE APP IS BEHIND THE GATE');
const b1 = await browser();
await t('an unauthenticated visit shows the sign-in screen, not the app', async () => {
  ok(!b1.d.querySelector('#authGate').hidden, 'gate not shown');
  ok(!b1.d.querySelector('#loginForm').hidden, 'login form not shown');
  ok(b1.d.body.classList.contains('locked'), 'body not locked');
});
await t('no training data is rendered before sign-in', async () => {
  eq(b1.d.querySelectorAll('#exList .ex').length, 0);
});

sec('FIRST LOGIN FORCES A PASSWORD CHANGE');
await t('signing in with the temporary password shows the password screen', async () => {
  b1.d.querySelector('#loginEmail').value = 'alice@test.local';
  b1.d.querySelector('#loginPassword').value = 'Alice-Temp-Passphrase-1';
  b1.d.querySelector('#loginForm').dispatchEvent(new b1.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  ok(!b1.d.querySelector('#pwForm').hidden, 'password form not shown');
  ok(b1.d.querySelector('#authGate').hidden === false, 'gate closed too early');
});
await t('mismatched new passwords are refused client-side', async () => {
  b1.d.querySelector('#pwCurrent').value = 'Alice-Temp-Passphrase-1';
  b1.d.querySelector('#pwNext').value = 'Alice-Real-Passphrase-9';
  b1.d.querySelector('#pwConfirm').value = 'Alice-Different-9';
  b1.d.querySelector('#pwForm').dispatchEvent(new b1.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(300);
  /* The pop-up reports a mismatch beside the field, not in the form-level alert. */
  ok(!b1.d.querySelector('#pwConfirm-err').hidden, 'no error shown');
});
await t('setting the new password opens the app', async () => {
  b1.d.querySelector('#pwCurrent').value = 'Alice-Temp-Passphrase-1';
  b1.d.querySelector('#pwNext').value = 'Alice-Real-Passphrase-9';
  b1.d.querySelector('#pwConfirm').value = 'Alice-Real-Passphrase-9';
  b1.d.querySelector('#pwForm').dispatchEvent(new b1.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);
  ok(b1.d.querySelector('#authGate').hidden, 'gate still showing');
  ok(!b1.d.body.classList.contains('locked'), 'body still locked');
  ok(!b1.d.querySelector('#acctBtn').hidden, 'no account control');
});

sec('DATA IS SCOPED TO THE ACCOUNT AND SYNCED TO THE SERVER');
await t('local storage is namespaced by account id', async () => {
  const keys = Object.keys(b1.w.localStorage);
  ok(keys.some(k => k.startsWith(`recomp.u.${ALICE}.`)), keys.join(','));
  ok(!keys.includes('recomp.v3'), 'wrote to the old unscoped key');
});
await t('a logged session reaches the server', async () => {
  b1.w.__recomp.startSession(b1.w.__recomp.nextDay(), null);
  await b1.w.__recomp.pushToServer();
  await wait(300);
  const r = await raw('/api/state', {}, null);
  eq(r.status, 401, 'state readable without a cookie');
  const row = db.get('SELECT doc FROM user_state WHERE user_id = ?', ALICE);
  ok(row, 'nothing stored for Alice');
  ok(JSON.parse(row.doc).sessions.length >= 1, 'session not synced');
});

sec('A SECOND ACCOUNT ON THE SAME DEVICE SEES NOTHING OF THE FIRST');
await t('logging out clears that account\'s local data', async () => {
  await b1.w.AUTH.logout();
  const keys = Object.keys(b1.w.localStorage);
  ok(!keys.some(k => k.startsWith(`recomp.u.${ALICE}.`)), 'Alice data survived logout: ' + keys.join(','));
  ok(!keys.includes('recomp.lastUser'), 'last user not cleared');
});
const b2 = await browser();
await t('Bob signs in on the same device and sees no Alice data', async () => {
  b2.d.querySelector('#loginEmail').value = 'bob@test.local';
  b2.d.querySelector('#loginPassword').value = 'Bob-Temp-Passphrase-2';
  b2.d.querySelector('#loginForm').dispatchEvent(new b2.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  b2.d.querySelector('#pwCurrent').value = 'Bob-Temp-Passphrase-2';
  b2.d.querySelector('#pwNext').value = 'Bob-Real-Passphrase-8';
  b2.d.querySelector('#pwConfirm').value = 'Bob-Real-Passphrase-8';
  b2.d.querySelector('#pwForm').dispatchEvent(new b2.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);
  eq(b2.w.__recomp.S.sessions.length, 0, 'Bob can see Alice\'s sessions');
  const keys = Object.keys(b2.w.localStorage);
  ok(!keys.some(k => k.startsWith(`recomp.u.${ALICE}.`)), 'Alice keys present in Bob\'s session');
});

sec('FEATURE PERMISSIONS CHANGE THE INTERFACE AND THE API');
await t('Bob has nutrition and progress switched off', async () => {
  const u = b2.w.AUTH.user();
  eq(u.permissions.nutrition, false);
  eq(u.permissions.progress, false);
  eq(u.permissions.training, true);
});
await t('the Progress tab is removed, not merely dimmed', async () => {
  b2.w.__recomp.applyPermissions();
  ok(b2.d.querySelector('[data-tab="progress"]').hidden, 'Progress tab still present');
  ok(!b2.d.querySelector('[data-tab="train"]').hidden, 'Train tab wrongly hidden');
});
await t('the nutrition card is removed from Today', async () => {
  ok(b2.d.querySelector('#fuelCard').hidden, 'fuel card still shown');
});
await t('navigating to a forbidden tab is refused', async () => {
  b2.w.__recomp.go('progress');
  ok(b2.d.getElementById('p-progress').hidden, 'forbidden panel was opened');
});
await t('and the API refuses it too, independently of the UI', async () => {
  await raw('/api/admin/users/' + BOB, { method: 'PATCH', body: { permissions: { training: false } } }, ownerCk);
  const r = await b2.w.AUTH.pullState();
  eq(r.forbidden, true, 'API allowed training data after it was revoked');
  await raw('/api/admin/users/' + BOB, { method: 'PATCH', body: { permissions: { training: true } } }, ownerCk);
});

sec('SUSPENSION REACHES AN OPEN APP');
await t('suspending Bob makes his next request fail and returns him to the gate', async () => {
  await raw('/api/admin/users/' + BOB, { method: 'PATCH', body: { status: 'suspended' } }, ownerCk);
  const r = await b2.w.AUTH.refresh();
  eq(r.state, 'anonymous', 'suspended account still looked authenticated');
  const pull = await b2.w.AUTH.pullState();
  ok(!pull.ok, 'suspended account still read data');
});

sec('OFFLINE IS BOUNDED');
await t('a recently verified device keeps working offline', async () => {
  const b3 = await browser();
  b3.d.querySelector('#loginEmail').value = 'alice@test.local';
  b3.d.querySelector('#loginPassword').value = 'Alice-Real-Passphrase-9';
  b3.d.querySelector('#loginForm').dispatchEvent(new b3.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1200);
  ok(b3.d.querySelector('#authGate').hidden, 'did not sign in');
  const realFetch = b3.w.fetch;
  b3.w.fetch = () => Promise.reject(new TypeError('offline'));
  const r = await b3.w.AUTH.refresh();
  eq(r.state, 'offline', 'offline device was locked out inside the grace window');
  ok(r.user.id === ALICE);
  b3.w.fetch = realFetch;
});
await t('an expired offline window forces a sign-in', async () => {
  const b4 = await browser();
  b4.w.localStorage.setItem('recomp.lastUser', ALICE);
  b4.w.localStorage.setItem('recomp.lastVerified', String(Date.now() - 10 * 24 * 3600 * 1000));
  b4.w.fetch = () => Promise.reject(new TypeError('offline'));
  const r = await b4.w.AUTH.refresh();
  eq(r.state, 'offline_expired');
  ok(/three days|online/i.test(r.message), r.message);
});

sec('THE SERVICE WORKER NEVER CACHES AUTHENTICATED RESPONSES');
await t('sw.js excludes /api/ from every cache path', async () => {
  const sw = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
  ok(/pathname\.startsWith\('\/api\/'\)/.test(sw), 'no /api/ exclusion');
  const idx = sw.indexOf("startsWith('/api/')");
  const after = sw.slice(idx, idx + 400);
  ok(!/caches\.open/.test(after.split('return;')[0]), 'API branch still writes to a cache');
});
await t('logout clears the app caches', async () => {
  ok(/caches\.delete/.test(await readFile(new URL('./authclient.js', import.meta.url), 'utf8')),
    'logout does not clear caches');
});

console.log('\n' + '='.repeat(62));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
if (fail) fails.forEach(([n,m]) => console.log(` - ${n}\n   ${m}`));
server.close(); db.close();
process.exit(fail ? 1 : 0);
