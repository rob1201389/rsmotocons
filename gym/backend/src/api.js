/* The HTTP API. A single Web-standard fetch handler, so it runs unchanged on
   Cloudflare Workers and on Node.

   Two rules hold everywhere in this file:
     1. The user id is taken from the session, never from the request body or
        the URL. A browser cannot ask for someone else's data by changing an id.
     2. Permission is checked per request, not per screen. Hiding a tab is
        presentation; these checks are the boundary. */

import { newId, sha256hex } from './crypto.js';
import { sessionFromRequest, login, changePassword, revokeAllSessions, revokeSession,
         sessionCookie, clearCookie, readCookie, audit, setupAvailable, claimOwner, normLogin } from './auth.js';
import { json, err, readBody } from './http.js';
import * as signup from './signup.js';
import { weeklyReview } from './ai.js';
import { createSubmission, listSubmissions, decideSubmission } from './weekly.js';
import { can, isOwner, isAdmin, isReviewer, effectivePermissions, mayAccessUserData,
         FEATURES, ROLES } from './rbac.js';

function publicUser(u, accountState) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
           accountState,
           mustChangePassword: !!u.must_change_pw,
           permissions: effectivePermissions(u),
           lastLoginAt: u.last_login_at || null, createdAt: u.created_at };
}
const body = readBody;

/* The only routes a pending (unverified or awaiting approval) account may use.
   Everything else is refused by one guard in handle(), so a new route cannot
   forget to check. */
const PENDING_ALLOWED = new Set([
  'GET /api/auth/session', 'GET /api/auth/me', 'POST /api/auth/logout', 'POST /api/auth/password',
  'POST /api/auth/resend-verification', 'GET /api/auth/account-status'
]);

export async function handle(req, ctx) {
  const { db, env } = ctx;
  const now = ctx.now || Date.now();
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  // On Workers the platform supplies the client address (trustIp), which a caller cannot forge.
  const ip = (ctx.trustIp ? ctx.ip : (req.headers.get('x-forwarded-for') || ctx.ip)) || null;
  const ua = req.headers.get('user-agent') || '';
  const secure = url.protocol === 'https:';
  const rc = { req, ctx, db, env, now, url, ip, ua, secure };

  if (!path.startsWith('/api/')) return err(404, 'Not found');

  /* ---- CSRF: same-origin enforcement on every mutation ------------------ */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin) {
      const o = new URL(origin);
      if (o.host !== url.host) return err(403, 'Cross-origin request refused.');
    }
    if (req.headers.get('x-recomp-request') !== '1') {
      return err(403, 'Missing request header. This endpoint is not callable from a plain form post.');
    }
  }

  /* ---- unauthenticated routes ------------------------------------------ */
  if (path === '/api/auth/login' && req.method === 'POST') {
    const b = await body(req);
    const r = await login(db, b.email, b.password, ip, ua, now);
    if (!r.ok) return err(r.status, r.error, { accountStatus: r.accountStatus });
    return json({ user: publicUser(r.user, await signup.accountState(db, r.user)) }, 200,
      { 'Set-Cookie': sessionCookie(r.token, secure) });
  }
  if (path === '/api/auth/signup' && req.method === 'POST') return signup.signup(rc);
  if (path === '/api/auth/verify' && req.method === 'POST') return signup.verify(rc);
  if (path === '/api/auth/forgot' && req.method === 'POST') return signup.forgot(rc);
  if (path === '/api/auth/reset' && req.method === 'POST') return signup.reset(rc);
  if (path === '/api/auth/session' && req.method === 'GET') {
    const { user, reason } = await sessionFromRequest(db, req, now);
    if (!user) return json({ authenticated: false, reason: reason || 'none',
      setupAvailable: await setupAvailable(db, env) }, 200);
    return json({ authenticated: true, user: publicUser(user, await signup.accountState(db, user)) });
  }
  if (path === '/api/auth/setup' && req.method === 'POST') {
    const b = await body(req);
    const r = await claimOwner(db, env, b.email, b.password, ip, ua, now);
    if (!r.ok) return err(r.status, r.error);
    return json({ user: publicUser(r.user, 'active') }, 200, { 'Set-Cookie': sessionCookie(r.token, secure) });
  }

  /* ---- everything below requires a live session ------------------------- */
  const { user, reason, user0 } = await sessionFromRequest(db, req, now);
  if (!user) {
    const st = user0 ? user0.status : null;
    return json({ error: 'Not signed in.', reason, accountStatus: st }, 401,
      { 'Set-Cookie': clearCookie(secure) });
  }

  /* ---- central guard: a pending account is restricted to a short allowlist */
  if (user.status === 'pending' && !PENDING_ALLOWED.has(req.method + ' ' + path)) {
    return err(403, 'Your account is awaiting approval.',
      { code: 'pending', accountState: await signup.accountState(db, user) });
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = readCookie(req, 'recomp_session');
    if (token) await revokeSession(db, token, now);
    await audit(db, user, 'auth.logout', user.id, null, ip);
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(secure) });
  }
  if (path === '/api/auth/password' && req.method === 'POST') {
    const b = await body(req);
    const r = await changePassword(db, user, b.current, b.next, ip, now);
    if (!r.ok) return err(r.status, r.error);
    const token = await (await import('./auth.js')).createSession(db, user, ip, ua, now);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, secure) });
  }
  if (path === '/api/auth/me' && req.method === 'GET') return json({ user: publicUser(user, await signup.accountState(db, user)) });
  if (path === '/api/auth/account-status' && req.method === 'GET') return signup.accountStatus(rc, user);
  if (path === '/api/auth/resend-verification' && req.method === 'POST') return signup.resendVerification(rc, user);

  /* A forced password change blocks everything else. */
  if (user.must_change_pw) {
    return err(403, 'You must change your password before continuing.', { mustChangePassword: true });
  }

  /* ---- the user's own Recomp state -------------------------------------- */
  if (path === '/api/state' && req.method === 'GET') {
    if (!can(user, 'training')) return err(403, 'You do not have access to training data.');
    const row = await db.get('SELECT doc, version, updated_at FROM user_state WHERE user_id = ?', user.id);
    return json({ doc: row ? JSON.parse(row.doc) : null,
                  version: row ? row.version : 0, updatedAt: row ? row.updated_at : null });
  }
  if (path === '/api/state' && req.method === 'PUT') {
    if (!can(user, 'training')) return err(403, 'You do not have access to training data.');
    const b = await body(req);
    if (!b.doc || typeof b.doc !== 'object') return err(400, 'No document supplied.');
    const row = await db.get('SELECT version FROM user_state WHERE user_id = ?', user.id);
    if (row && b.ifVersion != null && b.ifVersion !== row.version) {
      return err(409, 'This device is out of date.', { version: row.version });
    }
    const v = (row ? row.version : 0) + 1;
    if (row) await db.run('UPDATE user_state SET doc = ?, version = ?, updated_at = ? WHERE user_id = ?',
      JSON.stringify(b.doc), v, now, user.id);
    else await db.run('INSERT INTO user_state (user_id, doc, version, updated_at) VALUES (?,?,?,?)',
      user.id, JSON.stringify(b.doc), v, now);
    return json({ ok: true, version: v });
  }

  /* Reading ANOTHER user's records. Admin rank alone is not enough. */
  let m = path.match(/^\/api\/users\/([^/]+)\/state$/);
  if (m && req.method === 'GET') {
    const targetId = m[1];
    const access = await mayAccessUserData(db, user, targetId);
    if (!access.ok) {
      await audit(db, user, 'access.denied', targetId, { reason: access.reason }, ip);
      return err(403, 'You do not have access to that account\'s records.');
    }
    const row = await db.get('SELECT doc, version, updated_at FROM user_state WHERE user_id = ?', targetId);
    if (access.scope !== 'self') {
      await audit(db, user, 'access.read_member_records', targetId, { scope: access.scope }, ip);
    }
    return json({ doc: row ? JSON.parse(row.doc) : null, version: row ? row.version : 0,
                  scope: access.scope });
  }

  /* ---- AI weekly review and weekly submissions to a coach ----------------- */
  if (path === '/api/ai/weekly-review' && req.method === 'POST') return weeklyReview(rc, user);
  if (path === '/api/weekly-submissions' && req.method === 'POST') return createSubmission(rc, user);
  if (path === '/api/weekly-submissions' && req.method === 'GET') return listSubmissions(rc, user);
  m = path.match(/^\/api\/weekly-submissions\/([^/]+)$/);
  if (m && req.method === 'PATCH') return decideSubmission(rc, user, m[1]);

  /* ---- import local data into the signed-in account --------------------- */
  if (path === '/api/import/preview' && req.method === 'POST') {
    const b = await body(req);
    const incoming = b.doc || {};
    const row = await db.get('SELECT doc FROM user_state WHERE user_id = ?', user.id);
    const existing = row ? JSON.parse(row.doc) : null;
    const exIds = new Set(((existing && existing.sessions) || []).map(s => s.id));
    const inc = (incoming.sessions || []);
    const dupes = inc.filter(s => exIds.has(s.id));
    const fresh = inc.filter(s => !exIds.has(s.id));
    const exBw = new Set(((existing && existing.bodyweight) || []).map(e => e.date));
    const bwNew = (incoming.bodyweight || []).filter(e => !exBw.has(e.date));
    return json({ preview: {
      existingSessions: exIds.size,
      incomingSessions: inc.length,
      newSessions: fresh.length,
      duplicateSessions: dupes.length,
      newWeighIns: bwNew.length,
      dateRange: inc.length ? [inc[0].date, inc[inc.length - 1].date] : null,
      schemaVersion: incoming.schemaVersion || null
    }});
  }
  if (path === '/api/import/commit' && req.method === 'POST') {
    const b = await body(req);
    const incoming = b.doc || {};
    const row = await db.get('SELECT doc, version FROM user_state WHERE user_id = ?', user.id);
    const existing = row ? JSON.parse(row.doc) : null;
    let merged;
    if (!existing) merged = incoming;
    else {
      const seen = new Set((existing.sessions || []).map(s => s.id));
      merged = Object.assign({}, existing);
      merged.sessions = (existing.sessions || []).concat(
        (incoming.sessions || []).filter(s => !seen.has(s.id)));
      const bwSeen = new Set((existing.bodyweight || []).map(e => e.date));
      merged.bodyweight = (existing.bodyweight || []).concat(
        (incoming.bodyweight || []).filter(e => !bwSeen.has(e.date)));
    }
    const v = (row ? row.version : 0) + 1;
    if (row) await db.run('UPDATE user_state SET doc = ?, version = ?, updated_at = ? WHERE user_id = ?',
      JSON.stringify(merged), v, now, user.id);
    else await db.run('INSERT INTO user_state (user_id, doc, version, updated_at) VALUES (?,?,?,?)',
      user.id, JSON.stringify(merged), v, now);
    await audit(db, user, 'data.imported', user.id,
      { sessions: (merged.sessions || []).length }, ip);
    return json({ ok: true, version: v, sessions: (merged.sessions || []).length });
  }

  /* ---- workout reviews --------------------------------------------------- */
  if (path === '/api/reviews' && req.method === 'POST') {
    if (!can(user, 'reviews')) return err(403, 'You do not have access to reviews.');
    const b = await body(req);
    const id = newId('rv');
    await db.run(
      `INSERT INTO reviews (id,user_id,session_ref,session_date,difficulty,satisfaction,effective,unsuitable,
        technique_q,pain_note,wanted,comment,wants_review,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'new', ?, ?)`,
      id, user.id, b.sessionRef || null, b.sessionDate || null, b.difficulty || null,
      b.satisfaction || null, JSON.stringify(b.effective || []), JSON.stringify(b.unsuitable || []),
      b.techniqueQuestion || null, b.painNote || null, b.wanted || null, b.comment || null,
      b.wantsReview ? 1 : 0, now, now);
    await audit(db, user, 'review.submitted', id, { sessionRef: b.sessionRef }, ip);
    return json({ ok: true, id });
  }
  if (path === '/api/reviews' && req.method === 'GET') {
    if (!can(user, 'reviews')) return err(403, 'You do not have access to reviews.');
    const status = url.searchParams.get('status');
    if (url.searchParams.get('inbox') === '1') {
      if (!isReviewer(user)) return err(403, 'Not a reviewer.');
      // Reviewers see only the accounts assigned to them.
      const rows = await db.all(
        `SELECT r.*, u.email AS member_email, u.name AS member_name FROM reviews r
           JOIN users u ON u.id = r.user_id
           JOIN coach_assignments a ON a.member_id = r.user_id AND a.coach_id = ?
          ${status ? 'WHERE r.status = ?' : ''}
          ORDER BY r.created_at DESC`,
        ...(status ? [user.id, status] : [user.id]));
      return json({ reviews: rows });
    }
    const rows = await db.all('SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC', user.id);
    return json({ reviews: rows });
  }
  m = path.match(/^\/api\/reviews\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const rv = await db.get('SELECT * FROM reviews WHERE id = ?', m[1]);
    if (!rv) return err(404, 'No such review.');
    const access = await mayAccessUserData(db, user, rv.user_id);
    if (!access.ok) return err(403, 'You do not have access to that review.');
    const b = await body(req);
    if (b.status && ['new','in_review','replied','resolved'].includes(b.status)) {
      await db.run('UPDATE reviews SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?',
        b.status, access.scope === 'self' ? rv.assigned_to : user.id, now, m[1]);
      await audit(db, user, 'review.status', m[1], { status: b.status }, ip);
    }
    return json({ ok: true });
  }
  m = path.match(/^\/api\/reviews\/([^/]+)\/messages$/);
  if (m && (req.method === 'GET' || req.method === 'POST')) {
    const rv = await db.get('SELECT * FROM reviews WHERE id = ?', m[1]);
    if (!rv) return err(404, 'No such review.');
    const access = await mayAccessUserData(db, user, rv.user_id);
    if (!access.ok) return err(403, 'You do not have access to that review.');
    if (req.method === 'GET') {
      const rows = await db.all(
        `SELECT mm.*, u.name AS author_name, u.role AS author_role FROM review_messages mm
           JOIN users u ON u.id = mm.author_id WHERE mm.review_id = ? ORDER BY mm.created_at`, m[1]);
      return json({ messages: rows });
    }
    const b = await body(req);
    if (!b.body || !String(b.body).trim()) return err(400, 'Message is empty.');
    const id = newId('msg');
    await db.run('INSERT INTO review_messages (id, review_id, author_id, body, created_at) VALUES (?,?,?,?,?)',
      id, m[1], user.id, String(b.body).slice(0, 4000), now);
    if (access.scope !== 'self') {
      await db.run("UPDATE reviews SET status = 'replied', updated_at = ? WHERE id = ?", now, m[1]);
    }
    return json({ ok: true, id });
  }

  /* ---- plan proposals: a reviewer suggests, the user decides -------------- */
  if (path === '/api/proposals' && req.method === 'POST') {
    const b = await body(req);
    if (!isReviewer(user)) return err(403, 'Only a reviewer can propose a change.');
    const access = await mayAccessUserData(db, user, b.userId);
    if (!access.ok || access.scope === 'self') return err(403, 'Not assigned to that account.');
    if (!b.reason || !String(b.reason).trim()) return err(400, 'A reason is required.');
    const id = newId('pp');
    await db.run(
      `INSERT INTO plan_proposals (id, review_id, user_id, proposed_by, variant_id, change, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, b.reviewId || null, b.userId, user.id, b.variantId || null,
      JSON.stringify(b.change || {}), String(b.reason).slice(0, 2000), now);
    await audit(db, user, 'proposal.created', b.userId, { id, variantId: b.variantId }, ip);
    return json({ ok: true, id });
  }
  if (path === '/api/proposals' && req.method === 'GET') {
    const rows = await db.all(
      `SELECT p.*, u.name AS proposer_name FROM plan_proposals p
         JOIN users u ON u.id = p.proposed_by
        WHERE p.user_id = ? ORDER BY p.created_at DESC`, user.id);
    return json({ proposals: rows });
  }
  m = path.match(/^\/api\/proposals\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const pp = await db.get('SELECT * FROM plan_proposals WHERE id = ?', m[1]);
    if (!pp) return err(404, 'No such proposal.');
    if (pp.user_id !== user.id) return err(403, 'Only the owner of the plan can accept or decline it.');
    const b = await body(req);
    const next = b.status === 'accepted' ? 'accepted' : 'declined';
    await db.run('UPDATE plan_proposals SET status = ?, decided_at = ? WHERE id = ?', next, now, m[1]);
    await audit(db, user, 'proposal.' + next, m[1], null, ip);
    return json({ ok: true, status: next });
  }

  /* ---- administration ---------------------------------------------------- */
  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(user)) return err(403, 'Administrator access required.');

    if (path === '/api/admin/requests' && req.method === 'GET') return signup.adminRequestsList(rc);
    m = path.match(/^\/api\/admin\/requests\/([^/]+)\/(decision|verify-email)$/);
    if (m && req.method === 'POST') {
      return m[2] === 'decision' ? signup.adminDecision(rc, user, m[1]) : signup.adminVerifyEmail(rc, user, m[1]);
    }
    m = path.match(/^\/api\/admin\/users\/([^/]+)\/note$/);
    if (m && (req.method === 'GET' || req.method === 'PUT')) return signup.adminNote(rc, user, m[1]);

    if (path === '/api/admin/users' && req.method === 'GET') {
      const rows = await db.all(
        `SELECT id,email,name,role,status,must_change_pw,permissions,created_at,approved_at,last_login_at
           FROM users ORDER BY created_at`);
      return json({ users: rows.map(r => ({
        id: r.id, email: r.email, name: r.name, role: r.role, status: r.status,
        mustChangePassword: !!r.must_change_pw, permissions: effectivePermissions(r),
        createdAt: r.created_at, approvedAt: r.approved_at, lastLoginAt: r.last_login_at })) });
    }

    if (path === '/api/admin/users' && req.method === 'POST') {
      const b = await body(req);
      const email = normLogin(b.email);
      if (email.length < 3 || email.length > 80) return err(400, 'A login of 3 to 80 characters is required.');
      if (b.role && !ROLES.includes(b.role)) return err(400, 'Unknown role.');
      if ((b.role === 'owner' || b.role === 'admin') && !isOwner(user)) {
        return err(403, 'Only the owner can create administrators.');
      }
      const { passwordProblems, hashPassword } = await import('./crypto.js');
      const problems = passwordProblems(b.password);
      if (problems.length) return err(400, `Password needs ${problems.join(', ')}.`);
      const exists = await db.get('SELECT id FROM users WHERE email = ?', email);
      if (exists) return err(409, 'That login already exists.');
      const id = newId('u');
      await db.run(
        `INSERT INTO users (id,email,name,password_hash,role,status,must_change_pw,permissions,created_at,created_by,approved_at,approved_by,pw_changed_at)
         VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)`,
        id, email, b.name || null, await hashPassword(b.password),
        b.role || 'member', b.status || 'active',
        b.permissions ? JSON.stringify(b.permissions) : null,
        now, user.id, now, user.id, now);
      await audit(db, user, 'admin.user_created', id, { email, role: b.role || 'member' }, ip);
      return json({ ok: true, id });
    }

    m = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
      const targetId = m[1];
      const target = await db.get('SELECT * FROM users WHERE id = ?', targetId);
      if (!target) return err(404, 'No such account.');
      const b = await body(req);

      if (b.role !== undefined) {
        if (!ROLES.includes(b.role)) return err(400, 'Unknown role.');
        if (!isOwner(user)) return err(403, 'Only the owner can change roles.');
        if (target.role === 'owner' && b.role !== 'owner') {
          const owners = await db.all("SELECT id FROM users WHERE role = 'owner' AND status = 'active'");
          if (owners.length <= 1) return err(409, 'This is the last owner. Promote another owner first.');
        }
        await db.run('UPDATE users SET role = ? WHERE id = ?', b.role, targetId);
        await audit(db, user, 'admin.role_changed', targetId, { from: target.role, to: b.role }, ip);
      }

      if (b.status !== undefined) {
        if (!['pending','active','suspended','revoked','rejected'].includes(b.status)) return err(400, 'Unknown status.');
        if (target.role === 'owner' && b.status !== 'active') {
          const owners = await db.all("SELECT id FROM users WHERE role = 'owner' AND status = 'active'");
          if (owners.length <= 1) return err(409, 'This is the last active owner.');
        }
        await db.run('UPDATE users SET status = ?, approved_at = COALESCE(approved_at, ?), approved_by = COALESCE(approved_by, ?) WHERE id = ?',
          b.status, b.status === 'active' ? now : null, b.status === 'active' ? user.id : null, targetId);
        if (b.status === 'active') {
          // Keep the sign-up queue consistent when an admin activates someone directly.
          await db.run("UPDATE signup_requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE user_id = ? AND status <> 'approved'",
            now, user.id, targetId);
        } else if (b.status === 'rejected') {
          await db.run("UPDATE signup_requests SET status = 'rejected', decided_at = ?, decided_by = ? WHERE user_id = ? AND status <> 'rejected'",
            now, user.id, targetId);
        }
        if (b.status !== 'active') {
          // Suspension or revocation kills every live session immediately.
          await revokeAllSessions(db, targetId, now);
        }
        await audit(db, user, 'admin.status_changed', targetId, { from: target.status, to: b.status }, ip);
      }

      if (b.permissions !== undefined) {
        const clean = {};
        FEATURES.forEach(f => { if (f in (b.permissions || {})) clean[f] = !!b.permissions[f]; });
        await db.run('UPDATE users SET permissions = ? WHERE id = ?', JSON.stringify(clean), targetId);
        await audit(db, user, 'admin.permissions_changed', targetId, clean, ip);
      }

      if (b.resetPassword) {
        const { passwordProblems, hashPassword } = await import('./crypto.js');
        const problems = passwordProblems(b.resetPassword);
        if (problems.length) return err(400, `Password needs ${problems.join(', ')}.`);
        await db.run('UPDATE users SET password_hash = ?, must_change_pw = 1, pw_changed_at = ? WHERE id = ?',
          await hashPassword(b.resetPassword), now, targetId);
        await revokeAllSessions(db, targetId, now);
        await audit(db, user, 'admin.password_reset', targetId, null, ip);
      }
      return json({ ok: true });
    }

    if (path === '/api/admin/assign' && req.method === 'POST') {
      const b = await body(req);
      const coach = await db.get('SELECT * FROM users WHERE id = ?', b.coachId);
      const member = await db.get('SELECT * FROM users WHERE id = ?', b.memberId);
      if (!coach || !member) return err(404, 'Account not found.');
      if (!isReviewer(coach)) return err(400, 'That account is not a reviewer.');
      if (b.remove) {
        await db.run('DELETE FROM coach_assignments WHERE coach_id = ? AND member_id = ?', b.coachId, b.memberId);
        await audit(db, user, 'admin.unassigned', b.memberId, { coachId: b.coachId }, ip);
      } else {
        await db.run('INSERT OR IGNORE INTO coach_assignments (coach_id, member_id, created_at, created_by) VALUES (?,?,?,?)',
          b.coachId, b.memberId, now, user.id);
        await audit(db, user, 'admin.assigned', b.memberId, { coachId: b.coachId }, ip);
      }
      return json({ ok: true });
    }
    if (path === '/api/admin/assignments' && req.method === 'GET') {
      return json({ assignments: await db.all('SELECT * FROM coach_assignments') });
    }
    if (path === '/api/admin/audit' && req.method === 'GET') {
      const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10));
      return json({ entries: await db.all('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?', limit) });
    }
  }

  return err(404, 'Unknown endpoint.');
}
