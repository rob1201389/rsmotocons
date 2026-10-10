/* Weekly submissions: a member sends their weekly report to their assigned
   coach, who approves it or asks for changes. */
import { json, err, readBody } from './http.js';
import { audit } from './auth.js';
import { newId, sealText, openText } from './crypto.js';
import { sharingAllowed, healthConsentWithdrawn } from './account.js';
import { can, isReviewer, mayAccessUserData } from './rbac.js';

const MAX_REPORT_BYTES = 60 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN = ['submitted', 'changes_requested'];
const STATUSES = ['submitted', 'approved', 'changes_requested', 'withdrawn'];

const shape = async (r, withMember, env) => {
  let report = null;
  try { report = JSON.parse(await openText(env, r.report_json)); } catch (e) { report = null; }
  const o = { id: r.id, userId: r.user_id, weekStart: r.week_start, report, planVersionId: r.plan_version_id,
    status: r.status, coachId: r.coach_id, coachNote: r.coach_note, createdAt: r.created_at,
    decidedAt: r.decided_at, updatedAt: r.updated_at };
  if (withMember) { o.memberName = r.member_name; o.memberEmail = r.member_email; }
  return o;
};

export async function createSubmission(rc, user) {
  const { db, now, ip } = rc;
  if (!can(user, 'reviews')) return err(403, 'You do not have access to reviews.');
  if (await healthConsentWithdrawn(db, user.id)) return err(403, 'You have withdrawn consent to use your health information.', { code: 'health_consent_withdrawn' });
  if (!(await sharingAllowed(db, user.id))) return err(409, 'Sharing with a reviewer is turned off in your settings.', { code: 'sharing_off' });
  let b;
  try {
    const text = await rc.req.text();
    if (text.length > MAX_REPORT_BYTES + 2048) return err(400, 'The report is too large.');
    b = JSON.parse(text);
  } catch (e) { return err(400, 'Invalid request.'); }
  if (!b || typeof b !== 'object') return err(400, 'Invalid request.');
  if (typeof b.weekStart !== 'string' || !DATE_RE.test(b.weekStart) || isNaN(new Date(b.weekStart + 'T00:00:00Z'))) {
    return err(400, 'weekStart must be a date in YYYY-MM-DD form.');
  }
  if (!b.report || typeof b.report !== 'object' || Array.isArray(b.report)) return err(400, 'A report object is required.');
  const plainJson = JSON.stringify(b.report);
  if (new TextEncoder().encode(plainJson).length > MAX_REPORT_BYTES) return err(400, 'The report is too large.');
  const reportJson = await sealText(rc.env, plainJson);
  if (b.planVersionId != null && (typeof b.planVersionId !== 'string' || b.planVersionId.length > 80)) {
    return err(400, 'planVersionId must be text of up to 80 characters.');
  }
  const coach = await db.get(
    `SELECT a.coach_id FROM coach_assignments a JOIN users c ON c.id = a.coach_id
      WHERE a.member_id = ? AND c.status = 'active' ORDER BY a.created_at, a.coach_id LIMIT 1`, user.id);
  if (!coach) return err(409, 'no_coach', { error: 'no_coach', message: 'You do not have a coach assigned yet.' });

  const open = await db.get(
    `SELECT * FROM weekly_submissions WHERE user_id = ? AND week_start = ? AND status IN ('submitted','changes_requested')`,
    user.id, b.weekStart);
  if (open) {
    await db.run(
      `UPDATE weekly_submissions SET report_json = ?, plan_version_id = ?, status = 'submitted', coach_id = ?,
              coach_note = NULL, decided_at = NULL, updated_at = ? WHERE id = ?`,
      reportJson, b.planVersionId || null, coach.coach_id, now, open.id);
    await audit(db, user, 'weekly.resubmitted', open.id, { weekStart: b.weekStart }, ip);
    return json({ ok: true, id: open.id, status: 'submitted', replaced: true });
  }
  const approved = await db.get(`SELECT id FROM weekly_submissions WHERE user_id = ? AND week_start = ? AND status = 'approved'`,
    user.id, b.weekStart);
  if (approved) return err(409, 'already_approved', { error: 'already_approved', message: 'That week has already been approved.' });
  const id = newId('ws');
  await db.run(
    `INSERT INTO weekly_submissions (id,user_id,week_start,report_json,plan_version_id,status,coach_id,created_at,updated_at)
     VALUES (?,?,?,?,?,'submitted',?,?,?)`,
    id, user.id, b.weekStart, reportJson, b.planVersionId || null, coach.coach_id, now, now);
  await audit(db, user, 'weekly.submitted', id, { weekStart: b.weekStart }, ip);
  return json({ ok: true, id, status: 'submitted', replaced: false });
}

export async function listSubmissions(rc, user) {
  const { db, ip } = rc;
  const status = rc.url.searchParams.get('status');
  if (status && !STATUSES.includes(status)) return err(400, 'Unknown status.');
  if (rc.url.searchParams.get('inbox') === '1') {
    if (!isReviewer(user)) return err(403, 'Not a reviewer.');
    if (!can(user, 'reviews')) return err(403, 'You do not have access to reviews.');
    const rows = await db.all(
      `SELECT w.*, u.name AS member_name, u.email AS member_email FROM weekly_submissions w
         JOIN users u ON u.id = w.user_id
         JOIN coach_assignments a ON a.member_id = w.user_id AND a.coach_id = ?
        WHERE w.user_id <> ? ${status ? 'AND w.status = ?' : "AND w.status <> 'withdrawn'"}
        ORDER BY w.updated_at DESC LIMIT 200`,
      ...(status ? [user.id, user.id, status] : [user.id, user.id]));
    const out = [];
    for (const r of rows) {
      const access = await mayAccessUserData(db, user, r.user_id);     // belt and braces
      if (access.ok && access.scope === 'assigned') out.push(r);
    }
    if (out.length) {
      await audit(db, user, 'weekly.read_member_reports', null,
        { ids: out.map(r => r.id), members: [...new Set(out.map(r => r.user_id))] }, ip);
    }
    return json({ submissions: await Promise.all(out.map(r => shape(r, true, rc.env))) });
  }
  if (!can(user, 'reviews')) return err(403, 'You do not have access to reviews.');
  const rows = await db.all(
    `SELECT * FROM weekly_submissions WHERE user_id = ? ${status ? 'AND status = ?' : ''} ORDER BY week_start DESC, updated_at DESC`,
    ...(status ? [user.id, status] : [user.id]));
  return json({ submissions: await Promise.all(rows.map(r => shape(r, false, rc.env))) });
}

export async function decideSubmission(rc, user, id) {
  const { db, now, ip } = rc;
  const sub = await db.get('SELECT * FROM weekly_submissions WHERE id = ?', id);
  if (!sub) return err(404, 'No such submission.');
  let b = {};
  b = await readBody(rc.req);
  if (!b || typeof b !== 'object') b = {};
  const action = b.action;
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) : '';
  if (!['approve', 'changes_requested', 'withdraw'].includes(action)) return err(400, 'Unknown action.');

  if (action === 'withdraw') {
    if (sub.user_id !== user.id) return err(403, 'Only the member who sent a report can withdraw it.');
    if (!OPEN.includes(sub.status)) return err(409, `A ${sub.status.replace('_', ' ')} report cannot be withdrawn.`);
    await db.run("UPDATE weekly_submissions SET status = 'withdrawn', updated_at = ? WHERE id = ?", now, id);
    await audit(db, user, 'weekly.withdrawn', id, null, ip);
    return json({ ok: true, status: 'withdrawn' });
  }
  if (sub.user_id === user.id) return err(403, 'You cannot approve your own report.');
  const access = await mayAccessUserData(db, user, sub.user_id);
  if (!access.ok || access.scope !== 'assigned') {
    await audit(db, user, 'access.denied', sub.user_id, { reason: access.reason || 'not_assigned', weekly: id }, ip);
    return err(403, 'You do not have access to that report.');
  }
  if (sub.status !== 'submitted') return err(409, 'Only a report waiting for review can be decided.');
  if (action === 'changes_requested' && !note) return err(400, 'Please say what needs to change.');
  const next = action === 'approve' ? 'approved' : 'changes_requested';
  await db.run('UPDATE weekly_submissions SET status = ?, coach_id = ?, coach_note = ?, decided_at = ?, updated_at = ? WHERE id = ?',
    next, user.id, note || null, now, now, id);
  await audit(db, user, 'weekly.' + next, id, { member: sub.user_id, hasNote: !!note }, ip);
  return json({ ok: true, status: next });
}
