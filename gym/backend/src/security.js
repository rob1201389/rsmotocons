/* Account protection: two-step verification (authenticator app and recovery
   codes), the pending-login step, recent re-authentication for sensitive
   actions, session management, email change, device labels and security alerts.
   Every route here takes the user from the session, never from the request. */
import { randomToken, sha256hex, newId, hashPassword, verifyPassword, randomBytes,
         base32Encode, verifyTotp, sealText, openText, b64 } from './crypto.js';
import { audit, createSession, sessionCookie, revokeAllSessions, readCookie } from './auth.js';
import { json, err, readBody } from './http.js';
import { sendMail, mailConfigured } from './mail.js';
import { isOver, hit, HOUR } from './limits.js';

export const REAUTH_MS = 10 * 60 * 1000;
const PENDING_MS = 5 * 60 * 1000;
const PENDING_ATTEMPTS = 5;
const PENDING_COOKIE = 'recomp_mfa';
const RECOVERY_COUNT = 10;

/* ------------------------------------------------------------- helpers */
export const needsMfa = u => !!u && (u.role === 'owner' || u.role === 'admin');
export async function mfaSummary(db, user) {
  const t = await db.get('SELECT enabled_at FROM mfa_totp WHERE user_id = ?', user.id);
  const pk = await db.get('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', user.id);
  const rc = await db.get('SELECT COUNT(*) AS n FROM mfa_recovery WHERE user_id = ? AND used_at IS NULL', user.id);
  const totp = !!(t && t.enabled_at);
  return { totp, passkeys: pk ? pk.n : 0, recoveryCodesLeft: totp ? (rc ? rc.n : 0) : 0, required: needsMfa(user) };
}
export const hasSecondFactor = m => !!(m && (m.totp || m.passkeys > 0));
export function deviceLabel(ua) {
  const s = String(ua || '');
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'Mac'
    : /Windows/.test(s) ? 'Windows' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux' : '';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari' : /node|undici/i.test(s) ? 'Script' : '';
  if (!os && !br) return 'Unknown device';
  return br && os ? `${br} on ${os}` : (br || os);
}
/* A recent password (and second step) on this session. */
export async function hasRecentAuth(db, sessionId, now) {
  const r = await db.get('SELECT at FROM session_reauth WHERE session_id = ?', sessionId);
  return !!(r && now - r.at <= REAUTH_MS);
}
export async function markReauth(db, sessionId, now) {
  await db.run('INSERT OR REPLACE INTO session_reauth (session_id, at) VALUES (?,?)', sessionId, now);
}
export const reauthRequired = () => err(403, 'Please confirm it is you first.', { code: 'reauth_required' });

/* Issues a full session and records a fresh authentication on it. */
export async function startSession(rc, user, opts) {
  const token = await createSession(rc.db, user, rc.ip, rc.ua, rc.now);
  const sid = await sha256hex(token);
  if (!opts || opts.fresh !== false) await markReauth(rc.db, sid, rc.now);
  await newDeviceAlert(rc, user);
  return token;
}
async function newDeviceAlert(rc, user) {
  const dev = deviceLabel(rc.ua);
  const seen = await rc.db.get('SELECT 1 AS x FROM known_devices WHERE user_id = ? AND device = ?', user.id, dev);
  if (seen) return;
  const first = !(await rc.db.get('SELECT 1 AS x FROM known_devices WHERE user_id = ?', user.id));
  await rc.db.run('INSERT OR IGNORE INTO known_devices (user_id, device, first_seen) VALUES (?,?,?)', user.id, dev, rc.now);
  if (first || !needsMfa(user)) return;
  await audit(rc.db, user, 'security.new_device_login', user.id, { device: dev }, rc.ip);
  await alertOwners(rc, 'New device signed in to an administrator account',
    `The ${user.role} account ${user.email} signed in from a device not seen before (${dev}). If this was not expected, suspend the account and review the security events in Administration.`);
}
/* Emails every active owner when mail is configured. The in-app security events show the same event either way. */
export async function alertOwners(rc, subject, text) {
  if (!mailConfigured(rc.env)) return;
  const owners = await rc.db.all("SELECT email FROM users WHERE role = 'owner' AND status = 'active'");
  for (const o of owners) {
    if (!/@/.test(o.email)) continue;                     // a plain login name cannot receive mail
    await sendMail(rc.env, { to: o.email, subject: 'Recomp security: ' + subject, text: text + '\n\nThis is an automatic security notice from Recomp.' }, rc.ctx.fetch);
  }
}
async function notifyUser(rc, user, subject, text) {
  if (!mailConfigured(rc.env) || !/@/.test(user.email)) return;
  await sendMail(rc.env, { to: user.email, subject: 'Recomp: ' + subject, text: text + '\n\nIf this was not you, reset your password and contact the administrator.' }, rc.ctx.fetch);
}

/* ---------------------------------------------------------- pending login */
export async function createPendingLogin(rc, user) {
  const token = randomToken(32);
  await rc.db.run('DELETE FROM pending_logins WHERE user_id = ? OR expires_at < ?', user.id, rc.now);
  await rc.db.run('INSERT INTO pending_logins (id, user_id, created_at, expires_at, attempts, ip, user_agent) VALUES (?,?,?,?,0,?,?)',
    await sha256hex(token), user.id, rc.now, rc.now + PENDING_MS, rc.ip || null, String(rc.ua || '').slice(0, 200));
  const attrs = ['Path=/api/auth', 'HttpOnly', 'SameSite=Strict', `Max-Age=${PENDING_MS / 1000}`]; if (rc.secure) attrs.push('Secure');
  return `${PENDING_COOKIE}=${encodeURIComponent(token)}; ${attrs.join('; ')}`;
}
function clearPendingCookie(secure) {
  const attrs = ['Path=/api/auth', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']; if (secure) attrs.push('Secure');
  return `${PENDING_COOKIE}=; ${attrs.join('; ')}`;
}
export async function methodsFor(db, user) {
  const m = await mfaSummary(db, user);
  const out = []; if (m.totp) out.push('totp', 'recovery'); if (m.passkeys) out.push('passkey');
  return out;
}
async function pendingFromRequest(rc) {
  const token = readCookie(rc.req, PENDING_COOKIE);
  if (!token) return null;
  const id = await sha256hex(token);
  const p = await rc.db.get('SELECT * FROM pending_logins WHERE id = ?', id);
  if (!p || p.expires_at < rc.now) { if (p) await rc.db.run('DELETE FROM pending_logins WHERE id = ?', id); return null; }
  return p;
}
async function checkTotp(db, env, userId, code, now) {
  const t = await db.get('SELECT * FROM mfa_totp WHERE user_id = ? AND enabled_at IS NOT NULL', userId);
  if (!t) return false;
  const step = await verifyTotp(await openText(env, t.secret), code, now, t.last_step);
  if (step == null) return false;
  await db.run('UPDATE mfa_totp SET last_step = ? WHERE user_id = ?', step, userId);
  return true;
}
async function useRecoveryCode(db, userId, code, now) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 8) return false;
  const rows = await db.all('SELECT * FROM mfa_recovery WHERE user_id = ? AND used_at IS NULL', userId);
  for (const r of rows) {
    if (await verifyPassword(c, r.code_hash)) {
      const u = await db.run('UPDATE mfa_recovery SET used_at = ? WHERE id = ? AND used_at IS NULL', now, r.id);
      return u.changes === 1;
    }
  }
  return false;
}
/* POST /api/auth/mfa/verify  { code } | { recoveryCode } */
export async function mfaVerify(rc, publicUserFn) {
  const p = await pendingFromRequest(rc);
  if (!p) return err(401, 'That log in has expired. Enter your password again.', { code: 'mfa_expired' }, { 'Set-Cookie': clearPendingCookie(rc.secure) });
  const user = await rc.db.get('SELECT * FROM users WHERE id = ?', p.user_id);
  if (!user || (user.status !== 'active' && user.status !== 'pending')) {
    await rc.db.run('DELETE FROM pending_logins WHERE id = ?', p.id);
    return err(401, 'That log in has expired. Enter your password again.', { code: 'mfa_expired' });
  }
  const b = await readBody(rc.req);
  let ok = false, used = null;
  if (b.code) { ok = await checkTotp(rc.db, rc.env, user.id, b.code, rc.now); used = 'totp'; }
  else if (b.recoveryCode) { ok = await useRecoveryCode(rc.db, user.id, b.recoveryCode, rc.now); used = 'recovery'; }
  if (!ok) {
    await rc.db.run('UPDATE pending_logins SET attempts = attempts + 1 WHERE id = ?', p.id);
    await audit(rc.db, user, 'auth.mfa_failed', user.id, { method: used }, rc.ip);
    if (p.attempts + 1 >= PENDING_ATTEMPTS) {
      await rc.db.run('DELETE FROM pending_logins WHERE id = ?', p.id);
      return err(401, 'Too many wrong codes. Enter your password again.', { code: 'mfa_expired' }, { 'Set-Cookie': clearPendingCookie(rc.secure) });
    }
    return err(400, 'That code did not work. Check it and try again.');
  }
  await rc.db.run('DELETE FROM pending_logins WHERE id = ?', p.id);
  await audit(rc.db, user, used === 'recovery' ? 'auth.login_recovery_code' : 'auth.login', user.id, { method: used }, rc.ip);
  if (used === 'recovery') await notifyUser(rc, user, 'a recovery code was used', 'A recovery code was used to sign in to your Recomp account.');
  const token = await startSession(rc, user);
  await rc.db.run('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?', rc.now, rc.ip || null, user.id);
  const res = json({ user: await publicUserFn(user) }, 200);
  res.headers.append('Set-Cookie', sessionCookie(token, rc.secure));
  res.headers.append('Set-Cookie', clearPendingCookie(rc.secure));
  return res;
}

/* ----------------------------------------------------- TOTP enrolment */
export async function totpBegin(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const existing = await rc.db.get('SELECT enabled_at FROM mfa_totp WHERE user_id = ?', user.id);
  if (existing && existing.enabled_at) return err(409, 'Two-step verification is already on. Turn it off first to change apps.');
  const secret = base32Encode(randomBytes(20));
  await rc.db.run('INSERT OR REPLACE INTO mfa_totp (user_id, secret, enabled_at, last_step, created_at) VALUES (?,?,NULL,NULL,?)',
    user.id, await sealText(rc.env, secret), rc.now);
  const label = encodeURIComponent('Recomp:' + user.email);
  return json({ secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=Recomp&algorithm=SHA1&digits=6&period=30` });
}
async function newRecoveryCodes(rc, userId) {
  await rc.db.run('DELETE FROM mfa_recovery WHERE user_id = ?', userId);
  const codes = [];
  for (let i = 0; i < RECOVERY_COUNT; i++) {
    const raw = base32Encode(randomBytes(8)).slice(0, 10);           // 50 bits from a CSPRNG
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
    // Lower PBKDF2 cost is fine here: each code has 50 bits of entropy (ASVS 6.5.2 allows a fast hash above 112 bits; this is below, so it is salted and stretched).
    await rc.db.run('INSERT INTO mfa_recovery (id, user_id, code_hash, used_at, created_at) VALUES (?,?,?,NULL,?)',
      newId('rcv'), userId, await hashPassword(raw, 20000), rc.now);
  }
  return codes;
}
export async function totpConfirm(rc, user) {
  const t = await rc.db.get('SELECT * FROM mfa_totp WHERE user_id = ?', user.id);
  if (!t) return err(409, 'Start set-up first.');
  if (t.enabled_at) return err(409, 'Two-step verification is already on.');
  if (!(await isOver(rc.db, 'totpconfirm|' + user.id, 10, HOUR, rc.now))) await hit(rc.db, 'totpconfirm|' + user.id, rc.now);
  else return err(429, 'Too many attempts. Try again later.');
  const b = await readBody(rc.req);
  const step = await verifyTotp(await openText(rc.env, t.secret), b.code, rc.now, null);
  if (step == null) return err(400, 'That code did not match. Check the time on your phone and try again.');
  await rc.db.run('UPDATE mfa_totp SET enabled_at = ?, last_step = ? WHERE user_id = ?', rc.now, step, user.id);
  const codes = await newRecoveryCodes(rc, user.id);
  await audit(rc.db, user, 'security.mfa_enabled', user.id, { method: 'totp' }, rc.ip);
  await notifyUser(rc, user, 'two-step verification turned on', 'Two-step verification was turned on for your Recomp account.');
  return json({ ok: true, recoveryCodes: codes });
}
export async function recoveryRegenerate(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const t = await rc.db.get('SELECT enabled_at FROM mfa_totp WHERE user_id = ?', user.id);
  if (!t || !t.enabled_at) return err(409, 'Two-step verification is not on.');
  const codes = await newRecoveryCodes(rc, user.id);
  await audit(rc.db, user, 'security.recovery_codes_regenerated', user.id, null, rc.ip);
  return json({ ok: true, recoveryCodes: codes });
}
export async function mfaDisable(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const m = await mfaSummary(rc.db, user);
  if (needsMfa(user) && m.passkeys === 0) return err(403, 'Owner and administrator accounts must keep two-step verification on.', { code: 'mfa_required' });
  await rc.db.run('DELETE FROM mfa_totp WHERE user_id = ?', user.id);
  await rc.db.run('DELETE FROM mfa_recovery WHERE user_id = ?', user.id);
  await audit(rc.db, user, 'security.mfa_disabled', user.id, { method: 'totp' }, rc.ip);
  await notifyUser(rc, user, 'two-step verification turned off', 'Two-step verification was turned off for your Recomp account.');
  if (needsMfa(user)) await alertOwners(rc, 'Two-step verification changed', `Two-step verification with an app was turned off for ${user.email} (${user.role}).`);
  return json({ ok: true });
}

/* ---------------------------------------------------------- re-authentication */
export async function reauth(rc, user, session) {
  const key = 'reauth|' + user.id;
  if (await isOver(rc.db, key, 10, 15 * 60 * 1000, rc.now)) return err(429, 'Too many attempts. Try again in 15 minutes.');
  const b = await readBody(rc.req);
  const good = await verifyPassword(String(b.password || ''), user.password_hash);
  const m = await mfaSummary(rc.db, user);
  let second = !m.totp;
  if (good && m.totp) {
    if (b.code) second = await checkTotp(rc.db, rc.env, user.id, b.code, rc.now);
    else if (b.recoveryCode) second = await useRecoveryCode(rc.db, user.id, b.recoveryCode, rc.now);
  }
  if (!good || !second) {
    await hit(rc.db, key, rc.now);
    await audit(rc.db, user, 'security.reauth_failed', user.id, null, rc.ip);
    return err(400, m.totp ? 'Your password or code did not match.' : 'That password did not match.');
  }
  await markReauth(rc.db, session.id, rc.now);
  return json({ ok: true, until: rc.now + REAUTH_MS });
}

/* ------------------------------------------------------------- sessions */
const handleOf = async id => (await sha256hex('h|' + id)).slice(0, 24);
export async function listSessions(rc, user, session) {
  const rows = await rc.db.all('SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC', user.id, rc.now);
  const out = [];
  for (const s of rows) out.push({ id: await handleOf(s.id), current: s.id === session.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
    expiresAt: s.expires_at, device: deviceLabel(s.user_agent) });
  return json({ sessions: out });
}
export async function revokeOne(rc, user, handle) {
  const rows = await rc.db.all('SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL', user.id);
  for (const s of rows) if ((await handleOf(s.id)) === handle) {
    await rc.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', rc.now, s.id);
    await audit(rc.db, user, 'security.session_revoked', user.id, null, rc.ip);
    return json({ ok: true });
  }
  return err(404, 'That session was not found.');
}
export async function logoutAll(rc, user, session) {
  const b = await readBody(rc.req);
  const keep = b.keepCurrent !== false;
  const r = keep
    ? await rc.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?', rc.now, user.id, session.id)
    : await rc.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', rc.now, user.id);
  await audit(rc.db, user, 'security.logout_all', user.id, { keepCurrent: keep, revoked: r.changes }, rc.ip);
  return json({ ok: true, revoked: r.changes });
}

/* ---------------------------------------------------------- email change */
export async function emailChangeStart(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  if (!mailConfigured(rc.env)) return err(409, 'Email is not set up on this server, so the address cannot be changed safely.', { code: 'mail_not_configured' });
  const b = await readBody(rc.req);
  const next = String(b.newEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) || next.length > 120) return err(400, 'Enter a valid email address.');
  if (await isOver(rc.db, 'emailchange|' + user.id, 3, HOUR, rc.now)) return err(429, 'Too many requests. Try again later.');
  await hit(rc.db, 'emailchange|' + user.id, rc.now);
  const taken = await rc.db.get('SELECT id FROM users WHERE email = ?', next);
  const token = randomToken(32);
  if (!taken) {
    await rc.db.run('DELETE FROM email_changes WHERE user_id = ?', user.id);
    await rc.db.run('INSERT INTO email_changes (token_hash, user_id, new_email, created_at, expires_at) VALUES (?,?,?,?,?)',
      await sha256hex(token), user.id, next, rc.now, rc.now + HOUR);
    const base = (rc.env.PUBLIC_URL || rc.url.origin).replace(/\/+$/, '');
    await sendMail(rc.env, { to: next, subject: 'Confirm your new Recomp email address',
      text: `Open this link within an hour to make this your Recomp login:\n\n${base}/?email=${encodeURIComponent(token)}\n\nIf you did not ask for this, ignore this email.` }, rc.ctx.fetch);
  }
  // The current address is told either way, and the response does not reveal whether the new one is taken.
  await notifyUser(rc, user, 'email change requested', `Someone signed in to your account asked to change its email address to ${next.replace(/(.).*(@.*)/, '$1…$2')}. Nothing changes until the link sent to that address is opened.`);
  await audit(rc.db, user, 'security.email_change_requested', user.id, null, rc.ip);
  return json({ ok: true });
}
export async function emailChangeConfirm(rc) {
  const b = await readBody(rc.req);
  const h = await sha256hex(String(b.token || ''));
  const row = await rc.db.get('SELECT * FROM email_changes WHERE token_hash = ?', h);
  if (!row || row.used_at || row.expires_at < rc.now) return err(400, 'This link is invalid or has expired.');
  const u = await rc.db.run('UPDATE email_changes SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', rc.now, h);
  if (u.changes !== 1) return err(400, 'This link is invalid or has expired.');
  const taken = await rc.db.get('SELECT id FROM users WHERE email = ?', row.new_email);
  if (taken) return err(409, 'That address is already in use.');
  const user = await rc.db.get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user || user.status !== 'active') return err(400, 'This link is invalid or has expired.');
  const old = user.email;
  await rc.db.run('UPDATE users SET email = ? WHERE id = ?', row.new_email, user.id);
  await revokeAllSessions(rc.db, user.id, rc.now);
  await audit(rc.db, { id: user.id, email: row.new_email }, 'security.email_changed', user.id, null, rc.ip);
  await notifyUser(rc, { email: old }, 'your email address was changed', 'The email address for your Recomp account was changed. You were signed out on every device.');
  return json({ ok: true });
}
export { clearPendingCookie, b64 };
