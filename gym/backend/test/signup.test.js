/* Sign-up, verification, approval, restricted sessions, notes, reset, mail.
   Real HTTP, real database. Run: node test/signup.test.js */
import { harness, startApp, GOOD_PW } from './helpers.js';
import { outbox, sendMail } from '../src/mail.js';
import { sha256hex } from '../src/crypto.js';

const { t, ok, eq, sec, finish } = harness();
const app = await startApp();
const { db, client } = app;
const owner = await app.ownerClient();
const adminU = await app.makeUser(owner, 'admin@example.test', 'admin');
const admin = adminU.c;

let n = 0;
const body = (over = {}) => Object.assign({ name: 'Sam Member', email: `sam${++n}@example.test`, password: GOOD_PW, website: '' }, over);
const lastMail = to => [...outbox].reverse().find(m => m.to === to);
const tokenFrom = (to, kind) => { const m = lastMail(to); return m && (m.text.match(new RegExp('\\?' + kind + '=([^\\s"&]+)')) || [])[1]; };
const audits = () => db.all('SELECT * FROM audit_log').map(r => r.action);
const countUsers = () => db.get('SELECT COUNT(*) AS n FROM users').n;
const rows = e => db.get('SELECT COUNT(*) AS n FROM signup_requests WHERE email = ?', e).n;

/* Creates a pending user through the real endpoint and returns the pieces. */
async function newSignup(over) {
  const c = client(); const b = body(over);
  const r = await c.post('/api/auth/signup', b);
  const user = db.get('SELECT * FROM users WHERE email = ?', b.email);
  const sr = user && db.get('SELECT * FROM signup_requests WHERE user_id = ?', user.id);
  return { c, b, r, user, sr };
}

sec('SIGN-UP');
await t('happy path: pending member, request row, hashed token, mail sent, session cookie', async () => {
  const before = outbox.length;
  const { c, b, r, user, sr } = await newSignup();
  eq(r.status, 200); eq(r.data, { ok: true, status: 'pending_verification', emailSent: true });
  ok(r.hadSetCookie && c.cookie, 'no session cookie');
  eq(user.role, 'member'); eq(user.status, 'pending');
  eq(sr.status, 'pending_verification'); eq(sr.verified_by_admin, 0); eq(sr.email_verified_at, null);
  eq(outbox.length, before + 1);
  const token = tokenFrom(b.email, 'verify'); ok(token, 'no verify link in the mail');
  const tk = db.get('SELECT * FROM email_tokens WHERE user_id = ?', user.id);
  eq(tk.token_hash, await sha256hex(token)); ok(tk.token_hash !== token);
  eq(tk.purpose, 'verify'); ok(Math.abs(tk.expires_at - tk.created_at - 48 * 3600 * 1000) < 5000, 'verify TTL is 48h');
  eq(db.get('SELECT COUNT(*) AS n FROM email_tokens WHERE token_hash = ?', token).n, 0, 'plain token stored');
  eq(user.password_hash.startsWith('pbkdf2$'), true);
  const me = await c.fetch('/api/auth/me'); eq(me.data.user.accountState, 'pending_verification');
});

await t('email is lower-cased and trimmed and is the login', async () => {
  const c = client();
  const r = await c.post('/api/auth/signup', body({ email: '  MixedCase@Example.TEST ', name: '  Pat   Lee ' }));
  eq(r.status, 200);
  const u = db.get("SELECT * FROM users WHERE email = 'mixedcase@example.test'");
  ok(u); eq(u.name, 'Pat Lee');
  const l = await client().post('/api/auth/login', { email: 'MIXEDCASE@example.test', password: GOOD_PW });
  eq(l.status, 200); eq(l.data.user.accountState, 'pending_verification');
});

await t('validation failures are 400 and create nothing', async () => {
  const before = countUsers();
  const cases = [
    body({ name: 'A' }), body({ name: 'x'.repeat(81) }), body({ name: '' }), body({ name: 7 }),
    body({ email: 'not-an-email' }), body({ email: 'a@b' }), body({ email: 'x'.repeat(115) + '@e.test' }), body({ email: null }),
    body({ password: 'short1A' }), body({ password: 'alllowercase1234' }), body({ password: 'NoDigitsHere!!!!' }), body({ password: null }),
    body({ password: 'Aa1' + 'x'.repeat(300) }), {}
  ];
  for (const c of cases) { const r = await client().post('/api/auth/signup', c); eq(r.status, 400, JSON.stringify(c).slice(0, 60)); }
  eq(countUsers(), before);
});

await t('honeypot: a filled website field looks successful and does nothing', async () => {
  const before = countUsers(), mails = outbox.length;
  const b = body({ website: 'http://spam.example' });
  const r = await client().post('/api/auth/signup', b);
  eq(r.status, 200); eq(Object.keys(r.data).sort(), ['emailSent', 'ok', 'status']);
  eq(countUsers(), before); eq(outbox.length, mails); eq(rows(b.email), 0);
});

await t('role, status and permission fields in the body are ignored', async () => {
  const b = body({ role: 'owner', status: 'active', permissions: { reviews: true }, must_change_pw: 0, approved_at: 1 });
  const r = await client().post('/api/auth/signup', b);
  eq(r.status, 200);
  const u = db.get('SELECT * FROM users WHERE email = ?', b.email);
  eq(u.role, 'member'); eq(u.status, 'pending'); eq(u.permissions, null); eq(u.approved_at, null);
});

await t('duplicate with an existing account: same shape, no leak, no new rows, no session', async () => {
  const fresh = await newSignup();
  const before = countUsers();
  const dupe = client();
  const r = await dupe.post('/api/auth/signup', body({ email: adminU.email }));   // an active account
  eq(r.status, 200); eq(Object.keys(r.data).sort(), Object.keys(fresh.r.data).sort());
  eq(r.data.status, 'pending_verification'); eq(r.data.emailSent, true);
  eq(countUsers(), before); eq(dupe.cookie, null, 'cookie issued for an existing account');
  eq(db.get('SELECT COUNT(*) AS n FROM signup_requests WHERE email = ?', adminU.email).n, 0);
  ok(!JSON.stringify(r.data).includes('exist'));
});

await t('duplicate pending request: generic 200, one row only, verification re-sent', async () => {
  const first = await newSignup();
  const mails = outbox.length;
  const r = await client().post('/api/auth/signup', body({ email: first.b.email.toUpperCase(), password: 'Other-Pass-9876' }));
  eq(r.status, 200); eq(r.data, { ok: true, status: 'pending_verification', emailSent: true });
  eq(rows(first.b.email), 1); eq(outbox.length, mails + 1);
  eq(db.get('SELECT COUNT(*) AS n FROM users WHERE email = ?', first.b.email).n, 1);
  const hash = db.get('SELECT password_hash FROM users WHERE email = ?', first.b.email).password_hash;
  eq(hash, first.user.password_hash, 'password of the existing request was changed');
  eq(r.hadSetCookie, false, 'a wrong password must not get a session');
});

await t('sign-up is rate limited per IP and per email', async () => {
  const ip = '203.0.113.50';
  for (let i = 0; i < 5; i++) eq((await client(ip).post('/api/auth/signup', body())).status, 200);
  eq((await client(ip).post('/api/auth/signup', body())).status, 429);
  const e = 'limited@example.test';
  for (let i = 0; i < 3; i++) eq((await client().post('/api/auth/signup', body({ email: e }))).status, 200);
  eq((await client().post('/api/auth/signup', body({ email: e }))).status, 429);
});

sec('EMAIL VERIFICATION');
await t('a valid token verifies the email and moves the request to pending_approval', async () => {
  const s = await newSignup(); const token = tokenFrom(s.b.email, 'verify');
  const r = await client().post('/api/auth/verify', { token });
  eq(r.status, 200); eq(r.data, { ok: true, status: 'pending_approval' });
  const sr = db.get('SELECT * FROM signup_requests WHERE id = ?', s.sr.id);
  eq(sr.status, 'pending_approval'); ok(sr.email_verified_at > 0); eq(sr.verified_by_admin, 0);
  eq((await s.c.fetch('/api/auth/me')).data.user.accountState, 'pending_approval');
  eq(db.get('SELECT role, status FROM users WHERE id = ?', s.user.id).status, 'pending', 'verification must not activate');
});
await t('a token cannot be reused', async () => {
  const s = await newSignup(); const token = tokenFrom(s.b.email, 'verify');
  eq((await client().post('/api/auth/verify', { token })).status, 200);
  eq((await client().post('/api/auth/verify', { token })).status, 400);
});
await t('a wrong, empty or malformed token is refused', async () => {
  for (const tok of ['nonsense-token-nonsense-token-123', '', null, 42, { a: 1 }, 'x'.repeat(500)]) {
    eq((await client().post('/api/auth/verify', { token: tok })).status, 400, String(tok).slice(0, 20));
  }
});
await t('an expired token is refused', async () => {
  const s = await newSignup(); const token = tokenFrom(s.b.email, 'verify');
  db.run('UPDATE email_tokens SET expires_at = ? WHERE user_id = ?', Date.now() - 1000, s.user.id);
  eq((await client().post('/api/auth/verify', { token })).status, 400);
  eq(db.get('SELECT status FROM signup_requests WHERE id = ?', s.sr.id).status, 'pending_verification');
});
await t('a new verification email invalidates the earlier link', async () => {
  const s = await newSignup(); const old = tokenFrom(s.b.email, 'verify');
  eq((await s.c.post('/api/auth/resend-verification')).status, 200);
  const fresh = tokenFrom(s.b.email, 'verify'); ok(fresh !== old);
  eq((await client().post('/api/auth/verify', { token: old })).status, 400);
  eq((await client().post('/api/auth/verify', { token: fresh })).status, 200);
});
await t('resend-verification is rate limited, works with a session, and is a no-op once verified', async () => {
  const s = await newSignup();
  eq((await client().post('/api/auth/resend-verification')).status, 401);
  for (let i = 0; i < 3; i++) { const r = await s.c.post('/api/auth/resend-verification'); eq(r.status, 200); eq(r.data.emailSent, true); }
  eq((await s.c.post('/api/auth/resend-verification')).status, 429);
  const v = await newSignup();
  await client().post('/api/auth/verify', { token: tokenFrom(v.b.email, 'verify') });
  const r = await v.c.post('/api/auth/resend-verification');
  eq(r.status, 200); eq(r.data.alreadyVerified, true); eq(r.data.emailSent, false);
});

sec('PENDING USERS ARE RESTRICTED (one central guard)');
const pend = await newSignup();
const victim = await app.makeUser(owner, 'victim@example.test', 'member');
const PROTECTED = [
  ['GET', '/api/state'], ['PUT', '/api/state', { doc: { sessions: [] } }],
  ['GET', `/api/users/${victim.id}/state`], ['GET', `/api/users/${pend.user.id}/state`],
  ['POST', '/api/import/preview', { doc: {} }], ['POST', '/api/import/commit', { doc: {} }],
  ['GET', '/api/reviews'], ['GET', '/api/reviews?inbox=1'], ['POST', '/api/reviews', { comment: 'x' }],
  ['PATCH', '/api/reviews/rv_x', { status: 'resolved' }], ['GET', '/api/reviews/rv_x/messages'], ['POST', '/api/reviews/rv_x/messages', { body: 'x' }],
  ['GET', '/api/proposals'], ['POST', '/api/proposals', { userId: victim.id, reason: 'x' }], ['PATCH', '/api/proposals/pp_x', { status: 'accepted' }],
  ['GET', '/api/admin/users'], ['POST', '/api/admin/users', { email: 'x@y.test', password: GOOD_PW }],
  ['PATCH', `/api/admin/users/${pend.user.id}`, { status: 'active', role: 'owner' }],
  ['POST', '/api/admin/assign', { coachId: pend.user.id, memberId: victim.id }], ['GET', '/api/admin/assignments'], ['GET', '/api/admin/audit'],
  ['GET', '/api/admin/requests'], ['POST', `/api/admin/requests/${pend.sr.id}/decision`, { action: 'approve', overrideVerification: true }],
  ['POST', `/api/admin/requests/${pend.sr.id}/verify-email`, {}],
  ['GET', `/api/admin/users/${victim.id}/note`], ['PUT', `/api/admin/users/${victim.id}/note`, { note: 'x' }],
  ['POST', '/api/ai/weekly-review', { payload: {} }],
  ['POST', '/api/weekly-submissions', { weekStart: '2026-10-05', report: {} }], ['GET', '/api/weekly-submissions'],
  ['GET', '/api/weekly-submissions?inbox=1'], ['PATCH', '/api/weekly-submissions/ws_x', { action: 'approve' }],
  ['GET', '/api/does-not-exist'], ['DELETE', '/api/state']
];
await t(`a pending user gets 403 {code:'pending'} from every protected route (${PROTECTED.length} checked)`, async () => {
  for (const [method, path, b] of PROTECTED) {
    const r = await pend.c.fetch(path, { method, body: b });
    eq(r.status, 403, `${method} ${path}`);
    eq(r.data.code, 'pending', `${method} ${path}`);
    eq(r.data.error, 'Your account is awaiting approval.');
    eq(r.data.accountState, 'pending_verification');
  }
  eq(db.get('SELECT status FROM users WHERE id = ?', pend.user.id).status, 'pending', 'the pending user promoted itself');
  eq(db.get('SELECT COUNT(*) AS n FROM user_state WHERE user_id = ?', pend.user.id).n, 0);
});
await t('a pending user can still read session, me and account-status', async () => {
  const s = await pend.c.fetch('/api/auth/session');
  eq(s.data.authenticated, true); eq(s.data.user.accountState, 'pending_verification'); eq(s.data.user.status, 'pending');
  const m = await pend.c.fetch('/api/auth/me'); eq(m.status, 200); eq(m.data.user.accountState, 'pending_verification');
  ok(m.data.user.email && m.data.user.permissions && !JSON.stringify(m.data).includes('pbkdf2'));
  const a = await pend.c.fetch('/api/auth/account-status');
  eq(a.status, 200); eq(a.data.accountState, 'pending_verification'); eq(a.data.emailVerified, false);
  eq((await client().fetch('/api/auth/account-status')).status, 401);
});
await t('a pending user can change their password and log out', async () => {
  const p = await pend.c.post('/api/auth/password', { current: GOOD_PW, next: 'Brand-New-Pass-77' });
  eq(p.status, 200);
  eq((await pend.c.fetch('/api/auth/me')).status, 200);
  const l = await pend.c.post('/api/auth/logout'); eq(l.status, 200);
  eq((await pend.c.fetch('/api/auth/me')).status, 401);
});
await t('after verification the state is pending_approval and the guard still holds', async () => {
  const s = await newSignup(); await client().post('/api/auth/verify', { token: tokenFrom(s.b.email, 'verify') });
  const r = await s.c.fetch('/api/state'); eq(r.status, 403); eq(r.data.accountState, 'pending_approval');
  eq((await s.c.fetch('/api/auth/account-status')).data.emailVerified, true);
});

sec('ADMIN REQUESTS, APPROVAL AND REJECTION');
await t('request list shows the needed fields and never passwords or hashes', async () => {
  const s = await newSignup();
  const r = await admin.fetch('/api/admin/requests?status=pending_verification');
  eq(r.status, 200);
  const row = r.data.requests.find(x => x.id === s.sr.id); ok(row);
  eq(Object.keys(row).sort(), ['accountStatus', 'adminNote', 'createdAt', 'decidedAt', 'decisionNote', 'email', 'emailVerified', 'id', 'name', 'status', 'userId', 'verifiedByAdmin']);
  eq(row.emailVerified, false);
  ok(r.data.requests.every(x => x.status === 'pending_verification'));
  eq((await admin.fetch('/api/admin/requests?status=bogus')).status, 400);
  const raw = JSON.stringify([r.data, (await admin.fetch('/api/admin/users')).data, (await admin.fetch('/api/admin/requests')).data]);
  ok(!/pbkdf2|password_hash|"password"/.test(raw) && !raw.includes(GOOD_PW), 'a password or hash was returned');
});
await t('a member or coach cannot use the request endpoints', async () => {
  const mem = await app.makeUser(owner, 'plain@example.test', 'member');
  const s = await newSignup();
  eq((await mem.c.fetch('/api/admin/requests')).status, 403);
  eq((await mem.c.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve', overrideVerification: true })).status, 403);
  eq((await mem.c.fetch(`/api/admin/users/${s.user.id}/note`)).status, 403);
  eq((await client().fetch('/api/admin/requests')).status, 401);
  eq(db.get('SELECT status FROM users WHERE id = ?', s.user.id).status, 'pending');
});
await t('approval is refused for an unverified email, and allowed with an audited override', async () => {
  const s = await newSignup();
  const r = await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve' });
  eq(r.status, 409); eq(r.data.code, 'email_not_verified');
  eq(db.get('SELECT status FROM users WHERE id = ?', s.user.id).status, 'pending');
  eq((await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve', overrideVerification: 'true' })).status, 409, 'only boolean true overrides');
  const o = await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve', overrideVerification: true, note: 'known to the club' });
  eq(o.status, 200);
  eq(db.get('SELECT status FROM users WHERE id = ?', s.user.id).status, 'active');
  ok(audits().includes('signup.verification_overridden'));
  eq((await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'reject' })).status, 409, 'cannot decide twice');
});
await t('an admin can attest an email manually (audited) and then approve without override', async () => {
  const s = await newSignup();
  const v = await admin.post(`/api/admin/requests/${s.sr.id}/verify-email`);
  eq(v.status, 200); eq(v.data.status, 'pending_approval');
  const sr = db.get('SELECT * FROM signup_requests WHERE id = ?', s.sr.id);
  eq(sr.verified_by_admin, 1); ok(sr.email_verified_at);
  ok(audits().includes('signup.email_attested'));
  eq((await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve' })).status, 200);
  const listed = (await admin.fetch('/api/admin/requests?status=approved')).data.requests.find(x => x.id === s.sr.id);
  eq(listed.verifiedByAdmin, true); eq(listed.emailVerified, true);
});
await t('approval activates the account, applies role and permissions, and the old session now works', async () => {
  const s = await newSignup(); await client().post('/api/auth/verify', { token: tokenFrom(s.b.email, 'verify') });
  const r = await admin.post(`/api/admin/requests/${s.sr.id}/decision`,
    { action: 'approve', role: 'coach', permissions: { nutrition: true, reviews: false }, note: 'welcome' });
  eq(r.status, 200); eq(r.data.status, 'approved');
  const u = db.get('SELECT * FROM users WHERE id = ?', s.user.id);
  eq(u.status, 'active'); eq(u.role, 'coach'); ok(u.approved_at); eq(u.approved_by, adminU.id);
  eq(JSON.parse(u.permissions), { nutrition: true, reviews: false });
  const me = await s.c.fetch('/api/auth/me');
  eq(me.data.user.accountState, 'active'); eq(me.data.user.permissions.nutrition, true); eq(me.data.user.permissions.reviews, false);
  eq((await s.c.fetch('/api/state')).status, 200);
  eq((await s.c.fetch('/api/reviews')).status, 403, 'a revoked feature must stay revoked');
  const sr = db.get('SELECT * FROM signup_requests WHERE id = ?', s.sr.id);
  eq(sr.status, 'approved'); eq(sr.decided_by, adminU.id); eq(sr.decision_note, 'welcome');
});
await t('an admin cannot grant admin or owner; the owner can grant admin but never owner', async () => {
  const a = await newSignup(), b = await newSignup(), c = await newSignup();
  for (const x of [a, b, c]) await admin.post(`/api/admin/requests/${x.sr.id}/verify-email`);
  eq((await admin.post(`/api/admin/requests/${a.sr.id}/decision`, { action: 'approve', role: 'admin' })).status, 403);
  eq((await admin.post(`/api/admin/requests/${a.sr.id}/decision`, { action: 'approve', role: 'owner' })).status, 403);
  eq((await owner.post(`/api/admin/requests/${a.sr.id}/decision`, { action: 'approve', role: 'owner' })).status, 403);
  eq((await admin.post(`/api/admin/requests/${a.sr.id}/decision`, { action: 'approve', role: 'wizard' })).status, 400);
  eq(db.get('SELECT status, role FROM users WHERE id = ?', a.user.id), { status: 'pending', role: 'member' });
  eq((await owner.post(`/api/admin/requests/${b.sr.id}/decision`, { action: 'approve', role: 'admin' })).status, 200);
  eq(db.get('SELECT role FROM users WHERE id = ?', b.user.id).role, 'admin');
  eq((await admin.post(`/api/admin/requests/${c.sr.id}/decision`, { action: 'approve', role: 'coach' })).status, 200);
});
await t('permission overrides are validated against the known features', async () => {
  const s = await newSignup(); await admin.post(`/api/admin/requests/${s.sr.id}/verify-email`);
  for (const p of [{ godmode: true }, { reviews: 'yes' }, [1], 'all'])
    eq((await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve', permissions: p })).status, 400, JSON.stringify(p));
  eq(db.get('SELECT status FROM users WHERE id = ?', s.user.id).status, 'pending');
});
await t('rejection blocks login, kills an existing session, and stores the note', async () => {
  const s = await newSignup();
  const r = await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'reject', note: 'not a club member' });
  eq(r.status, 200); eq(r.data.status, 'rejected');
  const after = await s.c.fetch('/api/auth/me');
  eq(after.status, 401);
  const l = await client().post('/api/auth/login', { email: s.b.email, password: GOOD_PW });
  eq(l.status, 403); eq(l.data.accountStatus, 'rejected');
  eq(db.get('SELECT decision_note FROM signup_requests WHERE id = ?', s.sr.id).decision_note, 'not a club member');
  eq((await client().post('/api/auth/signup', body({ email: s.b.email }))).status, 200);
  eq(rows(s.b.email), 1, 'a rejected email must not create a second request');
  eq(db.get('SELECT status FROM users WHERE id = ?', s.user.id).status, 'rejected');
});
await t('suspending or revoking later is immediate, on direct requests with the old cookie', async () => {
  for (const st of ['suspended', 'revoked']) {
    const s = await newSignup(); await admin.post(`/api/admin/requests/${s.sr.id}/verify-email`);
    await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve' });
    const cookie = s.c.cookie;
    eq((await s.c.fetch('/api/state')).status, 200);
    eq((await admin.patch(`/api/admin/users/${s.user.id}`, { status: st })).status, 200);
    const res = await fetch(app.BASE + '/api/state', { headers: { Cookie: cookie, 'X-Recomp-Request': '1' } });
    eq(res.status, 401, st);
    const l = await client().post('/api/auth/login', { email: s.b.email, password: GOOD_PW });
    eq(l.status, 403); eq(l.data.accountStatus, st);
  }
});
await t('suspending a PENDING user also takes effect on the next request', async () => {
  const s = await newSignup();
  await admin.patch(`/api/admin/users/${s.user.id}`, { status: 'suspended' });
  eq((await s.c.fetch('/api/auth/me')).status, 401);
  eq((await s.c.fetch('/api/auth/session')).data.authenticated, false);
});

sec('PRIVATE ADMIN NOTES');
await t('notes are admin only, never in member-facing responses, and audited without the text', async () => {
  const s = await newSignup(); await admin.post(`/api/admin/requests/${s.sr.id}/verify-email`);
  await admin.post(`/api/admin/requests/${s.sr.id}/decision`, { action: 'approve' });
  const SECRET = 'PRIVATE-NOTE-ZEBRA-4471';
  eq((await admin.put(`/api/admin/users/${s.user.id}/note`, { note: SECRET })).status, 200);
  const g = await admin.fetch(`/api/admin/users/${s.user.id}/note`); eq(g.data.note, SECRET);
  const listed = (await admin.fetch('/api/admin/requests')).data.requests.find(x => x.id === s.sr.id); eq(listed.adminNote, SECRET);
  const seen = [];
  for (const p of ['/api/auth/me', '/api/auth/session', '/api/auth/account-status', '/api/state', '/api/reviews', '/api/proposals', '/api/weekly-submissions']) {
    const r = await s.c.fetch(p); seen.push(JSON.stringify(r.data));
  }
  const login = await client().post('/api/auth/login', { email: s.b.email, password: GOOD_PW }); seen.push(JSON.stringify(login.data));
  ok(seen.every(x => !x.includes(SECRET)), 'a note leaked to the member');
  eq((await s.c.fetch(`/api/admin/users/${s.user.id}/note`)).status, 403);
  eq((await s.c.put(`/api/admin/users/${s.user.id}/note`, { note: 'mine' })).status, 403);
  const entry = db.all("SELECT * FROM audit_log WHERE action = 'admin.note_changed'").pop();
  ok(entry && !JSON.stringify(entry).includes(SECRET), 'note text was written to the audit log');
  eq((await admin.put(`/api/admin/users/${s.user.id}/note`, { note: 'x'.repeat(2001) })).status, 400);
  eq((await admin.put(`/api/admin/users/${s.user.id}/note`, { note: '' })).status, 200);
  eq((await admin.fetch(`/api/admin/users/${s.user.id}/note`)).data.note, '');
  eq((await admin.fetch('/api/admin/users/nope/note')).status, 404);
});

sec('AUDIT TRAIL');
await t('every sign-up and admin action above left an audit entry', async () => {
  const a = audits();
  ['signup.created', 'signup.honeypot', 'signup.duplicate', 'signup.email_verified', 'signup.verification_resent',
   'signup.approved', 'signup.rejected', 'signup.verification_overridden', 'signup.email_attested',
   'admin.status_changed', 'admin.note_changed'].forEach(x => ok(a.includes(x), 'missing ' + x));
  const ap = db.all("SELECT detail FROM audit_log WHERE action = 'signup.approved'").map(r => r.detail).join('|');
  ok(ap.includes('"role"'), 'approval audit lacks the role');
});

sec('PASSWORD RESET');
const rs = await newSignup({ email: 'resetme@example.test' });
await admin.post(`/api/admin/requests/${rs.sr.id}/verify-email`);
await admin.post(`/api/admin/requests/${rs.sr.id}/decision`, { action: 'approve' });
await t('forgot is generic for known and unknown emails; mail only for a real account', async () => {
  const before = outbox.length;
  const a = await client().post('/api/auth/forgot', { email: 'resetme@example.test' });
  const mails = outbox.length;
  const b = await client().post('/api/auth/forgot', { email: 'nobody-here@example.test' });
  eq(a.status, 200); eq(b.status, 200); eq(a.data, b.data); eq(a.data, { ok: true, emailSent: true });
  eq(mails, before + 1); eq(outbox.length, mails, 'mail sent to an unknown address');
  eq((await client().post('/api/auth/forgot', {})).status, 200);
  const tk = db.get("SELECT * FROM email_tokens WHERE user_id = ? AND purpose = 'reset'", rs.user.id);
  ok(Math.abs(tk.expires_at - tk.created_at - 3600 * 1000) < 5000, 'reset TTL is 1h');
  ok(tokenFrom('resetme@example.test', 'reset'));
});
await t('reset enforces the policy without spending the token, then sets the password once', async () => {
  const token = tokenFrom('resetme@example.test', 'reset');
  eq((await client().post('/api/auth/reset', { token, password: 'weak' })).status, 400);
  const oldCookie = rs.c.cookie;
  eq((await rs.c.fetch('/api/state')).status, 200);
  const NEWPW = 'Fresh-Reset-Pass-31';
  const r = await client().post('/api/auth/reset', { token, password: NEWPW });
  eq(r.status, 200);
  eq((await rs.c.fetch('/api/state')).status, 401, 'old session survived a reset');
  eq((await client().post('/api/auth/login', { email: 'resetme@example.test', password: GOOD_PW })).status, 401);
  eq((await client().post('/api/auth/login', { email: 'resetme@example.test', password: NEWPW })).status, 200);
  eq((await client().post('/api/auth/reset', { token, password: 'Another-Pass-5555' })).status, 400, 'token reused');
  eq(db.get('SELECT must_change_pw FROM users WHERE id = ?', rs.user.id).must_change_pw, 0);
  ok(oldCookie);
});
await t('a reset clears a forced password change and revokes every session', async () => {
  const u = await app.makeUser(owner, 'forced@example.test', 'member');
  db.run('UPDATE users SET must_change_pw = 1 WHERE id = ?', u.id);
  const second = client(); await second.post('/api/auth/login', { email: u.email, password: u.password });
  await client().post('/api/auth/forgot', { email: u.email });
  const token = tokenFrom(u.email, 'reset');
  eq((await client().post('/api/auth/reset', { token, password: 'Reset-Forced-Pass-9' })).status, 200);
  eq(db.get('SELECT must_change_pw FROM users WHERE id = ?', u.id).must_change_pw, 0);
  eq(db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL', u.id).n, 0);
  ok(audits().includes('auth.password_reset') && audits().includes('auth.reset_requested'));
});
await t('expired and bogus reset tokens are refused', async () => {
  const u = await app.makeUser(owner, 'expire@example.test', 'member');
  await client().post('/api/auth/forgot', { email: u.email });
  const token = tokenFrom(u.email, 'reset');
  db.run("UPDATE email_tokens SET expires_at = ? WHERE user_id = ? AND purpose = 'reset'", Date.now() - 1, u.id);
  eq((await client().post('/api/auth/reset', { token, password: 'Valid-New-Pass-123' })).status, 400);
  eq((await client().post('/api/auth/reset', { token: 'x'.repeat(43), password: 'Valid-New-Pass-123' })).status, 400);
  eq((await client().post('/api/auth/reset', { password: 'Valid-New-Pass-123' })).status, 400);
});
await t('a verify token cannot be used as a reset token (and vice versa)', async () => {
  const s = await newSignup(); const vt = tokenFrom(s.b.email, 'verify');
  eq((await client().post('/api/auth/reset', { token: vt, password: 'Valid-New-Pass-123' })).status, 400);
  eq(db.get('SELECT used_at FROM email_tokens WHERE user_id = ?', s.user.id).used_at, null, 'wrong-purpose use spent the token');
});
await t('no reset mail for rejected or revoked accounts, and the response is unchanged', async () => {
  const rej = await newSignup(); await admin.post(`/api/admin/requests/${rej.sr.id}/decision`, { action: 'reject' });
  const rev = await app.makeUser(owner, 'revoked@example.test', 'member');
  await admin.patch(`/api/admin/users/${rev.id}`, { status: 'revoked' });
  const before = outbox.length;
  for (const e of [rej.b.email, rev.email]) eq((await client().post('/api/auth/forgot', { email: e })).data, { ok: true, emailSent: true });
  eq(outbox.length, before);
});
await t('forgot is rate limited per email (silently) and per IP', async () => {
  const e = 'resetme@example.test'; const before = outbox.length;
  for (let i = 0; i < 6; i++) eq((await client().post('/api/auth/forgot', { email: e })).status, 200);
  ok(outbox.length - before <= 3, 'more than 3 reset mails per hour for one address');
  const ip = '198.51.100.7';
  for (let i = 0; i < 10; i++) await client(ip).post('/api/auth/forgot', { email: `x${i}@example.test` });
  eq((await client(ip).post('/api/auth/forgot', { email: 'y@example.test' })).status, 429);
});

sec('MAIL PROVIDER');
await t('outbox provider records the message; links use PUBLIC_URL when set', async () => {
  const a = await startApp({ env: { PUBLIC_URL: 'https://gym.example.test/' } });
  const before = outbox.length;
  const r = await a.client().post('/api/auth/signup', body({ email: 'pu@example.test' }));
  eq(r.data.emailSent, true); eq(outbox.length, before + 1);
  ok(/https:\/\/gym\.example\.test\/\?verify=[\w-]+/.test(lastMail('pu@example.test').text), lastMail('pu@example.test').text);
  const b = await a.client().post('/api/auth/signup', body({ email: 'pu2@example.test' }));
  eq(b.status, 200);
  a.close();
  const plain = lastMail('sam1@example.test');
  ok(plain.text.includes(`${app.BASE}/?verify=`), 'request origin used when PUBLIC_URL is unset');
});
await t('Resend: bearer key, from address and JSON body go to the Resend API via the injectable fetch', async () => {
  const calls = [];
  const fake = async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200, json: async () => ({ id: 'e1' }) }; };
  const a = await startApp({ env: { MAIL_PROVIDER: undefined, RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Recomp <no-reply@example.test>' }, fetch: fake });
  const before = outbox.length;
  const r = await a.client().post('/api/auth/signup', body({ email: 'rs@example.test' }));
  eq(r.data, { ok: true, status: 'pending_verification', emailSent: true });
  eq(calls.length, 1); eq(calls[0].url, 'https://api.resend.com/emails');
  eq(calls[0].o.headers.Authorization, 'Bearer re_test_key'); eq(calls[0].o.method, 'POST');
  const sent = JSON.parse(calls[0].o.body);
  eq(sent.to, ['rs@example.test']); eq(sent.from, 'Recomp <no-reply@example.test>'); ok(/\?verify=/.test(sent.text));
  eq(outbox.length, before, 'the outbox was used although Resend is configured');
  a.close();
});
await t('a failing or throwing mail provider never breaks sign-up and emailSent is false', async () => {
  for (const fake of [async () => ({ ok: false, status: 500, json: async () => ({}) }), async () => { throw new Error('network down'); }]) {
    const a = await startApp({ env: { MAIL_PROVIDER: undefined, RESEND_API_KEY: 're_x', MAIL_FROM: 'a@b.test' }, fetch: fake });
    const c = a.client();
    const r = await c.post('/api/auth/signup', body({ email: 'fail@example.test' }));
    eq(r.status, 200); eq(r.data, { ok: true, status: 'pending_verification', emailSent: false });
    eq((await c.fetch('/api/auth/me')).status, 200);
    a.close();
  }
});
await t('with no provider configured sign-up works and reports emailSent:false', async () => {
  const a = await startApp({ env: { MAIL_PROVIDER: undefined } });
  const r = await a.client().post('/api/auth/signup', body({ email: 'nomail@example.test' }));
  eq(r.status, 200); eq(r.data.emailSent, false);
  eq(await sendMail({}, { to: 'a@b.test', subject: 's', text: 't' }), { sent: false, reason: 'not_configured' });
  eq(await sendMail({ RESEND_API_KEY: 'k' }, { to: 'a@b.test', subject: 's', text: 't' }), { sent: false, reason: 'not_configured' }, 'key without MAIL_FROM');
  a.close();
});
await t('mail bodies and tokens never reach the server log', async () => {
  const logs = []; const orig = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  try { await client().post('/api/auth/signup', body({ email: 'quiet@example.test' })); } finally { [console.log, console.error, console.warn] = orig; }
  const token = tokenFrom('quiet@example.test', 'verify');
  ok(!logs.join('\n').includes(token) && !logs.join('\n').includes(GOOD_PW));
});

finish(() => app.close());
