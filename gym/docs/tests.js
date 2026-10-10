/* Recomp test suite. Run: node tests.js   (exit code 1 on any failure) */
const C = require('./core.js');
const E = require('./engine.js');
const X = require('./exercises.js');

let pass = 0, fail = 0; const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
  catch (e) { fail++; failures.push([name, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + name + '\n       ' + e.message); }
}
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m||'') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(v, m) { if (!v) throw new Error(m || 'expected truthy, got ' + v); }
function section(s) { console.log('\n\x1b[1m' + s + '\x1b[0m'); }

/* ---------------------------------------------------------------- helpers */
const EXI = X.EX_INDEX;
function freshState() {
  const s = C.blankState();
  s._exIndex = EXI;
  return s;
}
/* Build a completed session for one variant with explicit per-set actuals. */
function logSession(state, variantId, setSpecs, opts) {
  opts = opts || {};
  const ex = EXI[variantId];
  const sess = C.newSession(ex.day, opts.date || C.todayISO());
  const entry = C.newEntry(variantId, variantId);
  setSpecs.forEach(sp => {
    const set = C.newSet({ weight: sp.pw != null ? sp.pw : sp.w, reps: sp.pr != null ? sp.pr : sp.r });
    if (sp.skip) { set.status = 'skipped'; }
    else { C.editSet(set, sp.w, sp.r); }
    if (sp.warmup) set.warmup = true;
    entry.sets.push(set);
  });
  if (opts.feedback) entry.feedback = Object.assign(E.blankFeedback(), opts.feedback);
  if (opts.decision) entry.decision = opts.decision;
  sess.entries.push(entry);
  sess.status = 'completed';
  sess.endedAt = Date.now();
  if (opts.checkin) sess.checkin = opts.checkin;
  state.sessions.push(sess);
  return sess;
}
function decideFor(state, variantId, checkin, today) {
  const ex = EXI[variantId];
  return E.decide({
    state, ex, variantId,
    checkin: checkin || null,
    todayISO: today || C.todayISO(),
    last: C.lastPerformance(state, variantId, ex)
  });
}
function fb(effort, reserve, technique, capacity, pain) {
  return { effort, reserve, technique, capacity, pain: pain || null, at: Date.now() };
}

/* ========================================================================== */
section('BUG 1 — progression must use comparable working sets, not the heaviest set');

t('mixed loads: working weight is the modal set, not the top single', () => {
  const s = freshState();
  // Three working sets at 60, one heavy single at 100 (a top set).
  logSession(s, 'bench-barbell', [
    { w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }, { w: 100, r: 1 }
  ], { feedback: fb('manageable', '2', 'controlled', 'another_set') });
  const sum = C.summariseEntry(s.sessions[0].entries[0], EXI['bench-barbell']);
  eq(sum.workingWeight, 60, 'working weight');
  eq(sum.topWeight, 100, 'top weight still recorded');
  ok(sum.mixedLoads, 'mixed loads flagged');
  const d = decideFor(s, 'bench-barbell');
  // v5: the load is built off 60, never off the 100 single. Only 3 of the 4 prescribed
  // sets were finished at 60, so the increase is not earned yet: it holds and builds reps.
  eq(d.action, 'hold');
  eq(d.prescription.load, 60, 'next load builds off 60, not 100');
  ok(d.flags.includes('building_reps'));
});

t('four finished sets at 60 plus an extra heavy single still progress from 60', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [
    { w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }, { w: 100, r: 1 }
  ], { feedback: fb('manageable', '2', 'controlled', 'another_set') });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'progress');
  ok(d.prescription.load > 60 && d.prescription.load <= 65, 'builds off 60, got ' + d.prescription.load);
});

t('tie between two loads resolves to the lower (conservative)', () => {
  eq(C.modeWeight([{ actualWeight: 50 }, { actualWeight: 60 }]), 50);
});

t('warm-up sets are excluded from the working weight', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [
    { w: 20, r: 10, warmup: true }, { w: 20, r: 10, warmup: true },
    { w: 70, r: 8 }, { w: 70, r: 8 }, { w: 70, r: 8 }, { w: 70, r: 8 }
  ], { feedback: fb('challenging', '2', 'controlled', 'enough') });
  const sum = C.summariseEntry(s.sessions[0].entries[0], EXI['bench-barbell']);
  eq(sum.workingWeight, 70);
});

/* ========================================================================== */
section('BUG 2 — sessions are dated with stable ids, not keyed by week');

t('the same day can be trained twice in one week, both retained', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 100, r: 5 }, { w: 100, r: 5 }, { w: 100, r: 5 }, { w: 100, r: 5 }],
    { date: '2026-10-05', feedback: fb('challenging', '2', 'controlled') });
  logSession(s, 'squat-barbell', [{ w: 102.5, r: 5 }, { w: 102.5, r: 5 }, { w: 102.5, r: 5 }, { w: 102.5, r: 5 }],
    { date: '2026-10-08', feedback: fb('challenging', '2', 'controlled') });
  eq(s.sessions.length, 2, 'both sessions kept');
  eq(C.historyFor(s, 'squat-barbell').length, 2);
  const last = C.lastPerformance(s, 'squat-barbell', EXI['squat-barbell']);
  eq(last.date, '2026-10-08', 'latest by date wins');
});

t('session ids are unique', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(C.newSession(1).id);
  eq(ids.size, 500);
});

/* ========================================================================== */
section('BUG 3 — suggested values are never recorded as performance without confirmation');

t('a pending set with a plan contributes nothing to history', () => {
  const s = freshState();
  const sess = C.newSession(1, C.todayISO());
  const e = C.newEntry('bench-barbell', 'bench-barbell');
  const set = C.newSet({ weight: 80, reps: 8 });     // suggested, untouched
  e.sets.push(set); sess.entries.push(e); sess.status = 'completed';
  s.sessions.push(sess);
  eq(C.workingSets(e).length, 0, 'no performed sets');
  eq(C.lastPerformance(s, 'bench-barbell', EXI['bench-barbell']), null,
     'an unconfirmed suggestion is not performance');
});

t('confirm copies plan to actual and marks provenance', () => {
  const set = C.newSet({ weight: 80, reps: 8 });
  C.confirmSet(set);
  eq([set.actualWeight, set.actualReps, set.status], [80, 8, 'confirmed']);
});

t('editing to blank records null, it does not inherit the suggestion', () => {
  const set = C.newSet({ weight: 80, reps: 8 });
  C.editSet(set, '', '');
  eq([set.actualWeight, set.actualReps, set.status], [null, null, 'edited']);
});

t('unlogging returns a set to pending with no actuals', () => {
  const set = C.newSet({ weight: 80, reps: 8 });
  C.confirmSet(set); C.unlogSet(set);
  eq([set.actualWeight, set.status], [null, 'pending']);
});

/* ========================================================================== */
section('BUG 4 — records recalculate after a correction');

t('correcting a mistyped 200 kg down to 100 kg lowers the record', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 200, r: 5 }], { date: '2026-10-01' });
  C.recomputeBests(s, EXI);
  eq(C.e1rm(200, 5), s.bests['squat-barbell'].e1rm, 'record set from the typo');
  // user fixes the typo
  s.sessions[0].entries[0].sets[0].actualWeight = 100;
  C.recomputeBests(s, EXI);
  eq(s.bests['squat-barbell'].heaviest, 100, 'heaviest corrected down');
  eq(s.bests['squat-barbell'].e1rm, C.e1rm(100, 5), 'e1RM corrected down');
});

t('deleting a session removes the record it created', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 5 }], { date: '2026-10-01' });
  logSession(s, 'bench-barbell', [{ w: 120, r: 3 }], { date: '2026-10-03' });
  C.recomputeBests(s, EXI);
  eq(s.bests['bench-barbell'].heaviest, 120);
  s.sessions = s.sessions.filter(x => x.date !== '2026-10-03');
  C.recomputeBests(s, EXI);
  eq(s.bests['bench-barbell'].heaviest, 80, 'phantom record cleared');
});

t('assisted exercise records LEAST assistance, not most weight', () => {
  const s = freshState();
  logSession(s, 'assisted-pull-up', [{ w: 30, r: 10 }], { date: '2026-10-01' });
  logSession(s, 'assisted-pull-up', [{ w: 20, r: 10 }], { date: '2026-10-08' });
  C.recomputeBests(s, EXI);
  eq(s.bests['assisted-pull-up'].leastAssist, 20, 'less assistance is the better record');
  eq(s.bests['assisted-pull-up'].heaviest, undefined, 'no weight PR for assisted work');
});

t('timed hold records longest hold; carry records heaviest load', () => {
  const s = freshState();
  logSession(s, 'side-plank-weighted', [{ w: 5, r: 30 }], { date: '2026-10-01' });
  logSession(s, 'farmers-walk', [{ w: 32, r: 40 }], { date: '2026-10-01' });
  C.recomputeBests(s, EXI);
  eq(s.bests['side-plank-weighted'].longestHold, 30);
  eq(s.bests['farmers-walk'].heaviest, 32);
});

/* ========================================================================== */
section('BUG 5 — averages use calendar dates, not the last N entries');

t('three weigh-ins on one day count as one day, not three', () => {
  const s = freshState();
  C.logBodyweight(s, 86.0, '2026-10-10');
  C.logBodyweight(s, 85.8, '2026-10-10');   // same day overwrites
  C.logBodyweight(s, 85.9, '2026-10-10');
  eq(s.bodyweight.length, 1, 'one entry per calendar day');
  eq(s.bodyweight[0].kg, 85.9, 'latest value for the day wins');
});

t('a 60-day-old entry is excluded from the 7-day average', () => {
  const s = freshState();
  C.logBodyweight(s, 95, '2026-08-11');     // long ago
  C.logBodyweight(s, 85, '2026-10-09');
  C.logBodyweight(s, 85.4, '2026-10-10');
  const avg = C.trailingAverage(s, 7, '2026-10-10');
  eq(avg.n, 2, 'only in-window entries');
  eq(Math.round(avg.avg * 10) / 10, 85.2);
});

t('a gap week yields an honest empty window rather than stale numbers', () => {
  const s = freshState();
  C.logBodyweight(s, 86, '2026-09-01');
  const avg = C.trailingAverage(s, 7, '2026-10-10');
  eq(avg.n, 0); eq(avg.avg, null);
});

t('weekly rate of change is computed from two calendar windows', () => {
  const s = freshState();
  for (let i = 0; i < 20; i++) C.logBodyweight(s, 86 - i * 0.05, C.addDays('2026-09-21', i));
  const r = C.weeklyRate(s, 20, '2026-10-10');
  ok(r < 0, 'losing weight, got ' + r);
  ok(Math.abs(r) < 1, 'plausible weekly rate, got ' + r);
});

/* ========================================================================== */
section('BUG 6 — the meal plan is generated from the targets, not fixed');

t('meal plan tracks a change in calorie target', () => {
  const s = freshState();
  C.logBodyweight(s, 86, C.todayISO());
  const a = C.buildMealPlan(C.macroTargets(s));
  s.nutrition.deficitKcal = 800;
  const b = C.buildMealPlan(C.macroTargets(s));
  ok(b.totals.kcal < a.totals.kcal - 150,
     `bigger deficit must shrink the plan: ${a.totals.kcal} -> ${b.totals.kcal}`);
});

t('plan lands within tolerance of its protein and calorie targets', () => {
  const s = freshState();
  C.logBodyweight(s, 86, C.todayISO());
  const tg = C.macroTargets(s);
  const plan = C.buildMealPlan(tg);
  ok(Math.abs(plan.variance.p) <= 15, 'protein within 15 g, got ' + plan.variance.p);
  ok(Math.abs(plan.variance.kcal) <= 250, 'kcal within 250, got ' + plan.variance.kcal);
});

t('targets follow bodyweight down as the trend drops', () => {
  const s = freshState();
  C.logBodyweight(s, 86, C.todayISO());
  const hi = C.macroTargets(s).kcal;
  s.bodyweight = []; C.logBodyweight(s, 80, C.todayISO());
  ok(C.macroTargets(s).kcal < hi, 'lighter bodyweight, lower target');
});

t('calorie floor is enforced', () => {
  const s = freshState();
  C.logBodyweight(s, 50, C.todayISO());
  s.nutrition.deficitKcal = 2000;
  const tg = C.macroTargets(s);
  eq(tg.kcal, 1200); ok(tg.floored);
});

/* ========================================================================== */
section('BUG 7 — timers are wall-clock, so redraws and backgrounding do not drift');

t('remaining time derives from an end timestamp, not tick counting', () => {
  // Model of the shipped timer: end = start + duration; remaining = end - now.
  const start = 1000000, dur = 90000;
  const end = start + dur;
  const remainingAt = now => Math.max(0, Math.ceil((end - now) / 1000));
  eq(remainingAt(start), 90);
  eq(remainingAt(start + 30000), 60);
  // simulate 45 s of the app being backgrounded with zero ticks delivered
  eq(remainingAt(start + 75000), 15, 'no drift across a backgrounded gap');
  eq(remainingAt(start + 200000), 0, 'never goes negative');
});

t('timer state is independent of how many times the list re-renders', () => {
  const timer = { end: 5000 };
  const render = () => ({ left: Math.max(0, Math.ceil((timer.end - 1000) / 1000)) });
  const a = render(), b = render(), c = render();
  eq([a.left, b.left, c.left], [4, 4, 4], 'repeated renders do not reset or advance it');
});

/* ========================================================================== */
section('BUG 8 — backup validation, and "saved" only when verified');

t('round trip restores identical data', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }], { date: '2026-10-01' });
  C.logBodyweight(s, 86, '2026-10-01');
  const bk = C.makeBackup(s);
  const v = C.validateBackup(bk);
  ok(v.ok, 'valid: ' + JSON.stringify(v.errors));
  eq(v.counts.sessions, 1);
  const back = C.migrate(bk.data, { exIndex: EXI });
  eq(back.state.sessions.length, 1);
});

t('corrupted payload is rejected by checksum', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }]);
  const bk = C.makeBackup(s);
  bk.data.sessions[0].entries[0].sets[0].actualWeight = 999;   // tampered
  const v = C.validateBackup(bk);
  ok(!v.ok, 'must reject');
  ok(v.errors.join(' ').includes('Checksum'), v.errors.join(' '));
});

t('a random JSON file is rejected with a reason', () => {
  const v = C.validateBackup({ hello: 'world' });
  ok(!v.ok); ok(v.errors.length >= 1);
});

t('a backup from a future schema is refused rather than mangled', () => {
  const v = C.validateBackup({ format: 'recomp-backup', data: { schemaVersion: 99, sessions: [] } });
  ok(!v.ok); ok(v.errors.join(' ').includes('v99'));
});

t('header/payload count mismatch raises a warning', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }]);
  const bk = C.makeBackup(s);
  bk.counts.sessions = 5;
  const v = C.validateBackup(bk);
  ok(v.ok, 'still structurally valid');
  ok(v.warnings.length === 1, 'mismatch flagged');
});

t('lastBackupVerified starts false and is only set on a verified write', () => {
  const s = freshState();
  eq(s.lastBackupVerified, false);
});

/* ========================================================================== */
section('MIGRATION — v1 to v3');

const V1 = {
  week: 3,
  settings: { weight: 86, deficit: 400, ppk: 2.0 },
  logs: {
    '1:bench': { sets: [{ weight: '60', reps: '8', done: true }, { weight: '60', reps: '8', done: true },
                        { weight: '60', reps: '7', done: true }, { weight: '', reps: '', done: false }],
                 ts: Date.parse('2026-09-07T09:00:00Z') },
    '1:squat': { sets: [{ weight: '100', reps: '5', done: true }, { weight: '100', reps: '5', done: true }],
                 ts: Date.parse('2026-09-08T09:00:00Z') },
    '2:bench': { sets: [{ weight: '62.5', reps: '8', done: true }, { weight: '62.5', reps: '8', done: true }],
                 ts: Date.parse('2026-09-14T09:00:00Z') },
    '3:dead':  { sets: [{ weight: '140', reps: '5', done: true }],
                 ts: Date.parse('2026-09-21T09:00:00Z') }
  },
  bests: { bench: { e1rm: 999, weight: 500, reps: 1, week: 1 } },   // phantom/incorrect
  // Two weigh-ins a couple of hours apart (same local day) plus one a week on.
  bw: [{ d: Date.parse('2026-09-07T00:00:00Z'), kg: 86.2 },
       { d: Date.parse('2026-09-07T02:00:00Z'), kg: 86.0 },
       { d: Date.parse('2026-09-14T00:00:00Z'), kg: 85.6 }],
  lastBackup: null
};

t('v1 is detected and migrated', () => {
  eq(C.detectVersion(V1), 1);
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  ok(r.migrated); eq(r.state.schemaVersion, C.SCHEMA_VERSION); eq(C.SCHEMA_VERSION, 4);
});

t('week-keyed logs become dated sessions', () => {
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  eq(r.state.sessions.length, 4, 'four (week, day) buckets');
  r.state.sessions.forEach(s => { ok(/^\d{4}-\d{2}-\d{2}$/.test(s.date), 'dated: ' + s.date); });
  ok(r.state.sessions.every(s => s.id && s.id.startsWith('s_')), 'stable ids');
});

t('legacy exercise ids are mapped onto the new variants', () => {
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  const ids = new Set();
  r.state.sessions.forEach(s => s.entries.forEach(e => ids.add(e.variantId)));
  ok(ids.has('bench-barbell'), 'bench -> bench-barbell');
  ok(ids.has('squat-barbell'), 'squat -> squat-barbell');
  ok(ids.has('deadlift-conventional'), 'dead -> deadlift-conventional');
  ok(!ids.has('bench'), 'raw legacy id should not survive as a variant');
});

t('performed sets survive, unperformed ones do not become performance', () => {
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  const benchW1 = r.state.sessions.find(s => s.entries.some(e => e.exerciseId === 'bench'));
  const e = benchW1.entries.find(x => x.exerciseId === 'bench');
  eq(C.workingSets(e).length, 3, 'the blank undone 4th set is not performance');
  ok(e.sets.every(x => !C.isPerformed(x) || x.migrated), 'migrated sets carry provenance');
});

t('phantom v1 record is discarded and rebuilt from the real data', () => {
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  ok(!r.state.bests.bench, 'v1 bests not carried over');
  const b = r.state.bests['bench-barbell'];
  ok(b && b.e1rm < 200, 'record rebuilt from the real sets, got ' + JSON.stringify(b));
});

t('same-day duplicate weigh-ins collapse to one', () => {
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  eq(r.state.bodyweight.length, 2, 'two distinct days');
});

t('settings carry into profile and nutrition', () => {
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  eq(r.state.profile.bodyweightKg, 86);
  eq(r.state.nutrition.deficitKcal, 400);
  eq(r.state.nutrition.proteinPerKg, 2.0);
});

t('an audit trail is written', () => {
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  eq(r.state.migrations.length, 2);                 // v1 -> v3, then v3 -> v4
  eq(r.state.migrations[0].from, 1);
  eq(r.state.migrations[1].from, 3);
});

t('migrating twice is not destructive (v3 passes through unchanged)', () => {
  const r1 = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  const r2 = C.migrate(r1.state, { exIndex: EXI });
  eq(r2.migrated, false);
  eq(r2.state.sessions.length, r1.state.sessions.length);
});

t('a future schema version is refused, not mangled', () => {
  const r = C.migrate({ schemaVersion: 99, sessions: [] });
  eq(r.state, null); ok(r.error);
});

/* ========================================================================== */
section('ENGINE — easy session');

t('easy session with reps met and reserve in hand progresses the load', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 70, r: 8 }, { w: 70, r: 8 }, { w: 70, r: 8 }, { w: 70, r: 8 }],
    { feedback: fb('very_easy', '4+', 'controlled', 'another_set') });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'progress');
  ok(d.prescription.load > 70, 'load increased');
  ok(d.explain.what && d.explain.why && d.explain.next, 'what/why/next all present');
  ok(!d.prescription.volumeChanged, 'volume did not increase in the same step');
});

t('the load jump is capped — no large jumps', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 200, r: 8 }, { w: 200, r: 8 }, { w: 200, r: 8 }, { w: 200, r: 8 }],
    { feedback: fb('very_easy', '4+', 'controlled') });
  const d = decideFor(s, 'squat-barbell');
  const jump = d.prescription.load - 200;
  ok(jump <= 200 * 0.05 + 0.01, 'jump ' + jump + ' exceeds the 5% cap');
});

/* ========================================================================== */
section('ENGINE — maximum-effort success must NOT progress');

t('all reps completed at maximum effort holds the load', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb('maximum', '0', 'controlled', 'enough') });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'hold');
  eq(d.prescription.load, 80);
  ok(d.explain.why.toLowerCase().includes('maximum'), d.explain.why);
});

t('near limit with zero in reserve also holds', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb('near_limit', '0', 'controlled') });
  eq(decideFor(s, 'bench-barbell').action, 'hold');
});

t('only one reserve rep is not enough to progress', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb('challenging', '1', 'controlled') });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'hold'); eq(d.prescription.load, 80);
});

t('deteriorating technique blocks progression even with reps and reserve', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 120, r: 8 }, { w: 120, r: 8 }, { w: 120, r: 8 }, { w: 120, r: 8 }],
    { feedback: fb('manageable', '3', 'deteriorating', 'another_set') });
  const d = decideFor(s, 'squat-barbell');
  eq(d.action, 'hold');
  ok(d.flags.includes('technique'));
});

/* ========================================================================== */
section('ENGINE — pain follows a separate pathway');

t('mild pain reduces load and is never averaged into readiness', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb('manageable', '3', 'controlled', 'another_set',
       { present: true, location: 'right shoulder', severity: 3, note: 'pinch at the bottom' }) });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'reduce');
  ok(d.prescription.load < 80, 'load backed off');
  eq(d.pain.pathway, 'separate');
  ok(d.explain.why.includes('never mixed into effort'), d.explain.why);
});

t('severe pain pauses the exercise for review and prescribes nothing', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 120, r: 5 }, { w: 120, r: 5 }],
    { feedback: fb('challenging', '2', 'controlled', 'enough',
       { present: true, location: 'lower back', severity: 7 }) });
  const d = decideFor(s, 'squat-barbell');
  eq(d.action, 'review');
  eq(d.prescription, null);
  ok(d.explain.next.includes('does not diagnose'), 'declines to diagnose');
});

t('readiness excludes pain entirely', () => {
  const withPain = E.readiness({ energy: 4, sleep: 4, soreness: 2, pain: { present: true, severity: 9 } });
  const without = E.readiness({ energy: 4, sleep: 4, soreness: 2 });
  eq(withPain.score, without.score, 'pain must not move the readiness score');
});

t('pain at check-in flags the session without touching readiness', () => {
  const advice = E.sessionPlanAdvice({ energy: 4, sleep: 4, soreness: 2,
    pain: { present: true, location: 'knee' }, timeAvailableMin: 60 }, 60, 6);
  const pa = advice.find(a => a.action === 'pain_review');
  ok(pa, 'pain review raised');
  ok(pa.explain.next.includes('does not diagnose'));
});

/* ========================================================================== */
section('ENGINE — incomplete sets');

t('missing the rep target holds the load', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 7 }, { w: 80, r: 6 }, { w: 80, r: 6 }],
    { feedback: fb('near_limit', '1', 'controlled') });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'hold'); eq(d.prescription.load, 80);
});

t('falling well below the rep range reduces the load', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 90, r: 3 }, { w: 90, r: 3 }, { w: 90, r: 2 }, { w: 90, r: 2 }],
    { feedback: fb('maximum', '0', 'deteriorating') });
  const d = decideFor(s, 'bench-barbell');
  ok(['reduce', 'hold'].includes(d.action), d.action);
  if (d.action === 'reduce') ok(d.prescription.load < 90);
});

t('a skipped set is not counted as a completed one', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { skip: true, w: 80, r: 8 }],
    { feedback: fb('challenging', '2', 'controlled') });
  const sum = C.summariseEntry(s.sessions[0].entries[0], EXI['bench-barbell']);
  eq(sum.performedSets, 2);
});

/* ========================================================================== */
section('ENGINE — missing feedback stays unknown');

t('no feedback at all holds, never progresses', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }]);
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'hold');
  ok(d.flags.includes('unknown_feedback'));
  ok(d.confidence === 'low');
});

t('"unsure" on reserve is treated as unknown, not as zero', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb(null, 'unsure', null, null) });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'hold');
  eq(E.RESERVE_SCALE['unsure'], null, 'unsure maps to null, not 0');
});

t('effort known but reserve unsure can still progress if effort is low', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb('very_easy', 'unsure', 'controlled', 'another_set') });
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'progress');
});

t('first time ever: calibrate, and suggest no load at all', () => {
  const s = freshState();
  const d = decideFor(s, 'bench-barbell');
  eq(d.action, 'calibrate');
  eq(d.prescription.load, null, 'no guessed number');
});

/* ========================================================================== */
section('ENGINE — missed weeks and returning');

t('three weeks away trims the load and flags a return', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 120, r: 5 }, { w: 120, r: 5 }, { w: 120, r: 5 }, { w: 120, r: 5 }],
    { date: '2026-09-10', feedback: fb('challenging', '2', 'controlled') });
  const d = decideFor(s, 'squat-barbell', null, '2026-10-05');   // 25 days
  eq(d.action, 'reduce');
  ok(d.flags.includes('returning'));
  ok(d.prescription.load < 120 && d.prescription.load >= 120 * 0.85 - 2.5,
     'trimmed but capped at 15%: ' + d.prescription.load);
});

t('a long layoff is capped at 15%, not scaled indefinitely', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 120, r: 5 }, { w: 120, r: 5 }, { w: 120, r: 5 }, { w: 120, r: 5 }],
    { date: '2026-01-05', feedback: fb('challenging', '2', 'controlled') });
  const d = decideFor(s, 'squat-barbell', null, '2026-10-05');   // ~9 months
  ok(d.prescription.load >= 120 * 0.85 - 2.5, 'floor respected: ' + d.prescription.load);
});

t('a 6-day gap is normal and does not trigger the return path', () => {
  const s = freshState();
  logSession(s, 'squat-barbell', [{ w: 120, r: 8 }, { w: 120, r: 8 }, { w: 120, r: 8 }, { w: 120, r: 8 }],
    { date: '2026-10-01', feedback: fb('manageable', '3', 'controlled') });
  const d = decideFor(s, 'squat-barbell', null, '2026-10-07');
  eq(d.action, 'progress');
});

/* ========================================================================== */
section('ENGINE — readiness, workload, plateau, deload');

t('low readiness holds a session that would otherwise progress', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb('manageable', '3', 'controlled', 'another_set') });
  const d = decideFor(s, 'bench-barbell', { energy: 1, sleep: 1, soreness: 5 });
  eq(d.action, 'hold');
  ok(d.flags.includes('low_readiness'));
});

t('a real plateau (four comparable sessions, no improvement, feedback recorded) suggests a substitution', () => {
  const s = freshState();
  for (let i = 0; i < 4; i++) {
    logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
      { date: C.addDays('2026-09-01', i * 7),
        feedback: fb('near_limit', '1', 'controlled'), decision: { action: 'hold' } });
  }
  const d = decideFor(s, 'bench-barbell', null, '2026-09-30');
  eq(d.action, 'substitute');
  ok(d.alternatives && d.alternatives.length, 'alternatives offered');
});

t('three holds at the same load is NOT a plateau any more', () => {
  const s = freshState();
  for (let i = 0; i < 3; i++) {
    logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
      { date: C.addDays('2026-09-01', i * 7),
        feedback: fb('near_limit', '1', 'controlled'), decision: { action: 'hold' } });
  }
  const d = decideFor(s, 'bench-barbell', null, '2026-09-22');
  ok(d.action !== 'substitute', 'got ' + d.action);
});

t('deload is proposed, never applied automatically', () => {
  const s = freshState();
  for (let i = 0; i < 30; i++) {
    logSession(s, 'bench-barbell', [{ w: 80, r: 8 }],
      { date: C.addDays('2026-05-01', i * 5), feedback: fb('challenging', '2', 'controlled') });
  }
  const p = E.proposeDeload(s, '2026-10-10');
  ok(p, 'deload proposed');
  ok(p.requiresConfirmation, 'must be confirmed');
  ok(p.explain.next.includes('Decline'), 'declining is offered');
});

/* ========================================================================== */
section('ENGINE — modality-specific behaviour');

t('bodyweight exercise adds reps before load', () => {
  const s = freshState();
  logSession(s, 'pull-up', [{ w: 0, r: 7 }, { w: 0, r: 7 }, { w: 0, r: 7 }, { w: 0, r: 7 }],
    { feedback: fb('manageable', '3', 'controlled') });
  const d = decideFor(s, 'pull-up');
  eq(d.action, 'progress');
  ok(d.flags.includes('progress_reps'), 'reps, not load');
  eq(d.prescription.load, 0);
});

t('at the rep cap, a bodyweight exercise switches to added load', () => {
  const s = freshState();
  logSession(s, 'pull-up', [{ w: 0, r: 12 }, { w: 0, r: 12 }, { w: 0, r: 12 }, { w: 0, r: 12 }],
    { feedback: fb('manageable', '3', 'controlled') });
  const d = decideFor(s, 'pull-up');
  ok(d.flags.includes('progress_load'), 'switches to load at the cap');
});

t('assisted exercise progresses by REDUCING assistance', () => {
  const s = freshState();
  logSession(s, 'assisted-pull-up', [{ w: 30, r: 12 }, { w: 30, r: 12 }, { w: 30, r: 12 }, { w: 30, r: 12 }],
    { feedback: fb('manageable', '3', 'controlled') });
  const d = decideFor(s, 'assisted-pull-up');
  eq(d.action, 'progress');
  ok(d.prescription.load < 30, 'assistance went down, got ' + d.prescription.load);
});

t('timed hold adds seconds before load, then resets the time', () => {
  const s = freshState();
  logSession(s, 'side-plank-weighted', [{ w: 5, r: 20 }, { w: 5, r: 20 }, { w: 5, r: 20 }],
    { feedback: fb('manageable', '3', 'controlled') });
  const a = decideFor(s, 'side-plank-weighted');
  ok(a.flags.includes('progress_time'), 'time first');
  const s2 = freshState();
  logSession(s2, 'side-plank-weighted', [{ w: 5, r: 30 }, { w: 5, r: 30 }, { w: 5, r: 30 }],
    { feedback: fb('manageable', '3', 'controlled') });
  const b = decideFor(s2, 'side-plank-weighted');
  ok(b.flags.includes('progress_load'), 'then load');
  eq(b.prescription.repsLow, 20, 'time resets to the bottom of the range');
});

t('carry keeps distance fixed and moves only the load', () => {
  const s = freshState();
  logSession(s, 'farmers-walk', [{ w: 32, r: 40 }, { w: 32, r: 40 }, { w: 32, r: 40 }],
    { feedback: fb('manageable', '3', 'controlled') });
  const d = decideFor(s, 'farmers-walk');
  eq(d.action, 'progress');
  ok(d.prescription.load > 32, 'load up');
  eq(d.prescription.repsHigh, 40, 'distance unchanged');
  ok(d.explain.next.includes('Distance stays fixed'));
});

/* ========================================================================== */
section('EXPLAINABILITY & data integrity');

t('every decision carries what / why / next and a rule trace', () => {
  const s = freshState();
  const cases = [
    ['bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }], fb('very_easy', '4+', 'controlled')],
    ['bench-barbell', [{ w: 80, r: 4 }, { w: 80, r: 4 }], fb('maximum', '0', 'deteriorating')],
    ['pull-up', [{ w: 0, r: 8 }, { w: 0, r: 8 }], fb('challenging', '2', 'controlled')]
  ];
  cases.forEach(([id, sets, f]) => {
    const st = freshState();
    logSession(st, id, sets, { feedback: f });
    const d = decideFor(st, id);
    ok(d.explain.what, 'what missing for ' + id);
    ok(d.explain.why, 'why missing for ' + id);
    ok(d.explain.next, 'next missing for ' + id);
    ok(Array.isArray(d.trace) && d.trace.length, 'trace missing for ' + id);
  });
});

t('load and volume never increase together', () => {
  const s = freshState();
  logSession(s, 'bench-barbell', [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
    { feedback: fb('very_easy', '4+', 'controlled') });
  const d = decideFor(s, 'bench-barbell');
  ok(d.prescription.load > 80, 'load up');
  eq(d.prescription.sets, EXI['bench-barbell'].sets, 'sets unchanged');
  eq(d.prescription.volumeChanged, false);
});

t('every exercise variant has a unique id, an animation and full guidance', () => {
  const ids = new Set();
  X.EXERCISES.forEach(e => {
    ok(!ids.has(e.id), 'duplicate id ' + e.id); ids.add(e.id);
    ok(e.anim, 'no animation for ' + e.id);
    ok(e.setup && e.setup.length, 'no setup cues for ' + e.id);
    ok(e.execution && e.execution.length, 'no execution cues for ' + e.id);
    ok(e.breathing, 'no breathing cue for ' + e.id);
    ok(e.mistakes && e.mistakes.length, 'no mistakes for ' + e.id);
    ok(e.alternatives && e.alternatives.length, 'no alternatives for ' + e.id);
    ok(e.direction, 'no text alternative for ' + e.id);
    ok(E.MODALITY[e.modality], 'unknown modality for ' + e.id);
  });
});

t('previously combined movements are now separate variants', () => {
  ['lat-pulldown', 'pull-up', 'assisted-pull-up', 'weighted-pull-up',
   'hanging-leg-raise', 'weighted-hanging-leg-raise',
   'deadlift-conventional', 'deadlift-trap-bar',
   'ab-wheel-kneeling', 'ab-wheel-standing'].forEach(id => ok(EXI[id], 'missing ' + id));
});

t('separate variants keep separate histories', () => {
  const s = freshState();
  logSession(s, 'pull-up', [{ w: 0, r: 10 }], { date: '2026-10-01' });
  logSession(s, 'lat-pulldown', [{ w: 60, r: 10 }], { date: '2026-10-02' });
  eq(C.historyFor(s, 'pull-up').length, 1);
  eq(C.historyFor(s, 'lat-pulldown').length, 1);
});

t('every coaching assumption is declared with a basis and a reviewer', () => {
  ok(E.COACHING_ASSUMPTIONS.length >= 8);
  E.COACHING_ASSUMPTIONS.forEach(a => {
    ok(a.claim && a.basis && a.review, 'incomplete assumption ' + a.id);
  });
  ok(E.COACHING_ASSUMPTIONS.some(a => /clinic|physio/i.test(a.review)), 'a clinician review is flagged');
});

/* ========================================================================== */
console.log('\n' + '='.repeat(62));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
if (fail) { failures.forEach(([n, m]) => console.log(` - ${n}\n   ${m}`)); process.exit(1); }
