/* Sessions, login, rate limiting, bootstrap. Server-side enforcement only. */
import { hashPassword, verifyPassword, randomToken, sha256hex, newId, passwordProblems } from './crypto.js';

export const SESSION_IDLE_MS = 7 * 24 * 3600 * 1000;    // 7 days without use
export const SESSION_ABS_MS = 30 * 24 * 3600 * 1000;    // 30 days absolute
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const COOKIE = 'recomp_session';

/* A login is any short name, not necessarily an email: trimmed, lowercased,
   inner spaces collapsed, so "RS  Motocons" and "rs motocons" are the same login. */
export const normLogin = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const ownerLogin = env => normLogin(env.OWNER_LOGIN || env.OWNER_EMAIL);

export async function audit(db, actor, action, targetId, detail, ip) {
  await db.run(
    'INSERT INTO audit_log (at, actor_id, actor_email, action, target_id, detail, ip) VALUES (?,?,?,?,?,?,?)',
    Date.now(), actor ? actor.id : null, actor ? actor.email : null, action,
    targetId || null, detail ? JSON.stringify(detail) : null, ip || null);
}

export async function rateLimited(db, key, now) {
  const since = now - ATTEMPT_WINDOW_MS;
  await db.run('DELETE FROM login_attempts WHERE at < ?', since - ATTEMPT_WINDOW_MS);
  const rows = await db.all('SELECT ok FROM login_attempts WHERE key = ? AND at >= ?', key, since);
  const failures = rows.filter(r => !r.ok).length;
  return failures >= MAX_ATTEMPTS;
}
export async function noteAttempt(db, key, ok, now) {
  await db.run('INSERT INTO login_attempts (key, at, ok) VALUES (?,?,?)', key, now, ok ? 1 : 0);
}

export async function createSession(db, user, ip, ua, now) {
  const token = randomToken(32);
  const id = await sha256hex(token);
  await db.run(
    'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)',
    id, user.id, now, now, now + SESSION_ABS_MS, ip || null, (ua || '').slice(0, 200));
  return token;
}

/* Resolves a request's session. Every call re-reads the user row, so a
   suspension or revocation takes effect on the very next request rather than
   when some cached claim happens to expire. */
export async function sessionFromRequest(db, req, now) {
  const token = readCookie(req, COOKIE);
  if (!token) return { user: null, session: null, reason: 'no_cookie' };
  const id = await sha256hex(token);
  const s = await db.get('SELECT * FROM sessions WHERE id = ?', id);
  if (!s) return { user: null, session: null, reason: 'unknown_session' };
  if (s.revoked_at) return { user: null, session: null, reason: 'revoked' };
  if (now > s.expires_at) return { user: null, session: null, reason: 'expired' };
  if (now - s.last_seen_at > SESSION_IDLE_MS) return { user: null, session: null, reason: 'idle_expired' };
  const user = await db.get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!user) return { user: null, session: null, reason: 'no_user' };
  // A pending user gets a restricted session (api.js narrows it to a few routes).
  // Suspended, revoked and rejected users are refused on every request.
  if (user.status !== 'active' && user.status !== 'pending') {
    return { user: null, session: null, reason: 'status_' + user.status, user0: user };
  }
  await db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now, id);
  return { user, session: s, reason: null };
}

export async function revokeAllSessions(db, userId, now) {
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, userId);
}
export async function revokeSession(db, token, now) {
  const id = await sha256hex(token);
  await db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', now, id);
}

export function readCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
export function sessionCookie(token, secure) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_ABS_MS / 1000)}`];
  if (secure) attrs.push('Secure');
  return `${COOKIE}=${encodeURIComponent(token)}; ${attrs.join('; ')}`;
}
export function clearCookie(secure) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return `${COOKIE}=; ${attrs.join('; ')}`;
}

/* ---------------------------------------------------------------- bootstrap
   Creates the single owner account, once, from server-side configuration.
   The password is read from the environment — never from the client, never
   from the shipped bundle. After it runs, it disables itself in `meta`. */
export async function bootstrapOwner(db, env, now) {
  const done = await db.get("SELECT value FROM meta WHERE key = 'bootstrap_done'");
  if (done) return { ok: false, reason: 'already_bootstrapped' };
  const existing = await db.get("SELECT id FROM users WHERE role = 'owner'");
  if (existing) {
    await db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('bootstrap_done', ?)", String(now));
    return { ok: false, reason: 'owner_exists' };
  }
  const email = (env.OWNER_EMAIL || '').trim().toLowerCase();
  const pw = env.BOOTSTRAP_OWNER_PASSWORD || '';
  if (!email) return { ok: false, reason: 'no_owner_email',
    message: 'Set OWNER_EMAIL in the server environment. It is your login identifier; no mail is ever sent to it.' };
  const problems = passwordProblems(pw);
  if (problems.length) {
    return { ok: false, reason: 'weak_bootstrap_password',
      message: `BOOTSTRAP_OWNER_PASSWORD was rejected by the password policy. It needs ${problems.join(', ')}. ` +
               `Set a different value in the server environment — the policy is not bypassed for the owner.` };
  }
  const id = newId('u');
  await db.run(
    `INSERT INTO users (id, email, name, password_hash, role, status, must_change_pw, created_at, approved_at, pw_changed_at)
     VALUES (?,?,?,?,'owner','active',1,?,?,?)`,
    id, email, env.OWNER_NAME || 'Owner', await hashPassword(pw), now, now, now);
  await db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('bootstrap_done', ?)", String(now));
  await audit(db, { id, email }, 'bootstrap.owner_created', id, { email }, null);
  return { ok: true, id, email, mustChangePassword: true };
}

/* ---------------------------------------------------------------- first-run setup
   While no owner exists, the person whose email matches OWNER_EMAIL may choose
   their own password and become the owner. Nothing secret is stored or shipped:
   the password is typed once, here, and only its hash is kept. The window shuts
   permanently the moment an owner exists. */
export async function setupAvailable(db, env) {
  if (!ownerLogin(env)) return false;
  const existing = await db.get("SELECT id FROM users WHERE role = 'owner'");
  return !existing;
}

export async function claimOwner(db, env, email, password, ip, ua, now) {
  const key = `setup|${ip || 'noip'}`;
  if (await rateLimited(db, key, now)) {
    return { ok: false, status: 429, error: 'Too many attempts. Try again in 15 minutes.' };
  }
  if (!(await setupAvailable(db, env))) {
    return { ok: false, status: 409, error: 'Setup is not available. Sign in instead.' };
  }
  const ownerEmail = ownerLogin(env);
  const given = normLogin(email);
  if (!given || given !== ownerEmail) {
    await noteAttempt(db, key, false, now);
    await audit(db, null, 'setup.refused_email', null, null, ip);
    return { ok: false, status: 403, error: 'That login is not allowed to set up this app.' };
  }
  const problems = passwordProblems(password);
  if (problems.length) {
    return { ok: false, status: 400, error: `Your password needs ${problems.join(', ')}.` };
  }
  const id = newId('u');
  await db.run(
    `INSERT INTO users (id, email, name, password_hash, role, status, must_change_pw, created_at, approved_at, pw_changed_at)
     VALUES (?,?,?,?,'owner','active',0,?,?,?)`,
    id, ownerEmail, env.OWNER_NAME || 'Owner', await hashPassword(password), now, now, now);
  await db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('bootstrap_done', ?)", String(now));
  const user = await db.get('SELECT * FROM users WHERE id = ?', id);
  await audit(db, user, 'setup.owner_created', id, { email: ownerEmail }, ip);
  const token = await createSession(db, user, ip, ua, now);
  return { ok: true, token, user };
}

export async function login(db, email, password, ip, ua, now) {
  const key = `${normLogin(email)}|${ip || 'noip'}`;
  if (await rateLimited(db, key, now)) {
    await audit(db, null, 'auth.rate_limited', null, { email }, ip);
    return { ok: false, status: 429, error: 'Too many attempts. Try again in 15 minutes.' };
  }
  const user = await db.get('SELECT * FROM users WHERE email = ?', normLogin(email));
  // Always run a verification so the timing does not reveal whether the account exists.
  const stored = user ? user.password_hash : 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const good = await verifyPassword(password || '', stored);
  if (!user || !good) {
    await noteAttempt(db, key, false, now);
    await audit(db, null, 'auth.login_failed', user ? user.id : null, { email }, ip);
    return { ok: false, status: 401, error: 'Login or password is incorrect.' };
  }
  if (user.status !== 'active' && user.status !== 'pending') {
    await noteAttempt(db, key, false, now);
    await audit(db, user, 'auth.login_blocked', user.id, { status: user.status }, ip);
    return { ok: false, status: 403, error: `Your account has been ${user.status}.`, accountStatus: user.status };
  }
  await noteAttempt(db, key, true, now);
  const token = await createSession(db, user, ip, ua, now);
  await db.run('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?', now, ip || null, user.id);
  await audit(db, user, 'auth.login', user.id, null, ip);
  return { ok: true, token, user };
}

export async function changePassword(db, user, current, next, ip, now) {
  const ok = await verifyPassword(current || '', user.password_hash);
  if (!ok) return { ok: false, status: 400, error: 'Current password is incorrect.' };
  const problems = passwordProblems(next);
  if (problems.length) return { ok: false, status: 400,
    error: `New password needs ${problems.join(', ')}.` };
  await db.run('UPDATE users SET password_hash = ?, must_change_pw = 0, pw_changed_at = ? WHERE id = ?',
    await hashPassword(next), now, user.id);
  // Changing a password invalidates every other session for that account.
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, user.id);
  await audit(db, user, 'auth.password_changed', user.id, null, ip);
  return { ok: true };
}
