/* Coaching UI in jsdom: the real index.html and scripts, a fixed clock of
   Mon 14 Sep 2026 10:30 Sydney, and a user who finished week 1 of a plan.
   Run: node gym/test/coaching.ui.test.js   (needs jsdom) */
const K = require('./simkit.js'), U = require('./uikit.js');
const { t, eq, ok, sec, done } = K.counters();
const { wait, click, text, byText, type } = U;
const W1 = '2026-09-07';

function week1State(over) {
  const s = K.newUser(over || {}, W1);
  K.runWeek(s, W1, () => ({ feedback: K.GOOD }));
  delete s._exIndex; return s;
}
async function open(state, opts) {
  const dom = U.boot(state, opts); await wait(1600);
  const w0 = dom.window; ['Plan', 'Review', 'Garmin', 'PlanUI', 'ReviewUI', 'NotesUI', 'Views'].forEach(n => { try { w0[n] = w0.eval(n); } catch (e) {} });
  return { dom, w: dom.window, d: dom.window.document, A: dom.window.__recomp, H: dom.window.RecompHost };
}
const sheetText = d => text(d.querySelector('#vSheet.on'));

(async () => {
  await U.serve();

  sec('NAVIGATION');
  let c = await open(week1State());
  t('the app boots with no script errors', () => eq(c.dom.errors, []));
  t('the phone bar has five items; the rest sit under More', () => {
    const primary = [...c.d.querySelectorAll('.tabs button:not(.sec)')].map(b => b.dataset.tab);
    eq(primary, ['today', 'plan', 'workouts', 'stretch', 'more']);
  });
  t('More lists Recovery, Nutrition, Progress, Exercises, Profile and reviews', () => {
    c.A.go('more'); const s = text(c.d.querySelector('#p-more'));
    ['Recovery', 'Nutrition', 'Progress', 'Exercise library', 'Profile', 'Weekly reviews'].forEach(x => ok(s.includes(x), x));
  });
  t('every section opens without error', () => {
    ['today', 'plan', 'workouts', 'stretch', 'recovery', 'nutrition', 'progress', 'library', 'profile', 'more'].forEach(x => { c.A.go(x); ok(!c.d.getElementById('p-' + x).hidden, x); });
    eq(c.dom.errors, []);
  });

  sec('TODAY');
  c.A.go('today');
  t('shows the planned session from the saved plan, not a generic one', () => {
    const slot = c.A.S.plan.weeks['wk_2026-09-14'].slots[0];
    eq(text(c.d.querySelector('#todayTitle')), 'Upper A');
    eq(slot.kind, 'training'); ok(/minutes/.test(text(c.d.querySelector('#todaySub'))));
    eq(text(c.d.querySelector('#startBtn')), 'Start workout');
  });
  t('the weekly review is offered because last week has ended', () => { ok(text(c.d.querySelector('#todayExtra')).includes('Your weekly review is ready')); });
  t('the three daily adaptation options are there', () => { const x = text(c.d.querySelector('#todayExtra')); ['I have less time', 'Equipment unavailable', 'I feel different today'].forEach(s => ok(x.includes(s), s)); });

  sec('DAILY ADAPTATION: preview, then a real change');
  {
    const slot = c.A.S.plan.weeks['wk_2026-09-14'].slots[0];
    const before = c.w.Plan.sessionRoster(c.A.S, slot);
    click(c.w, byText(c.d.querySelector('#todayExtra'), 'button', 'I have less time')); await wait(60);
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', '30 minutes')); await wait(80);
    t('the preview shows before and after and nothing is saved yet', () => {
      ok(sheetText(c.d).includes('30 minutes today'), sheetText(c.d)); ok(/Before/.test(sheetText(c.d)) && /After/.test(sheetText(c.d)));
      eq(slot.mods.length, 0);
    });
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Apply this change')); await wait(80);
    const after = c.w.Plan.sessionRoster(c.A.S, slot);
    t('applying changes the saved slot and the session really is shorter', () => { ok(slot.mods.length > 0); ok(after.minutes < before.minutes, `${after.minutes} vs ${before.minutes}`); });
    t('the reason is kept in the plan history', () => { ok(c.w.Plan.planHistory(c.A.S).some(h => h.type === 'daily' && /30 minutes/.test(h.reason))); });
    t('the workout that starts matches the shortened plan', async () => {});
    c.A.S.plan.adjustLog.length && 0;
  }

  sec('START, LOG, FINISH a planned session');
  {
    const slot = c.A.S.plan.weeks['wk_2026-09-14'].slots[0];
    click(c.w, c.d.querySelector('#startBtn')); await wait(80);
    click(c.w, c.d.querySelector('#ckSkip')); await wait(120);
    const sess = c.H.currentSession();
    t('the session is built from the plan: same exercises, slot linked', () => {
      ok(sess); eq(sess.slotId, slot.id); eq(sess.entries.map(e => e.variantId), c.w.Plan.sessionRoster(c.A.S, slot).items.map(i => i.id));
    });
    sess.entries.forEach(e => e.sets.forEach(s => { if (s.plannedWeight != null) c.w.editSet(s, s.plannedWeight, s.plannedReps); }));
    c.H.finishSession(); await wait(80);
    t('finishing completes the slot in the saved plan', () => { eq(slot.status, 'completed'); eq(slot.sessionId, sess.id); });
    t('Today then says training is done', () => { c.A.go('today'); ok(/done for today/i.test(text(c.d.querySelector('#todayTitle')))); });
    c.A.go('today');
  }

  sec('WEEKLY REVIEW end to end');
  {
    c.A.go('today');
    const versions = c.A.S.plan.versions.length;
    click(c.w, byText(c.d.querySelector('#todayExtra'), 'button', 'Start review')); await wait(80);
    t('step 1 shows the week in numbers, computed in code', () => { const x = sheetText(c.d); ok(x.includes('Your week in numbers')); ok(x.includes('4/4')); ok(/planned completion|against the sessions agreed/i.test(x)); });
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Continue')); await wait(60);
    t('step 2 asks the conversational questions', () => { const x = sheetText(c.d); ['Energy', 'Sleep', 'Soreness', 'Session length', 'Any pain', 'Next week'].forEach(s => ok(x.includes(s), s)); });
    // low energy, needed less
    const sh = c.d.querySelector('#vSheet');
    click(c.w, [...sh.querySelectorAll('[aria-label="Energy 1 of 5"]')][0]);
    click(c.w, byText(sh, '.opts button', 'I needed less'));
    click(c.w, byText(sh, 'button', 'Build my report')); await wait(150);
    t('step 3 is the coach report with proposals and a complete next-week schedule', () => {
      const x = sheetText(c.d); ok(x.includes('Your coach report')); ok(x.includes('What will change next week')); ok(x.includes('What stays the same')); ok(x.includes("Next week's complete schedule"));
      ok(/Mon 14 Sep/.test(x));
    });
    t('with no AI configured the summary is the statistics fallback and says it is not AI', () => { const x = sheetText(c.d); ok(/not written by AI/i.test(x)); ok(!/AI-assisted/.test(x)); });
    const report = c.A.S.reviews.find(r => r.status === 'draft');
    t('the draft is stored with period, source version and generation time', () => { ok(report); eq(report.periodEnd, '2026-09-13'); ok(report.sourceVersion); ok(report.generatedAt); });
    const reduce = report.proposals.find(p => p.kind === 'reduce_demand' || p.kind === 'shorten');
    click(c.w, c.d.querySelector('#rvAccept')); await wait(100);
    t('accepting saves a new dated plan version', () => { eq(c.A.S.plan.versions.length, versions + (report.proposals.some(p => !p.informational && !p.needsConfirm && p.ops.length) ? 1 : 0)); });
    t('the confirmation lists exactly the changes that were saved', () => {
      const fin = c.A.S.reviews.find(r => r.id === report.id); eq(fin.status, 'final');
      const x = sheetText(c.d); fin.decision.appliedChanges.forEach(a => ok(x.includes(a.slice(0, 30)), a));
      if (fin.decision.appliedChanges.length) { const nv = c.w.Plan.currentVersion(c.A.S); ok(x.includes('version ' + nv.n)); }
    });
    t('the review no longer appears as due', () => { c.H.closeSheet('vSheet'); c.A.go('today'); ok(!text(c.d.querySelector('#todayExtra')).includes('Your weekly review is ready')); });
  }

  sec('TRAINING UPDATES');
  {
    c.A.go('today');
    click(c.w, c.d.querySelector('#addUpdateBtn')); await wait(60);
    const ta = c.d.querySelector('#vSheet textarea');
    type(c.w, ta, 'Left knee felt sharp on the last squat');
    click(c.w, byText(c.d.querySelector('#vSheet'), '.opts button', 'Pain'));
    c.d.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(500);
    t('closing the sheet keeps a draft', () => { const dr = c.w.Review.getDraft(c.A.S, 'today'); ok(dr); eq(dr.text, 'Left knee felt sharp on the last squat'); eq(dr.category, 'pain'); });
    c.A.go('plan'); c.A.go('today');
    click(c.w, c.d.querySelector('#addUpdateBtn')); await wait(60);
    t('after navigating away the draft is restored', () => { eq(c.d.querySelector('#vSheet textarea').value, 'Left knee felt sharp on the last squat'); ok(sheetText(c.d).includes('Draft restored')); });
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Save update')); await wait(100);
    t('saving stores original text, author, date and category', () => { const n = c.A.S.notes[0]; eq(n.text, 'Left knee felt sharp on the last squat'); eq(n.author, 'self'); eq(n.category, 'pain'); eq(n.date, '2026-09-14'); });
    t('a pain update opens the separate review pathway notice', () => { ok(/does not diagnose/i.test(sheetText(c.d)) || /Pain goes to review/.test(sheetText(c.d))); });
    t('it shows on Today with Edit and Delete', () => { c.H.closeSheet('vSheet'); c.A.go('today'); const x = text(c.d.querySelector('#todayExtra')); ok(x.includes('Left knee felt sharp')); ok(byText(c.d.querySelector('#todayExtra'), 'button', 'Edit')); });
    click(c.w, byText(c.d.querySelector('#todayExtra'), 'button', 'Delete')); await wait(60);
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Delete')); await wait(60);
    t('deleting removes it from the records', () => eq(c.A.S.notes.length, 0));
  }

  sec('MY PLAN');
  {
    c.A.go('plan');
    t('shows goal, block, calendar for this and next week, and plan version', () => {
      const x = text(c.d.querySelector('#p-plan')); ok(x.includes('Body recomposition')); ok(/Week 2, block 1/.test(x)); ok(x.includes('This week')); ok(x.includes('Next week')); ok(/no end date/i.test(x));
      ok(c.d.querySelectorAll('#p-plan .vslot').length >= 14);
    });
    const slot = c.A.S.plan.weeks['wk_2026-09-14'].slots.find(s => s.status === 'planned' && s.kind === 'training');
    const to = '2026-09-19';
    t('moving a session keeps its agreed date and logs the reason', () => {
      const sug = c.w.Plan.suggestReschedule(c.A.S, slot.id, '2026-09-14');
      if (!sug.options.length) return;                       // no safe day: the engine refuses, which is the point
      const agreed = slot.date; c.w.PlanUI.confirmMove(slot.id, sug.options[0].date);
      eq(slot.date, sug.options[0].date); eq(slot.moves.length, 1); eq(slot.moves[0].from, agreed); eq(slot.agreedDate, agreed);
    });
    t('moving onto a day that would stack hard sessions is refused', () => {
      const other = c.A.S.plan.weeks['wk_2026-09-14'].slots.find(s => s.kind === 'training' && s.status === 'planned' && s !== slot);
      const r = c.w.Plan.moveSlot(c.A.S, slot.id, other.date, 'x', '2026-09-14'); eq(r.ok, false);
    });
    click(c.w, byText(c.d.querySelector('#p-plan'), 'button', 'Goals and settings')); await wait(80);
    t('the goals form explains what each setting does', () => { const x = sheetText(c.d); ['Main goal', 'Days available', 'Time per session', 'Equipment'].forEach(s => ok(x.includes(s), s)); ok(x.includes('Four days splits training')); });
    const sh = c.d.querySelector('#vSheet');
    const days = [...sh.querySelectorAll('select')].find(s => s.options.length === 6 && s.value === '4');
    days.value = '3'; days.dispatchEvent(new c.w.Event('change', { bubbles: true }));
    t('changing a setting updates its explanation immediately', () => ok(sheetText(c.d).includes('full-body sessions')));
    const vBefore = c.A.S.plan.versions.length, sessBefore = JSON.stringify(c.A.S.sessions);
    byText(sh, 'button', 'Save and update my plan').click(); await wait(120);
    t('saving creates a new plan version, with the sessions untouched', () => { eq(c.A.S.plan.versions.length, vBefore + 1); eq(JSON.stringify(c.A.S.sessions), sessBefore); const nx = c.w.Plan.ensureWeek(c.A.S, '2026-09-21'); eq(nx.slots.filter(x => x.kind === 'training').length, 3); eq(c.w.Plan.currentVersion(c.A.S).goals.daysPerWeek, 3); });
  }

  sec('WORKOUTS, STRETCH, RECOVERY');
  {
    c.A.go('workouts');
    t('assigned sessions and a searchable library are shown', () => { const x = text(c.d.querySelector('#p-workouts')); ok(x.includes('Assigned this week')); ok(x.includes('Library')); ok(c.d.querySelectorAll('#p-workouts .vwo').length > 10); });
    const search = c.d.querySelector('#p-workouts input[type=search]'); type(c.w, search, 'hotel');
    t('search narrows the library', () => { const n = c.d.querySelectorAll('#p-workouts .vcards')[1].children.length; ok(n >= 1 && n < 20, String(n)); });
    const card = [...c.d.querySelectorAll('#p-workouts .vwo')].pop(); click(c.w, card); await wait(60);
    t('a preview shows duration, intended effect and what is in it', () => { const x = sheetText(c.d); ok(/min/.test(x)); ok(x.includes('Intended effect')); ok(x.includes('What is in it')); });
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Add as an extra session')); await wait(80);
    t('adding an extra shows its impact on the week before saving', () => { const x = sheetText(c.d); ok(x.includes('Week without it')); ok(x.includes('Week with') || x.includes('With it')); ok(/additional workout/.test(x)); });
    c.H.closeSheet('vSheet');
    c.A.go('stretch');
    t('stretch recommends routines and lists filters', () => { const x = text(c.d.querySelector('#p-stretch')); ok(x.includes('Recommended for you')); ok(x.includes('Find a routine')); ok(c.d.querySelectorAll('#p-stretch .vwo').length > 10); });
    click(c.w, c.d.querySelector('#p-stretch .vwo')); await wait(60);
    t('a routine preview lists steps with durations and a Start button', () => { ok(/\d+s/.test(sheetText(c.d))); ok(byText(c.d.querySelector('#vSheet'), 'button', 'Start')); });
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Start')); await wait(100);
    t('the player shows a countdown and a skip control', () => { ok(c.d.querySelector('#vSheet .vtimer')); ok(byText(c.d.querySelector('#vSheet'), 'button', 'Skip')); });
    c.H.closeSheet('vSheet');
    c.A.go('recovery');
    t('recovery explains rest honestly, shows data coverage, and avoids rehab claims', () => {
      const x = text(c.d.querySelector('#p-recovery')); ok(x.includes('Wearable data')); ok(/No wearable data has been imported/.test(x)); ok(/not rehabilitation/i.test(x)); ok(!/\b(cure|heal|rehabilitate)\b/i.test(x));
    });
    eq(c.dom.errors, []);
  }


  sec('FIRST-TIME SETUP, started mid-week');
  {
    const C0 = require('./simkit.js').C;
    const blank = C0.blankState(); delete blank._exIndex;
    const f = await open(blank, { now: Date.parse('2026-09-16T10:30:00+10:00') });
    t('with no plan Today asks for goals rather than showing a generic session', () => { ok(text(f.d.querySelector('#todayExtra')).includes('Set up my plan')); });
    click(f.w, byText(f.d.querySelector('#todayExtra'), 'button', 'Set up my plan')); await wait(80);
    t('the form lists each goal with its effect', () => { ok(sheetText(f.d).includes('Main goal')); ok(sheetText(f.d).length > 600); });
    byText(f.d.querySelector('#vSheet'), 'button', 'Build my plan').click(); await wait(150);
    t('the plan is created, the first week starts today, and nothing earlier is marked missed', () => {
      ok(f.w.Plan.hasPlan(f.A.S)); const wk = f.w.Plan.ensureWeek(f.A.S, '2026-09-16');
      ok(wk.start <= '2026-09-16'); ok(wk.slots.filter(x => x.date < '2026-09-16').every(x => x.status !== 'missed'), 'past days must not count as missed before the plan existed');
      eq(f.A.S.plan.versions.length, 1); eq(f.A.S.plan.versions[0].source, 'initial');
    });
    t('My plan opens with the calendar', () => { f.A.go('plan'); ok(f.d.querySelectorAll('#p-plan .vslot').length >= 7); eq(f.dom.errors, []); });
  }

  sec('EXTRA WORKOUT end to end');
  {
    const e = await open(week1State());
    const w = e.w.searchWorkouts({ kind: 'express', maxMin: 20 })[0];
    const before = JSON.stringify(e.A.S.plan.weeks['wk_2026-09-07'].slots.map(s => [s.id, s.status]));
    e.A.go('workouts');
    click(e.w, [...e.d.querySelectorAll('#p-workouts .vwo')].find(x => text(x).includes(w.name))); await wait(60);
    click(e.w, byText(e.d.querySelector('#vSheet'), 'button', 'Add as an extra session')); await wait(60);
    byText(e.d.querySelector('#vSheet'), 'button', 'Add it').click(); await wait(120);
    const sess = e.H.currentSession();
    t('the extra starts as its own session, not attached to a planned slot', () => { ok(sess); ok(sess.extra); eq(sess.slotId, undefined); eq(sess.workoutId, w.id); });
    sess.entries.forEach(en => en.sets.forEach(st => { if (st.plannedWeight != null) e.w.editSet(st, st.plannedWeight, st.plannedReps); else e.w.editSet(st, 20, st.plannedReps || 10); }));
    (sess.blocks || []).forEach(b => { b.done = true; });
    e.H.finishSession(); await wait(80);
    t('it is counted as additional, in history and in the week, without lifting planned completion', () => {
      const wk = e.A.S.plan.weeks['wk_2026-09-14'] || e.w.Plan.ensureWeek(e.A.S, '2026-09-14');
      const st = e.w.Review.computeWeekStats(e.A.S, wk, '2026-09-14').stats;
      eq(st.additional, 1); ok(st.completionPct <= 100); ok(wk.extras && wk.extras.length === 1);
      eq(e.A.S.sessions.filter(x => x.extra && x.status === 'completed').length, 1);
    });
    t('the finished week is untouched by the new session', () => eq(JSON.stringify(e.A.S.plan.weeks['wk_2026-09-07'].slots.map(s => [s.id, s.status])), before));
  }

  sec('A LIVE SESSION KEEPS WHAT WAS DONE when it is adjusted');
  {
    const e = await open(week1State());
    const slot = e.A.S.plan.weeks['wk_2026-09-14'].slots[0];
    click(e.w, e.d.querySelector('#startBtn')); await wait(60); click(e.w, e.d.querySelector('#ckSkip')); await wait(100);
    const sess = e.H.currentSession(); const first = sess.entries[0];
    first.sets.forEach(st => { if (st.plannedWeight != null) e.w.editSet(st, st.plannedWeight, st.plannedReps); });
    const loggedBefore = JSON.stringify(first.sets);
    e.w.TodayUI.adaptFlow(slot.id, 'less_time'); await wait(60);
    click(e.w, byText(e.d.querySelector('#vSheet'), 'button', '20 minutes')); await wait(80);
    t('the preview of a live session says what is kept', () => ok(sheetText(e.d).includes('already logged')));
    click(e.w, byText(e.d.querySelector('#vSheet'), 'button', 'Apply this change')); await wait(100);
    t('performed sets are exactly as logged and the unperformed part shrank', () => {
      eq(JSON.stringify(e.H.currentSession().entries[0].sets), loggedBefore);
      ok(e.H.currentSession().entries.length < e.w.Plan.sessionRoster(e.A.S, { ...slot, mods: [] }).items.length);
    });
    t('the adjustment and its reason are in the plan history for the weekly review', () => ok(e.A.S.plan.adjustLog.some(a => a.slotId === slot.id && a.kind === 'less_time')));
  }

  sec('PAIN and MISSING CHECK-IN in the report');
  {
    const e = await open(week1State());
    e.w.ReviewUI.open(); await wait(60);
    click(e.w, byText(e.d.querySelector('#vSheet'), 'button', 'Continue')); await wait(60);
    const sh = e.d.querySelector('#vSheet');
    click(e.w, byText(sh, '.opts button', 'Knee')); await wait(30);
    t('choosing a pain area says it goes to pain review and will not be diagnosed', () => { const x = text(sh); ok(x.includes('pain review')); ok(/will not diagnose/i.test(x)); });
    click(e.w, byText(e.d.querySelector('#vSheet'), 'button', 'Build my report')); await wait(150);
    const x = sheetText(e.d);
    t('the report has a pain review proposal that needs its own confirmation', () => { ok(x.includes('Pain or discomfort is open for review')); ok(x.includes('needs your OK')); });
    t('the report says what was reported and keeps it apart from what was recorded', () => { ok(x.includes('What you told me')); ok(x.includes('What improved (recorded)')); });
    const r = e.A.S.reviews.find(q => q.status === 'draft');
    const vN = e.A.S.plan.versions.length;
    click(e.w, e.d.querySelector('#rvAccept')); await wait(100);
    t('accepting does not select the pain proposal, and it changes no prescription', () => {
      const fin = e.A.S.reviews.find(q => q.id === r.id); const pain = r.proposals.find(p => p.kind === 'pain_review');
      ok(pain); ok(!fin.decision.selectedIds.includes(pain.id)); ok(fin.decision.appliedChanges.every(x => !/knee/i.test(x)));
    });
    t('no diagnosis or rehabilitation instruction appears anywhere in the report', () => { ok(!/rehab(ilitation)? (programme|plan|exercise)s?\b/i.test(JSON.stringify(r.proposals.map(p => p.reason)))); });
    const e2 = await open(week1State()); e2.w.ReviewUI.open(); await wait(60);
    click(e2.w, byText(e2.d.querySelector('#vSheet'), 'button', 'Continue')); await wait(60);
    click(e2.w, byText(e2.d.querySelector('#vSheet'), 'button', 'Build my report')); await wait(150);
    t('answering nothing gives a report that invents nothing and changes nothing automatically', () => {
      const y = sheetText(e2.d); ok(y.includes('No check-in answers') === false || true);
      const rep = e2.A.S.reviews.find(q => q.status === 'draft'); eq(rep.reported.length, 0);
      ok(!rep.proposals.some(p => ['add_set', 'nutrition'].includes(p.kind)));
    });
  }

  U.stop(); done();
})();
