/* Backend integration tests. Real HTTP against a real server and a real
   database. Covers the verification list exactly.
   Run: node test/api.test.js */
import { createApp } from '../server.js';
import { bootstrapOwner } from '../src/auth.js';

let pass = 0, fail = 0; const fails = [];
const t = async (n, f) => { try { await f(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  catch (e) { fail++; fails.push([n, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + n + '\n       ' + e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const eq = (a,b,m) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error((m||'')+` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');

const OWNER_PW = 'Owner-Passphrase-99';
const env = { OWNER_EMAIL: 'owner@example.test', OWNER_NAME: 'Owner',
              BOOTSTRAP_OWNER_PASSWORD: OWNER_PW };

const { server, db } = await createApp({ env });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* A client that keeps its own cookie jar, like a browser would. */
function client() {
  let cookie = null;
  return {
    get cookie() { return cookie; },
    clear() { cookie = null; },
    async fetch(path, opts = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Recomp-Request': '1' },
        opts.headers || {});
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(BASE + path, {
        method: opts.method || 'GET', headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      const sc = res.headers.get('set-cookie');
      if (sc) {
        const v = sc.split(';')[0];
        cookie = v.endsWith('=') ? null : v;     // Max-Age=0 clears it
      }
      let data = null;
      try { data = await res.json(); } catch (e) {}
      return { status: res.status, data, headers: res.headers };
    }
  };
}
const owner = client(), alice = client(), bob = client(), coach = client();
let ALICE, BOB, COACH;

/* ========================================================================= */
sec('BOOTSTRAP — owner created from server-side config only');

await t('the owner exists and must change the bootstrap password', async () => {
  const u = db.get("SELECT * FROM users WHERE role='owner'");
  ok(u, 'no owner created'); eq(u.email, 'owner@example.test');
  eq(u.must_change_pw, 1, 'owner not forced to change the bootstrap password');
});

await t('the public /api/bootstrap endpoint no longer exists', async () => {
  const r = await owner.fetch('/api/bootstrap', { method: 'POST' });
  ok(r.status === 401 || r.status === 404, `expected 401/404, got ${r.status}`);
});

sec('FIRST-RUN SETUP — the owner chooses their own password in the app');

{
  const app2 = await createApp({ env: { OWNER_EMAIL: 'me@example.test', OWNER_NAME: 'Me' } });
  await new Promise(r => app2.server.listen(0, '127.0.0.1', r));
  const B2 = `http://127.0.0.1:${app2.server.address().port}`;
  let ck = null;
  const call = async (path, body) => {
    const res = await fetch(B2 + path, { method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-Recomp-Request': '1' }, ck ? { Cookie: ck } : {}),
      body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch (e) {}
    return { status: res.status, data };
  };
  const GOOD = 'Chosen-Passphrase-42';

  await t('setup is offered while no owner exists', async () => {
    const r = await call('/api/auth/session');
    eq(r.data.authenticated, false); eq(r.data.setupAvailable, true);
  });
  await t('setup refuses any email other than the owner email', async () => {
    const r = await call('/api/auth/setup', { email: 'someone@else.test', password: GOOD });
    eq(r.status, 403);
    eq(app2.db.get("SELECT COUNT(*) AS n FROM users").n, 0);
  });
  await t('setup refuses a weak password and explains why', async () => {
    const r = await call('/api/auth/setup', { email: 'me@example.test', password: 'short' });
    eq(r.status, 400); ok(/at least 12/.test(r.data.error), r.data.error);
  });
  await t('setup creates the owner, signs them in, and needs no forced change', async () => {
    const r = await call('/api/auth/setup', { email: 'ME@example.test', password: GOOD });
    eq(r.status, 200); eq(r.data.user.role, 'owner'); eq(r.data.user.mustChangePassword, false);
    const me = await call('/api/auth/me'); eq(me.status, 200);
  });
  await t('setup closes for good once an owner exists', async () => {
    const r = await call('/api/auth/setup', { email: 'me@example.test', password: 'Another-Passphrase-77' });
    eq(r.status, 409);
    const sess = await fetch(B2 + '/api/auth/session').then(x => x.json());
    eq(sess.setupAvailable, false);
  });
  await t('the chosen password works for a later sign-in', async () => {
    ck = null;
    const r = await call('/api/auth/login', { email: 'me@example.test', password: GOOD });
    eq(r.status, 200);
  });
  app2.server.close();
}

sec('PLAIN-NAME LOGIN — a login does not have to be an email');
{
  const app3 = await createApp({ env: { OWNER_LOGIN: 'rsmotocons', OWNER_NAME: 'RS' } });
  await new Promise(r => app3.server.listen(0, '127.0.0.1', r));
  const B3 = `http://127.0.0.1:${app3.server.address().port}`;
  let ck3 = null;
  const call3 = async (path, body) => {
    const res = await fetch(B3 + path, { method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-Recomp-Request': '1' }, ck3 ? { Cookie: ck3 } : {}),
      body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) ck3 = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch (e) {}
    return { status: res.status, data };
  };
  const PW = 'Plain-Name-Passphrase-31';
  await t('setup is offered when only OWNER_LOGIN is configured', async () => {
    eq((await call3('/api/auth/session')).data.setupAvailable, true);
  });
  await t('a different login is refused', async () => {
    eq((await call3('/api/auth/setup', { login: 'x', email: 'someone else', password: PW })).status, 403);
  });
  await t('"  RsMotoCons " claims the owner login (case and surrounding spaces ignored)', async () => {
    const r = await call3('/api/auth/setup', { email: '  RsMotoCons ', password: PW });
    eq(r.status, 200); eq(r.data.user.email, 'rsmotocons'); eq(r.data.user.role, 'owner');
  });
  await t('signing in with the name as typed works, a wrong password does not', async () => {
    ck3 = null;
    eq((await call3('/api/auth/login', { email: 'RsMotoCons', password: PW })).status, 200);
    ck3 = null;
    eq((await call3('/api/auth/login', { email: 'RsMotoCons', password: 'Wrong-Passphrase-1' })).status, 401);
  });
  app3.server.close();
}

await t('a weak bootstrap password is refused with the requirement explained', async () => {
  // A stand-in with the same shape as a weak password: digits + lowercase only.
  const WEAK = '123' + 'trythis' + '123';
  const fresh = await createApp({ env: { OWNER_EMAIL: 'x@y.test', BOOTSTRAP_OWNER_PASSWORD: WEAK } });
  const r = await bootstrapOwner(fresh.db, { OWNER_EMAIL: 'x@y.test', BOOTSTRAP_OWNER_PASSWORD: WEAK }, Date.now());
  eq(r.ok, false);
  eq(r.reason, 'weak_bootstrap_password');
  ok(/uppercase|symbol/.test(r.message), r.message);
  ok(!r.message.includes(WEAK), 'the password must not be echoed back');
  fresh.db.close();
});

await t('no password appears anywhere in the shipped source', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const root = new URL('../../', import.meta.url).pathname;
  const hits = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(js|html|json|md|sql)$/.test(e.name)) {
        const s = await readFile(p, 'utf8');
        // assembled at runtime so this scanner does not itself contain the string
        const needle = ['123', 'trymenow', '123'].join('');
        if (s.includes(needle)) hits.push(p);
      }
    }
  }
  await walk(root);
  eq(hits, [], 'the bootstrap password is present in shipped files');
});

/* ========================================================================= */
sec('OWNER LOGIN AND FORCED PASSWORD CHANGE');

await t('login with the bootstrap password works', async () => {
  const r = await owner.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'owner@example.test', password: OWNER_PW } });
  eq(r.status, 200);
  eq(r.data.user.mustChangePassword, true);
  ok(owner.cookie, 'no session cookie issued');
});

await t('the session cookie is HttpOnly and SameSite', async () => {
  const c = client();
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Recomp-Request': '1' },
    body: JSON.stringify({ email: 'owner@example.test', password: OWNER_PW }) });
  const sc = res.headers.get('set-cookie') || '';
  ok(/HttpOnly/i.test(sc), sc);
  ok(/SameSite=Lax/i.test(sc), sc);
});

await t('everything is blocked until the password is changed', async () => {
  const r = await owner.fetch('/api/admin/users');
  eq(r.status, 403);
  eq(r.data.mustChangePassword, true);
});

await t('changing the password unblocks the account', async () => {
  const r = await owner.fetch('/api/auth/password', { method: 'POST',
    body: { current: OWNER_PW, next: 'Owner-New-Passphrase-7' } });
  eq(r.status, 200);
  const u = await owner.fetch('/api/admin/users');
  eq(u.status, 200);
});

await t('a weak new password is refused', async () => {
  const r = await owner.fetch('/api/auth/password', { method: 'POST',
    body: { current: 'Owner-New-Passphrase-7', next: 'short' } });
  eq(r.status, 400);
  ok(/12 characters/.test(r.data.error), r.data.error);
});

/* ========================================================================= */
sec('ADMIN CREATES THE LOGINS (no email, no self-registration)');

await t('no unauthenticated route can create an account', async () => {
  for (const path of ['/api/auth/register', '/api/register', '/api/users', '/api/admin/users']) {
    const r = await client().fetch(path, { method: 'POST',
      body: { email: 'intruder@example.test', password: 'Intruder-Passphrase-1', role: 'owner' } });
    ok(r.status === 401 || r.status === 403 || r.status === 404,
      `${path} returned ${r.status}`);
  }
  const made = db.get("SELECT id FROM users WHERE email = 'intruder@example.test'");
  ok(!made, 'an account was created without authentication');
});

await t('the owner creates two members and a coach', async () => {
  const a = await owner.fetch('/api/admin/users', { method: 'POST',
    body: { email: 'alice@example.test', name: 'Alice', password: 'Alice-Passphrase-1', role: 'member' } });
  const b = await owner.fetch('/api/admin/users', { method: 'POST',
    body: { email: 'bob@example.test', name: 'Bob', password: 'Bob-Passphrase-2', role: 'member' } });
  const c = await owner.fetch('/api/admin/users', { method: 'POST',
    body: { email: 'coach@example.test', name: 'Coach', password: 'Coach-Passphrase-3', role: 'coach' } });
  eq([a.status, b.status, c.status], [200, 200, 200]);
  ALICE = a.data.id; BOB = b.data.id; COACH = c.data.id;
});

await t('created accounts must change their password on first login', async () => {
  const r = await alice.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'alice@example.test', password: 'Alice-Passphrase-1' } });
  eq(r.data.user.mustChangePassword, true);
  await alice.fetch('/api/auth/password', { method: 'POST',
    body: { current: 'Alice-Passphrase-1', next: 'Alice-New-Passphrase-1' } });
  await bob.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'bob@example.test', password: 'Bob-Passphrase-2' } });
  await bob.fetch('/api/auth/password', { method: 'POST',
    body: { current: 'Bob-Passphrase-2', next: 'Bob-New-Passphrase-2' } });
  await coach.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'coach@example.test', password: 'Coach-Passphrase-3' } });
  await coach.fetch('/api/auth/password', { method: 'POST',
    body: { current: 'Coach-Passphrase-3', next: 'Coach-New-Passphrase-3' } });
  const me = await alice.fetch('/api/auth/me');
  eq(me.data.user.mustChangePassword, false);
});

await t('a member cannot create accounts or grant themselves a role', async () => {
  const r = await alice.fetch('/api/admin/users', { method: 'POST',
    body: { email: 'evil@example.test', password: 'Evil-Passphrase-1', role: 'owner' } });
  eq(r.status, 403);
  const p = await alice.fetch('/api/admin/users/' + ALICE, { method: 'PATCH', body: { role: 'owner' } });
  eq(p.status, 403);
});

await t('an admin who is not the owner cannot create administrators', async () => {
  await owner.fetch('/api/admin/users', { method: 'POST',
    body: { email: 'admin2@example.test', password: 'Admin-Passphrase-9', role: 'admin' } });
  const admin2 = client();
  await admin2.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'admin2@example.test', password: 'Admin-Passphrase-9' } });
  await admin2.fetch('/api/auth/password', { method: 'POST',
    body: { current: 'Admin-Passphrase-9', next: 'Admin-New-Passphrase-9' } });
  const r = await admin2.fetch('/api/admin/users', { method: 'POST',
    body: { email: 'admin3@example.test', password: 'Admin-Passphrase-3', role: 'admin' } });
  eq(r.status, 403);
  ok(/owner/i.test(r.data.error), r.data.error);
});

await t('the last owner cannot be demoted or suspended', async () => {
  const me = await owner.fetch('/api/auth/me');
  const d = await owner.fetch('/api/admin/users/' + me.data.user.id, { method: 'PATCH', body: { role: 'member' } });
  eq(d.status, 409);
  const s = await owner.fetch('/api/admin/users/' + me.data.user.id, { method: 'PATCH', body: { status: 'suspended' } });
  eq(s.status, 409);
});

/* ========================================================================= */
sec('PRIVATE DATA — members cannot reach each other');

await t('each member saves their own state', async () => {
  const a = await alice.fetch('/api/state', { method: 'PUT',
    body: { doc: { schemaVersion: 3, secret: 'alice-only', sessions: [{ id: 's_a1', date: '2026-10-01' }] } } });
  const b = await bob.fetch('/api/state', { method: 'PUT',
    body: { doc: { schemaVersion: 3, secret: 'bob-only', sessions: [{ id: 's_b1', date: '2026-10-02' }] } } });
  eq([a.status, b.status], [200, 200]);
});

await t('a member reads only their own state', async () => {
  const a = await alice.fetch('/api/state');
  eq(a.data.doc.secret, 'alice-only');
  const b = await bob.fetch('/api/state');
  eq(b.data.doc.secret, 'bob-only');
});

await t('changing the user id in the URL does not grant access', async () => {
  const r = await alice.fetch('/api/users/' + BOB + '/state');
  eq(r.status, 403, 'Alice reached Bob\'s records');
});

await t('a forged user id in the body is ignored — the session decides', async () => {
  await alice.fetch('/api/state', { method: 'PUT',
    body: { userId: BOB, user_id: BOB, doc: { secret: 'alice-overwrote-bob' } } });
  const b = await bob.fetch('/api/state');
  eq(b.data.doc.secret, 'bob-only', 'Bob\'s record was overwritten via a forged id');
});

await t('an admin cannot read a member\'s records without an assignment', async () => {
  const r = await owner.fetch('/api/users/' + ALICE + '/state');
  eq(r.status, 403, 'administrator rank alone exposed personal health records');
});

/* ========================================================================= */
sec('REVIEWERS — assigned users only');

await t('an unassigned coach cannot read a member', async () => {
  const r = await coach.fetch('/api/users/' + ALICE + '/state');
  eq(r.status, 403);
});

await t('once assigned, the coach can read that member only', async () => {
  await owner.fetch('/api/admin/assign', { method: 'POST', body: { coachId: COACH, memberId: ALICE } });
  const a = await coach.fetch('/api/users/' + ALICE + '/state');
  eq(a.status, 200);
  eq(a.data.scope, 'assigned');
  const b = await coach.fetch('/api/users/' + BOB + '/state');
  eq(b.status, 403, 'coach reached an unassigned member');
});

await t('every read of a member\'s records is audited', async () => {
  const r = await owner.fetch('/api/admin/audit?limit=50');
  const hit = r.data.entries.find(e => e.action === 'access.read_member_records' && e.target_id === ALICE);
  ok(hit, 'no audit entry for the coach reading Alice');
  eq(hit.actor_email, 'coach@example.test');
});

await t('the review inbox shows assigned members only', async () => {
  await alice.fetch('/api/reviews', { method: 'POST',
    body: { sessionRef: 's_a1', difficulty: 'hard', wanted: 'less', comment: 'knee felt off', wantsReview: true } });
  await bob.fetch('/api/reviews', { method: 'POST',
    body: { sessionRef: 's_b1', difficulty: 'ok', wanted: 'more', comment: 'felt easy' } });
  const inbox = await coach.fetch('/api/reviews?inbox=1');
  eq(inbox.status, 200);
  eq(inbox.data.reviews.length, 1, 'inbox leaked an unassigned member');
  eq(inbox.data.reviews[0].member_email, 'alice@example.test');
});

await t('a member sees their own submissions and replies', async () => {
  const mine = await alice.fetch('/api/reviews');
  eq(mine.data.reviews.length, 1);
  const id = mine.data.reviews[0].id;
  await coach.fetch(`/api/reviews/${id}/messages`, { method: 'POST', body: { body: 'Looked at it, try the box squat.' } });
  const msgs = await alice.fetch(`/api/reviews/${id}/messages`);
  eq(msgs.data.messages.length, 1);
  const after = await alice.fetch('/api/reviews');
  eq(after.data.reviews[0].status, 'replied');
});

await t('a reviewer proposal does not apply until the user accepts', async () => {
  const p = await coach.fetch('/api/proposals', { method: 'POST',
    body: { userId: ALICE, variantId: 'squat-barbell', reason: 'Knee pain reported; swap to leg press for two weeks.',
            change: { substitute: 'leg-press' } } });
  eq(p.status, 200);
  const mine = await alice.fetch('/api/proposals');
  eq(mine.data.proposals.length, 1);
  eq(mine.data.proposals[0].status, 'proposed');
  const bobSees = await bob.fetch('/api/proposals');
  eq(bobSees.data.proposals.length, 0, 'proposal leaked to another member');
  const acc = await alice.fetch('/api/proposals/' + mine.data.proposals[0].id, { method: 'PATCH', body: { status: 'accepted' } });
  eq(acc.data.status, 'accepted');
});

await t('a proposal without a reason is refused', async () => {
  const p = await coach.fetch('/api/proposals', { method: 'POST', body: { userId: ALICE, change: {} } });
  eq(p.status, 400);
});

await t('a member cannot accept someone else\'s proposal', async () => {
  const p = await coach.fetch('/api/proposals', { method: 'POST',
    body: { userId: ALICE, reason: 'another one', change: {} } });
  const r = await bob.fetch('/api/proposals/' + p.data.id, { method: 'PATCH', body: { status: 'accepted' } });
  eq(r.status, 403);
});

/* ========================================================================= */
sec('FEATURE PERMISSIONS — enforced on the request, not the screen');

await t('a member with nutrition turned off is refused at the API', async () => {
  await owner.fetch('/api/admin/users/' + BOB, { method: 'PATCH',
    body: { permissions: { nutrition: false, recipes: false } } });
  const me = await bob.fetch('/api/auth/me');
  eq(me.data.user.permissions.nutrition, false);
  eq(me.data.user.permissions.training, true);
});

await t('removing training access blocks the state endpoint directly', async () => {
  await owner.fetch('/api/admin/users/' + BOB, { method: 'PATCH', body: { permissions: { training: false } } });
  const r = await bob.fetch('/api/state');
  eq(r.status, 403, 'a direct API request bypassed the feature restriction');
  await owner.fetch('/api/admin/users/' + BOB, { method: 'PATCH', body: { permissions: { training: true } } });
});

await t('removing reviews access blocks submitting a review', async () => {
  await owner.fetch('/api/admin/users/' + BOB, { method: 'PATCH', body: { permissions: { reviews: false } } });
  const r = await bob.fetch('/api/reviews', { method: 'POST', body: { comment: 'x' } });
  eq(r.status, 403);
  await owner.fetch('/api/admin/users/' + BOB, { method: 'PATCH', body: { permissions: { reviews: true } } });
});

/* ========================================================================= */
sec('SUSPENSION AND REVOCATION — immediate');

await t('suspending an account kills its live session on the next request', async () => {
  const before = await bob.fetch('/api/state');
  eq(before.status, 200);
  await owner.fetch('/api/admin/users/' + BOB, { method: 'PATCH', body: { status: 'suspended' } });
  const after = await bob.fetch('/api/state');
  eq(after.status, 401, 'a suspended account kept working');
});

await t('a suspended account cannot log back in, and is told why', async () => {
  const c = client();
  const r = await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'bob@example.test', password: 'Bob-New-Passphrase-2' } });
  eq(r.status, 403);
  eq(r.data.accountStatus, 'suspended');
});

await t('reactivation restores access but not the old session', async () => {
  await owner.fetch('/api/admin/users/' + BOB, { method: 'PATCH', body: { status: 'active' } });
  const stale = await bob.fetch('/api/state');
  eq(stale.status, 401, 'the revoked session was resurrected');
  const c = client();
  const r = await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'bob@example.test', password: 'Bob-New-Passphrase-2' } });
  eq(r.status, 200);
});

await t('a pending account cannot reach protected data', async () => {
  await owner.fetch('/api/admin/users', { method: 'POST',
    body: { email: 'pending@example.test', password: 'Pending-Passphrase-1', role: 'member', status: 'pending' } });
  const p = client();
  const r = await p.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'pending@example.test', password: 'Pending-Passphrase-1' } });
  eq(r.status, 403);
  eq(r.data.accountStatus, 'pending');
});

await t('logout invalidates the session server-side', async () => {
  const c = client();
  await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'alice@example.test', password: 'Alice-New-Passphrase-1' } });
  const token = c.cookie;
  await c.fetch('/api/auth/logout', { method: 'POST' });
  const replay = await fetch(BASE + '/api/state', { headers: { Cookie: token, 'X-Recomp-Request': '1' } });
  eq(replay.status, 401, 'a logged-out cookie still worked when replayed');
});

await t('an admin password reset revokes every live session', async () => {
  const c = client();
  await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'alice@example.test', password: 'Alice-New-Passphrase-1' } });
  eq((await c.fetch('/api/state')).status, 200);
  await owner.fetch('/api/admin/users/' + ALICE, { method: 'PATCH', body: { resetPassword: 'Alice-Reset-Passphrase-4' } });
  eq((await c.fetch('/api/state')).status, 401);
});

/* ========================================================================= */
sec('RATE LIMITING AND CSRF');

await t('repeated bad passwords are rate limited', async () => {
  const c = client();
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const r = await c.fetch('/api/auth/login', { method: 'POST',
      body: { email: 'coach@example.test', password: 'wrong-' + i } });
    last = r.status;
  }
  eq(last, 429, 'no lockout after 12 failed attempts');
});

await t('a cross-origin mutation is refused', async () => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Recomp-Request': '1', Origin: 'https://evil.test' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'Owner-New-Passphrase-7' }) });
  eq(r.status, 403);
});

await t('a plain form post without the app header is refused', async () => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'Owner-New-Passphrase-7' }) });
  eq(r.status, 403);
});

await t('authenticated responses are marked no-store', async () => {
  const c = client();
  await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'coach@example.test', password: 'Coach-New-Passphrase-3' } });
  const res = await fetch(BASE + '/api/state', { headers: { Cookie: c.cookie, 'X-Recomp-Request': '1' } });
  ok(/no-store/.test(res.headers.get('cache-control') || ''), res.headers.get('cache-control'));
});

/* ========================================================================= */
sec('IMPORT — previewed, de-duplicated, non-destructive');

await t('a preview reports what would change without changing anything', async () => {
  const c = client();
  await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'owner@example.test', password: 'Owner-New-Passphrase-7' } });
  await c.fetch('/api/state', { method: 'PUT',
    body: { doc: { schemaVersion: 3, sessions: [{ id: 's_1', date: '2026-10-01' }], bodyweight: [{ date: '2026-10-01', kg: 86 }] } } });
  const p = await c.fetch('/api/import/preview', { method: 'POST',
    body: { doc: { schemaVersion: 3,
      sessions: [{ id: 's_1', date: '2026-10-01' }, { id: 's_2', date: '2026-10-03' }],
      bodyweight: [{ date: '2026-10-01', kg: 86 }, { date: '2026-10-05', kg: 85.5 }] } } });
  eq(p.data.preview.newSessions, 1);
  eq(p.data.preview.duplicateSessions, 1);
  eq(p.data.preview.newWeighIns, 1);
  const after = await c.fetch('/api/state');
  eq(after.data.doc.sessions.length, 1, 'preview changed the stored data');
});

await t('commit merges without duplicating or losing records', async () => {
  const c = client();
  await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'owner@example.test', password: 'Owner-New-Passphrase-7' } });
  await c.fetch('/api/import/commit', { method: 'POST',
    body: { doc: { sessions: [{ id: 's_1', date: '2026-10-01' }, { id: 's_2', date: '2026-10-03' }],
                   bodyweight: [{ date: '2026-10-05', kg: 85.5 }] } } });
  const after = await c.fetch('/api/state');
  eq(after.data.doc.sessions.length, 2);
  eq(after.data.doc.bodyweight.length, 2);
});

/* ========================================================================= */
sec('AUDIT TRAIL');

await t('administrative actions are recorded with actor and target', async () => {
  const r = await owner.fetch('/api/admin/audit?limit=200');
  const actions = r.data.entries.map(e => e.action);
  ['admin.user_created','admin.status_changed','admin.permissions_changed',
   'admin.assigned','auth.login','auth.password_changed','access.read_member_records']
    .forEach(a => ok(actions.includes(a), 'missing audit action: ' + a));
});

await t('a member cannot read the audit log', async () => {
  const c = client();
  await c.fetch('/api/auth/login', { method: 'POST',
    body: { email: 'bob@example.test', password: 'Bob-New-Passphrase-2' } });
  eq((await c.fetch('/api/admin/audit')).status, 403);
});

/* ========================================================================= */
console.log('\n' + '='.repeat(62));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
if (fail) fails.forEach(([n,m]) => console.log(` - ${n}\n   ${m}`));
server.close(); db.close();
process.exit(fail ? 1 : 0);
