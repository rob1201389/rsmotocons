/* Generates gym/docs/DOUBLE-PROGRESSION-EXAMPLES.md from the REAL engine, so the
   worked examples can never drift from the behaviour.
   Run: node gym/test/examples.js > gym/docs/DOUBLE-PROGRESSION-EXAMPLES.md */
const path = require('path'), fs = require('fs');
const dir = fs.existsSync(path.join(__dirname, '../public/core.js')) ? '../public/' : './';
const C = require(dir + 'core.js'), E = require(dir + 'engine.js'), X = require(dir + 'exercises.js');
const EXI = X.EX_INDEX, PD = 'lat-pulldown';
const GOOD = { effort: 'manageable', reserve: '3', technique: 'controlled', capacity: 'another_set', pain: null };
const fresh = () => { const s = C.blankState(); s._exIndex = EXI; return s; };
const day = n => C.addDays('2026-09-01', n);
function seed(s, id, date, w, reps, fb) {
  const ex = EXI[id], sess = C.newSession(ex.day, date), e = C.newEntry(id, id);
  reps.forEach(r => { const k = C.newSet({ weight: w, reps: r }); C.editSet(k, w, r); e.sets.push(k); });
  if (fb) e.feedback = Object.assign(E.blankFeedback(), fb);
  sess.entries.push(e); sess.status = 'completed'; s.sessions.push(sess); return e;
}
const decide = (s, id, date, ck) => E.decide({ state: s, ex: EXI[id], variantId: id, checkin: ck || null,
  todayISO: date, last: C.lastPerformance(s, id, EXI[id]) });
function run(s, id, date, actual, fb) {
  const d = decide(s, id, date), ex = EXI[id], p = d.prescription;
  const sess = C.newSession(ex.day, date), e = C.newEntry(id, id); e.decision = d;
  for (let i = 0; i < p.sets; i++) e.sets.push(C.newSet({ weight: p.load, reps: p.setTargets[i] }));
  if (p.backoff) for (let i = 0; i < p.backoff.sets; i++) e.sets.push(C.newSet({ weight: p.backoff.load, reps: p.backoff.reps, role: 'backoff' }));
  actual.forEach((a, i) => { const k = e.sets[i]; if (a === null) { k.status = 'skipped'; return; }
    const w = typeof a === 'object' ? a.w : p.load, r = typeof a === 'object' ? a.r : a; C.editSet(k, w, r); });
  if (fb) e.feedback = Object.assign(E.blankFeedback(), fb);
  sess.entries.push(e); sess.status = 'completed'; s.sessions.push(sess); return e;
}
const out = [];
const P = (...a) => out.push(a.join(''));
function show(title, setup, d) {
  P('### ', title); P('');
  P('*Setup:* ', setup); P('');
  P('```'); const i = d.progression;
  if (i) { P(i.header); P(i.lastText); if (i.todayText) P(i.todayText); P('Status: ', i.status, '   Action: ', d.action, (d.flags && d.flags.length) ? '   Flags: ' + d.flags.join(', ') : ''); }
  P('What changed: ', d.explain.what); P('Why: ', d.explain.why); P('Next: ', d.explain.next);
  if (i && i.nextText && i.nextText !== d.explain.next) P('Next weight increase: ', i.nextText.replace(/^Next weight increase: /, ''));
  P('```'); P('');
}
P('# Double progression: worked examples'); P('');
P('Every block below is produced by running the real engine (`gym/test/examples.js`). Nothing here is hand-written output. Exercise: lat pulldown, cable, 3 × 8–12, smallest increment 2.5 kg, progression limit 5%, effort and technique recorded as "manageable, 3 in reserve, controlled" unless stated.'); P('');

P('## 1. Building reps at one weight'); P('');
let s = fresh(); seed(s, PD, day(0), 60, [12, 12, 10], GOOD);
show('Last time 12 / 12 / 10 at 60 kg', 'previous session 60 kg × 12, 12, 10.', decide(s, PD, day(3)));
s = fresh(); seed(s, PD, day(0), 60, [9, 8, 8], GOOD);
show('Last time 9 / 8 / 8: every set moves up one rep, not straight to 12', 'previous session 60 kg × 9, 8, 8.', decide(s, PD, day(3)));

P('## 2. Every set reaches the top'); P('');
s = fresh(); seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
show('All three sets at 12', 'previous session 60 kg × 12, 12, 12 with good effort and technique.', decide(s, PD, day(3)));
P('A full cycle, prescribed and logged by the engine session by session:'); P(''); P('```');
s = fresh(); seed(s, PD, day(0), 60, [8, 8, 8], GOOD); let dd = 3;
[[9, 9, 9], [10, 10, 10], [11, 11, 11], [12, 12, 12]].forEach(a => {
  const e = run(s, PD, day(dd), a, GOOD); const p = e.decision.prescription;
  P('day ', String(dd).padStart(2), '  prescribed ', p.load, ' kg  targets ', p.setTargets.join('/'), '   logged ', a.join('/')); dd += 3; });
const nx = decide(s, PD, day(dd)); P('day ', String(dd).padStart(2), '  prescribed ', nx.prescription.load, ' kg  targets ', nx.prescription.setTargets.join('/'), '   (weight earned, reps reset, still 3 sets)'); P('```'); P('');

P('## 3. Mixed loads and back-off sets'); P('');
s = fresh(); let e = seed(s, PD, day(0), 60, [12, 12, 12], GOOD); e.sets.forEach(k => { k.plannedWeight = 60; });
C.editSet(e.sets[0], 65, 12); C.editSet(e.sets[1], 55, 12); C.editSet(e.sets[2], 55, 12);
show('A heavy first set then lighter sets', 'prescribed 60 kg; logged 65 × 12, then 55 × 12, 55 × 12.', decide(s, PD, day(3)));
s = fresh(); E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5], minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5, backoff: { sets: 2, pct: 85 } }, day(-1));
seed(s, PD, day(0), 60, [10, 10, 10], GOOD);
const bo = run(s, PD, day(3), [11, 11, 11, { w: 50, r: 15 }, { w: 50, r: 15 }], GOOD);
P('A deliberate back-off prescription (2 sets at 85%) is created as its own role:'); P(''); P('```');
bo.sets.forEach((k, i) => P('set ', i + 1, '  ', k.role === 'backoff' ? 'back-off' : 'working ', '  ', k.plannedWeight, ' kg × ', k.plannedReps));
P('```'); P('');
show('Next session after those: back-off sets never set the working load', 'working 60 kg × 11, 11, 11; back-off 50 kg × 15, 15.', decide(s, PD, day(6)));

P('## 4. What blocks an earned increase'); P('');
[['Maximum effort', { effort: 'maximum', reserve: '0', technique: 'controlled', capacity: 'enough' }],
 ['Technique deteriorating', { effort: 'manageable', reserve: '3', technique: 'deteriorating', capacity: 'another_set' }],
 ['"Needed less"', { effort: 'manageable', reserve: '3', technique: 'controlled', capacity: 'needed_less' }],
 ['Mild pain', { ...GOOD, pain: { present: true, location: 'Shoulder', severity: 2 } }],
 ['Concerning pain (sharp)', { ...GOOD, pain: { present: true, location: 'Shoulder', severity: 3, sharp: true } }],
 ['No feedback recorded', null]].forEach(([n, fb]) => {
  const st = fresh(); seed(st, PD, day(0), 60, [12, 12, 12], fb); show(n, 'previous session 60 kg × 12, 12, 12.', decide(st, PD, day(3))); });

P('## 5. The progression limit'); P('');
s = fresh(); seed(s, PD, day(0), 30, [12, 12, 12], GOOD);
show('Smallest increase (2.5 kg) is 8.3% of 30 kg, limit 5%', 'previous session 30 kg × 12, 12, 12.', decide(s, PD, day(3)));
s = fresh(); E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [1, 2.5], minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5 }, day(-1));
seed(s, PD, day(0), 30, [12, 12, 12], GOOD);
show('A 1 kg increment is available and fits', 'same session, increments 1, 2.5.', decide(s, PD, day(3)));

P('## 6. Qualifying sessions'); P('');
s = fresh(); E.saveExerciseSettings(s, EXI[PD], { method: 'double', sets: 3, repMin: 8, repMax: 12, increments: [2.5], minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 2, maxJumpPct: 5 }, day(-1));
seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
show('Two qualifying sessions required: the first is recorded, not rewarded', 'one clean session at the top.', decide(s, PD, day(3)));
run(s, PD, day(3), [12, 12, 12], GOOD);
show('After the second clean session', 'two clean sessions in a row.', decide(s, PD, day(6)));

P('## 7. Deload and returning from a break'); P('');
s = fresh(); seed(s, PD, day(0), 60, [12, 12, 12], GOOD); E.acceptDeload(s, day(2));
show('Deload week overrides an earned increase', 'last session 12, 12, 12 at 60 kg, deload accepted.', decide(s, PD, day(3)));
s = fresh(); seed(s, PD, day(0), 60, [11, 11, 11], GOOD); E.acceptDeload(s, day(3)); run(s, PD, day(4), [12, 12, 12], GOOD);
show('First session after the deload returns to the old load, no increase', 'pre-deload 60 kg × 11, 11, 11; deload week done.', decide(s, PD, day(12)));
s = fresh(); seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
show('Return after a 30 day break', 'last session 12, 12, 12 at 60 kg, thirty days ago.', decide(s, PD, day(30)));

P('## 8. Reps are progress; a stall is not just an unchanged weight'); P('');
s = fresh(); [[8, 8, 8], [9, 9, 9], [10, 10, 10], [11, 11, 11]].forEach((r, i) => seed(s, PD, day(i * 7), 60, r, GOOD));
P('Four sessions at 60 kg with reps 8, 9, 10, 11: plateau detector says `', JSON.stringify(E.detectPlateau(s, PD, E.resolveSettings(s, EXI[PD]), EXI[PD], day(30))), '`.'); P('');
s = fresh(); for (let i = 0; i < 4; i++) seed(s, PD, day(i * 7), 60, [9, 9, 9], { effort: 'challenging', reserve: '2', technique: 'controlled' });
P('Four sessions at 60 kg, always 9 / 9 / 9, feedback recorded, 21 days: plateau detector says `', JSON.stringify(E.detectPlateau(s, PD, E.resolveSettings(s, EXI[PD]), EXI[PD], day(30))), '`.'); P('');
show('...and the engine then suggests a change of approach', 'that flat history.', decide(s, PD, day(22)));
s = fresh(); for (let i = 0; i < 4; i++) seed(s, PD, day(i * 7), 60, [9, 9, 9], null);
P('The same flat history with **no feedback recorded**: plateau detector says `', JSON.stringify(E.detectPlateau(s, PD, E.resolveSettings(s, EXI[PD]), EXI[PD], day(30))), '` (unknown stays unknown).'); P('');

P('## 9. Accept, hold, edit'); P('');
s = fresh(); seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
const d0 = decide(s, PD, day(3)); const settings = E.resolveSettings(s, EXI[PD]);
function mkEntry() { const en = C.newEntry(PD, PD); en.decision = JSON.parse(JSON.stringify(d0)); for (let i = 0; i < 3; i++) en.sets.push(C.newSet({ weight: d0.prescription.load, reps: d0.prescription.setTargets[i] })); return en; }
P('Recommendation: ', d0.prescription.load, ' kg, targets ', d0.prescription.setTargets.join('/'), '.'); P('');
P('```');
let en = mkEntry(); E.applyProgressionChoice(en, 'hold', null, settings, 1);
P('HOLD   -> planned ', en.sets.map(k => k.plannedWeight + ' × ' + k.plannedReps).join(', '), '   | recorded: ', en.progressionChoice.chosen, ' | recommendation kept: ', en.decision.prescription.load, ' kg');
en = mkEntry(); E.applyProgressionChoice(en, 'edit', { load: 61, setTargets: [9, 9, 8] }, settings, 1);
P('EDIT   -> planned ', en.sets.map(k => k.plannedWeight + ' × ' + k.plannedReps).join(', '), '   | recorded: ', en.progressionChoice.chosen, ' | recommendation kept: ', en.decision.prescription.load, ' kg');
en = mkEntry(); const bad = E.applyProgressionChoice(en, 'edit', { load: 65, setTargets: [8, 8, 8, 8] }, settings, 1);
P('EDIT 65 kg + 4 sets -> refused: ', bad.problems.join(' '));
P('```'); P('');

P('## 10. Other exercise types keep their own rules'); P('');
s = fresh(); seed(s, 'assisted-pull-up', day(0), 30, [10, 10, 10, 10], GOOD);
show('Assisted pull-up, 10 of 12 reps', 'assistance 30 kg × 10, 10, 10, 10.', decide(s, 'assisted-pull-up', day(3)));
s = fresh(); seed(s, 'assisted-pull-up', day(0), 30, [12, 12, 12, 12], GOOD);
show('Assisted pull-up, all sets at 12: LESS assistance is the increase', 'assistance 30 kg × 12 on all four sets.', decide(s, 'assisted-pull-up', day(3)));
s = fresh(); seed(s, 'side-plank-weighted', day(0), 5, [30, 30, 30], GOOD);
show('Timed hold at the top of its range: load is added and the time resets', 'weighted side plank, 5 kg × 30 s.', decide(s, 'side-plank-weighted', day(3)));
s = fresh(); seed(s, 'farmers-walk', day(0), 32, [40, 40, 40], GOOD);
show('Carry: distance is fixed, so load moves (the one flagged exception to the limit)', 'farmer\'s walk 32 kg × 40 m.', decide(s, 'farmers-walk', day(3)));
s = fresh(); E.saveExerciseSettings(s, EXI[PD], { method: 'manual', sets: 3, repMin: 8, repMax: 12, increments: [2.5], minReserve: 2, maxEffort: 'near_limit', qualifyingSessions: 1, maxJumpPct: 5 }, day(-1));
seed(s, PD, day(0), 60, [12, 12, 12], GOOD);
show('Manual method: the app never changes the load', 'same perfect session, method set to manual.', decide(s, PD, day(3)));
console.log(out.join('\n'));
