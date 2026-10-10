/* Weekly submissions to a coach. Real HTTP, real database.
   Run: node test/weekly.test.js */
import { harness, startApp } from './helpers.js';

const { t, ok, eq, sec, finish } = harness();
const app = await startApp();
const { db } = app;
const owner = await app.ownerClient();
const coach = await app.makeUser(owner, 'coach@example.test', 'coach');
const coach2 = await app.makeUser(owner, 'coach2@example.test', 'coach');
const adminU = await app.makeUser(owner, 'admin@example.test', 'admin');
const alice = await app.makeUser(owner, 'alice@example.test', 'member');
const bob = await app.makeUser(owner, 'bob@example.test', 'member');
const carol = await app.makeUser(owner, 'carol@example.test', 'member');
const dave = await app.makeUser(owner, 'dave@example.test', 'member', { permissions: { reviews: false } });
const assign = (c, m) => owner.post('/api/admin/assign', { coachId: c.id, memberId: m.id });
const audits = () => db.all('SELECT * FROM audit_log').map(r => r.action);
const W1 = '2026-10-05', W2 = '2026-10-12', W3 = '2026-10-19';
const report = (extra) => Object.assign({ headline: 'Good week', stats: { sessions: 4 } }, extra || {});
const submit = (u, w, r, pv) => u.c.post('/api/weekly-submissions', { weekStart: w, report: r || report(), planVersionId: pv === undefined ? 'plan_v3' : pv });

sec('SUBMITTING');
await t('no assigned coach => 409 no_coach and nothing stored', async () => {
  const r = await submit(alice, W1);
  eq(r.status, 409); eq(r.data.error, 'no_coach');
  eq(db.get('SELECT COUNT(*) AS n FROM weekly_submissions').n, 0);
});
await assign(coach, alice); await assign(coach, carol); await assign(coach2, bob);
await assign(coach2, dave);
await t('signed-out and permission-less users are refused', async () => {
  eq((await app.client().post('/api/weekly-submissions', { weekStart: W1, report: report() })).status, 401);
  eq((await submit(dave, W1)).status, 403);
  eq((await dave.c.fetch('/api/weekly-submissions')).status, 403);
});
await t('a valid submission is stored against the assigned coach', async () => {
  const r = await submit(alice, W1);
  eq(r.status, 200); eq(r.data.status, 'submitted'); eq(r.data.replaced, false); ok(r.data.id);
  const row = db.get('SELECT * FROM weekly_submissions WHERE id = ?', r.data.id);
  eq(row.user_id, alice.id); eq(row.coach_id, coach.id); eq(row.week_start, W1); eq(row.plan_version_id, 'plan_v3');
  eq(JSON.parse(row.report_json), report());
});
await t('the member id comes from the session, a body userId is ignored', async () => {
  const r = await alice.c.post('/api/weekly-submissions', { weekStart: W2, report: report(), userId: bob.id, coachId: coach2.id, status: 'approved' });
  eq(r.status, 200);
  const row = db.get('SELECT * FROM weekly_submissions WHERE id = ?', r.data.id);
  eq(row.user_id, alice.id); eq(row.coach_id, coach.id); eq(row.status, 'submitted');
});
await t('bad input is 400', async () => {
  const bads = [{ weekStart: 'monday', report: report() }, { weekStart: W3 }, { weekStart: W3, report: [1] },
    { weekStart: W3, report: 'x' }, { weekStart: W3, report: report(), planVersionId: 'x'.repeat(81) },
    { weekStart: W3, report: { blob: 'x'.repeat(61 * 1024) } }, { report: report() }];
  for (const b of bads) eq((await alice.c.post('/api/weekly-submissions', b)).status, 400, JSON.stringify(b).slice(0, 50));
  eq((await alice.c.fetch('/api/weekly-submissions', { method: 'POST', body: '{broken' })).status, 400);
  eq(db.get('SELECT COUNT(*) AS n FROM weekly_submissions WHERE week_start = ?', W3).n, 0);
});
await t('resubmitting an open week replaces it (one open row per user and week)', async () => {
  const a = await submit(alice, W1, report({ headline: 'Edited' }), 'plan_v4');
  eq(a.status, 200); eq(a.data.replaced, true);
  eq(db.get('SELECT COUNT(*) AS n FROM weekly_submissions WHERE user_id = ? AND week_start = ?', alice.id, W1).n, 1);
  const row = db.get('SELECT * FROM weekly_submissions WHERE id = ?', a.data.id);
  eq(JSON.parse(row.report_json).headline, 'Edited'); eq(row.plan_version_id, 'plan_v4');
});

sec('READING');
await t('a member sees only their own submissions, with the report', async () => {
  await submit(bob, W1);
  const a = await alice.c.fetch('/api/weekly-submissions');
  eq(a.status, 200); ok(a.data.submissions.length >= 2);
  ok(a.data.submissions.every(s => s.userId === alice.id));
  ok(a.data.submissions[0].report && a.data.submissions[0].report.headline);
  const b = await bob.c.fetch('/api/weekly-submissions');
  ok(b.data.submissions.length === 1 && b.data.submissions[0].userId === bob.id);
  eq((await alice.c.fetch('/api/weekly-submissions?status=bogus')).status, 400);
});
await t('the coach inbox lists only assigned members, and reading is audited', async () => {
  await submit(carol, W1);
  const r = await coach.c.fetch('/api/weekly-submissions?inbox=1');
  eq(r.status, 200);
  const ids = new Set(r.data.submissions.map(s => s.userId));
  ok(ids.has(alice.id) && ids.has(carol.id) && !ids.has(bob.id), 'inbox leaked or missed a member');
  ok(r.data.submissions.every(s => s.memberEmail && s.report));
  const r2 = await coach2.c.fetch('/api/weekly-submissions?inbox=1');
  eq(r2.data.submissions.map(s => s.userId), [bob.id]);
  ok(audits().includes('weekly.read_member_reports'));
  const e = db.all("SELECT * FROM audit_log WHERE action = 'weekly.read_member_reports' AND actor_id = ?", coach.id).pop();
  ok(e && e.detail.includes(alice.id));
});
await t('members, unassigned admins and the owner see an empty or refused inbox, never other people\'s reports', async () => {
  eq((await alice.c.fetch('/api/weekly-submissions?inbox=1')).status, 403);
  eq((await adminU.c.fetch('/api/weekly-submissions?inbox=1')).data.submissions, []);
  eq((await owner.fetch('/api/weekly-submissions?inbox=1')).data.submissions, []);
  const own = await owner.fetch('/api/weekly-submissions');
  eq(own.data.submissions, []);
});
await t('a coach without the reviews permission is refused the inbox', async () => {
  const c3 = await app.makeUser(owner, 'coach3@example.test', 'coach', { permissions: { reviews: false } });
  eq((await c3.c.fetch('/api/weekly-submissions?inbox=1')).status, 403);
});

sec('DECIDING');
const sub = db.get('SELECT * FROM weekly_submissions WHERE user_id = ? AND week_start = ?', alice.id, W1);
await t('unassigned coaches, members, admins and the owner cannot decide', async () => {
  for (const [who, name] of [[coach2, 'coach2'], [bob, 'bob'], [carol, 'carol'], [adminU, 'admin'], [{ c: owner }, 'owner']]) {
    const r = await who.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'approve' });
    eq(r.status, 403, name);
  }
  eq(db.get('SELECT status FROM weekly_submissions WHERE id = ?', sub.id).status, 'submitted');
  ok(audits().includes('access.denied'));
  eq((await coach.c.patch('/api/weekly-submissions/ws_nope', { action: 'approve' })).status, 404);
  eq((await coach.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'delete' })).status, 400);
});
await t('self-approval is impossible, even for a coach who has their own coach', async () => {
  await assign(coach2, coach);
  const own = await submit(coach, W1);
  eq(own.status, 200);
  eq((await coach.c.patch(`/api/weekly-submissions/${own.data.id}`, { action: 'approve' })).status, 403);
  eq((await alice.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'approve' })).status, 403);
  eq((await coach2.c.patch(`/api/weekly-submissions/${own.data.id}`, { action: 'approve', note: 'ok' })).status, 200);
});
await t('changes_requested needs a note and lets the member resubmit', async () => {
  eq((await coach.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'changes_requested' })).status, 400);
  const r = await coach.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'changes_requested', note: 'Please add your sleep numbers.' });
  eq(r.status, 200); eq(r.data.status, 'changes_requested');
  const row = db.get('SELECT * FROM weekly_submissions WHERE id = ?', sub.id);
  eq(row.coach_note, 'Please add your sleep numbers.'); ok(row.decided_at);
  const mine = (await alice.c.fetch('/api/weekly-submissions')).data.submissions.find(s => s.id === sub.id);
  eq(mine.status, 'changes_requested'); eq(mine.coachNote, 'Please add your sleep numbers.');
  eq((await coach.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'approve' })).status, 409, 'only submitted reports can be decided');
  const re = await submit(alice, W1, report({ headline: 'With sleep' }));
  eq(re.status, 200); eq(re.data.id, sub.id); eq(re.data.replaced, true);
  const after = db.get('SELECT * FROM weekly_submissions WHERE id = ?', sub.id);
  eq(after.status, 'submitted'); eq(after.coach_note, null); eq(after.decided_at, null);
});
await t('the assigned coach can approve; an approved week is final', async () => {
  const r = await coach.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'approve', note: 'Nicely done' });
  eq(r.status, 200); eq(r.data.status, 'approved');
  const row = db.get('SELECT * FROM weekly_submissions WHERE id = ?', sub.id);
  eq(row.status, 'approved'); eq(row.coach_id, coach.id); eq(row.coach_note, 'Nicely done'); ok(row.decided_at);
  eq((await coach.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'changes_requested', note: 'x' })).status, 409);
  const again = await submit(alice, W1);
  eq(again.status, 409); eq(again.data.error, 'already_approved');
  eq((await alice.c.patch(`/api/weekly-submissions/${sub.id}`, { action: 'withdraw' })).status, 409);
});
await t('an unassigned coach loses access to an existing report', async () => {
  const s2 = db.get('SELECT * FROM weekly_submissions WHERE user_id = ? AND week_start = ?', carol.id, W1);
  eq((await owner.post('/api/admin/assign', { coachId: coach.id, memberId: carol.id, remove: true })).status, 200);
  eq((await coach.c.patch(`/api/weekly-submissions/${s2.id}`, { action: 'approve' })).status, 403);
  ok(!(await coach.c.fetch('/api/weekly-submissions?inbox=1')).data.submissions.some(s => s.userId === carol.id));
  await assign(coach, carol);
});
await t('a suspended coach and a pending user are refused', async () => {
  const s2 = db.get('SELECT * FROM weekly_submissions WHERE user_id = ? AND week_start = ?', carol.id, W1);
  const cc = await app.makeUser(owner, 'coach9@example.test', 'coach'); await assign(cc, carol);
  await owner.patch(`/api/admin/users/${cc.id}`, { status: 'suspended' });
  eq((await cc.c.patch(`/api/weekly-submissions/${s2.id}`, { action: 'approve' })).status, 401);
  const p = app.client(); await p.post('/api/auth/signup', { name: 'Pen Ding', email: 'pend@example.test', password: 'Pending-Pass-123', website: '' });
  for (const [m, path] of [['GET', '/api/weekly-submissions'], ['GET', '/api/weekly-submissions?inbox=1'], ['POST', '/api/weekly-submissions'], ['PATCH', `/api/weekly-submissions/${s2.id}`]]) {
    const r = await p.fetch(path, { method: m, body: m === 'GET' ? undefined : {} });
    eq(r.status, 403, m + path); eq(r.data.code, 'pending');
  }
  eq(db.get('SELECT status FROM weekly_submissions WHERE id = ?', s2.id).status, 'submitted');
});

sec('WITHDRAWING');
await t('only the member can withdraw, only while open, and the week can then be sent again', async () => {
  const s3 = db.get('SELECT * FROM weekly_submissions WHERE user_id = ? AND week_start = ?', carol.id, W1);
  eq((await bob.c.patch(`/api/weekly-submissions/${s3.id}`, { action: 'withdraw' })).status, 403);
  eq((await coach.c.patch(`/api/weekly-submissions/${s3.id}`, { action: 'withdraw' })).status, 403);
  eq((await carol.c.patch(`/api/weekly-submissions/${s3.id}`, { action: 'withdraw' })).data.status, 'withdrawn');
  eq((await carol.c.patch(`/api/weekly-submissions/${s3.id}`, { action: 'withdraw' })).status, 409);
  eq((await coach.c.patch(`/api/weekly-submissions/${s3.id}`, { action: 'approve' })).status, 409);
  ok(!(await coach.c.fetch('/api/weekly-submissions?inbox=1')).data.submissions.some(s => s.id === s3.id), 'withdrawn report still in the inbox');
  const again = await submit(carol, W1);
  eq(again.status, 200); ok(again.data.id !== s3.id);
  eq(db.get("SELECT COUNT(*) AS n FROM weekly_submissions WHERE user_id = ? AND week_start = ? AND status IN ('submitted','changes_requested')", carol.id, W1).n, 1);
});

sec('AUDIT');
await t('every action left an audit entry, and report contents are not logged', async () => {
  const a = audits();
  ['weekly.submitted', 'weekly.resubmitted', 'weekly.approved', 'weekly.changes_requested', 'weekly.withdrawn',
   'weekly.read_member_reports', 'access.denied'].forEach(x => ok(a.includes(x), 'missing ' + x));
  const blob = JSON.stringify(db.all("SELECT * FROM audit_log WHERE action LIKE 'weekly.%'"));
  ok(!blob.includes('Good week') && !blob.includes('Please add your sleep numbers'), 'report or note text in the audit log');
});

finish(() => app.close());
