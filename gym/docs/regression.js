/* Regression suite for the v3 independent review.
   Each test reproduces a reported defect. Written BEFORE the fix.
   Run: node regression.js */
const C = require('./core.js');
const E = require('./engine.js');
const X = require('./exercises.js');
const fs = require('fs');

let pass = 0, fail = 0; const fails = [];
const t = (n, f) => { try { f(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  catch (e) { fail++; fails.push([n, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + n + '\n       ' + e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const eq = (a,b,m) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error((m||'')+` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');

const EXI = X.EX_INDEX;
function st(profile) {
  const s = C.blankState(); s._exIndex = EXI;
  if (profile) Object.assign(s.profile, profile);
  return s;
}
function log(s, id, sets, opts) {
  opts = opts || {};
  const ex = EXI[id];
  const ss = C.newSession(ex.day, opts.date || C.todayISO());
  const e = C.newEntry(id, id);
  sets.forEach(x => { const k = C.newSet({ weight: x.w, reps: x.r }); C.editSet(k, x.w, x.r); e.sets.push(k); });
  if (opts.feedback) e.feedback = Object.assign(E.blankFeedback(), opts.feedback);
  if (opts.decision) e.decision = opts.decision;
  ss.entries.push(e); ss.status = 'completed'; s.sessions.push(ss);
  return ss;
}
function dec(s, id, checkin, today) {
  const ex = EXI[id];
  return E.decide({ state: s, ex, variantId: id, checkin: checkin || null,
    todayISO: today || C.todayISO(), last: C.lastPerformance(s, id, ex) });
}
const fb = (effort, reserve, technique, capacity, pain) =>
  ({ effort, reserve, technique, capacity, pain: pain || null, at: Date.now() });

/* ========================================================================= */
sec('DEFECT 1 — "needed_less" bypasses the low-reserve safeguard');

t('needed_less with 1 rep in reserve must NOT progress', () => {
  const s = st();
  log(s, 'bench-barbell', [{w:60,r:8},{w:60,r:8},{w:60,r:8},{w:60,r:8}],
    { feedback: fb('near_limit', '1', 'controlled', 'needed_less') });
  const d = dec(s, 'bench-barbell');
  ok(d.action !== 'progress', `progressed to ${d.prescription && d.prescription.load} on 1 rep in reserve`);
});

t('needed_less never reaches a HIGHER load than enough_today', () => {
  const mk = cap => {
    const s = st();
    log(s, 'bench-barbell', [{w:60,r:8},{w:60,r:8},{w:60,r:8},{w:60,r:8}],
      { feedback: fb('near_limit', '1', 'controlled', cap) });
    return dec(s, 'bench-barbell').prescription.load;
  };
  const nl = mk('needed_less'), en = mk('enough');
  ok(nl <= en, `"needed less" prescribed ${nl} vs ${en} for "enough today" — it must never be higher`);
});

t('needed_less is treated as a signal to back off, not to push on', () => {
  const s = st();
  log(s, 'bench-barbell', [{w:60,r:8},{w:60,r:8},{w:60,r:8},{w:60,r:8}],
    { feedback: fb('maximum', '0', 'controlled', 'needed_less') });
  const d = dec(s, 'bench-barbell');
  ok(['hold','reduce'].includes(d.action), 'got ' + d.action);
  ok(d.prescription.load <= 60, 'load must not rise after "needed less"');
});

t('needed_less with plenty in reserve still does not progress load', () => {
  const s = st();
  log(s, 'bench-barbell', [{w:60,r:8},{w:60,r:8},{w:60,r:8},{w:60,r:8}],
    { feedback: fb('manageable', '3', 'controlled', 'needed_less') });
  const d = dec(s, 'bench-barbell');
  ok(d.action !== 'progress', 'contradictory feedback must resolve conservatively, got ' + d.action);
});

/* ========================================================================= */
sec('DEFECT 2 — capJump does not enforce maxLoadJumpPct');

t('capJump never returns more than maxLoadJumpPct of the current load', () => {
  const p = { maxLoadJumpPct: 5 };
  [[20,2.5],[10,5],[30,2.5],[200,2.5],[40,2]].forEach(([cur,inc]) => {
    const got = E.capJump(cur, inc, p);
    const cap = cur * 0.05;
    ok(got <= cap + 1e-9 || got === 0,
      `current=${cur} increment=${inc}: returned ${got}, cap is ${cap}`);
  });
});

t('a 2.5 kg jump on a 20 kg lift exceeds 5% and must not be prescribed silently', () => {
  const s = st({ maxLoadJumpPct: 5 });
  s.profile.increments.dumbbell = 2.5;
  log(s, 'lateral-raise', [{w:10,r:18},{w:10,r:18},{w:10,r:18}],
    { feedback: fb('very_easy','4+','controlled','another_set') });
  const d = dec(s, 'lateral-raise');
  if (d.action === 'progress' && d.prescription.load > 10) {
    const jump = d.prescription.load - 10;
    ok(jump <= 10 * 0.05 + 1e-9,
      `prescribed +${jump} kg on a 10 kg lift, which is ${(jump/10*100).toFixed(0)}% — over the 5% cap`);
  }
});

t('when the smallest available increment exceeds the cap, the engine says so', () => {
  const s = st({ maxLoadJumpPct: 5 });
  s.profile.increments.machine = 5;
  log(s, 'leg-press', [{w:40,r:12},{w:40,r:12},{w:40,r:12}],
    { feedback: fb('very_easy','4+','controlled','another_set') });
  const d = dec(s, 'leg-press');
  // 5 kg on 40 kg is 12.5%. Either hold, or progress another dimension, but explain it.
  if (d.prescription.load > 40) {
    throw new Error(`silently prescribed ${d.prescription.load} kg (+12.5%)`);
  }
  ok(/increment|smallest|cap|%/i.test(d.explain.why), 'explanation must mention the increment limit: ' + d.explain.why);
});

t('reps are offered as the alternative when load cannot move within the cap', () => {
  const s = st({ maxLoadJumpPct: 5 });
  s.profile.increments.machine = 5;
  log(s, 'leg-press', [{w:40,r:10},{w:40,r:10},{w:40,r:10}],
    { feedback: fb('very_easy','4+','controlled','another_set') });
  const d = dec(s, 'leg-press');
  ok(d.prescription.repsHigh > 10 || d.action === 'hold',
    'should chase reps toward the top of the range instead of an oversized jump');
});

/* ========================================================================= */
sec('DEFECT 3 — sessionPlanAdvice announces a shorter session but does not shorten it');

t('shorten advice names how many exercises will actually remain', () => {
  const adv = E.sessionPlanAdvice({ timeAvailableMin: 20, energy:3, sleep:3, soreness:3 }, 60, 10);
  const sh = (adv||[]).find(a => a.action === 'shorten');
  ok(sh, 'no shorten advice produced');
  ok(typeof sh.keep === 'number', 'advice must carry the number of exercises to keep');
  ok(sh.keep < 10, 'keep must be fewer than the full roster, got ' + sh.keep);
});

t('there is a function that actually applies the shortening to a roster', () => {
  ok(typeof E.applySessionPlan === 'function', 'engine must expose applySessionPlan');
  const roster = X.exercisesForDay(1);
  const res = E.applySessionPlan(roster, { timeAvailableMin: 20, energy:3, sleep:3, soreness:3 },
    { sessionMinutes: 60 });
  ok(res.kept.length < roster.length, 'roster was not shortened');
  ok(res.dropped.length > 0, 'nothing recorded as dropped');
  eq(res.kept.length + res.dropped.length, roster.length, 'exercises lost in the split');
});

t('shortening keeps the compounds and drops accessories, not the first N blindly', () => {
  const roster = X.exercisesForDay(1);
  const res = E.applySessionPlan(roster, { timeAvailableMin: 20 }, { sessionMinutes: 60 });
  const keptIds = res.kept.map(e => e.id);
  ok(keptIds.includes('bench-barbell'), 'dropped the main press');
  ok(keptIds.includes('row-barbell'), 'dropped the main row');
  ok(!keptIds.includes('lateral-raise') || res.kept.length > 6, 'kept an isolation lift over a compound');
});

t('the explanation matches the resulting workout', () => {
  const roster = X.exercisesForDay(1);
  const res = E.applySessionPlan(roster, { timeAvailableMin: 20 }, { sessionMinutes: 60 });
  ok(res.explain && res.explain.what.includes(String(res.kept.length)),
    `explanation "${res.explain && res.explain.what}" does not state the real count ${res.kept.length}`);
});

t('ample time leaves the roster untouched', () => {
  const roster = X.exercisesForDay(1);
  const res = E.applySessionPlan(roster, { timeAvailableMin: 90 }, { sessionMinutes: 60 });
  eq(res.kept.length, roster.length);
  eq(res.dropped.length, 0);
});

/* ========================================================================= */
sec('DEFECT 4 — accepting a deload does not change any prescription');

t('an accepted deload has explicit start and end dates', () => {
  const s = st();
  const d = E.acceptDeload(s, '2026-10-12');
  ok(d, 'acceptDeload must exist and return the applied block');
  ok(d.startDate === '2026-10-12', 'start date');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(d.endDate), 'end date must be explicit, got ' + d.endDate);
  ok(C.daysBetween(d.startDate, d.endDate) >= 6, 'a deload week should span a week');
});

t('prescriptions inside the deload window are reduced', () => {
  const s = st();
  log(s, 'squat-barbell', [{w:120,r:5},{w:120,r:5},{w:120,r:5},{w:120,r:5}],
    { date: '2026-10-08', feedback: fb('manageable','3','controlled','another_set') });
  const before = dec(s, 'squat-barbell', null, '2026-10-12').prescription.load;
  E.acceptDeload(s, '2026-10-12');
  const during = dec(s, 'squat-barbell', null, '2026-10-12').prescription.load;
  ok(during < before, `deload did not reduce the load: ${before} -> ${during}`);
  ok(during <= 120 * 0.7, `expected roughly 60% of the working load, got ${during}`);
});

t('the deload is explained as a deload, not as a normal decision', () => {
  const s = st();
  log(s, 'squat-barbell', [{w:120,r:5},{w:120,r:5},{w:120,r:5},{w:120,r:5}],
    { date: '2026-10-08', feedback: fb('manageable','3','controlled') });
  E.acceptDeload(s, '2026-10-12');
  const d = dec(s, 'squat-barbell', null, '2026-10-12');
  ok(d.flags.includes('deload'), 'not flagged as a deload');
  ok(/deload|easy week/i.test(d.explain.what + d.explain.why), d.explain.why);
});

t('after the end date the deload stops applying by itself', () => {
  const s = st();
  log(s, 'squat-barbell', [{w:120,r:5},{w:120,r:5},{w:120,r:5},{w:120,r:5}],
    { date: '2026-10-08', feedback: fb('manageable','3','controlled','another_set') });
  E.acceptDeload(s, '2026-10-12');
  const after = dec(s, 'squat-barbell', null, '2026-10-26');
  ok(!after.flags.includes('deload'), 'deload still applying after its end date');
});

t('a deload can be dismissed, and dismissal is remembered', () => {
  const s = st();
  E.dismissDeload(s, '2026-10-12');
  ok(s.deloadDismissedUntil, 'dismissal not recorded');
  ok(s.deloadDismissedUntil > '2026-10-12', 'dismissal must suppress the prompt for a while');
});

t('a completed deload is recorded so the clock restarts', () => {
  const s = st();
  const d = E.acceptDeload(s, '2026-09-01');
  E.closeDeloadIfDue(s, '2026-10-01');
  ok(s.deloadHistory && s.deloadHistory.length === 1, 'no deload history written');
  ok(!s.activeDeload, 'finished deload still marked active');
});

/* ========================================================================= */
sec('DEFECT 5 — goal, experience and availability do not reach programme generation');

t('training days per week changes how many distinct days are programmed', () => {
  ok(typeof E.buildProgram === 'function', 'engine must expose buildProgram');
  const p3 = E.buildProgram({ trainingDaysPerWeek: 3, goal: 'recomp', experience: 'intermediate',
    sessionMinutes: 60, equipment: {} }, X.EXERCISES);
  const p5 = E.buildProgram({ trainingDaysPerWeek: 5, goal: 'recomp', experience: 'intermediate',
    sessionMinutes: 60, equipment: {} }, X.EXERCISES);
  ok(p3.days.length === 3, '3-day programme has ' + p3.days.length + ' days');
  ok(p5.days.length === 5, '5-day programme has ' + p5.days.length + ' days');
});

t('goal changes rep ranges and set counts, not just a label', () => {
  const str = E.buildProgram({ trainingDaysPerWeek:4, goal:'strength', experience:'intermediate',
    sessionMinutes:60, equipment:{} }, X.EXERCISES);
  const hyp = E.buildProgram({ trainingDaysPerWeek:4, goal:'hypertrophy', experience:'intermediate',
    sessionMinutes:60, equipment:{} }, X.EXERCISES);
  const pick = p => p.days[0].exercises.find(e => e.ex.pattern === 'horizontal push');
  const a = pick(str), b = pick(hyp);
  ok(a && b, 'no comparable exercise found');
  ok(a.repsHigh < b.repsHigh, `strength reps (${a.repsLow}-${a.repsHigh}) should be lower than hypertrophy (${b.repsLow}-${b.repsHigh})`);
});

t('experience changes volume', () => {
  const nov = E.buildProgram({ trainingDaysPerWeek:4, goal:'recomp', experience:'novice',
    sessionMinutes:60, equipment:{} }, X.EXERCISES);
  const adv = E.buildProgram({ trainingDaysPerWeek:4, goal:'recomp', experience:'advanced',
    sessionMinutes:60, equipment:{} }, X.EXERCISES);
  const sets = p => p.days.reduce((a,d) => a + d.exercises.reduce((b,e) => b + e.sets, 0), 0);
  ok(sets(nov) < sets(adv), `novice ${sets(nov)} sets vs advanced ${sets(adv)} — should differ`);
});

t('session length changes how many exercises are programmed', () => {
  const short = E.buildProgram({ trainingDaysPerWeek:4, goal:'recomp', experience:'intermediate',
    sessionMinutes:30, equipment:{} }, X.EXERCISES);
  const long = E.buildProgram({ trainingDaysPerWeek:4, goal:'recomp', experience:'intermediate',
    sessionMinutes:90, equipment:{} }, X.EXERCISES);
  ok(short.days[0].exercises.length < long.days[0].exercises.length,
    `30 min: ${short.days[0].exercises.length} exercises, 90 min: ${long.days[0].exercises.length}`);
});

t('equipment the user does not have is substituted, not silently dropped', () => {
  const p = E.buildProgram({ trainingDaysPerWeek:4, goal:'recomp', experience:'intermediate',
    sessionMinutes:60, equipment:{ barbell:false, dumbbell:true, machine:true, cable:true } }, X.EXERCISES);
  const ids = p.days.flatMap(d => d.exercises.map(e => e.ex.id));
  ok(!ids.some(id => EXI[id].equipment === 'barbell'), 'programmed a barbell lift without a barbell');
  ok(p.days.every(d => d.exercises.length >= 3), 'a day collapsed instead of substituting');
  ok(p.notes && p.notes.length, 'no note explaining the substitutions');
});

t('the programme explains how it was built', () => {
  const p = E.buildProgram({ trainingDaysPerWeek:4, goal:'strength', experience:'novice',
    sessionMinutes:45, equipment:{} }, X.EXERCISES);
  ok(p.explain && /strength/i.test(p.explain), 'no explanation referencing the goal');
  ok(/45/.test(p.explain) || /4/.test(p.explain), 'explanation does not reference the inputs');
});

/* ========================================================================= */
sec('DEFECT 6 — pain handling');

t('descriptive flags are captured, not just a number', () => {
  const p = E.blankPain();
  ['present','location','severity','note','duringOrAfter'].forEach(k => ok(k in p, 'missing ' + k));
  ['sharp','swelling','numbness','givingWay','night','worsening'].forEach(k =>
    ok(k in p, 'missing descriptive flag: ' + k));
});

t('a LOW severity number does not authorise continuing when a concerning flag is set', () => {
  const s = st();
  log(s, 'squat-barbell', [{w:100,r:5},{w:100,r:5}],
    { feedback: fb('challenging','2','controlled','enough',
      { present:true, location:'knee', severity:2, sharp:true }) });
  const d = dec(s, 'squat-barbell');
  ok(d.action === 'review', `sharp pain rated 2 produced "${d.action}" and kept training`);
  eq(d.prescription, null, 'nothing should be prescribed while a concerning flag stands');
});

t('numbness or giving way always routes to review regardless of rating', () => {
  ['numbness','givingWay'].forEach(flag => {
    const s = st();
    const pain = { present:true, location:'knee', severity:1 }; pain[flag] = true;
    log(s, 'squat-barbell', [{w:100,r:5}], { feedback: fb('manageable','3','controlled','enough', pain) });
    const d = dec(s, 'squat-barbell');
    eq(d.action, 'review', flag + ' with severity 1 must still pause');
  });
});

t('an unresolved pain concern persists into later sessions until cleared', () => {
  const s = st();
  log(s, 'squat-barbell', [{w:100,r:5}], { date:'2026-10-01',
    feedback: fb('challenging','2','controlled','enough',
      { present:true, location:'knee', severity:6 }) });
  // a later clean session with no pain reported
  log(s, 'squat-barbell', [{w:80,r:5}], { date:'2026-10-08',
    feedback: fb('manageable','3','controlled','enough') });
  const d = dec(s, 'squat-barbell', null, '2026-10-15');
  ok(s.painConcerns && s.painConcerns.length, 'no persistent concern recorded');
  ok(d.flags.includes('pain_unresolved') || d.action === 'review',
    'an open concern vanished because the next session did not mention it');
});

t('a pain concern can be explicitly resolved by the user', () => {
  const s = st();
  const c = E.openPainConcern(s, { present:true, location:'knee', severity:6 }, 'squat-barbell', '2026-10-01');
  ok(c && c.id, 'openPainConcern must return the concern');
  E.resolvePainConcern(s, c.id, '2026-10-20', 'cleared by physio');
  const open = (s.painConcerns||[]).filter(x => x.status === 'open');
  eq(open.length, 0, 'concern not resolved');
});

t('a paused exercise is genuinely paused, not merely flagged', () => {
  const s = st();
  log(s, 'squat-barbell', [{w:100,r:5}],
    { feedback: fb('challenging','2','controlled','enough',
      { present:true, location:'lower back', severity:7 }) });
  const d = dec(s, 'squat-barbell');
  eq(d.action, 'review');
  eq(d.prescription, null);
  ok(d.paused === true, 'decision must carry an explicit paused flag the UI can act on');
  ok(d.resumeOptions && d.resumeOptions.length, 'must offer substitute / skip / clear options');
});

t('pain still never enters the readiness score', () => {
  const a = E.readiness({ energy:4, sleep:4, soreness:2, pain:{present:true,severity:9,sharp:true} });
  const b = E.readiness({ energy:4, sleep:4, soreness:2 });
  eq(a.score, b.score);
});

/* ========================================================================= */
sec('DEFECT 7 — misleading exercise diagrams');

t('frontal-plane movements are not presented as plain side views', () => {
  const frontal = ['lateral-raise','face-pull','cable-fly'];
  frontal.forEach(id => {
    const ex = EXI[id];
    ok(ex.viewAngle, `${id} has no declared viewing angle`);
    ok(ex.viewAngle !== 'side', `${id} is a frontal-plane movement shown from the side`);
  });
});

t('every exercise declares the angle its diagram is drawn from', () => {
  X.EXERCISES.forEach(e => ok(e.viewAngle, 'no viewAngle on ' + e.id));
});

t('provisional assets are labelled in the manifest', () => {
  const m = X.ASSET_MANIFEST;
  m.entries.forEach(e => {
    ok(e.reviewed === false, 'an asset claims review it has not had: ' + e.exercise);
    ok(e.status && /unreviewed|provisional|gap/.test(e.status), e.exercise + ' status: ' + e.status);
    ok(e.viewAngle, 'manifest entry missing viewAngle: ' + e.exercise);
  });
});

/* ========================================================================= */
sec('SERVICE WORKER — cache scope, fallbacks, updates mid-workout');

const sw = fs.readFileSync(__dirname + '/sw.js', 'utf8');

t('cache deletion is scoped to this app\'s caches only', () => {
  ok(/CACHE_PREFIX|startsWith\(/.test(sw),
    'activate() deletes every cache on the origin, including other apps\'');
});

t('a failed asset request does not fall back to the HTML page', () => {
  ok(!/caches\.match\('\.\/index\.html'\)\)\)\;?\s*$/m.test(sw) || /request\.mode === 'navigate'|destination/.test(sw),
    'index.html is returned for any failed same-origin GET, including .js and .png');
  ok(/navigate|destination/.test(sw), 'no navigation-vs-asset distinction in the fetch handler');
});

t('the worker does not take over immediately mid-session', () => {
  ok(!/self\.skipWaiting\(\)/.test(sw) || /SKIP_WAITING|message/.test(sw),
    'skipWaiting() runs unconditionally, so a deploy can swap code during a workout');
});

t('the page can ask the worker to activate when it is safe', () => {
  ok(/addEventListener\('message'/.test(sw), 'no message channel for a controlled update');
});

/* ========================================================================= */
console.log('\n' + '='.repeat(62));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
if (fail) { fails.forEach(([n,m]) => console.log(` - ${n}\n   ${m}`)); process.exit(1); }
