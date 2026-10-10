/* Self sign-up, email verification, password reset, account status and the
   administrator's request queue. Every function takes the request context `rc`
   built in api.js: { req, ctx, db, env, now, url, ip, ua, secure }. */
import { json, err, readBody } from './http.js';
import { hashPassword, verifyPassword, randomToken, sha256hex, newId, passwordProblems } from './crypto.js';
import { audit, createSession, sessionCookie, revokeAllSessions } from './auth.js';
import { isOwner, FEATURES } from './rbac.js';
import { sendMail, mailConfigured, verifyEmail, resetEmail } from './mail.js';
import { hit, isOver, HOUR } from './limits.js';

const VERIFY_TTL = 48 * HOUR;
const RESET_TTL = 1 * HOUR;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = ['pending_verification', 'pending_approval', 'approved', 'rejected'];

/* 'pending_verification' | 'pending_approval' | 'active' for the states a
   signed-in user can be in. Any other status never reaches a handler. */
export async function accountState(db, u) {
  if (u.status === 'active') return 'active';
  if (u.status !== 'pending') return u.status;
  const r = await db.get('SELECT status, email_verified_at FROM signup_requests WHERE user_id = ?', u.id);
  return r && r.status === 'pending_verification' ? 'pending_verification' : 'pending_approval';
}

async function issueToken(db, userId, purpose, ttl, now) {
  await db.run('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    now, userId, purpose);
  const token = randomToken(32);
  await db.run('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, used_at, created_at) VALUES (?,?,?,?,NULL,?)',
    await sha256hex(token), userId, purpose, now + ttl, now);
  return token;
}
const baseUrl = rc => String(rc.env.PUBLIC_URL || rc.url.origin).replace(/\/+$/, '');

/* Mail failures never throw into the caller. */
async function mailVerification(rc, user) {
  try {
    const token = await issueToken(rc.db, user.id, 'verify', VERIFY_TTL, rc.now);
    const m = verifyEmail(user.name, `${baseUrl(rc)}/?verify=${encodeURIComponent(token)}`);
    const r = await sendMail(rc.env, { to: user.email, ...m }, rc.ctx.fetch);
    return !!r.sent;
  } catch (e) { return false; }
}
async function mailReset(rc, user) {
  try {
    const token = await issueToken(rc.db, user.id, 'reset', RESET_TTL, rc.now);
    const m = resetEmail(user.name, `${baseUrl(rc)}/?reset=${encodeURIComponent(token)}`);
    const r = await sendMail(rc.env, { to: user.email, ...m }, rc.ctx.fetch);
    return !!r.sent;
  } catch (e) { return false; }
}

/* Rate limit with a single check-and-record. Returns true when allowed. */
async function allow(rc, key, max, windowMs) {
  if (await isOver(rc.db, key, max, windowMs, rc.now)) return false;
  await hit(rc.db, key, rc.now);
  return true;
}

/* ---------------------------------------------------------------- sign-up */
export async function signup(rc) {
  const { db, env, now, ip } = rc;
  const b = await readBody(rc.req);
  // Honeypot: real people never see this field. Look normal and do nothing.
  if (b.website != null && b.website !== false && String(b.website).trim() !== '') {
    await audit(db, null, 'signup.honeypot', null, null, ip);
    return json({ ok: true, status: 'pending_verification', emailSent: mailConfigured(env) });
  }
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (name.length < 2 || name.length > 80) return err(400, 'Please enter your name (2 to 80 characters).');
  if (!email || email.length > 120 || !EMAIL_RE.test(email)) return err(400, 'Please enter a valid email address.');
  if (password.length > 200) return err(400, 'That password is too long.');
  const problems = passwordProblems(password);
  if (problems.length) return err(400, `Your password needs ${problems.join(', ')}.`);

  if (!(await allow(rc, 'signup|ip|' + (ip || 'noip'), 5, HOUR)) ||
      !(await allow(rc, 'signup|email|' + email, 3, HOUR))) {
    return err(429, 'Too many sign-up attempts. Please try again later.');
  }

  const generic = emailSent => json({ ok: true, status: 'pending_verification', emailSent });
  const existing = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (existing) {
    // Same response shape as a brand-new request, so existence is not revealed.
    let sent = mailConfigured(env);
    let cookie = null;
    const req0 = await db.get('SELECT * FROM signup_requests WHERE user_id = ?', existing.id);
    if (req0 && req0.status === 'pending_verification' && existing.status === 'pending') {
      if (await allow(rc, 'resend|user|' + existing.id, 3, HOUR)) {
        sent = await mailVerification(rc, existing);
        await audit(db, existing, 'signup.verification_resent', existing.id, { via: 'signup' }, ip);
      }
      // Whoever knows the password for this pending request may pick the session back up.
      if (await verifyPassword(password, existing.password_hash)) {
        cookie = sessionCookie(await createSession(db, existing, ip, rc.ua, now), rc.secure);
      }
    } else {
      await audit(db, null, 'signup.duplicate', existing.id, null, ip);
    }
    const res = generic(sent);
    if (cookie) res.headers.set('Set-Cookie', cookie);
    return res;
  }

  const id = newId('u');
  const reqId = newId('sr');
  try {
    await db.run(
      `INSERT INTO users (id,email,name,password_hash,role,status,must_change_pw,created_at,pw_changed_at)
       VALUES (?,?,?,?,'member','pending',0,?,?)`,
      id, email, name, await hashPassword(password), now, now);
    await db.run(
      `INSERT INTO signup_requests (id,user_id,name,email,status,verified_by_admin,created_at)
       VALUES (?,?,?,?,'pending_verification',0,?)`, reqId, id, name, email, now);
  } catch (e) {
    return generic(mailConfigured(env));            // lost a race with an identical sign-up
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', id);
  await audit(db, user, 'signup.created', id, { requestId: reqId }, ip);
  const sent = await mailVerification(rc, user);
  const token = await createSession(db, user, ip, rc.ua, now);
  return json({ ok: true, status: 'pending_verification', emailSent: sent }, 200,
    { 'Set-Cookie': sessionCookie(token, rc.secure) });
}

/* ----------------------------------------------------------------- verify */
async function consumeToken(db, token, purpose, now) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const hash = await sha256hex(token);
  const row = await db.get('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ?', hash, purpose);
  if (!row || row.used_at || row.expires_at < now) return null;
  // Single use: the UPDATE only succeeds for the first caller.
  const r = await db.run('UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', now, hash);
  if (!r.changes) return null;
  return row;
}

export async function verify(rc) {
  const { db, now, ip } = rc;
  if (!(await allow(rc, 'verify|ip|' + (ip || 'noip'), 30, HOUR))) return err(429, 'Too many attempts. Please try again later.');
  const b = await readBody(rc.req);
  const row = await consumeToken(db, b.token, 'verify', now);
  if (!row) return err(400, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.');
  const user = await db.get('SELECT * FROM users WHERE id = ?', row.user_id);
  await db.run('UPDATE signup_requests SET email_verified_at = COALESCE(email_verified_at, ?) WHERE user_id = ?', now, row.user_id);
  await db.run("UPDATE signup_requests SET status = 'pending_approval' WHERE user_id = ? AND status = 'pending_verification'", row.user_id);
  await audit(db, user, 'signup.email_verified', row.user_id, null, ip);
  const sr = await db.get('SELECT status FROM signup_requests WHERE user_id = ?', row.user_id);
  return json({ ok: true, status: sr ? sr.status : null });
}

export async function resendVerification(rc, user) {
  const { db, now, ip } = rc;
  const sr = await db.get('SELECT * FROM signup_requests WHERE user_id = ?', user.id);
  if (!sr || sr.email_verified_at) return json({ ok: true, emailSent: false, alreadyVerified: !!(sr && sr.email_verified_at) });
  if (!(await allow(rc, 'resend|user|' + user.id, 3, HOUR)) ||
      !(await allow(rc, 'resend|ip|' + (ip || 'noip'), 10, HOUR))) {
    return err(429, 'Too many requests. Please wait a while before asking for another email.');
  }
  const sent = await mailVerification(rc, user);
  await audit(db, user, 'signup.verification_resent', user.id, { via: 'session' }, ip);
  return json({ ok: true, emailSent: sent });
}

/* --------------------------------------------------------- password reset */
export async function forgot(rc) {
  const { db, env, now, ip } = rc;
  const b = await readBody(rc.req);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const generic = json({ ok: true, emailSent: mailConfigured(env) });
  if (!email || email.length > 120) return generic;
  if (!(await allow(rc, 'forgot|ip|' + (ip || 'noip'), 10, HOUR))) return err(429, 'Too many requests. Please try again later.');
  if (!(await allow(rc, 'forgot|email|' + email, 3, HOUR))) return generic;     // silently absorbed
  const user = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (user && user.status !== 'rejected' && user.status !== 'revoked') {
    await mailReset(rc, user);
    await audit(db, user, 'auth.reset_requested', user.id, null, ip);
  }
  return generic;
}

export async function reset(rc) {
  const { db, now, ip } = rc;
  if (!(await allow(rc, 'reset|ip|' + (ip || 'noip'), 20, HOUR))) return err(429, 'Too many attempts. Please try again later.');
  const b = await readBody(rc.req);
  const pw = typeof b.password === 'string' ? b.password : '';
  if (pw.length > 200) return err(400, 'That password is too long.');
  const problems = passwordProblems(pw);
  if (problems.length) return err(400, `Your password needs ${problems.join(', ')}.`);
  const row = await consumeToken(db, b.token, 'reset', now);
  if (!row) return err(400, 'This reset link is invalid or has expired. Please ask for a new one.');
  const user = await db.get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user || user.status === 'rejected' || user.status === 'revoked') {
    return err(400, 'This reset link is invalid or has expired. Please ask for a new one.');
  }
  await db.run('UPDATE users SET password_hash = ?, must_change_pw = 0, pw_changed_at = ? WHERE id = ?',
    await hashPassword(pw), now, user.id);
  await revokeAllSessions(db, user.id, now);
  await audit(db, user, 'auth.password_reset', user.id, null, ip);
  return json({ ok: true });
}

/* ---------------------------------------------------------- account status */
export async function accountStatus(rc, user) {
  const sr = await rc.db.get('SELECT * FROM signup_requests WHERE user_id = ?', user.id);
  return json({
    accountStatus: user.status,
    accountState: await accountState(rc.db, user),
    email: user.email, name: user.name,
    emailVerified: !!(sr && sr.email_verified_at),
    requestStatus: sr ? sr.status : null,
    requestedAt: sr ? sr.created_at : user.created_at
  });
}

/* --------------------------------------------------------- admin: requests */
function requestRow(r) {
  return {
    id: r.id, userId: r.user_id, name: r.name, email: r.email,
    emailVerified: !!r.email_verified_at, verifiedByAdmin: !!r.verified_by_admin,
    status: r.status, createdAt: r.created_at, decidedAt: r.decided_at || null,
    decisionNote: r.decision_note || null, adminNote: r.admin_note || null,
    accountStatus: r.user_status
  };
}

export async function adminRequestsList(rc) {
  const status = rc.url.searchParams.get('status');
  if (status && status !== 'all' && !STATUSES.includes(status)) return err(400, 'Unknown status.');
  const filter = status && status !== 'all';
  const rows = await rc.db.all(
    `SELECT s.*, u.status AS user_status, n.note AS admin_note FROM signup_requests s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN admin_notes n ON n.user_id = s.user_id
      ${filter ? 'WHERE s.status = ?' : ''} ORDER BY s.created_at DESC LIMIT 500`,
    ...(filter ? [status] : []));
  return json({ requests: rows.map(requestRow) });
}

function cleanNote(v, max) {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (t.length > max) return { ok: false };
  return { ok: true, value: t || null };
}

export async function adminDecision(rc, actor, requestId) {
  const { db, now, ip } = rc;
  const sr = await db.get('SELECT * FROM signup_requests WHERE id = ?', requestId);
  if (!sr) return err(404, 'No such request.');
  const b = await readBody(rc.req);
  const note = cleanNote(b.note, 1000);
  if (!note.ok) return err(400, 'The note must be text of up to 1000 characters.');
  if (b.action !== 'approve' && b.action !== 'reject') return err(400, 'Action must be approve or reject.');
  if (sr.status === 'approved' || sr.status === 'rejected') {
    return err(409, `This request has already been ${sr.status}. Use the account controls to change it.`);
  }
  const target = await db.get('SELECT * FROM users WHERE id = ?', sr.user_id);
  if (!target) return err(404, 'No such account.');
  if (target.status !== 'pending') return err(409, 'This account is no longer pending. Use the account controls instead.');

  if (b.action === 'reject') {
    await db.run("UPDATE users SET status = 'rejected' WHERE id = ?", target.id);
    await revokeAllSessions(db, target.id, now);
    await db.run("UPDATE signup_requests SET status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?",
      now, actor.id, note.value, sr.id);
    await audit(db, actor, 'signup.rejected', target.id, { requestId: sr.id, hasNote: !!note.value }, ip);
    return json({ ok: true, status: 'rejected' });
  }

  const role = b.role === undefined || b.role === null ? 'member' : b.role;
  if (role === 'owner') return err(403, 'The owner role cannot be granted from a sign-up request.');
  if (!['member', 'coach', 'admin'].includes(role)) return err(400, 'Role must be member, coach or admin.');
  if (role === 'admin' && !isOwner(actor)) return err(403, 'Only the owner can grant the admin role.');
  let perms = null;
  if (b.permissions !== undefined && b.permissions !== null) {
    if (typeof b.permissions !== 'object' || Array.isArray(b.permissions)) return err(400, 'Permissions must be an object.');
    perms = {};
    for (const k of Object.keys(b.permissions)) {
      if (!FEATURES.includes(k)) return err(400, `Unknown feature: ${String(k).slice(0, 40)}.`);
      if (typeof b.permissions[k] !== 'boolean') return err(400, 'Each permission must be true or false.');
      perms[k] = b.permissions[k];
    }
  }
  const verified = !!sr.email_verified_at || !!sr.verified_by_admin;
  const override = b.overrideVerification === true;
  if (!verified && !override) {
    return err(409, 'This email address has not been verified. Verify it first, or approve with overrideVerification set to true.',
      { code: 'email_not_verified' });
  }
  await db.run(
    `UPDATE users SET status = 'active', role = ?, permissions = ?, approved_at = ?, approved_by = ? WHERE id = ?`,
    role, perms ? JSON.stringify(perms) : null, now, actor.id, target.id);
  await db.run("UPDATE signup_requests SET status = 'approved', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?",
    now, actor.id, note.value, sr.id);
  if (!verified && override) {
    await audit(db, actor, 'signup.verification_overridden', target.id, { requestId: sr.id }, ip);
  }
  await audit(db, actor, 'signup.approved', target.id, { requestId: sr.id, role, permissions: perms }, ip);
  return json({ ok: true, status: 'approved', role });
}

export async function adminVerifyEmail(rc, actor, requestId) {
  const { db, now, ip } = rc;
  const sr = await db.get('SELECT * FROM signup_requests WHERE id = ?', requestId);
  if (!sr) return err(404, 'No such request.');
  if (sr.email_verified_at) return json({ ok: true, status: sr.status, alreadyVerified: true });
  await db.run('UPDATE signup_requests SET email_verified_at = ?, verified_by_admin = 1 WHERE id = ?', now, sr.id);
  await db.run("UPDATE signup_requests SET status = 'pending_approval' WHERE id = ? AND status = 'pending_verification'", sr.id);
  await audit(db, actor, 'signup.email_attested', sr.user_id, { requestId: sr.id }, ip);
  const after = await db.get('SELECT status FROM signup_requests WHERE id = ?', sr.id);
  return json({ ok: true, status: after.status });
}

/* ---------------------------------------------------------- admin: notes */
export async function adminNote(rc, actor, userId) {
  const { db, now, ip } = rc;
  const target = await db.get('SELECT id FROM users WHERE id = ?', userId);
  if (!target) return err(404, 'No such account.');
  if (rc.req.method === 'GET') {
    const n = await db.get('SELECT note, updated_at, updated_by FROM admin_notes WHERE user_id = ?', userId);
    return json({ note: n ? n.note : '', updatedAt: n ? n.updated_at : null, updatedBy: n ? n.updated_by : null });
  }
  const b = await readBody(rc.req);
  const n = cleanNote(b.note, 2000);
  if (!n.ok) return err(400, 'The note must be text of up to 2000 characters.');
  if (n.value === null) {
    await db.run('DELETE FROM admin_notes WHERE user_id = ?', userId);
  } else {
    await db.run(`INSERT INTO admin_notes (user_id, note, updated_at, updated_by) VALUES (?,?,?,?)
                  ON CONFLICT(user_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      userId, n.value, now, actor.id);
  }
  await audit(db, actor, 'admin.note_changed', userId, { cleared: n.value === null, length: n.value ? n.value.length : 0 }, ip);
  return json({ ok: true });
}
