/* Double progression test suite.
   Run: node gym/test/doubleprog.test.js     (exit code 1 on any failure)

   Most scenarios are END TO END: the engine prescribes a session, sets are
   created from that prescription, the user's actual numbers are logged over
   them, and the next decision is read back. Nothing is hand-fed to the engine
   that the app would not have produced. */
const path = require('path'), fs = require('fs');
const dir = fs.existsSync(path.join(__dirname, '../public/core.js')) ? '../public/' : './';
const C = require(dir + 'core.js');
const E = require(dir + 'engine.js');
const X = require(dir + 'exercises.js');

let pass = 0, fail = 0; const failures = [];
const t = (name, fn) => { try { fn(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
  catch (e) { fail++; failures.push([name, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + name + '\n       ' + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy, got ' + v); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');

const EXI = X.EX_INDEX;
const PD = 'lat-pulldown';      // cable, 3 x 8-12: the 60 kg 3 x 8-12 example
const BENCH = 'bench-barbell';  // barbell, 4 x 5-8
function fresh(profile) {
  const s = C.blankState(); s._exIndex = EXI;
  if (profile) Object.assign(s.profile, profile);
  return s;
}
const fb = (effort, reserve, technique, capacity, pain) =>
  ({ effort, reserve, technique, capacity, pain: pain || null, at: Date.now() });
const GOOD = fb('manageable', '3', 'controlled', 'another_set');

function decideAt(state, id, date, checkin) {
  const ex = EXI[id];
  return E.decide({ state, ex, variantId: id, checkin: checkin || null, todayISO: date,
                    last: C.lastPerformance(state, id, ex) });
}
/* Prescribe, create the sets the app would create, log actuals over them. */
function run(state, id, date, actual, opts) {
  opts = opts || {};
  const ex = EXI[id];
  const d = decideAt(state, id, date, opts.checkin);
  const sess = C.newSession(ex.day, date);
  const entry = C.newEntry(id, id);
  entry.decision = d;
  const p = d.prescription;
  if (p) {
    for (let i = 0; i < p.sets; i++) entry.sets.push(C.newSet({ weight: p.load, reps: p.setTargets[i] }));
    if (p.backoff) for (let i = 0; i < p.backoff.sets; i++)
      entry.sets.push(C.newSet({ weight: p.backoff.load, reps: p.backoff.reps, role: 'backoff' }));
  }
  (actual || []).forEach((a, i) => {
    if (!entry.sets[i]) entry.sets[i] = C.newSet({ weight: null, reps: null });
    const set = entry.sets[i];
    if (a === null) { set.status = 'skipped'; return; }
    const w = typeof a === 'object' ? a.w : (p ? p.load : null);
    const r = typeof a === 'object' ? a.r : a;
    C.editSet(set, w, r);
    if (typeof a === 'object' && a.warmup) set.warmup = true;
  });
  if (opts.feedback !== undefined) entry.feedback = opts.feedback ? Object.assign(E.blankFeedback(), opts.feedback) : null;
  sess.entries.push(entry); sess.status = 'completed'; sess.endedAt = Date.now();
  state.sessions.push(sess);
  return { d, entry, sess };
}
/* A baseline session at an explicit load, with no earlier prescription. */
function seed(state, id, date, w, reps, feedback) {
  const ex = EXI[id];
  const sess = C.newSession(ex.day, date), entry = C.newEntry(id, id);
  reps.forEach(r => { const s = C.newSet({ weight: w, reps: r }); C.editSet(s, w, r); entry.sets.push(s); });
  if (feedback) entry.feedback = Object.assign(E.blankFeedback(), feedback);
  sess.entries.push(entry); sess.status = 'completed'; state.sessions.push(sess);
  return entry;
}
const day = (n) => C.addDays('2026-09-01', n);

/* ========================================================================== */
sec('SETTINGS — stored per exercise variant, defaults preserved');

t('with nothing stored, settings resolve from the exercise and the profile', () => {
  const s = fresh();
  const r = E.resolveSettings(s, EXI[PD]);
  eq([r.method, r.sets, r.repMin, r.repMax], ['double', 3, 8, 12]);
  eq(r.increments, [2.5]); eq(r.minReserve, 2); eq(r.qualifyingSessions, 1);
  eq(r.source, 'default');
});
t('the profile increments and jump limit are the defaults, per equipment', () => {
  const s = fresh({ maxLoadJumpPct: 8 }); s.profile.increments.cable = 1.25;
  const r = E.resolveSettings(s, EXI[PD]);
  eq(r.increments, [1.25]); eq(r.maxJumpPct, 8);
});
t('each modality gets the right default method', () => {
  const s = fresh();
  eq(E.resolveSettings(s, EXI['bench-barbell']).method, 'double');
  eq(E.resolveSettings(s, EXI['pull-up']).method, 'reps');
  eq(E.resolveSettings(s, EXI['side-plank-weighted']).method, 'duration');
  eq(E.resolveSettings(s, EXI['farmers-walk']).method, 'distance');
  eq(E.resolveSettings(s, EXI['assisted-pull-up']).method, 'double');
});
t('settings are separate for different equipment variants of the same movement', () => {
  const s = fresh();
  const r = E.saveExerciseSettings(s, EXI['incline-barbell-press'],
    { method: 'double', sets: 3, repMin: 6, repMax: 10, increments: '1.25, 2.5', minReserve: 2,
      maxEffort: 'challenging', qualifyingSessions: 2, maxJumpPct: 5 }, day(0));
  ok(r.ok, JSON.stringify(r.problems));
  const db = E.resolveSettings(s, EXI['incline-db-press']);
  eq(db.source, 'default'); eq(db.repMax, EXI['incline-db-press'].hi);
  const bb = E.resolveSettings(s, EXI['incline-barbell-press']);
  eq([bb.sets, bb.repMin, bb.repMax, bb.qualifyingSessions, bb.increments], [3, 6, 10, 2, [1.25, 2.5]]);
});
t('histories are separate: a barbell session does not feed the dumbbell prescription', () => {
  const s = fresh();
  seed(s, 'incline-barbell-press', day(0), 60, [8, 8, 8, 8], GOOD);
  eq(decideAt(s, 'incline-db-press', day(3)).action, 'calibrate');
});
t('invalid settings are rejected with reasons and nothing is stored', () => {
  const s = fresh();
  const r = E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 0, repMin: 12, repMax: 8, increments: 'x',
    minReserve: 9, maxEffort: 'nope', qualifyingSessions: 0, maxJumpPct: 99 }, day(0));
  eq(r.ok, false); ok(r.problems.length >= 5, r.problems.join('|'));
  eq(s.exerciseSettings[PD], undefined);
});
t('changing what qualifies restarts qualifying history; changing increments does not', () => {
  const s = fresh();
  const base = { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5], minReserve: 2,
                 maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5 };
  eq(E.saveExerciseSettings(s, EXI[PD], base, day(0)).restartedQualifying, false);   // equals defaults
  eq(E.saveExerciseSettings(s, EXI[PD], Object.assign({}, base, { increments: [1, 2.5] }), day(1)).restartedQualifying, false);
  eq(E.saveExerciseSettings(s, EXI[PD], Object.assign({}, base, { repMax: 15 }), day(2)).restartedQualifying, true);
});

/* ========================================================================== */
sec('DOUBLE PROGRESSION — building reps at a fixed load');

t('partial progress: the load holds, every set adds at most one rep, and the top is not prescribed everywhere', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 12, 10], GOOD);
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'hold'); eq(d.prescription.load, 60);
  eq(d.prescription.setTargets, [12, 12, 11]);
  ok(d.flags.includes('building_reps'));
  ok(d.prescription.setTargets.some(r => r < 12), 'must not prescribe the maximum on every set');
});
t('all sets short of the top each move up one rep, never straight to the maximum', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [9, 8, 8], GOOD);
  eq(decideAt(s, PD, day(3)).prescription.setTargets, [10, 9, 9]);
});
t('the load does not move while reps are still being built, whatever the feedback', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [11, 12, 12], fb('very_easy', '4+', 'controlled', 'another_set'));
  const d = decideAt(s, PD, day(3));
  eq(d.prescription.load, 60); eq(d.action, 'hold');
});
t('a set that is still short pulls the whole increase back, even if two sets hit the top', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 12, 11], GOOD);
  eq(decideAt(s, PD, day(3)).prescription.load, 60);
});
t('one set at 12 and the others lower does not qualify', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 9, 9], GOOD);
  eq(decideAt(s, PD, day(3)).action, 'hold');
});

sec('DOUBLE PROGRESSION — the earned increase');

t('every set at the upper limit earns one available increment and resets reps to the bottom', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'progress'); eq(d.prescription.load, 62.5);
  eq(d.prescription.setTargets, [8, 8, 8]);
  ok(d.flags.includes('progress_load'));
});
t('sets never change in the same step as the load', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  const d = decideAt(s, PD, day(3));
  eq(d.prescription.sets, 3); eq(d.prescription.volumeChanged, false);
  eq(d.prescription.setTargets.length, 3);
});
t('a full chain: build 8 to 12 over sessions, then add weight, then reset', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [8, 8, 8], GOOD);
  const targets = [];
  let date = 3;
  const plan = [[9, 9, 9], [10, 10, 10], [11, 11, 11], [12, 12, 12]];
  plan.forEach(actual => {
    const r = run(s, PD, day(date), actual, { feedback: GOOD });
    targets.push(r.d.prescription.setTargets.join('/') + '@' + r.d.prescription.load);
    date += 3;
  });
  const next = decideAt(s, PD, day(date));
  eq(targets, ['9/9/9@60', '10/10/10@60', '11/11/11@60', '12/12/12@60']);
  eq(next.prescription.load, 62.5); eq(next.prescription.setTargets, [8, 8, 8]);
});
t('the increase is judged at the PRESCRIBED load, not whatever was typed', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  run(s, PD, day(3), [62.5, 62.5, 62.5].map(w => ({ w, r: 10 })), { feedback: GOOD });   // prescribed 62.5, did 10s
  const d = decideAt(s, PD, day(6));
  eq(d.prescription.load, 62.5); eq(d.action, 'hold');
});
t('qualifying sessions: one clean session is recorded but not rewarded when two are required', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 2, maxJumpPct: 5 }, day(-1));
  seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  const a = decideAt(s, PD, day(3));
  eq(a.action, 'hold'); ok(a.flags.includes('qualifying_wait'));
  ok(/1 of 2/.test(a.explain.what), a.explain.what);
  eq(a.progression.qualifying, { have: 1, need: 2 });
  run(s, PD, day(3), [12, 12, 12], { feedback: GOOD });
  const b = decideAt(s, PD, day(6));
  eq(b.action, 'progress'); eq(b.prescription.load, 62.5);
});
t('a failed session in between resets the qualifying count', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 2, maxJumpPct: 5 }, day(-1));
  seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  run(s, PD, day(3), [12, 12, 11], { feedback: GOOD });
  run(s, PD, day(6), [12, 12, 12], { feedback: GOOD });
  eq(decideAt(s, PD, day(9)).action, 'hold');          // only 1 qualifying session since the miss
});

/* ========================================================================== */
sec('WARM-UPS, SKIPPED AND INCOMPLETE SETS');

t('warm-up sets never count towards qualifying', () => {
  const s = fresh();
  const ex = EXI[PD], sess = C.newSession(ex.day, day(0)), e = C.newEntry(PD, PD);
  [{ w: 30, r: 12, warmup: true }, { w: 60, r: 12 }, { w: 60, r: 12 }, { w: 60, r: 10 }].forEach(a => {
    const st = C.newSet({ weight: a.w, reps: a.r }); C.editSet(st, a.w, a.r); if (a.warmup) st.warmup = true; e.sets.push(st);
  });
  e.feedback = Object.assign(E.blankFeedback(), GOOD); sess.entries.push(e); sess.status = 'completed'; s.sessions.push(sess);
  eq(decideAt(s, PD, day(3)).prescription.load, 60);       // the 12-rep warm-up must not complete the set count
  eq(decideAt(s, PD, day(3)).action, 'hold');
});
t('a skipped set means the load is not earned', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [11, 11, 11], GOOD);
  run(s, PD, day(3), [{ w: 60, r: 12 }, { w: 60, r: 12 }, null], { feedback: GOOD });   // third set skipped
  const d = decideAt(s, PD, day(6));
  eq(d.action, 'hold'); ok(d.flags.includes('building_reps'));
});
t('an unconfirmed (pending) set is not performance', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [11, 11, 11], GOOD);
  run(s, PD, day(3), [60, 60].map(w => ({ w, r: 12 })), { feedback: GOOD });   // third set left pending
  const d = decideAt(s, PD, day(6));
  eq(d.action, 'hold'); ok(d.flags.includes('building_reps'));
});
t('more sets than prescribed do not hide a missing top set', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 12, 8, 12], GOOD);       // 3 of the 4 sets hit 12; need 3 -> fine
  eq(decideAt(s, PD, day(3)).action, 'progress');
  const s2 = fresh();
  seed(s2, PD, day(0), 60, [12, 8, 8, 12], GOOD);       // only 2 hit 12; need 3
  eq(decideAt(s2, PD, day(3)).action, 'hold');
});

sec('MIXED LOADS AND BACK-OFF SETS');

t('a heavy first set followed by lighter sets does NOT qualify at the heavier load', () => {
  const s = fresh();
  const e = seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  e.sets.forEach(x => { x.plannedWeight = 60; });
  C.editSet(e.sets[0], 65, 12);                          // heavy opener
  C.editSet(e.sets[1], 55, 12); C.editSet(e.sets[2], 55, 12);   // lighter, unplanned sets
  const d = decideAt(s, PD, day(3));
  ok(d.prescription.load <= 60, 'must not build off the 65 opener: ' + d.prescription.load);
  ok(d.prescription.load !== 67.5);
});
t('a heavier opener over a prescribed 60 does not stop the 60 being earned', () => {
  const s = fresh();
  const e = seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  C.editSet(e.sets[0], 62.5, 12);
  const d = decideAt(s, PD, day(3));
  eq(d.prescription.load, 62.5);                         // earned from 60, not 62.5+2.5
  ok(d.action === 'progress');
});
t('lighter sets below the prescribed load are not completed sets at that load', () => {
  const s = fresh();
  const e = seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  e.sets.forEach(x => { x.plannedWeight = 60; });
  C.editSet(e.sets[2], 55, 12);
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'hold'); eq(d.prescription.load, 60);
});
t('a deliberate back-off prescription is created separately from the working sets', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5, backoff: { sets: 2, pct: 85 } }, day(-1));
  seed(s, PD, day(0), 60, [10, 10, 10], GOOD);
  const r = run(s, PD, day(3), [11, 11, 11], { feedback: GOOD });
  const bo = r.d.prescription.backoff;
  eq(bo.sets, 2); eq(bo.load, 50); eq(bo.pct, 85);
  eq(r.entry.sets.filter(x => x.role === 'backoff').length, 2);
  eq(r.entry.sets.filter(x => x.role !== 'backoff').length, 3);
});
t('back-off sets never qualify the top load', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5, backoff: { sets: 2, pct: 85 } }, day(-1));
  seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
  // two top sets + two back-off sets at 12 each: only 2 of the 3 required top sets exist
  const r = run(s, PD, day(3), [12, 12, null, { w: 50, r: 12 }, { w: 50, r: 12 }], { feedback: GOOD });
  const d = decideAt(s, PD, day(6));
  eq(d.action, 'hold'); eq(d.prescription.load, r.d.prescription.load);
});
t('back-off sets do not set the next working load', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5, backoff: { sets: 2, pct: 85 } }, day(-1));
  seed(s, PD, day(0), 60, [10, 10, 10], GOOD);
  run(s, PD, day(3), [11, 11, 11, { w: 50, r: 15 }, { w: 50, r: 15 }], { feedback: GOOD });
  const d = decideAt(s, PD, day(6));
  eq(d.prescription.load, 60);        // modal weight would be 50 if back-offs counted: 3 vs 2? top is 3, so also check summary
  eq(C.summariseEntry(s.sessions[1].entries[0], EXI[PD]).workingWeight, 60);
});

/* ========================================================================== */
sec('FEEDBACK AND RECOVERY — blocks on progression');

const ALL_TOP = [12, 12, 12];
const blocked = (feedback, expectFlag, extra) => () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, feedback);
  const d = decideAt(s, PD, day(3));
  ok(d.action !== 'progress', 'must not progress, got ' + d.action);
  ok(d.prescription == null || d.prescription.load <= 60, 'load must not rise');
  if (expectFlag) ok(d.flags.includes(expectFlag), 'flags: ' + d.flags.join(','));
  if (extra) extra(d);
};
t('excessive effort (maximum) holds even though every rep was hit', blocked(fb('maximum', '0', 'controlled', 'enough'), 'maximal_effort', d => {
  eq(d.prescription.load, 60); eq(d.prescription.setTargets, [12, 12, 12]);
}));
t('zero reps in reserve holds', blocked(fb('challenging', '0', 'controlled'), 'maximal_effort'));
t('one rep in reserve holds when two are required', blocked(fb('challenging', '1', 'controlled'), null, d => eq(d.action, 'hold')));
t('effort above the exercise limit holds (limit set to "challenging")', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'challenging', qualifyingSessions: 1, maxJumpPct: 5 }, day(-1));
  seed(s, PD, day(0), 60, ALL_TOP, fb('near_limit', '3', 'controlled', 'enough'));
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'hold'); ok(d.flags.includes('effort_high'));
});
t('the reserve requirement is configurable per exercise', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 1, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5 }, day(-1));
  seed(s, PD, day(0), 60, ALL_TOP, fb('challenging', '1', 'controlled'));
  eq(decideAt(s, PD, day(3)).action, 'progress');
});
t('deteriorating technique blocks the increase', blocked(fb('manageable', '3', 'deteriorating', 'another_set'), 'technique', d => eq(d.prescription.load, 60)));
t('"needed less" blocks the increase and never raises the load', blocked(fb('manageable', '3', 'controlled', 'needed_less'), 'needed_less'));
t('"needed less" with a hard session eases the load back', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, fb('near_limit', '1', 'controlled', 'needed_less'));
  const d = decideAt(s, PD, day(3));
  ok(d.prescription.load <= 60);
});
t('mild pain reduces the load, on its own pathway', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, fb('manageable', '3', 'controlled', 'another_set',
    { present: true, location: 'Shoulder', severity: 2 }));
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'reduce'); ok(d.prescription.load < 60);
  ok(d.explain.next.toLowerCase().includes('does not diagnose'));
});
t('concerning pain pauses the exercise: no prescription at all', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, fb('manageable', '3', 'controlled', 'another_set',
    { present: true, location: 'Shoulder', severity: 3, sharp: true }));
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'review'); eq(d.prescription, null); eq(d.paused, true);
});
t('an unresolved pain concern still blocks after a quiet session', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [10, 10, 10], fb('manageable', '3', 'controlled', 'another_set',
    { present: true, location: 'Elbow', severity: 6, sharp: true }));
  decideAt(s, PD, day(1));                                    // opens the concern
  seed(s, PD, day(3), 60, ALL_TOP, GOOD);
  eq(decideAt(s, PD, day(6)).action, 'review');
});
t('a clean session never adds load AND sets in one step', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'progress'); eq(d.prescription.sets, 3);
  ok(!d.flags.includes('progress_sets'));
});

sec('MISSING FEEDBACK STAYS UNKNOWN');

t('no feedback at all: holds, and the progress panel shows the requirement as unknown, not met', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, null);
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'hold'); ok(d.flags.includes('unknown_feedback'));
  const eff = d.progression.requirements.find(r => r.id === 'effort');
  eq(eff.met, null);
  eq(d.progression.requirements.find(r => r.id === 'technique').met, null);
});
t('technique alone is not enough feedback', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, { effort: null, reserve: null, technique: 'controlled', capacity: null });
  eq(decideAt(s, PD, day(3)).action, 'hold');
});
t('"unsure" reserve with no effort stays unknown', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, { effort: null, reserve: 'unsure', technique: 'controlled', capacity: null });
  eq(decideAt(s, PD, day(3)).action, 'hold');
});
t('technique can be made mandatory per exercise', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5, requireTechnique: true }, day(-1));
  seed(s, PD, day(0), 60, ALL_TOP, { effort: 'manageable', reserve: '3', technique: null, capacity: null });
  eq(decideAt(s, PD, day(3)).action, 'hold');
});

/* ========================================================================== */
sec('EQUIPMENT INCREMENTS AND THE PROGRESSION LIMIT');

t('the smallest increment over the limit: the load holds and the constraint is explained', () => {
  const s = fresh({ maxLoadJumpPct: 5 });
  seed(s, PD, day(0), 30, ALL_TOP, GOOD);           // 2.5 kg on 30 kg is 8.3%
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'hold'); eq(d.prescription.load, 30);
  ok(d.flags.includes('increment_blocked'));
  ok(/smallest increment/.test(d.explain.why) && /8%/.test(d.explain.why), d.explain.why);
  eq(d.progression.status, 'blocked');
});
t('it never invents an unavailable weight', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5, 5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 10 }, day(-1));
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  const d = decideAt(s, PD, day(3));
  ok([62.5, 65].includes(d.prescription.load), 'got ' + d.prescription.load);
  eq(d.prescription.load, 62.5);        // smallest available that fits
});
t('a smaller available increment is used when it fits the limit', () => {
  const s = fresh({ maxLoadJumpPct: 5 });
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [1, 2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5 }, day(-1));
  seed(s, PD, day(0), 30, ALL_TOP, GOOD);           // 2.5 is over 5% of 30 but 1 fits
  eq(decideAt(s, PD, day(3)).prescription.load, 31);
});
t('raising the limit unlocks the larger increment', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 10 }, day(-1));
  seed(s, PD, day(0), 30, ALL_TOP, GOOD);
  eq(decideAt(s, PD, day(3)).prescription.load, 32.5);
});
t('the limit holds across the chain: no step exceeds it', () => {
  const s = fresh({ maxLoadJumpPct: 5 });
  seed(s, 'squat-barbell', day(0), 100, [8, 8, 8, 8], GOOD);
  const d = decideAt(s, 'squat-barbell', day(3));
  ok(d.prescription.load - 100 <= 5.0001);
});

/* ========================================================================== */
sec('DELOAD AND RETURN AFTER A BREAK take precedence');

t('an accepted deload overrides an earned increase', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  E.acceptDeload(s, day(2));
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'deload'); ok(d.prescription.load < 60);
});
t('after a deload the first session goes back to the pre-deload load and does not progress', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [11, 11, 11], GOOD);
  E.acceptDeload(s, day(3));
  run(s, PD, day(4), [12, 12, 12], { feedback: GOOD });             // deload week, easy and clean
  const after = decideAt(s, PD, day(12));                            // window over
  eq(after.action, 'hold'); ok(after.flags.includes('post_deload'));
  eq(after.prescription.load, 60); eq(after.prescription.setTargets, [11, 11, 11]);
});
t('a deload session is not evidence of a plateau', () => {
  const s = fresh();
  for (let i = 0; i < 4; i++) seed(s, PD, day(i * 7), 60, [9, 9, 9], GOOD).decision = { action: 'deload' };
  eq(E.detectPlateau(s, PD, E.resolveSettings(s, EXI[PD]), EXI[PD], day(30)), null);
});
t('a long break trims the load and never progresses, whatever the last session looked like', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  const d = decideAt(s, PD, day(30));
  eq(d.action, 'reduce'); ok(d.flags.includes('returning'));
  ok(d.prescription.load < 60 && d.prescription.load >= 60 * 0.85 - 2.5, String(d.prescription.load));
  eq(d.prescription.setTargets.length, 3);
  ok(d.prescription.setTargets.every(r => r < 12), 'easing back is not the top of the range');
});
t('a normal gap does not trigger the return rule', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  eq(decideAt(s, PD, day(8)).action, 'progress');
});
t('low readiness holds today without erasing the earned increase', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  const d = decideAt(s, PD, day(3), { energy: 1, sleep: 1, soreness: 5 });
  eq(d.action, 'hold'); ok(d.flags.includes('low_readiness'));
  eq(decideAt(s, PD, day(3)).action, 'progress');
});

/* ========================================================================== */
sec('REPS AT THE SAME WEIGHT ARE PROGRESS — and a stall is not just "weight unchanged"');

const settingsFor = (s, id) => E.resolveSettings(s, EXI[id]);
t('rep gains at one load over four sessions are not a plateau', () => {
  const s = fresh();
  [[8, 8, 8], [9, 9, 9], [10, 10, 10], [11, 11, 11]].forEach((r, i) => seed(s, PD, day(i * 7), 60, r, GOOD));
  eq(E.detectPlateau(s, PD, settingsFor(s, PD), EXI[PD], day(30)), null);
  const d = decideAt(s, PD, day(30 - 22));
  ok(d.action !== 'substitute', 'got ' + d.action);
});
t('the same weight for six sessions with rising reps is never called stalled', () => {
  const s = fresh();
  [[8,8,8],[8,8,9],[9,9,9],[9,10,10],[10,10,10],[11,10,10]].forEach((r, i) => seed(s, PD, day(i * 7), 60, r, GOOD));
  eq(E.detectPlateau(s, PD, settingsFor(s, PD), EXI[PD], day(60)), null);
});
t('genuinely flat comparable performance, with feedback, over enough time IS a plateau', () => {
  const s = fresh();
  for (let i = 0; i < 4; i++) seed(s, PD, day(i * 7), 60, [9, 9, 9], fb('challenging', '2', 'controlled'));
  const p = E.detectPlateau(s, PD, settingsFor(s, PD), EXI[PD], day(30));
  ok(p && p.sessions === 4 && p.spanDays === 21, JSON.stringify(p));
  eq(decideAt(s, PD, day(22)).action, 'substitute');
});
t('flat performance with no feedback recorded is unknown, not a plateau', () => {
  const s = fresh();
  for (let i = 0; i < 4; i++) seed(s, PD, day(i * 7), 60, [9, 9, 9], null);
  eq(E.detectPlateau(s, PD, settingsFor(s, PD), EXI[PD], day(30)), null);
});
t('four sessions squeezed into ten days is not enough history', () => {
  const s = fresh();
  for (let i = 0; i < 4; i++) seed(s, PD, day(i * 3), 60, [9, 9, 9], fb('challenging', '2', 'controlled'));
  eq(E.detectPlateau(s, PD, settingsFor(s, PD), EXI[PD], day(20)), null);
});
t('three sessions are never enough', () => {
  const s = fresh();
  for (let i = 0; i < 3; i++) seed(s, PD, day(i * 10), 60, [9, 9, 9], fb('challenging', '2', 'controlled'));
  eq(E.detectPlateau(s, PD, settingsFor(s, PD), EXI[PD], day(40)), null);
});
t('adding weight counts as improvement even if reps drop', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [9, 9, 9], fb('challenging', '2', 'controlled'));
  seed(s, PD, day(7), 60, [9, 9, 9], fb('challenging', '2', 'controlled'));
  seed(s, PD, day(14), 60, [9, 9, 9], fb('challenging', '2', 'controlled'));
  seed(s, PD, day(21), 65, [8, 8, 8], fb('challenging', '2', 'controlled'));
  eq(E.detectPlateau(s, PD, settingsFor(s, PD), EXI[PD], day(30)), null);
});

/* ========================================================================== */
sec('OTHER EXERCISE TYPES keep their own rules');

t('assisted: assistance only drops once every set reaches the top, then reps reset', () => {
  const s = fresh();
  seed(s, 'assisted-pull-up', day(0), 30, [10, 10, 10, 10], GOOD);
  const hold = decideAt(s, 'assisted-pull-up', day(3));
  eq(hold.action, 'hold'); eq(hold.prescription.load, 30);
  const s2 = fresh();
  seed(s2, 'assisted-pull-up', day(0), 30, [12, 12, 12, 12], GOOD);
  const up = decideAt(s2, 'assisted-pull-up', day(3));
  eq(up.action, 'progress'); ok(up.prescription.load < 30, 'assistance down');
  eq(up.prescription.setTargets, [8, 8, 8, 8]);
});
t('assisted: sets done with MORE assistance than prescribed are not at the load', () => {
  const s = fresh();
  const e = seed(s, 'assisted-pull-up', day(0), 30, [12, 12, 12, 12], GOOD);
  e.sets.forEach(x => { x.plannedWeight = 30; });
  C.editSet(e.sets[3], 40, 12);
  eq(decideAt(s, 'assisted-pull-up', day(3)).action, 'hold');
});
t('bodyweight reps: reps climb, then load is added at the cap (default)', () => {
  const s = fresh();
  seed(s, 'pull-up', day(0), 0, [7, 7, 7, 7], GOOD);
  ok(decideAt(s, 'pull-up', day(3)).flags.includes('progress_reps'));
  const s2 = fresh();
  seed(s2, 'pull-up', day(0), 0, [12, 12, 12, 12], GOOD);
  ok(decideAt(s2, 'pull-up', day(3)).flags.includes('progress_load'));
});
t('reps-only method never adds load', () => {
  const s = fresh();
  const ex = EXI['pull-up'];
  E.saveExerciseSettings(s, ex, { method: 'reps', sets: ex.sets, repMin: ex.lo, repMax: ex.hi, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5, addLoadAtCap: false }, day(-1));
  seed(s, 'pull-up', day(0), 0, [12, 12, 12, 12], GOOD);
  const d = decideAt(s, 'pull-up', day(3));
  eq(d.action, 'hold'); eq(d.prescription.load, 0); ok(d.flags.includes('reps_cap'));
});
t('timed holds build seconds, then add load and reset the time', () => {
  const s = fresh();
  seed(s, 'side-plank-weighted', day(0), 5, [20, 20, 20], GOOD);
  ok(decideAt(s, 'side-plank-weighted', day(3)).flags.includes('progress_time'));
  const s2 = fresh();
  seed(s2, 'side-plank-weighted', day(0), 5, [30, 30, 30], GOOD);
  const b = decideAt(s2, 'side-plank-weighted', day(3));
  ok(b.flags.includes('progress_load')); eq(b.prescription.repsLow, 20);
});
t('carries keep a fixed distance and move load; the over-limit exception is loud and switchable', () => {
  const s = fresh();
  seed(s, 'farmers-walk', day(0), 32, [40, 40, 40], GOOD);
  const d = decideAt(s, 'farmers-walk', day(3));
  eq(d.action, 'progress'); ok(d.prescription.load > 32);
  ok(d.flags.includes('increment_over_cap'));
  const s2 = fresh(); const ex = EXI['farmers-walk'];
  E.saveExerciseSettings(s2, ex, { method: 'distance', sets: ex.sets, repMin: ex.lo, repMax: ex.hi, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5, strictLimit: true }, day(-1));
  seed(s2, 'farmers-walk', day(0), 32, [40, 40, 40], GOOD);
  const d2 = decideAt(s2, 'farmers-walk', day(3));
  eq(d2.prescription.load, 32);
});
t('manual: the app never changes the load, however good the last session was', () => {
  const s = fresh();
  E.saveExerciseSettings(s, EXI[PD], { method: 'manual', sets: 3, repMin: 8, repMax: 12, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5 }, day(-1));
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  const d = decideAt(s, PD, day(3));
  eq(d.action, 'hold'); eq(d.prescription.load, 60); ok(d.flags.includes('manual'));
  eq(d.progression.status, 'manual');
});

/* ========================================================================== */
sec('THE WORKOUT SUMMARY the interface shows');

t('header, last time, today and what is still required', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [12, 12, 10], GOOD);
  const p = decideAt(s, PD, day(3)).progression;
  eq(p.header, '60 kg · 3 × 8–12');
  eq(p.lastText, 'Last time: 12 / 12 / 10');
  eq(p.todayText, 'Today: 12 / 12 / 11');
  ok(/^Next weight increase: complete all 3 sets at 12 reps with controlled technique/.test(p.nextText), p.nextText);
  eq(p.requirements.find(r => r.id === 'sets').met, true);
  eq(p.requirements.find(r => r.id === 'reps').met, false);
  eq(p.status, 'building');
});
t('the proposed next load and rep target are shown when earned', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  const p = decideAt(s, PD, day(3)).progression;
  eq(p.status, 'earned'); eq(p.header, '62.5 kg · 3 × 8–12');
  eq(p.todayText, 'Today: 8 / 8 / 8');
  ok(/Reps reset to 8 on all 3 sets/.test(p.nextText), p.nextText);
});
t('the proposed next load is previewed while still building', () => {
  const s = fresh();
  seed(s, PD, day(0), 60, [10, 10, 10], GOOD);
  const p = decideAt(s, PD, day(3)).progression;
  eq(p.nextIncrease, { allowed: true, to: 62.5, delta: 2.5, repsAfter: 8 });
  ok(/Then 62.5 kg × 8–12/.test(p.nextText), p.nextText);
});
t('a blocked increase says why instead of promising one', () => {
  const s = fresh();
  seed(s, PD, day(0), 30, ALL_TOP, GOOD);
  const p = decideAt(s, PD, day(3)).progression;
  eq(p.status, 'blocked'); ok(/progression limit/.test(p.nextText), p.nextText);
});
t('previous reps are shown for each set, including mixed loads', () => {
  const s = fresh();
  const e = seed(s, PD, day(0), 60, [12, 12, 10], GOOD);
  C.editSet(e.sets[0], 65, 12);
  ok(/12 × 65 kg/.test(decideAt(s, PD, day(3)).progression.lastText));
});

/* ========================================================================== */
sec('ACCEPT / HOLD / EDIT — recorded separately from the recommendation');

function earnedEntry() {
  const s = fresh();
  seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  const ex = EXI[PD];
  const d = decideAt(s, PD, day(3));
  const entry = C.newEntry(PD, PD); entry.decision = d;
  for (let i = 0; i < d.prescription.sets; i++) entry.sets.push(C.newSet({ weight: d.prescription.load, reps: d.prescription.setTargets[i] }));
  return { s, entry, d, settings: E.resolveSettings(s, ex) };
}
t('accept keeps the recommendation and records that it was accepted', () => {
  const { entry, settings } = earnedEntry();
  const r = E.applyProgressionChoice(entry, 'accept', null, settings, 1);
  ok(r.ok); eq(entry.progressionChoice.chosen, 'accepted');
  eq(entry.sets[0].plannedWeight, 62.5);
});
t('hold goes back to the previous load and repeats last time\'s reps', () => {
  const { entry, d, settings } = earnedEntry();
  const before = JSON.stringify(entry.decision);
  const r = E.applyProgressionChoice(entry, 'hold', null, settings, 1);
  ok(r.ok); eq(entry.progressionChoice.chosen, 'held');
  entry.sets.forEach(x => { eq(x.plannedWeight, 60); eq(x.plannedReps, 12); });
  eq(JSON.stringify(entry.decision), before, 'the automatic recommendation must be untouched');
  eq(entry.progressionChoice.recommended.load, 62.5);
});
t('edit applies the user\'s numbers and records them as a manual change', () => {
  const { entry, settings } = earnedEntry();
  const r = E.applyProgressionChoice(entry, 'edit', { load: 61, setTargets: [9, 9, 8] }, settings, 1);
  ok(r.ok); eq(entry.progressionChoice.chosen, 'edited');
  eq(entry.sets.map(x => x.plannedReps), [9, 9, 8]); eq(entry.sets[0].plannedWeight, 61);
  eq(entry.progressionChoice.recommended.load, 62.5, 'recommendation preserved beside it');
  eq(entry.decision.prescription.load, 62.5);
});
t('edit may not raise the load and add a set in the same step', () => {
  const { entry, settings } = earnedEntry();
  const r = E.applyProgressionChoice(entry, 'edit', { load: 65, setTargets: [8, 8, 8, 8] }, settings, 1);
  eq(r.ok, false); ok(/load and add sets/i.test(r.problems[0]), r.problems.join('|'));
  eq(entry.progressionChoice, undefined); eq(entry.sets.length, 3);
});
t('edit may add a set when the load is not raised', () => {
  const { entry, settings } = earnedEntry();
  const r = E.applyProgressionChoice(entry, 'edit', { load: 60, setTargets: [10, 10, 10, 10] }, settings, 1);
  ok(r.ok); eq(entry.sets.length, 4);
});
t('a manual jump over the limit is allowed but warned about and recorded', () => {
  const { entry, settings } = earnedEntry();
  const r = E.applyProgressionChoice(entry, 'edit', { load: 70, setTargets: [8, 8, 8] }, settings, 1);
  ok(r.ok); ok(r.warnings.some(w => /progression limit/.test(w)), r.warnings.join('|'));
  ok(entry.progressionChoice.warnings.length);
});
t('invalid edits are refused and change nothing', () => {
  const { entry, settings } = earnedEntry();
  const snap = JSON.stringify(entry.sets);
  eq(E.applyProgressionChoice(entry, 'edit', { load: -5, setTargets: [8, 8, 8] }, settings, 1).ok, false);
  eq(E.applyProgressionChoice(entry, 'edit', { load: 60, setTargets: [] }, settings, 1).ok, false);
  eq(JSON.stringify(entry.sets), snap);
});
t('performed sets are never rewritten by a choice', () => {
  const { entry, settings } = earnedEntry();
  C.editSet(entry.sets[0], 62.5, 8);
  E.applyProgressionChoice(entry, 'hold', null, settings, 1);
  eq([entry.sets[0].actualWeight, entry.sets[0].actualReps], [62.5, 8]);
  eq(entry.sets[0].plannedWeight, 62.5, 'a performed set keeps what was planned for it');
  eq(entry.sets[1].plannedWeight, 60);
});

/* ========================================================================== */
sec('HISTORY IS NEVER REWRITTEN');

function chain() {
  const s = fresh();
  seed(s, PD, day(0), 60, [10, 10, 10], GOOD);
  run(s, PD, day(3), [11, 11, 11], { feedback: GOOD });
  run(s, PD, day(6), [12, 12, 12], { feedback: GOOD });
  return s;
}
const snapshotPrescriptions = s => JSON.stringify(s.sessions.map(x => x.entries.map(e =>
  ({ d: e.decision, planned: e.sets.map(k => [k.plannedWeight, k.plannedReps]) }))));
t('editing a past set recalculates the next recommendation but not any recorded prescription', () => {
  const s = chain();
  const before = snapshotPrescriptions(s);
  eq(decideAt(s, PD, day(9)).action, 'progress');
  C.editSet(s.sessions[2].entries[0].sets[2], 60, 9);       // correct a typo in the latest session
  eq(snapshotPrescriptions(s), before, 'prescriptions and planned values must not change');
  const d = decideAt(s, PD, day(9));
  eq(d.action, 'hold'); eq(d.prescription.load, 60);
});
t('un-logging a set changes the next decision, not the recorded decision', () => {
  const s = chain();
  const before = snapshotPrescriptions(s);
  C.unlogSet(s.sessions[2].entries[0].sets[1]);
  eq(snapshotPrescriptions(s), before);
  eq(decideAt(s, PD, day(9)).action, 'hold');
});
t('changing exercise settings later never alters completed sessions', () => {
  const s = chain();
  const before = JSON.stringify(s.sessions);
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 4, repMin: 6, repMax: 15, increments: [1.25],
    minReserve: 3, maxEffort: 'challenging', qualifyingSessions: 3, maxJumpPct: 3 }, day(10));
  eq(JSON.stringify(s.sessions), before);
});
t('a settings change restarts what qualifies, so old sessions stop counting', () => {
  const s = chain();
  eq(decideAt(s, PD, day(9)).action, 'progress');
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 15, increments: [2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5 }, day(8));
  const d = decideAt(s, PD, day(9));
  eq(d.action, 'hold');                   // 12 reps is no longer the top of the range
  eq(d.prescription.setTargets, [13, 13, 13]);
});
t('the decision recorded at prescription time keeps its own explanation after history changes', () => {
  const s = chain();
  const e = s.sessions[2].entries[0];
  const what = e.decision.explain.what;
  C.editSet(s.sessions[0].entries[0].sets[0], 40, 10);
  eq(e.decision.explain.what, what);
});

/* ========================================================================== */
sec('MIGRATION — v3 to v4 keeps everything');

t('sessions, sets, feedback, decisions and profile come through unchanged', () => {
  const s = chain();
  s.profile.increments.cable = 1.25; s.profile.maxLoadJumpPct = 7;
  const v3 = JSON.parse(JSON.stringify(s));
  v3.schemaVersion = 3; delete v3.exerciseSettings;
  const r = C.migrate(v3);
  ok(r.migrated); eq(r.from, 3); eq(r.state.schemaVersion, 4);
  eq(JSON.stringify(r.state.sessions), JSON.stringify(v3.sessions), 'sessions must be byte-identical');
  eq(r.state.profile.increments.cable, 1.25); eq(r.state.profile.maxLoadJumpPct, 7);
  eq(r.state.exerciseSettings, {});
  const m = r.state.migrations[r.state.migrations.length - 1];
  eq([m.from, m.to, m.sessions], [3, 4, 3]);
  eq(m.sets, 9);
});
t('after migrating, existing exercises behave exactly as before', () => {
  const s = chain();
  const v3 = JSON.parse(JSON.stringify(s)); v3.schemaVersion = 3; delete v3.exerciseSettings;
  const m = C.migrate(v3).state; m._exIndex = EXI;
  const a = decideAt(s, PD, day(9)), b = decideAt(m, PD, day(9));
  eq(b.action, a.action); eq(b.prescription.load, a.prescription.load);
  eq(b.prescription.setTargets, a.prescription.setTargets);
});
t('the profile increment for the equipment migrates into the exercise\'s available increments', () => {
  const v3 = JSON.parse(JSON.stringify(chain())); v3.schemaVersion = 3; delete v3.exerciseSettings;
  v3.profile.increments.cable = 1.25;
  const m = C.migrate(v3).state;
  eq(E.resolveSettings(m, EXI[PD]).increments, [1.25]);
});
t('a v1 backup migrates through v3 to v4 in one pass without losing sessions', () => {
  const V1 = { week: 3, settings: { weight: 86, deficit: 400, ppk: 2 },
    logs: { '1:bench': { sets: [{ weight: '60', reps: '8', done: true }], ts: Date.parse('2026-09-01T10:00:00Z') } },
    bests: {}, bw: [], lastBackup: null };
  const r = C.migrate(V1, { dayOfExercise: X.dayOfExerciseMap(), exIndex: EXI, variantMap: X.LEGACY_ID_MAP });
  eq(r.state.schemaVersion, 4); eq(r.state.sessions.length, 1);
  eq(r.state.migrations.map(m => m.from), [1, 3]);
});
t('a v4 backup round-trips through makeBackup and validateBackup with its settings', () => {
  const s = chain();
  E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [1.25, 2.5],
    minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 2, maxJumpPct: 5 }, day(1));
  const b = C.makeBackup(s);
  ok(C.validateBackup(JSON.parse(JSON.stringify(b))).ok);
  const back = C.migrate(JSON.parse(JSON.stringify(b)).data).state;
  eq(back.exerciseSettings[PD].qualifyingSessions, 2);
});
t('older sets without a role are treated as working sets', () => {
  const s = fresh();
  const e = seed(s, PD, day(0), 60, ALL_TOP, GOOD);
  e.sets.forEach(x => delete x.role);
  eq(decideAt(s, PD, day(3)).action, 'progress');
});

/* ========================================================================== */
console.log('\n' + '='.repeat(62));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
if (fail) { failures.forEach(([n, m]) => console.log(' - ' + n + ': ' + m)); process.exit(1); }
