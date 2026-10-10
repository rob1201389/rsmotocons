/* Shared helpers for the planning and review tests: they drive the real engines
   (plan.js, review.js, engine.js) the same way the app does. */
const path = require('path'), fs = require('fs');
const dir = fs.existsSync(path.join(__dirname, '../public/plan.js')) ? '../public/' : './';
const C = require(dir + 'core.js'), E = require(dir + 'engine.js'), X = require(dir + 'exercises.js');
const P = require(dir + 'plan.js'), R = require(dir + 'review.js');

function counters() {
  let pass = 0, fail = 0; const failures = [];
  const t = (name, fn) => { try { fn(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
    catch (e) { fail++; failures.push([name, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + name + '\n       ' + e.message); } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy, got ' + v); };
  const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');
  const done = () => { console.log('\n' + '='.repeat(62) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(62));
    failures.forEach(f => console.log(' - ' + f[0] + ': ' + f[1])); process.exit(fail ? 1 : 0); };
  return { t, eq, ok, sec, done };
}
const MON = '2026-09-07';
const add = (d, n) => P.addDays(d, n);
const msOf = (date, hh) => Date.parse(date + 'T' + String(hh == null ? 18 : hh).padStart(2, '0') + ':30:00+10:00');

function newUser(over, start) {
  start = start || MON;
  const s = C.blankState(); s._exIndex = X.EX_INDEX;
  s.profile.weight = 86; s.profile.experience = 'intermediate';
  s.goals = Object.assign(P.defaultGoals(s.profile, 'Australia/Sydney'), { daysPerWeek: 4, sessionMinutes: 60, startDate: start }, over || {});
  P.createInitialPlan(s, start, s.goals);
  P.ensureWeek(s, start);
  return s;
}
const weekAt = (s, date) => P.ensureWeek(s, date);

/* Perform a planned slot the way the app does: the session is built from the
   plan, then each set gets the user's actual reps (default: hit the target). */
function perform(s, slotId, date, opt) {
  opt = opt || {};
  P.reconcile(s, date);
  const b = P.buildSession(s, slotId, opt.checkin || null, date);
  if (!b.ok) throw new Error('buildSession: ' + b.problems.join(' '));
  const sess = b.session; sess.date = date;
  let planned = 0, done = 0;
  sess.entries.forEach(e => {
    e.sets.forEach(set => {
      if (set.warmup) return;
      planned++;
      if (opt.maxSets != null && done >= opt.maxSets) { set.status = 'skipped'; return; }
      const reps = opt.reps ? opt.reps(e, set) : set.plannedReps;
      if (reps === null) { set.status = 'skipped'; return; }
      // calibration session: the user chooses a load, nothing is suggested
      const w = set.plannedWeight != null ? set.plannedWeight : ((opt.calib && opt.calib[e.variantId]) || (X.EX_INDEX[e.variantId].modality === 'bodyweight' ? 0 : 40));
      C.editSet(set, w, reps); done++;
    });
    if (opt.feedback) e.feedback = Object.assign(E.blankFeedback(), typeof opt.feedback === 'function' ? opt.feedback(e) : opt.feedback);
  });
  sess.status = 'completed'; sess.startedAt = msOf(date, 7); sess.endedAt = msOf(date, 8);
  s.sessions.push(sess);
  P.completeSlot(s, slotId, sess, planned ? done / planned : 1);
  return sess;
}
const GOOD = { effort: 'manageable', reserve: '3', technique: 'controlled', capacity: 'another_set' };
const HARD = { effort: 'maximum', reserve: '0', technique: 'controlled', capacity: 'needed_less' };

function trainingSlots(week) { return week.slots.filter(x => x.kind === 'training'); }
/* Run a whole week; behaviour(i, slot) returns options, or 'skip' */
function runWeek(s, startDate, behaviour) {
  const w = weekAt(s, startDate);
  trainingSlots(w).forEach((slot, i) => {
    const b = behaviour ? behaviour(i, slot) : {};
    if (b === 'skip') return;
    perform(s, slot.id, slot.date, b);
  });
  P.reconcile(s, add(w.end, 1));
  return w;
}
function reviewOf(s, week, checkin, nowDate) {
  return R.buildReport(s, week, checkin || null, msOf(nowDate || week.end, 18), { todayISO: nowDate || week.end });
}
module.exports = { C, E, X, P, R, counters, MON, add, msOf, newUser, weekAt, perform, runWeek, reviewOf, GOOD, HARD, trainingSlots };
