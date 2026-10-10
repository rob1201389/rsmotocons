/* A member's own account: server-enforced settings, consent records, profile,
   export of everything held, correction and privacy requests, and deletion.
   The user id always comes from the session. */
import { newId, sealText, openText } from './crypto.js';
import { audit } from './auth.js';
import { json, err, readBody } from './http.js';
import { hasRecentAuth, reauthRequired, deviceLabel, mfaSummary } from './security.js';
import { isOver, hit, HOUR } from './limits.js';

/* ---------------------------------------------------------------- settings */
export const SETTINGS_DEFAULTS = { aiReviews: false, shareWithReviewer: true };
export async function getSettings(db, userId) {
  const r = await db.get('SELECT * FROM user_settings WHERE user_id = ?', userId);
  if (!r) return Object.assign({}, SETTINGS_DEFAULTS, { updatedAt: null });
  return { aiReviews: !!r.ai_reviews, shareWithReviewer: !!r.share_with_reviewer, updatedAt: r.updated_at };
}
export async function settingsRoute(rc, user) {
  if (rc.req.method === 'GET') { const s = await getSettings(rc.db, user.id); return json({ settings: { aiReviews: s.aiReviews, shareWithReviewer: s.shareWithReviewer }, updatedAt: s.updatedAt }); }
  const b = await readBody(rc.req);
  const allowed = ['aiReviews', 'shareWithReviewer'];
  const bad = Object.keys(b).filter(k => allowed.indexOf(k) < 0);
  if (bad.length) return err(400, 'Unknown setting: ' + bad.join(', ').slice(0, 80));
  for (const k of Object.keys(b)) if (typeof b[k] !== 'boolean') return err(400, `${k} must be true or false.`);
  const cur = await getSettings(rc.db, user.id);
  const next = { aiReviews: 'aiReviews' in b ? b.aiReviews : cur.aiReviews, shareWithReviewer: 'shareWithReviewer' in b ? b.shareWithReviewer : cur.shareWithReviewer };
  await rc.db.run('INSERT OR REPLACE INTO user_settings (user_id, ai_reviews, share_with_reviewer, updated_at) VALUES (?,?,?,?)',
    user.id, next.aiReviews ? 1 : 0, next.shareWithReviewer ? 1 : 0, rc.now);
  if (next.aiReviews !== cur.aiReviews) await recordConsent(rc.db, user.id, 'ai_review', null, next.aiReviews, rc.now, 'settings');
  if (next.shareWithReviewer !== cur.shareWithReviewer) await audit(rc.db, user, 'privacy.sharing_changed', user.id, { shareWithReviewer: next.shareWithReviewer }, rc.ip);
  return json({ settings: next, updatedAt: rc.now });
}
export async function sharingAllowed(db, memberId) { return (await getSettings(db, memberId)).shareWithReviewer; }

/* ---------------------------------------------------------------- consents
   Acknowledging the privacy notice is not consent. Health data consent is
   explicit and separate. AI review consent mirrors the aiReviews setting. */
export const CONSENT_KINDS = ['privacy_notice', 'health_data', 'ai_review'];
export async function recordConsent(db, userId, kind, version, granted, now, source) {
  await db.run('INSERT INTO consents (id, user_id, kind, version, granted, at, source) VALUES (?,?,?,?,?,?,?)',
    newId('cs'), userId, kind, version ? String(version).slice(0, 40) : null, granted ? 1 : 0, now, source || null);
}
export async function consentSummary(db, userId) {
  const latest = async kind => db.get('SELECT * FROM consents WHERE user_id = ? AND kind = ? ORDER BY at DESC, rowid DESC LIMIT 1', userId, kind);
  const pn = await latest('privacy_notice'), hd = await latest('health_data');
  return { privacyNotice: pn ? { version: pn.version, at: pn.at } : null, healthData: hd ? { granted: !!hd.granted, at: hd.at } : null };
}
export async function healthConsentWithdrawn(db, userId) {
  const hd = await db.get("SELECT granted FROM consents WHERE user_id = ? AND kind = 'health_data' ORDER BY at DESC, rowid DESC LIMIT 1", userId);
  return !!(hd && !hd.granted);
}
export async function consentsRoute(rc, user) {
  if (rc.req.method === 'GET') return json({ consents: await consentSummary(rc.db, user.id) });
  const b = await readBody(rc.req);
  if (b.kind === 'privacy_notice') {
    const v = String(b.version || '').trim(); if (!v || v.length > 40) return err(400, 'A policy version is required.');
    await recordConsent(rc.db, user.id, 'privacy_notice', v, true, rc.now, 'app');
  } else if (b.kind === 'health_data') {
    if (typeof b.granted !== 'boolean') return err(400, 'granted must be true or false.');
    await recordConsent(rc.db, user.id, 'health_data', null, b.granted, rc.now, 'app');
    await audit(rc.db, user, b.granted ? 'privacy.health_consent_granted' : 'privacy.health_consent_withdrawn', user.id, null, rc.ip);
  } else return err(400, 'Unknown consent kind.');
  return json({ ok: true, consents: await consentSummary(rc.db, user.id) });
}

/* ---------------------------------------------------------------- profile */
export async function profileRoute(rc, user) {
  const b = await readBody(rc.req);
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return err(400, 'Enter a name of 2 to 80 characters.');
  await rc.db.run('UPDATE users SET name = ? WHERE id = ?', name, user.id);
  await audit(rc.db, user, 'account.name_changed', user.id, null, rc.ip);
  return json({ ok: true });
}

/* ---------------------------------------------------------------- requests */
export async function requestCreate(rc, user) {
  if (await isOver(rc.db, 'acctreq|' + user.id, 10, 24 * HOUR, rc.now)) return err(429, 'Too many requests today. Try again tomorrow.');
  const b = await readBody(rc.req);
  const type = ['correction', 'privacy', 'other'].includes(b.type) ? b.type : null;
  const msg = String(b.message || '').trim();
  if (!type) return err(400, 'Choose a request type.');
  if (msg.length < 5 || msg.length > 2000) return err(400, 'Write between 5 and 2,000 characters.');
  await hit(rc.db, 'acctreq|' + user.id, rc.now);
  const id = newId('ar');
  await rc.db.run('INSERT INTO account_requests (id, user_id, type, message, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    id, user.id, type, await sealText(rc.env, msg), 'open', rc.now, rc.now);
  await audit(rc.db, user, 'account.request_created', user.id, { type }, rc.ip);
  return json({ ok: true, id });
}
export async function adminRequests(rc, actor) {
  const rows = await rc.db.all(`SELECT r.*, u.name AS uname, u.email AS uemail FROM account_requests r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 200`);
  const out = [];
  for (const r of rows) out.push({ id: r.id, userId: r.user_id, name: r.uname, email: r.uemail, type: r.type, message: await openText(rc.env, r.message), status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
  await audit(rc.db, actor, 'admin.account_requests_read', null, { count: out.length }, rc.ip);
  return json({ requests: out });
}
export async function adminRequestUpdate(rc, actor, id) {
  const b = await readBody(rc.req);
  if (!['open', 'done'].includes(b.status)) return err(400, 'Status must be open or done.');
  const r = await rc.db.run('UPDATE account_requests SET status = ?, updated_at = ? WHERE id = ?', b.status, rc.now, id);
  if (!r.changes) return err(404, 'No such request.');
  await audit(rc.db, actor, 'admin.account_request_' + b.status, id, null, rc.ip);
  return json({ ok: true });
}

/* ------------------------------------------------------------------ export */
const parseJ = s => { try { return JSON.parse(s); } catch (e) { return null; } };
export async function exportRoute(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const db = rc.db, id = user.id;
  const state = await db.get('SELECT doc, version, updated_at FROM user_state WHERE user_id = ?', id);
  const subs = await db.all('SELECT * FROM weekly_submissions WHERE user_id = ? ORDER BY created_at', id);
  const reviews = await db.all('SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at', id);
  const reviewIds = reviews.map(r => r.id);
  const messages = [];
  for (const rid of reviewIds) for (const m of await db.all('SELECT id, review_id, author_id, body, created_at FROM review_messages WHERE review_id = ?', rid))
    messages.push(Object.assign({}, m, { body: await openText(rc.env, m.body) }));
  const proposals = await db.all('SELECT * FROM plan_proposals WHERE user_id = ?', id);
  const sr = await db.get('SELECT id, name, email, status, created_at, email_verified_at, decided_at FROM signup_requests WHERE user_id = ?', id);
  const sessions = (await db.all('SELECT created_at, last_seen_at, expires_at, revoked_at, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at', id))
    .map(s => ({ createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at, revokedAt: s.revoked_at, device: deviceLabel(s.user_agent) }));
  const audits = (await db.all('SELECT at, action, actor_id, target_id FROM audit_log WHERE actor_id = ? OR target_id = ? ORDER BY at', id, id))
    .map(a => ({ at: a.at, action: a.action, byYou: a.actor_id === id }));
  const consents = await db.all('SELECT kind, version, granted, at, source FROM consents WHERE user_id = ? ORDER BY at', id);
  const requests = [];
  for (const r of await db.all('SELECT type, message, status, created_at FROM account_requests WHERE user_id = ?', id)) requests.push({ type: r.type, message: await openText(rc.env, r.message), status: r.status, createdAt: r.created_at });
  const out = {
    exportedAt: new Date(rc.now).toISOString(), format: 'recomp-account-export-1',
    account: { id, email: user.email, name: user.name, role: user.role, status: user.status, createdAt: user.created_at, approvedAt: user.approved_at, lastLoginAt: user.last_login_at,
      permissions: parseJ(user.permissions) },
    settings: await getSettings(db, id), consents, mfa: await mfaSummary(db, user),
    state: state ? { version: state.version, updatedAt: state.updated_at, doc: parseJ(await openText(rc.env, state.doc)) } : null,
    weeklySubmissions: await Promise.all(subs.map(async s => ({ weekStart: s.week_start, status: s.status, createdAt: s.created_at, decidedAt: s.decided_at, coachNote: s.coach_note, report: parseJ(await openText(rc.env, s.report_json)) }))),
    workoutReviews: reviews, reviewMessages: messages, planProposals: proposals, signupRequest: sr, sessions, securityLog: audits, requests,
    notIncluded: ['Password and recovery code hashes', 'Two-step verification secret', 'Session tokens', 'Private notes administrators keep about accounts (ask the administrator for these)']
  };
  await audit(db, user, 'privacy.data_exported', id, null, rc.ip);
  return json(out, 200, { 'Content-Disposition': 'attachment; filename="recomp-account-export.json"' });
}

/* ------------------------------------------------------------------ delete
   Immediate hard delete of every row that belongs to the account. The audit
   log keeps a deletion record with no name, email or content, and earlier audit
   rows have the email address and IP address removed. Database backups (D1
   Time Travel) roll off on the provider's schedule. */
export const DELETION_TABLES = [
  ['user_state', 'user_id', 'Training, plan, notes, reviews, imported data and app settings'],
  ['weekly_submissions', 'user_id', 'Weekly reports sent to a coach'],
  ['review_messages', null, 'Messages on your workout reviews'],
  ['reviews', 'user_id', 'Workout reviews'],
  ['plan_proposals', 'user_id', 'Plan change proposals'],
  ['coach_assignments', null, 'Coach assignments'],
  ['sessions', 'user_id', 'Sign-in sessions'],
  ['session_reauth', null, null],
  ['pending_logins', 'user_id', null],
  ['login_attempts', null, null],
  ['mfa_totp', 'user_id', 'Two-step verification'],
  ['mfa_recovery', 'user_id', 'Recovery codes'],
  ['passkeys', 'user_id', 'Passkeys'],
  ['webauthn_challenges', 'user_id', null],
  ['email_tokens', 'user_id', 'Email links'],
  ['email_changes', 'user_id', null],
  ['signup_requests', 'user_id', 'Your sign-up request'],
  ['admin_notes', null, 'Administrator notes about you'],
  ['user_settings', 'user_id', 'Privacy settings'],
  ['consents', 'user_id', 'Consent records'],
  ['account_requests', 'user_id', 'Requests you sent'],
  ['known_devices', 'user_id', null],
  ['users', 'id', 'Your account and login']
];
export async function deleteAccount(db, user, now) {
  const id = user.id;
  await db.run('DELETE FROM review_messages WHERE review_id IN (SELECT id FROM reviews WHERE user_id = ?) OR author_id = ?', id, id);
  await db.run('DELETE FROM coach_assignments WHERE coach_id = ? OR member_id = ?', id, id);
  await db.run('DELETE FROM session_reauth WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)', id);
  await db.run('DELETE FROM login_attempts WHERE key LIKE ? OR key = ?', String(user.email).toLowerCase() + '|%', 'acct|' + String(user.email).toLowerCase());
  const cols = await db.all('PRAGMA table_info(admin_notes)');
  if (cols.some(c => c.name === 'user_id')) await db.run('DELETE FROM admin_notes WHERE user_id = ?', id);
  // References from other people's records to this account (as a coach) are cleared or removed,
  // so nothing points at a deleted person: assignments and coach decisions lose the link,
  // proposals this person wrote for others are removed with their author.
  await db.run('UPDATE reviews SET assigned_to = NULL WHERE assigned_to = ?', id);
  await db.run('UPDATE weekly_submissions SET coach_id = NULL WHERE coach_id = ?', id);
  await db.run('DELETE FROM plan_proposals WHERE proposed_by = ?', id);
  for (const [t, col] of DELETION_TABLES) {
    if (!col || ['review_messages', 'coach_assignments', 'session_reauth', 'login_attempts', 'admin_notes'].includes(t)) continue;
    await db.run(`DELETE FROM ${t} WHERE ${col} = ?`, id);
  }
  // Earlier security log entries keep the event, not the person: email and address removed.
  await db.run("UPDATE audit_log SET actor_email = NULL, ip = NULL WHERE actor_id = ? OR target_id = ?", id, id);
}
export async function deleteRoute(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const b = await readBody(rc.req);
  if (b.confirm !== 'DELETE MY ACCOUNT') return err(400, 'Type DELETE MY ACCOUNT to confirm.');
  if (user.role === 'owner') {
    const owners = await rc.db.all("SELECT id FROM users WHERE role = 'owner' AND status = 'active'");
    if (owners.length <= 1) return err(409, 'You are the only owner. Make someone else an owner before deleting this account.', { code: 'last_owner' });
  }
  await deleteAccount(rc.db, user, rc.now);
  await audit(rc.db, null, 'privacy.account_deleted', user.id, { role: user.role }, null);
  const deleted = DELETION_TABLES.map(x => x[2]).filter(Boolean);
  return json({ ok: true, deleted,
    retained: ['A security log entry recording that an account was deleted, with no name, email or content. Earlier security log entries keep the event and date with your email address and IP address removed.',
      'Data on your own devices or in files you downloaded. Signing out clears this device.'],
    backups: 'The database host keeps automatic point-in-time backups for up to 30 days (7 days on the free plan). Your data remains in those backups until they expire, and is only restored from them to recover from a fault.' },
    200, { 'Set-Cookie': 'recomp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (rc.secure ? '; Secure' : '') });
}
