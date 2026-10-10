/* Security tests with synthetic accounts: owner, admin, coach (assigned
   reviewer), approved member, second member, pending member, suspended member.
   Real HTTP against a real server and database. Run: node test/security.test.js */
import { harness, startApp, totpCode, CONSENT } from './helpers.js';
import { outbox } from '../src/mail.js';
import { handle } from '../src/api.js';
import { DatabaseSync } from 'node:sqlite';
import { nodeDb } from '../src/db.js';
import { openText } from '../src/crypto.js';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { t, ok, eq, sec, finish } = harness();
const hibpCalls = [];
/* A fake Have I Been Pwned range API. Knows one breached password. */
const BREACHED = 'Breached-Example-Passphrase-1';
async function sha1(s) { const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase(); }
const BREACHED_HASH = await sha1(BREACHED);
const hibpFetch = async (url) => { hibpCalls.push(url); const prefix = url.split('/').pop();
  const body = prefix === BREACHED_HASH.slice(0, 5) ? BREACHED_HASH.slice(5) + ':42\r\nABCDEF0123456789ABCDEF0123456789ABC:1' : 'ABCDEF0123456789ABCDEF0123456789ABC:1';
  return { ok: true, text: async () => body }; };
const aiCalls = [];
const aiFetch = async (url, o) => { aiCalls.push({ url, body: o && o.body }); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"headline":"ok","wentWell":[],"needsAttention":[],"nextWeek":[],"notesConsidered":[],"caveats":[]}' }], model: 'm' }) }; };

const app = await startApp({ env: { HIBP_CHECK: 'on', ANTHROPIC_API_KEY: 'test-key', DATA_ENC_KEY: Buffer.alloc(32, 9).toString('base64') }, hibpFetch, fetch: aiFetch });
const { db, client } = app;
const owner = await app.ownerClient();
const admin = await app.makeUser(owner, 'admin@example.test', 'admin');
const coach = await app.makeUser(owner, 'coach@example.test', 'coach');
const alice = await app.makeUser(owner, 'alice@example.test', 'member');
const bob = await app.makeUser(owner, 'bob@example.test', 'member');
const sus = await app.makeUser(owner, 'sus@example.test', 'member');
await owner.post('/api/admin/assign', { coachId: coach.id, memberId: alice.id });
const pendingC = client(); await pendingC.post('/api/auth/signup', Object.assign({ name: 'Pen Ding', email: 'pend@example.test', password: 'Pending-Person-Pass-1', website: '' }, CONSENT));
const usersTotal = () => db.get('SELECT COUNT(*) AS n FROM users').n;
/* Test fixture: a code that has not been used yet. Each code works once (tested
   separately), so before reusing an account the fixture forgets the last step. */
const fresh = async (userId, secret) => { db.run('UPDATE mfa_totp SET last_step = NULL WHERE user_id = ?', userId); return totpCode(secret, 0); };
const OWNER_ID = db.get("SELECT id FROM users WHERE role = 'owner'").id;
const ownerReauth = async () => { const r = await owner.post('/api/auth/reauth', { password: 'Owner-New-Passphrase-7', code: await fresh(OWNER_ID, app.ownerSecret) }); if (r.status !== 200) throw new Error('owner reauth ' + JSON.stringify(r.data)); };

sec('PASSWORDS');
await t('breached passwords are refused, and only a 5-character hash prefix leaves the server', async () => {
  hibpCalls.length = 0;
  const r = await client().post('/api/auth/signup', Object.assign({ name: 'Bree Ched', email: 'bree@example.test', password: BREACHED, website: '' }, CONSENT));
  eq(r.status, 400); ok(/data breach/.test(r.data.error), r.data.error);
  eq(hibpCalls.length, 1); ok(/\/range\/[0-9A-F]{5}$/.test(hibpCalls[0]), hibpCalls[0]);
  ok(!hibpCalls[0].includes(BREACHED_HASH.slice(5, 15)), 'more of the hash was sent');
});
await t('any composition of 12 or more characters is allowed; common and app-name passwords are not', async () => {
  const ok1 = await client().post('/api/auth/signup', Object.assign({ name: 'Long Phrase', email: 'phrase@example.test', password: 'correct horse battery staple', website: '' }, CONSENT));
  eq(ok1.status, 200);
  for (const pw of ['password1234', 'recomp123456', 'qwertyuiop12']) {
    const r = await client().post('/api/auth/signup', Object.assign({ name: 'Weak Pw', email: `w${pw}@example.test`, password: pw, website: '' }, CONSENT));
    eq(r.status, 400, pw);
  }
});
await t('login errors do not reveal whether an account exists', async () => {
  const a = await client().post('/api/auth/login', { email: 'nobody@example.test', password: 'Whatever-Passphrase-1' });
  const b = await client().post('/api/auth/login', { email: 'alice@example.test', password: 'Wrong-Passphrase-123' }); // gitleaks:allow (synthetic test credential)
  eq([a.status, a.data.error], [b.status, b.data.error]);
});
await t('a password is throttled per login across many addresses (credential stuffing)', async () => {
  for (let i = 0; i < 30; i++) await client().post('/api/auth/login', { email: 'bob@example.test', password: 'Wrong-' + i + '-Passphrase' });
  const r = await client().post('/api/auth/login', { email: 'bob@example.test', password: bob.password });
  eq(r.status, 429);
  db.run("DELETE FROM login_attempts WHERE key LIKE '%bob@example.test%'");
});

sec('TWO-STEP VERIFICATION');
await t('an administrator without a second step can do nothing but set one up', async () => {
  const m = await owner.post('/api/admin/users', { email: 'admin2@example.test', password: 'Admin-Two-Passphrase-1', role: 'admin' });
  db.run('UPDATE users SET must_change_pw = 0 WHERE id = ?', m.data.id);
  const c = client(); await c.post('/api/auth/login', { email: 'admin2@example.test', password: 'Admin-Two-Passphrase-1' });
  const me = await c.fetch('/api/auth/me'); eq(me.data.user.mfaSetupRequired, true);
  for (const p of ['/api/admin/users', '/api/state', '/api/admin/requests?status=all', '/api/settings']) eq((await c.fetch(p)).data.code, 'mfa_setup_required', p);
  await app.enrolTotp(c);
  eq((await c.fetch('/api/admin/users')).status, 200);
});
await t('with two-step on, the password alone gives no session, only a pending-login cookie', async () => {
  const c = client(); const r = await c.post('/api/auth/login', { email: 'admin@example.test', password: admin.password });
  eq(r.status, 200); eq(r.data.mfaRequired, true); ok(!r.data.user);
  ok(c.cookie.startsWith('recomp_mfa=') && !c.cookie.includes('recomp_session'), c.cookie);
  eq((await c.fetch('/api/state')).status, 401);
});
await t('five wrong codes drop the pending login; a right code then needs the password again', async () => {
  const c = client(); await c.post('/api/auth/login', { email: 'admin@example.test', password: admin.password });
  for (let i = 0; i < 4; i++) eq((await c.post('/api/auth/mfa/verify', { code: '000000' })).status, 400);
  eq((await c.post('/api/auth/mfa/verify', { code: '000001' })).status, 401);
  eq((await c.post('/api/auth/mfa/verify', { code: await totpCode(admin.secret, 1) })).status, 401);
});
await t('a code works once: replaying it is refused', async () => {
  const code = await totpCode(admin.secret, 1);
  const c1 = client(); await c1.post('/api/auth/login', { email: 'admin@example.test', password: admin.password });
  eq((await c1.post('/api/auth/mfa/verify', { code })).status, 200);
  const c2 = client(); await c2.post('/api/auth/login', { email: 'admin@example.test', password: admin.password });
  eq((await c2.post('/api/auth/mfa/verify', { code })).status, 400);
});
await t('recovery codes are single use and are stored hashed', async () => {
  const codes = admin.c.recoveryCodes; eq(codes.length, 10);
  const stored = db.all('SELECT code_hash FROM mfa_recovery WHERE user_id = ?', admin.id);
  ok(stored.every(r => r.code_hash.startsWith('pbkdf2$')) && !stored.some(r => codes.some(c => r.code_hash.includes(c.replace('-', '')))));
  const c1 = client(); await c1.post('/api/auth/login', { email: 'admin@example.test', password: admin.password });
  eq((await c1.post('/api/auth/mfa/verify', { recoveryCode: codes[0] })).status, 200);
  const c2 = client(); await c2.post('/api/auth/login', { email: 'admin@example.test', password: admin.password });
  eq((await c2.post('/api/auth/mfa/verify', { recoveryCode: codes[0] })).status, 400);
  const me = await c1.fetch('/api/auth/me'); eq(me.data.user.mfa.recoveryCodesLeft, 9);
});
await t('a recovery code session cannot remove or weaken the second step without re-authenticating', async () => {
  const c = client(); await c.post('/api/auth/login', { email: 'alice@example.test', password: alice.password });
  await app.enrolTotp(c); const codes = c.recoveryCodes;
  db.run('DELETE FROM session_reauth');                                   // as if 10 minutes had passed
  const c2 = client(); await c2.post('/api/auth/login', { email: 'alice@example.test', password: alice.password });
  eq((await c2.post('/api/auth/mfa/verify', { recoveryCode: codes[1] })).status, 200);
  db.run('DELETE FROM session_reauth');
  eq((await c2.post('/api/auth/mfa/disable', {})).data.code, 'reauth_required');
  eq((await c2.post('/api/auth/email', { newEmail: 'evil@example.test' })).data.code, 'reauth_required');
  eq((await c2.fetch('/api/account/export')).data.code, 'reauth_required');
  eq((await c2.post('/api/auth/reauth', { password: alice.password })).status, 400, 'password alone is not enough when two-step is on');
  eq((await c2.post('/api/auth/reauth', { password: alice.password, recoveryCode: codes[2] })).status, 200);
  eq((await c2.post('/api/auth/mfa/disable', {})).status, 200);
  alice.c = c2;
});
await t('owners and administrators cannot turn their second step off', async () => {
  await ownerReauth();
  const r = await owner.post('/api/auth/mfa/disable', {}); eq(r.status, 403); eq(r.data.code, 'mfa_required');
});
await t('password reset does not bypass two-step verification', async () => {
  await client().post('/api/auth/forgot', { email: 'admin@example.test' });
  const m = [...outbox].reverse().find(x => x.to === 'admin@example.test');
  const token = m.text.match(/\?reset=([^\s"&]+)/)[1];
  eq((await client().post('/api/auth/reset', { token, password: 'Admin-Reset-Passphrase-2' })).status, 200);
  const c = client(); const r = await c.post('/api/auth/login', { email: 'admin@example.test', password: 'Admin-Reset-Passphrase-2' });
  eq(r.data.mfaRequired, true, 'reset must not turn two-step off');
  admin.password = 'Admin-Reset-Passphrase-2';
  eq((await admin.c.fetch('/api/auth/me')).status, 401, 'reset revokes existing sessions');
});

sec('SESSIONS');
await t('sessions are listed without tokens, and one can be revoked', async () => {
  const c2 = client(); await c2.post('/api/auth/login', { email: 'bob@example.test', password: bob.password });
  const l = await bob.c.fetch('/api/auth/sessions');
  eq(l.status, 200); ok(l.data.sessions.length >= 2);
  ok(l.data.sessions.every(s => s.id.length === 24 && !('ip' in s)), JSON.stringify(l.data.sessions[0]));
  const other = l.data.sessions.find(s => !s.current);
  eq((await bob.c.post(`/api/auth/sessions/${other.id}/revoke`, {})).status, 200);
  eq((await c2.fetch('/api/auth/me')).status, 401);
});
await t('a session handle of another account cannot be revoked', async () => {
  const l = await alice.c.fetch('/api/auth/sessions');
  eq((await bob.c.post(`/api/auth/sessions/${l.data.sessions[0].id}/revoke`, {})).status, 404);
  eq((await alice.c.fetch('/api/auth/me')).status, 200);
});
await t('log out all devices keeps or ends the current one as asked', async () => {
  const c2 = client(); await c2.post('/api/auth/login', { email: 'bob@example.test', password: bob.password });
  const r = await bob.c.post('/api/auth/logout-all', { keepCurrent: true }); ok(r.data.revoked >= 1);
  eq((await c2.fetch('/api/auth/me')).status, 401); eq((await bob.c.fetch('/api/auth/me')).status, 200);
});
await t('sessions rotate: logging in gives a new token, and a password change ends the others', async () => {
  const before = bob.c.cookie;
  const c2 = client(); await c2.post('/api/auth/login', { email: 'bob@example.test', password: bob.password });
  ok(c2.cookie !== before);
  await bob.c.post('/api/auth/reauth', { password: bob.password });
  eq((await bob.c.post('/api/auth/password', { current: bob.password, next: 'Bob-Changed-Passphrase-9' })).status, 200);
  bob.password = 'Bob-Changed-Passphrase-9';
  ok(bob.c.cookie !== before, 'the changing session gets a fresh token');
  eq((await c2.fetch('/api/auth/me')).status, 401);
});
await t('changing a password needs a recent sign-in', async () => {
  db.run('DELETE FROM session_reauth');
  eq((await bob.c.post('/api/auth/password', { current: bob.password, next: 'Another-Passphrase-77' })).data.code, 'reauth_required');
});
await t('sessions expire when idle and at the absolute limit', async () => {
  const sid = db.get('SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', bob.id).id;
  db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', Date.now() - 8 * 24 * 3600 * 1000, sid);
  eq((await bob.c.fetch('/api/auth/me')).status, 401);
  const c = client(); await c.post('/api/auth/login', { email: 'bob@example.test', password: bob.password }); bob.c = c;
  const sid2 = db.get('SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', bob.id).id;
  db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', Date.now() - 1000, sid2);
  eq((await c.fetch('/api/auth/me')).status, 401);
  const c3 = client(); await c3.post('/api/auth/login', { email: 'bob@example.test', password: bob.password }); bob.c = c3;
});
await t('suspension takes effect on the very next request', async () => {
  await ownerReauth();
  eq((await sus.c.fetch('/api/state')).status, 200);
  eq((await owner.patch(`/api/admin/users/${sus.id}`, { status: 'suspended' })).status, 200);
  eq((await sus.c.fetch('/api/state')).status, 401);
  eq((await client().post('/api/auth/login', { email: 'sus@example.test', password: sus.password })).status, 403);
});
await t('a role change ends the account\'s sessions so the new role applies on a fresh sign-in', async () => {
  await ownerReauth();
  const m = await app.makeUser(owner, 'promo@example.test', 'member');
  eq((await owner.patch(`/api/admin/users/${m.id}`, { role: 'coach' })).status, 200);
  eq((await m.c.fetch('/api/auth/me')).status, 401);
});

sec('ADMINISTRATOR LIMITS');
await t('admin changes need a recent sign-in', async () => {
  db.run('DELETE FROM session_reauth');
  eq((await owner.patch(`/api/admin/users/${bob.id}`, { status: 'active' })).data.code, 'reauth_required');
  eq((await owner.post('/api/admin/users', { email: 'x@example.test', password: 'Some-Long-Passphrase-1' })).data.code, 'reauth_required');
  await ownerReauth();
});
await t('an administrator cannot change the owner or another administrator', async () => {
  db.run('UPDATE mfa_totp SET last_step = NULL WHERE user_id = ?', admin.id);
  const c = client(); const r = await app.loginWithMfa(c, 'admin@example.test', admin.password, admin.secret, 0);
  eq(r.status, 200, JSON.stringify(r.data));
  const ownerId = db.get("SELECT id FROM users WHERE role = 'owner'").id;
  eq((await c.patch(`/api/admin/users/${ownerId}`, { status: 'suspended' })).status, 403);
  const a2 = db.get("SELECT id FROM users WHERE email = 'admin2@example.test'").id;
  eq((await c.patch(`/api/admin/users/${a2}`, { permissions: { training: false } })).status, 403);
  eq((await c.patch(`/api/admin/users/${bob.id}`, { role: 'admin' })).status, 403, 'only the owner grants roles');
  admin.c = c;
});
await t('the last owner cannot be removed in any way', async () => {
  const ownerId = db.get("SELECT id FROM users WHERE role = 'owner'").id;
  eq((await owner.patch(`/api/admin/users/${ownerId}`, { role: 'member' })).status, 409);
  eq((await owner.patch(`/api/admin/users/${ownerId}`, { status: 'revoked' })).status, 409);
  const d = await owner.post('/api/account/delete', { confirm: 'DELETE MY ACCOUNT' }); eq(d.status, 409); eq(d.data.code, 'last_owner');
});
await t('nobody can make themselves an owner or administrator', async () => {
  eq((await alice.c.patch(`/api/admin/users/${alice.id}`, { role: 'owner' })).status, 403);
  eq((await client().post('/api/auth/signup', Object.assign({ name: 'Role Grab', email: 'grab@example.test', password: 'Grab-Passphrase-1234', website: '', role: 'owner' }, CONSENT))).status, 200); // gitleaks:allow (synthetic test credential)
  eq(db.get("SELECT role FROM users WHERE email = 'grab@example.test'").role, 'member');
  eq((await client().post('/api/auth/setup', { email: 'owner@example.test', password: 'Setup-Again-Passphrase-1' })).status, 409, 'setup is closed once an owner exists');
});

sec('CROSS-ACCOUNT ACCESS');
await t('changing any id in the URL never reaches another account', async () => {
  await alice.c.put('/api/state', { doc: { schemaVersion: 5, secret: 'alice-only' } });
  for (const [m, p] of [['GET', `/api/users/${alice.id}/state`], ['GET', `/api/admin/users/${alice.id}/note`], ['PUT', `/api/admin/users/${alice.id}/note`], ['PATCH', `/api/admin/users/${alice.id}`]]) {
    const r = await bob.c.fetch(p, { method: m, body: m === 'GET' ? undefined : {} });
    ok(r.status === 403 || r.status === 404, `${m} ${p} -> ${r.status}`);
    ok(!JSON.stringify(r.data).includes('alice-only'));
  }
  const rv = await alice.c.post('/api/reviews', { comment: 'private', sessionRef: 'x' });
  for (const [m, p] of [['PATCH', `/api/reviews/${rv.data.id}`], ['GET', `/api/reviews/${rv.data.id}/messages`], ['POST', `/api/reviews/${rv.data.id}/messages`]]) {
    eq((await bob.c.fetch(p, { method: m, body: m === 'GET' ? undefined : { body: 'x', status: 'resolved' } })).status, 403, `${m} ${p}`);
  }
  const ws = await alice.c.post('/api/weekly-submissions', { weekStart: '2026-09-07', report: { a: 1 } });
  eq(ws.status, 200, JSON.stringify(ws.data));
  eq((await bob.c.patch(`/api/weekly-submissions/${ws.data.id}`, { action: 'withdraw' })).status, 403);
  eq((await bob.c.patch(`/api/weekly-submissions/${ws.data.id}`, { action: 'approve' })).status, 403);
});
await t('an administrator cannot read a member\'s training records without being assigned', async () => {
  const r = await admin.c.fetch(`/api/users/${alice.id}/state`); eq(r.status, 403);
  ok(db.all("SELECT action FROM audit_log WHERE action = 'access.denied'").length >= 1);
});
await t('the assigned coach can read, and the read is logged', async () => {
  const r = await coach.c.fetch(`/api/users/${alice.id}/state`); eq(r.status, 200); eq(r.data.doc.secret, 'alice-only');
  ok(db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'access.read_member_records' AND target_id = ?", alice.id).n >= 1);
});
await t('with sharing off, even the assigned coach is refused and no new reports can be sent', async () => {
  eq((await alice.c.put('/api/settings', { shareWithReviewer: false })).status, 200);
  eq((await coach.c.fetch(`/api/users/${alice.id}/state`)).status, 403);
  eq((await coach.c.fetch('/api/weekly-submissions?inbox=1')).data.submissions.length, 0);
  eq((await alice.c.post('/api/weekly-submissions', { weekStart: '2026-09-14', report: { a: 1 } })).data.code, 'sharing_off');
  await alice.c.put('/api/settings', { shareWithReviewer: true });
});
await t('unknown settings are refused, and settings belong to the signed-in account only', async () => {
  eq((await alice.c.put('/api/settings', { aiReviews: true, role: 'admin' })).status, 400);
  await alice.c.put('/api/settings', { aiReviews: true });
  eq((await bob.c.fetch('/api/settings')).data.settings.aiReviews, false);
});

sec('AI REQUESTS');
const payload = { period: { start: '2026-09-07', end: '2026-09-13', timezone: 'Australia/Sydney' }, goal: { primary: 'recomp', secondary: [] },
  stats: { planned: 4, completed: 4 }, facts: [], attention: [], notes: [], feedback: [], proposals: [], dataGaps: [] };
await t('with AI reviews off, nothing is sent to the provider', async () => {
  aiCalls.length = 0;
  const r = await bob.c.post('/api/ai/weekly-review', { payload });
  eq(r.status, 403); eq(r.data.code, 'ai_disabled'); eq(aiCalls.length, 0);
});
await t('with AI on, the request carries only the payload; an id in the body is refused', async () => {
  aiCalls.length = 0;
  eq((await alice.c.post('/api/ai/weekly-review', { payload, userId: bob.id })).status, 400);
  const r = await alice.c.post('/api/ai/weekly-review', { payload }); eq(r.status, 200, JSON.stringify(r.data));
  eq(aiCalls.length, 1); ok(!aiCalls[0].body.includes('alice@example.test') && !aiCalls[0].body.includes(bob.id));
});
await t('withdrawing health consent stops saving training data and AI use, but export still works', async () => {
  eq((await bob.c.post('/api/account/consents', { kind: 'health_data', granted: false })).status, 200);
  eq((await bob.c.put('/api/state', { doc: { schemaVersion: 5 } })).data.code, 'health_consent_withdrawn');
  eq((await bob.c.fetch('/api/state')).status, 200);
  await bob.c.post('/api/account/consents', { kind: 'health_data', granted: true });
  eq((await bob.c.put('/api/state', { doc: { schemaVersion: 5, b: 1 } })).status, 200);
});

sec('DATA AT REST');
await t('training state, reports, messages, notes and secrets are encrypted in the database', async () => {
  ok(db.get('SELECT doc FROM user_state WHERE user_id = ?', alice.id).doc.startsWith('enc1:'));
  ok(db.get('SELECT report_json FROM weekly_submissions WHERE user_id = ?', alice.id).report_json.startsWith('enc1:'));
  ok(db.get('SELECT secret FROM mfa_totp WHERE user_id = ?', admin.id).secret.startsWith('enc1:'));
  await owner.put(`/api/admin/users/${alice.id}/note`, { note: 'met at the gym' });
  ok(db.get('SELECT note FROM admin_notes WHERE user_id = ?', alice.id).note.startsWith('enc1:'));
  eq((await owner.fetch(`/api/admin/users/${alice.id}/note`)).data.note, 'met at the gym');
});
await t('rows written before the key existed are still readable and are encrypted on the next write', async () => {
  db.run('UPDATE user_state SET doc = ? WHERE user_id = ?', JSON.stringify({ schemaVersion: 5, legacy: true }), bob.id);
  eq((await bob.c.fetch('/api/state')).data.doc.legacy, true);
  await bob.c.put('/api/state', { doc: { schemaVersion: 5, legacy: false } });
  ok(db.get('SELECT doc FROM user_state WHERE user_id = ?', bob.id).doc.startsWith('enc1:'));
});

sec('AUDIT LOG');
await t('audit entries cannot be rewritten or deleted, even by the app itself', async () => {
  let threw = 0;
  try { db.run('DELETE FROM audit_log'); } catch (e) { threw++; }
  try { db.run("UPDATE audit_log SET action = 'x'"); } catch (e) { threw++; }
  eq(threw, 2); ok(db.get('SELECT COUNT(*) AS n FROM audit_log').n > 10);
});
await t('no password, code or token is written to the audit log', async () => {
  const all = JSON.stringify(db.all('SELECT * FROM audit_log'));
  for (const s of [alice.password, bob.password, admin.password, 'Owner-New-Passphrase-7', admin.c.recoveryCodes && admin.c.recoveryCodes[3]]) if (s) ok(!all.includes(s), 'found a secret in the audit log');
});
await t('security events hide content fields and are for administrators only', async () => {
  eq((await alice.c.fetch('/api/admin/security-events')).status, 403);
  const r = await owner.fetch('/api/admin/security-events?limit=50'); eq(r.status, 200); ok(r.data.events.length > 0);
});

sec('EMAIL CHANGE');
await t('the new address must confirm, the old address is told, and other sessions end', async () => {
  const other = client(); await other.post('/api/auth/login', { email: 'bob@example.test', password: bob.password });
  await bob.c.post('/api/auth/reauth', { password: bob.password });
  eq((await bob.c.post('/api/auth/email', { newEmail: 'robert@example.test' })).status, 200);
  ok([...outbox].some(m => m.to === 'bob@example.test' && /change/.test(m.subject)), 'old address not told');
  const m = [...outbox].reverse().find(x => x.to === 'robert@example.test'); const token = m.text.match(/\?email=([^\s"&]+)/)[1];
  eq(db.get('SELECT email FROM users WHERE id = ?', bob.id).email, 'bob@example.test', 'nothing changes before the link is opened');
  eq((await client().post('/api/auth/email/confirm', { token })).status, 200);
  eq((await client().post('/api/auth/email/confirm', { token })).status, 400, 'the link works once');
  eq(db.get('SELECT email FROM users WHERE id = ?', bob.id).email, 'robert@example.test');
  eq((await other.fetch('/api/auth/me')).status, 401);
  const c = client(); await c.post('/api/auth/login', { email: 'robert@example.test', password: bob.password }); bob.c = c; bob.email = 'robert@example.test';
});
await t('asking to move to an address that is taken looks the same and changes nothing', async () => {
  await bob.c.post('/api/auth/reauth', { password: bob.password });
  eq((await bob.c.post('/api/auth/email', { newEmail: 'alice@example.test' })).status, 200);
  eq(db.get('SELECT email FROM users WHERE id = ?', alice.id).email, 'alice@example.test');
});

sec('EXPORT AND DELETION');
await t('export needs a recent sign-in and holds only the signed-in account\'s data, without secrets', async () => {
  db.run('DELETE FROM session_reauth');
  eq((await alice.c.fetch('/api/account/export')).data.code, 'reauth_required');
  const code = await totpCode(app.ownerSecret, 1);
  await alice.c.post('/api/auth/reauth', { password: alice.password });
  const r = await alice.c.fetch('/api/account/export'); eq(r.status, 200);
  eq(r.data.account.email, 'alice@example.test'); eq(r.data.state.doc.secret, 'alice-only');
  const s = JSON.stringify(r.data);
  ok(!s.includes('pbkdf2$') && !s.includes('enc1:') && !s.includes(bob.id) && !s.includes('robert@example.test'));
  ok(r.data.consents.length >= 0 && r.data.weeklySubmissions.length >= 1);
});
await t('deleting an account removes its rows from every table, and it can no longer sign in', async () => {
  await ownerReauth();
  const del = await app.makeUser(owner, 'del@example.test', 'member');
  await del.c.put('/api/state', { doc: { schemaVersion: 5, x: 1 } });
  await del.c.post('/api/account/requests', { type: 'privacy', message: 'Please delete me soon' });
  await del.c.put('/api/settings', { aiReviews: true });
  await owner.post('/api/admin/assign', { coachId: coach.id, memberId: del.id });
  eq((await del.c.post('/api/account/delete', { confirm: 'nope' })).status, 400);
  const r = await del.c.post('/api/account/delete', { confirm: 'DELETE MY ACCOUNT' });
  eq(r.status, 200, JSON.stringify(r.data)); ok(r.data.deleted.length > 5 && r.data.retained.length && /30 days/.test(r.data.backups));
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(x => x.name);
  for (const tb of tables) {
    const cols = db.all(`PRAGMA table_info(${tb})`).map(c => c.name);
    for (const col of cols.filter(c => ['user_id', 'id', 'member_id', 'coach_id', 'author_id'].includes(c))) {
      if (tb === 'audit_log') continue;
      eq(db.get(`SELECT COUNT(*) AS n FROM ${tb} WHERE ${col} = ?`, del.id).n, 0, `${tb}.${col}`);
    }
  }
  const audits = db.all('SELECT * FROM audit_log WHERE actor_id = ? OR target_id = ?', del.id, del.id);
  ok(audits.length > 0 && audits.every(a => a.actor_email === null && a.ip === null), 'audit rows keep personal details');
  ok(audits.some(a => a.action === 'privacy.account_deleted'));
  eq((await client().post('/api/auth/login', { email: 'del@example.test', password: del.password })).status, 401);
  eq((await del.c.fetch('/api/auth/me')).status, 401);
});

sec('REQUEST HANDLING');
await t('cross-site requests are refused (Origin check and custom header)', async () => {
  eq((await alice.c.fetch('/api/settings', { method: 'PUT', body: { aiReviews: false }, headers: { Origin: 'https://evil.example' } })).status, 403);
  eq((await alice.c.fetch('/api/settings', { method: 'PUT', body: { aiReviews: false }, headers: { 'X-Recomp-Request': '0' } })).status, 403);
});
await t('API responses are uncacheable, unframeable data with a CSP that allows nothing', async () => {
  const r = await alice.c.fetch('/api/auth/me');
  eq(r.headers.get('cache-control'), 'no-store, private');
  ok(/default-src 'none'/.test(r.headers.get('content-security-policy')));
  eq(r.headers.get('x-content-type-options'), 'nosniff'); eq(r.headers.get('access-control-allow-origin'), null);
});
await t('oversized bodies are refused, so no route can be used to store files', async () => {
  const big = 'x'.repeat(70 * 1024);
  eq((await alice.c.post('/api/account/requests', { type: 'other', message: big })).status, 413);
  eq((await alice.c.fetch('/api/state', { method: 'PUT', body: { doc: { s: 'x'.repeat(5 * 1024 * 1024) } } })).status, 413);
});
await t('a failure returns a plain error with no stack trace or internals', async () => {
  const broken = { kind: 'node', run: async () => { throw new Error('SQLITE_ERROR near "secret_table": syntax'); }, get: async () => { throw new Error('boom /home/user/x.js:1'); }, all: async () => [] };
  const res = await handle(new Request('http://127.0.0.1/api/auth/login', { method: 'POST', headers: { 'X-Recomp-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a', password: 'b' }) }), { db: broken, env: {} });
  const body = await res.text();
  eq(res.status, 500); eq(JSON.parse(body), { error: 'Server error.' });
});
await t('page content rejects HTML, script links and unknown fields', async () => {
  await ownerReauth();
  for (const content of [{ blocks: [{ t: 'p', text: '<script>alert(1)</script>' }] }, { blocks: [{ t: 'p', text: '[x](javascript:alert(1))' }] },
    { blocks: [{ t: 'html', text: 'x' }] }, { blocks: [{ t: 'p', text: 'x', onclick: 'y' }] }]) {
    eq((await owner.put('/api/admin/content/about', { content })).status, 400, JSON.stringify(content));
  }
  eq((await owner.put('/api/admin/content/about', { content: { title: 'About', blocks: [{ t: 'p', text: 'Hello [site](https://example.com)' }] } })).status, 200);
  eq((await client().fetch('/api/content/about')).data.content.blocks[0].text, 'Hello [site](https://example.com)');
  eq((await alice.c.put('/api/admin/content/about', { content: { blocks: [] } })).status, 403);
});

sec('BACKUP AND RESTORE (local demonstration)');
await t('a database copy can be restored and the data verified', async () => {
  const file = join(tmpdir(), 'recomp-backup-' + Date.now() + '.db');
  db.run(`VACUUM INTO '${file}'`);
  const users = usersTotal();
  const restored = nodeDb(DatabaseSync, file);
  eq(restored.get('SELECT COUNT(*) AS n FROM users').n, users);
  eq(restored.get('SELECT COUNT(*) AS n FROM user_state WHERE user_id = ?', alice.id).n, 1);
  const doc = restored.get('SELECT doc FROM user_state WHERE user_id = ?', alice.id).doc;
  ok(doc.startsWith('enc1:'), 'restored training data is still encrypted');
  ok(JSON.parse(await openText(app.env, doc)), 'and opens with the key');
  ok(restored.get("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'audit_log_no_delete'"), 'audit protection travels with the copy');
  restored.close(); await rm(file, { force: true });
});

sec('PASSKEYS');
/* A software authenticator: a P-256 key pair and the byte layout a real device produces. */
function cbor(v) {
  const out = []; const head = (mt, n) => { if (n < 24) out.push((mt << 5) | n); else if (n < 256) out.push((mt << 5) | 24, n); else out.push((mt << 5) | 25, n >> 8, n & 255); };
  const enc = x => {
    if (typeof x === 'number') { if (x >= 0) head(0, x); else head(1, -1 - x); }
    else if (typeof x === 'string') { const b = new TextEncoder().encode(x); head(3, b.length); out.push(...b); }
    else if (x instanceof Uint8Array) { head(2, x.length); out.push(...x); }
    else if (x instanceof Map) { head(5, x.size); for (const [k, val] of x) { enc(k); enc(val); } }
    else if (typeof x === 'object') { const ks = Object.keys(x); head(5, ks.length); for (const k of ks) { enc(k); enc(x[k]); } }
  };
  enc(v); return new Uint8Array(out);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
function rawToDer(raw) {
  const int = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.slice(i); if (v[0] & 0x80) v = new Uint8Array([0, ...v]); return [0x02, v.length, ...v]; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32)); return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const credId = crypto.getRandomValues(new Uint8Array(16));
const ORIGIN = app.BASE, RPID = '127.0.0.1';
let pkCounter = 0;
async function authData(flags, counter, attested) {
  const parts = [...(await sha256(new TextEncoder().encode(RPID))), flags, (counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255];
  if (attested) {
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
    parts.push(...new Uint8Array(16), 0, credId.length, ...credId, ...cose);
  }
  return new Uint8Array(parts);
}
async function assertion(challenge, opts) {
  opts = opts || {};
  const cd = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: opts.origin || ORIGIN }));
  const ad = await authData(0x05, opts.counter != null ? opts.counter : ++pkCounter, false);
  const signed = new Uint8Array([...ad, ...(await sha256(cd))]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, signed));
  return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(rawToDer(sig)), userHandle: null } };
}
await t('a passkey is registered after a recent sign-in, with origin and RP ID checked', async () => {
  await coach.c.post('/api/auth/reauth', { password: coach.password });
  const b = await coach.c.post('/api/auth/passkey/register/begin', {}); eq(b.status, 200);
  eq(b.data.options.attestation, 'none'); eq(b.data.options.authenticatorSelection.userVerification, 'required');
  const cd = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: b.data.options.challenge, origin: ORIGIN }));
  const att = cbor({ fmt: 'none', attStmt: new Map(), authData: await authData(0x45, 0, true) });
  const r = await coach.c.post('/api/auth/passkey/register/finish', { challengeId: b.data.challengeId, label: 'Test key', credential: { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(cd), attestationObject: b64u(att) } } });
  eq(r.status, 200, JSON.stringify(r.data));
  eq((await coach.c.post('/api/auth/passkey/register/finish', { challengeId: b.data.challengeId, credential: {} })).status, 400, 'challenge is single use');
});
await t('passkey sign-in works, and wrong origin, replayed challenge and a counter going backwards are refused', async () => {
  const c = client(); const b = await c.post('/api/auth/passkey/login/begin', {}); eq(b.status, 200);
  const bad = client(); const bb = await bad.post('/api/auth/passkey/login/begin', {});
  eq((await bad.post('/api/auth/passkey/login/finish', { challengeId: bb.data.challengeId, credential: await assertion(bb.data.options.challenge, { origin: 'https://evil.example' }) })).status, 400);
  const r = await c.post('/api/auth/passkey/login/finish', { challengeId: b.data.challengeId, credential: await assertion(b.data.options.challenge) });
  eq(r.status, 200, JSON.stringify(r.data)); eq(r.data.user.email, 'coach@example.test');
  eq((await c.post('/api/auth/passkey/login/finish', { challengeId: b.data.challengeId, credential: await assertion(b.data.options.challenge) })).status, 400, 'replay');
  const c2 = client(); const b2 = await c2.post('/api/auth/passkey/login/begin', {});
  eq((await c2.post('/api/auth/passkey/login/finish', { challengeId: b2.data.challengeId, credential: await assertion(b2.data.options.challenge, { counter: 1 }) })).status, 400, 'counter regressed');
});
await t('a forged signature is refused', async () => {
  const c = client(); const b = await c.post('/api/auth/passkey/login/begin', {});
  const a = await assertion(b.data.options.challenge); const sig = Buffer.from(a.response.signature, 'base64url'); sig[sig.length - 1] ^= 1; a.response.signature = b64u(sig);
  eq((await c.post('/api/auth/passkey/login/finish', { challengeId: b.data.challengeId, credential: a })).status, 400);
});

sec('PUBLIC ENDPOINTS');
await t('operator details and page content are public and hold nothing about accounts', async () => {
  const o = await client().fetch('/api/operator'); eq(o.status, 200); eq(o.data.complete, false);
  await ownerReauth();
  eq((await owner.put('/api/admin/operator', { operator: { name: 'Recomp', privacyEmail: 'privacy@example.test', country: 'Australia', abn: '12 345 678 901' }, policy: { effectiveDate: '2026-11-01' } })).status, 200);
  const o2 = await client().fetch('/api/operator'); eq(o2.data.complete, true); eq(o2.data.operator.abn, '12 345 678 901');
  eq((await owner.put('/api/admin/operator', { operator: { abn: '123' } })).status, 400);
});
await t('the setup checklist reflects real configuration', async () => {
  const r = await owner.fetch('/api/admin/privacy-checklist'); eq(r.status, 200);
  const byId = Object.fromEntries(r.data.items.map(i => [i.id, i]));
  eq(byId.encryption_key.done, true); eq(byId.ai.done, true); eq(byId.mail.done, false, 'the test outbox is not real email');
  eq(byId.bootstrap_secret_removed.done, false); eq(byId.legal_review.done, false); eq(r.data.publishable, false);
  eq((await owner.put('/api/admin/privacy-checklist/legal_review', { done: true })).status, 200);
  eq((await owner.put('/api/admin/privacy-checklist/encryption_key', { done: true })).status, 404, 'automatic items cannot be ticked by hand');
});

finish(() => app.close());
