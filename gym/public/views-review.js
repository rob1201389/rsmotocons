/* WEEKLY REVIEW and TRAINING UPDATES.
   The review is: your numbers first (all computed in code), a short
   conversation, then a report you can accept, edit or decline. Accepting saves
   a dated plan version; nothing is described as changed unless it was. */
const NotesUI = (function () {
  'use strict';
  const H = () => window.RecompHost;
  const { el, esc, fmtDate } = Views;
  const CATS = [['progress', 'Progress'], ['energy', 'Energy'], ['technique', 'Technique'], ['schedule', 'Schedule'], ['recovery', 'Recovery'], ['preferences', 'Preferences'], ['pain', 'Pain']];
  const CAT_HINT = { pain: 'Pain goes to its own review. Recomp does not diagnose it or prescribe rehab. Loads on the linked exercise are held while it is open.', preferences: 'Likes, dislikes and equipment notes can suggest plan changes, which you confirm.' };

  /* spec: { key, edit, linked:{sessionId,exerciseId,slotId}, category, origin, onSaved } */
  function compose(spec) {
    const S = H().S; spec = spec || {};
    const draft = !spec.edit ? Review.getDraft(S, spec.key || 'today') : null;
    const st = { text: spec.edit ? spec.edit.text : (draft ? draft.text : ''), category: spec.edit ? spec.edit.category : (draft ? draft.category : (spec.category || null)), selfReportedWorkout: false };
    const key = spec.key || 'today'; let t = null;
    const saveDraft = () => { if (spec.edit) return; Review.saveDraft(S, key, { text: st.text, category: st.category, linked: spec.linked || null }, Date.now()); clearTimeout(t); t = setTimeout(() => H().persist(), 400); };
    Views.sheet(spec.edit ? 'Edit training update' : 'Add training update', (b, close) => {
      if (draft) b.appendChild(el('div', 'banner ok', '<div><b>Draft restored.</b> <span class="muted">Your earlier words are still here.</span></div>'));
      const info = spec.linked && (spec.linked.exerciseId || spec.linked.sessionId) ? `Linked to ${spec.linked.exerciseId ? esc(Views.exName(spec.linked.exerciseId)) : 'your workout'}.` : '';
      if (info) b.appendChild(el('p', 'dim', info));
      b.appendChild(el('span', 'eyebrow', 'What is it about? (optional)'));
      const hint = el('p', 'dim veffect', '');
      b.appendChild(Views.chips(CATS.map(([v, l]) => ({ value: v, label: l })), st.category ? [st.category] : [], v => { st.category = (st.category === v) ? null : v; hint.textContent = CAT_HINT[st.category] || ''; saveDraft(); }, false, 'Category'));
      hint.textContent = CAT_HINT[st.category] || ''; b.appendChild(hint);
      const ta = el('textarea', 'vtext'); ta.rows = 5; ta.maxLength = 1200; ta.value = st.text; ta.setAttribute('aria-label', 'Your update');
      ta.placeholder = 'How did it feel? What got in the way? Anything you want changed?';
      const count = el('span', 'dim', ''); const upd = () => { count.textContent = `${ta.value.length} / 1200`; };
      ta.oninput = () => { st.text = ta.value; upd(); saveDraft(); }; upd();
      b.append(ta, count);
      b.appendChild(el('p', 'dim veffect', 'This is your own record. Words here describe what happened, they are never treated as instructions, and a workout you only mention is counted as self-reported, not as a logged session. If an AI service is used for your weekly review, your updates for that week may be processed by it.'));
      if (!spec.edit && !spec.linked) {
        const lab = el('label', 'vcheck'); const cb = el('input'); cb.type = 'checkbox'; cb.onchange = () => { st.selfReportedWorkout = cb.checked; };
        lab.append(cb, document.createTextNode(' This mentions a workout I did not log in the app')); b.appendChild(lab);
      }
      const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; b.appendChild(err);
      const row = el('div', 'row'); row.style.marginTop = '12px';
      const save = el('button', 'btn primary', spec.edit ? 'Save changes' : 'Save update'); const cancel = el('button', 'btn ghost', spec.edit ? 'Cancel' : 'Keep as draft');
      save.onclick = () => {
        const text = ta.value.trim();
        if (!text) { err.textContent = 'Write something first.'; err.hidden = false; return; }
        if (spec.edit) { const r = Review.editNote(S, spec.edit.id, { text, category: st.category }, Date.now()); if (!r.ok) { err.textContent = r.problems[0]; err.hidden = false; return; } H().persist(); close(); H().renderAll(); H().toast('Update changed'); return; }
        const r = Review.addNote(S, { text, category: st.category, linked: spec.linked || null, selfReportedWorkout: st.selfReportedWorkout, origin: spec.origin || 'today', author: 'self' }, Date.now(), (S.goals && S.goals.timezone) || undefined);
        if (!r.ok) { err.textContent = r.problems[0]; err.hidden = false; return; }
        Review.saveDraft(S, key, null, Date.now());
        const sg = Review.extractSuggestions(S, r.note);
        H().persist(); close(); H().renderAll(); H().toast('Update saved');
        if (spec.onSaved) spec.onSaved(r.note);
        if (r.note.category === 'pain' || sg.some(s => s.kind === 'pain')) painNotice();
        if (sg.some(x => x.kind !== 'pain')) suggestions(r.note, sg);
      };
      cancel.onclick = () => { saveDraft(); H().persist(); close(); if (!spec.edit) H().toast('Draft kept'); };
      row.append(save, cancel); b.appendChild(row);
    }, () => { saveDraft(); H().persist(); });
  }
  function painNotice() {
    Views.sheet('Pain goes to review', (b) => {
      b.appendChild(el('p', null, 'Thanks for telling the app. Pain is handled separately from progress: load increases on the linked exercise are held, and it is flagged in your weekly review.'));
      b.appendChild(el('p', 'muted', 'Recomp does not diagnose injuries or prescribe rehabilitation. If it is sharp, getting worse, or not settling, see a doctor or physiotherapist.'));
    });
  }
  /* Suggestions are proposals. Nothing changes until the user says yes. */
  function suggestions(note, list) {
    const S = H().S;
    Views.sheet('Changes this update could make', (b, close) => {
      b.appendChild(el('p', 'muted', 'Recomp found things in what you wrote that could change your plan. Nothing happens unless you confirm each one.'));
      list.filter(s => s.kind !== 'pain').forEach(s => {
        const r = el('div', 'vnote'); r.innerHTML = `<p style="margin:0 0 6px"><b>${esc(s.text)}</b></p>`;
        const yes = el('button', 'btn sm primary', 'Yes, do it'); const no = el('button', 'btn sm ghost', 'No');
        yes.onclick = () => {
          const res = Review.applySuggestion(S, s.id, Date.now());
          if (res.needsPlanRegeneration && Plan.hasPlan(S)) { const patch = { preferences: S.goals.preferences, sessionMinutes: S.goals.sessionMinutes, daysPerWeek: S.goals.daysPerWeek };
            const rr = Plan.changeGoals(S, patch, H().todayISO(), 'From your written update.'); H().toast(rr.ok ? 'Done. New plan from ' + fmtDate(rr.effectiveFrom) : 'Saved. The plan did not need to change.'); }
          else H().toast('Done'); r.remove(); H().persist(); H().renderAll(); };
        no.onclick = () => { Review.dismissSuggestion(S, s.id); r.remove(); H().persist(); };
        const row = el('div', 'row'); row.append(yes, no); r.appendChild(row); b.appendChild(r);
      });
      if (!list.filter(s => s.kind !== 'pain').length) close();
    });
  }
  return { compose, suggestions, painNotice };
})();
window.NotesUI = NotesUI;

const ReviewUI = (function () {
  'use strict';
  const H = () => window.RecompHost;
  const { el, esc, fmtDate, fmtLong, plural } = Views;
  const SESSION = { step: 1, checkin: null, report: null, period: null, selected: new Set(), editing: false, aiBusy: false };

  function periodWeek(S, sch) {
    return Object.values(S.plan.weeks).find(w => w.end === sch.periodEnd) || Plan.ensureWeek(S, sch.periodEnd);
  }
  /* Missed reviews are recorded, never invented. */
  function autoCarryOver(S) {
    if (!Plan.hasPlan(S)) return;
    const sch = Review.reviewSchedule(S, Date.now()); if (!sch || !sch.hasData) return;
    const start = S.plan.versions[0].effectiveFrom;
    Object.values(S.plan.weeks).forEach(w => { if (w.end < sch.periodEnd && w.end >= start && w.status === 'closed') Review.carryOverMissed(S, w, Date.now()); });
  }

  function open() {
    const S = H().S; if (!Plan.hasPlan(S)) { H().toast('Set up your plan first', 'warn'); return; }
    Plan.reconcile(S, H().todayISO());
    const sch = Review.reviewSchedule(S, Date.now());
    if (!sch || !sch.hasData) { H().toast('There is not a full week to review yet.', 'warn'); return; }
    const week = periodWeek(S, sch);
    const existing = (S.reviews || []).find(r => r.periodEnd === sch.periodEnd && r.status === 'draft');
    SESSION.period = { sch, weekId: week.id }; SESSION.step = 1; SESSION.editing = false;
    SESSION.checkin = existing && existing.checkin ? existing.checkin : prefill(S, week);
    SESSION.report = existing || null; SESSION.selected = new Set();
    stepNumbers();
  }

  /* what is already known, so the user is not asked twice */
  function prefill(S, week) {
    const w = Review.wellnessSummary(S, week.start, week.end, H().todayISO());
    const round = x => x == null ? null : Math.max(1, Math.min(5, Math.round(x)));
    const missedWhy = {}; week.slots.forEach(s => { if (s.missReason) missedWhy[s.id] = s.missReason; });
    return { overall: null, energy: round(w.avgEnergy), sleep: round(w.avgSleepRating), soreness: round(w.avgSoreness), prefilled: { energy: w.avgEnergy != null, sleep: w.avgSleepRating != null, soreness: w.avgSoreness != null },
      fit: null, capacity: null, difficulty: {}, pain: [], stiffness: [], enjoyed: '', disliked: '', next: { minutes: null, days: null, unavailable: [] }, goalChanged: false, missedWhy };
  }

  const shell = (title, build, onClose) => Views.sheet(title, build, onClose);
  const stepBar = n => `<p class="eyebrow" aria-live="polite">Step ${n} of 3</p>`;

  /* ----------------------------------------------- step 1: the numbers */
  function stepNumbers() {
    const S = H().S, week = S.plan.weeks[SESSION.period.weekId];
    const calc = Review.computeWeekStats(S, week, H().todayISO());
    const st = calc.stats;
    shell(`Review: ${fmtDate(week.start)} to ${fmtDate(week.end)}`, (b, close) => {
      b.insertAdjacentHTML('beforeend', stepBar(1));
      b.appendChild(el('h3', null, 'Your week in numbers'));
      b.appendChild(el('div', 'grid4', `
        <div class="stat"><div class="n">${st.completed}/${st.planned}</div><div class="l">planned sessions</div></div>
        <div class="stat"><div class="n">${st.uniqueTrainingDays}</div><div class="l">training days</div></div>
        <div class="stat"><div class="n">${st.additional}</div><div class="l">extra workouts</div></div>
        <div class="stat"><div class="n">${st.completionPct == null ? '–' : st.completionPct + '%'}</div><div class="l">of plan done</div></div>`));
      const lines = [];
      if (st.partial) lines.push(`${plural(st.partial, 'session')} partly done.`);
      if (st.skipped + st.missed) lines.push(`${plural(st.skipped + st.missed, 'planned session')} not done${st.missedForTime ? ` (${st.missedForTime} for time)` : ''}${st.missedForCapacity ? ` (${st.missedForCapacity} for capacity)` : ''}.`);
      if (st.rescheduled) lines.push(`${plural(st.rescheduled, 'session')} moved within the week.`);
      lines.push(`${st.repGains} exercises gained reps at the same weight; ${st.loadGains} went up in weight.`);
      lines.push(`Stretch sessions logged: ${st.stretchSessionsDone}. Recovery sessions logged: ${st.recoverySessionsDone}. Hard sets: ${st.hardSets}.`);
      if (st.painFlags) lines.push(`Pain flagged on ${plural(st.painFlags, 'exercise')}.`);
      if (st.techniqueConcerns) lines.push(`Technique flagged on ${plural(st.techniqueConcerns, 'exercise')}.`);
      const ul = el('ul', 'vlist'); lines.forEach(l => ul.appendChild(el('li', null, esc(l)))); b.appendChild(ul);
      b.appendChild(el('p', 'dim veffect', 'Planned completion is measured against the sessions agreed for the week. Extra workouts are counted separately and never lift it past 100 per cent.'));
      const nr = Review.nutritionReadiness(S, week.start, week.end), w = Review.wellnessSummary(S, week.start, week.end, H().todayISO());
      const gaps = [];
      if (!w.hasImport) gaps.push('No wearable data imported.'); else if (w.stale) gaps.push(`Wearable data ends ${fmtDate(w.coverageEnd)}, too old to use for this week.`);
      if (!nr.ready) gaps.push('Nutrition is not reviewed: ' + nr.missing[0]);
      if (gaps.length) { b.appendChild(el('span', 'eyebrow', 'What is missing')); const g = el('ul', 'vlist'); gaps.forEach(x => g.appendChild(el('li', null, esc(x)))); b.appendChild(g); }
      const notes = Review.notesBetween(S, week.start, week.end);
      b.appendChild(el('span', 'eyebrow', `Your updates this week (${notes.length})`));
      if (notes.length) { const nl = el('ul', 'vlist'); notes.forEach(n => nl.appendChild(el('li', null, `<span class="dim">${esc(fmtDate(n.date))}</span> ${esc(n.text.length > 120 ? n.text.slice(0, 117) + '...' : n.text)}`))); b.appendChild(nl); }
      const addN = el('button', 'btn sm', 'Add a training update'); addN.onclick = () => { Views.closeSheet(); NotesUI.compose({ key: 'review', origin: 'review', onSaved: () => setTimeout(stepNumbers, 50) }); }; b.appendChild(addN);
      const row = el('div', 'row'); row.style.cssText = 'margin-top:14px;flex-wrap:wrap';
      const next = el('button', 'btn primary', 'Continue'); next.onclick = () => stepConversation();
      const skip = el('button', 'btn ghost', 'Skip this review'); skip.onclick = async () => {
        if (!(await Views.confirmSheet('Skip this review?', 'Nothing is invented for the week. The plan carries on as it is, with no automatic increases, and you will be asked again next week.', 'Skip it'))) return;
        Review.carryOverMissed(S, week, Date.now()); H().persist(); Views.closeSheet(); H().renderAll(); H().toast('Skipped. The plan carries on unchanged.');
      };
      row.append(next, skip); b.appendChild(row);
    });
  }

  /* ----------------------------------------- step 2: the conversation */
  function stepConversation() {
    const S = H().S, week = S.plan.weeks[SESSION.period.weekId], ck = SESSION.checkin;
    const calc = Review.computeWeekStats(S, week, H().todayISO());
    shell('How did the week feel?', (b, close) => {
      b.insertAdjacentHTML('beforeend', stepBar(2));
      b.appendChild(el('p', 'muted', 'Answer what you can. Skipped questions are left out, never guessed.'));
      const pre = ck.prefilled || {};
      b.appendChild(Views.scale('Overall', ck.overall, v => { ck.overall = v; }, 'Rough', 'Great'));
      [['energy', 'Energy', 'Flat', 'Fresh'], ['sleep', 'Sleep', 'Poor', 'Great'], ['soreness', 'Soreness', 'None', 'Very sore']].forEach(([k, l, lo, hi]) => {
        b.appendChild(Views.scale(l, ck[k], v => { ck[k] = v; }, lo, hi));
        if (pre[k]) b.appendChild(el('p', 'dim veffect', `Prefilled from your check-ins this week. Change it if it is wrong.`));
      });
      b.appendChild(el('span', 'eyebrow', 'Session length'));
      b.appendChild(Views.chips([{ value: 'too_long', label: 'Too long' }, { value: 'ok', label: 'About right' }, { value: 'too_short', label: 'Could be longer' }], ck.fit, v => { ck.fit = v; }, false, 'Session length'));
      b.appendChild(el('span', 'eyebrow', 'The amount of training'));
      b.appendChild(Views.chips([{ value: 'less', label: 'I needed less' }, { value: 'about_right', label: 'About right' }, { value: 'more', label: 'I could manage more' }], ck.capacity, v => { ck.capacity = v; }, false, 'Capacity'));
      // per exercise
      const exs = calc.exercises.slice(0, 8);
      if (exs.length) {
        b.appendChild(el('span', 'eyebrow', 'How did these feel?'));
        exs.forEach(x => {
          const row = el('div', 'vrow'); row.appendChild(el('span', null, `<b>${esc(x.name)}</b>`));
          row.appendChild(Views.chips([{ value: 'easy', label: 'Too easy' }, { value: 'ok', label: 'About right' }, { value: 'hard', label: 'Too hard' }], ck.difficulty[x.exerciseId] || null, v => { ck.difficulty[x.exerciseId] = v; }, false, x.name));
          b.appendChild(row);
        });
      }
      // pain
      b.appendChild(el('span', 'eyebrow', 'Any pain or discomfort?'));
      const painBox = el('div'); b.appendChild(painBox);
      const paintPain = () => {
        painBox.innerHTML = '';
        const areas = ['Shoulder', 'Elbow', 'Wrist', 'Lower back', 'Hip', 'Knee', 'Ankle', 'Neck', 'Other'];
        painBox.appendChild(Views.chips(areas, ck.pain.map(p => p.area), v => { ck.pain = v.map(a => ck.pain.find(p => p.area === a) || { area: a, note: '' }); paintPain(); }, true, 'Pain areas'));
        ck.pain.forEach(p => { const n = Views.field('text', p.note || '', { maxlength: 120, placeholder: 'Anything useful: when, which exercise', 'aria-label': p.area + ' note' }); n.oninput = () => { p.note = n.value; }; painBox.appendChild(Views.labelled(p.area, n)); });
        if (ck.pain.length) painBox.appendChild(el('p', 'banner bad', '<div><b>This goes to pain review.</b> <span class="muted">No load increases while it is open, and Recomp will not diagnose it or prescribe rehab.</span></div>'));
      };
      paintPain();
      b.appendChild(el('span', 'eyebrow', 'Stiff areas (for stretch time)'));
      b.appendChild(Views.chips(['Neck', 'Shoulders', 'Upper back', 'Lower back', 'Hips', 'Hamstrings', 'Calves'], ck.stiffness, v => { ck.stiffness = v; }, true, 'Stiffness'));
      const en = Views.field('text', ck.enjoyed, { maxlength: 160, 'aria-label': 'What you enjoyed' }); en.oninput = () => { ck.enjoyed = en.value; };
      const di = Views.field('text', ck.disliked, { maxlength: 160, 'aria-label': 'What you did not enjoy' }); di.oninput = () => { ck.disliked = di.value; };
      b.append(Views.labelled('What did you enjoy?', en), Views.labelled('What did you not enjoy?', di));
      // next week
      b.appendChild(el('span', 'eyebrow', 'Next week'));
      const mins = Views.select([{ value: '', label: 'Same as usual' }].concat([20, 30, 40, 45, 60, 75, 90].map(m => ({ value: m, label: m + ' minutes a session' }))), ck.next.minutes || '', v => { ck.next.minutes = v ? Number(v) : null; });
      const days = Views.select([{ value: '', label: 'Same as usual' }].concat([1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: plural(n, 'training day') }))), ck.next.days || '', v => { ck.next.days = v ? Number(v) : null; });
      b.append(Views.labelled('Time per session', mins), Views.labelled('Training days available', days));
      b.appendChild(el('span', 'eyebrow', 'Equipment you will not have next week'));
      b.appendChild(Views.chips(['barbell', 'dumbbell', 'machine', 'cable', 'bands', 'kettlebell'], ck.next.unavailable, v => { ck.next.unavailable = v; }, true, 'Unavailable'));
      const gc = el('label', 'vcheck'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!ck.goalChanged; cb.onchange = () => { ck.goalChanged = cb.checked; }; gc.append(cb, document.createTextNode(' My goals or priorities have changed')); b.appendChild(gc);
      const addN = el('button', 'btn sm', 'Add a training update'); addN.style.marginTop = '8px'; addN.onclick = () => { Views.closeSheet(); NotesUI.compose({ key: 'review', origin: 'review', onSaved: () => setTimeout(stepConversation, 50) }); }; b.appendChild(addN);
      const row = el('div', 'row'); row.style.cssText = 'margin-top:14px;flex-wrap:wrap';
      const back = el('button', 'btn ghost', 'Back'); back.onclick = stepNumbers;
      const go = el('button', 'btn primary', 'Build my report'); go.onclick = () => { ck.completedAt = Date.now(); generate(); };
      row.append(back, go); b.appendChild(row);
    });
  }

  /* ------------------------------------------------ step 3: the report */
  function generate() {
    const S = H().S, week = S.plan.weeks[SESSION.period.weekId], today = H().todayISO();
    // a regenerated report supersedes the earlier draft; a final one is never touched
    S.reviews = (S.reviews || []).map(r => (r.periodEnd === week.end && r.status === 'draft') ? Object.assign(r, { status: 'superseded' }) : r);
    const report = Review.buildReport(S, week, SESSION.checkin, Date.now(), { todayISO: today });
    SESSION.report = report; SESSION.selected = new Set(report.proposals.filter(p => !p.informational && !p.needsConfirm).map(p => p.id)); SESSION.editing = false;
    S.reviews.push(report); H().persist();
    stepReport(); requestAi(report);
  }
  async function requestAi(report) {
    const S = H().S;
    if (H().AUTH_MODE !== 'server') { report.ai = { status: 'unavailable', reason: 'AI feedback needs an account connected to the server. Showing your statistics summary instead.' }; H().persist(); paintAi(); return; }
    report.ai = { status: 'generating' }; paintAi();
    const res = await Review.requestAi(report, S.goals, null, 25000);
    if (SESSION.report !== report) return;
    report.ai = res.status === 'ok' ? { status: 'ok', model: res.model, generatedAt: res.generatedAt || Date.now(), report: res.report, notes: res.payloadNotes } : { status: res.status, reason: res.reason };
    H().persist(); paintAi();
  }
  function aiBlock(report) {
    const ai = report.ai || { status: 'not_requested' };
    const box = el('div', 'card vai'); box.id = 'aiBox';
    if (ai.status === 'generating') { box.innerHTML = '<span class="eyebrow">Written feedback</span><p class="muted"><span class="spinner" aria-hidden="true"></span> Writing your feedback. This takes a few seconds, and if it takes too long your statistics summary is shown instead.</p>'; return box; }
    if (ai.status === 'ok') {
      const r = ai.report;
      box.innerHTML = `<span class="eyebrow">Written feedback · AI-assisted</span><p style="margin:6px 0"><b>${esc(r.headline)}</b></p>`;
      [['What went well', r.wentWell], ['Needs attention', r.needsAttention]].forEach(([t, arr]) => { if (arr.length) { box.appendChild(el('span', 'eyebrow', t)); const ul = el('ul', 'vlist'); arr.forEach(x => ul.appendChild(el('li', null, esc(x.text)))); box.appendChild(ul); } });
      if (r.nextWeek.length) { box.appendChild(el('span', 'eyebrow', 'Next week')); const ul = el('ul', 'vlist'); r.nextWeek.forEach(x => ul.appendChild(el('li', null, esc(x.text)))); box.appendChild(ul); }
      if (r.notesConsidered.length) { box.appendChild(el('span', 'eyebrow', 'About your updates')); const ul = el('ul', 'vlist'); r.notesConsidered.forEach(x => ul.appendChild(el('li', null, `${esc(x.observation)} <span class="pill">${x.kind === 'interpretation' ? 'tentative' : 'what you wrote'}</span>`))); box.appendChild(ul); }
      if (r.caveats.length) r.caveats.forEach(c => box.appendChild(el('p', 'dim', esc(c))));
      box.appendChild(el('p', 'dim veffect', `Wording by an AI service${ai.model ? ' (' + esc(ai.model) + ')' : ''}, generated ${esc(new Date(ai.generatedAt).toLocaleString('en-AU'))}. Every number comes from the statistics above, which the app calculated. Your updates for this week were processed by that service to write this.`));
    } else {
      const fb = Review.fallbackSummary(report);
      box.innerHTML = `<span class="eyebrow">${esc(fb.label)}</span>`;
      const ul = el('ul', 'vlist'); fb.lines.forEach(l => ul.appendChild(el('li', null, esc(l)))); box.appendChild(ul);
      const why = ai.reason || (ai.status === 'not_requested' ? '' : 'AI feedback is not available right now.');
      if (why) box.appendChild(el('p', 'dim', esc(why)));
      if (H().AUTH_MODE === 'server' && ai.status !== 'generating') { const rt = el('button', 'btn sm', 'Try AI feedback again'); rt.onclick = () => requestAi(report); box.appendChild(rt); }
    }
    return box;
  }
  function paintAi() { const old = document.getElementById('aiBox'); if (old) old.replaceWith(aiBlock(SESSION.report)); }

  function stepReport() {
    const S = H().S, report = SESSION.report, week = S.plan.weeks[report.weekId] || Plan.ensureWeek(S, report.periodEnd), today = H().todayISO();
    const stale = Review.staleDraft(S, report);
    shell('Your coach report', (b, close) => {
      b.insertAdjacentHTML('beforeend', stepBar(3));
      b.appendChild(el('p', 'muted', `${esc(fmtDate(report.periodStart))} to ${esc(fmtDate(report.periodEnd))} · generated ${esc(new Date(report.generatedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))} · based on ${plural(report.source.sessions, 'logged session')}${report.source.notes ? ` and ${plural(report.source.notes, 'update')}` : ''}.`));
      if (stale) { const bn = el('div', 'banner', '<div><b>Your records changed after this was written.</b><br><span class="muted">Regenerate it so the report matches what is saved now.</span></div>'); const rg = el('button', 'btn sm', 'Regenerate'); rg.onclick = generate; bn.querySelector('div').appendChild(rg); b.appendChild(bn); }
      if (report.noCheckin) b.appendChild(el('div', 'banner', '<div><b>No check-in answers.</b><br><span class="muted">This report uses your logged training only. Nothing about how the week felt is assumed, and nothing is increased automatically.</span></div>'));
      b.appendChild(aiBlock(report));
      const sect = (title, items, cls) => { if (!items.length) return; b.appendChild(el('span', 'eyebrow', title)); const ul = el('ul', 'vlist ' + (cls || '')); items.forEach(i => ul.appendChild(el('li', null, i))); b.appendChild(ul); };
      sect('What improved (recorded)', report.facts.filter(f => ['rep_gain', 'load_gain', 'sessions', 'days', 'extra', 'technique', 'stretch', 'recovery', 'rest', 'first'].includes(f.kind)).map(f => esc(f.text)));
      sect('What needs attention (recorded)', report.attention.map(f => esc(f.text)));
      sect('What you told me', report.reported.map(f => esc(f.text)));
      sect('Tentative readings', report.interpretations.map(f => esc(f.text) + ' <span class="pill">tentative</span>'));
      sect('Where the records disagree', report.contradictions.map(esc));
      sect('Gaps in the data', report.dataGaps.map(esc));
      // proposals
      b.appendChild(el('h3', null, 'What will change next week'));
      const live = report.proposals.filter(p => !p.informational);
      if (!live.length) b.appendChild(el('p', 'muted', 'Nothing needs to change. The plan stays as it is, and double progression carries on deciding loads from your sets.'));
      const propBox = el('div', 'stack'); b.appendChild(propBox);
      const paintProps = () => {
        propBox.innerHTML = '';
        live.forEach(p => {
          const c = el('div', 'vprop' + (p.safeguard ? ' safeguard' : ''));
          const show = SESSION.editing || p.needsConfirm;
          const id = 'pp-' + p.id;
          c.innerHTML = `<div class="spread">${show ? `<label class="vcheck"><input type="checkbox" id="${id}" ${SESSION.selected.has(p.id) ? 'checked' : ''} ${p.safeguard && !p.ops.length ? 'disabled' : ''}> <b>${esc(p.title)}</b></label>` : `<b>${esc(p.title)}</b>`}${p.needsConfirm ? '<span class="pill hold">needs your OK</span>' : ''}${p.tentative ? '<span class="pill">tentative</span>' : ''}</div>
            <p class="muted" style="margin:4px 0">${esc(p.reason)}</p>${p.ops.length ? '<ul class="vlist">' + p.ops.slice(0, 6).map(o => '<li>' + esc(o.text) + '</li>').join('') + '</ul>' : ''}`;
          const cb = c.querySelector('input'); if (cb) cb.onchange = () => { if (cb.checked) SESSION.selected.add(p.id); else SESSION.selected.delete(p.id); paintSched(); };
          propBox.appendChild(c);
        });
        const hold = report.proposals.filter(p => p.informational);
        hold.forEach(p => propBox.appendChild(el('div', 'vprop', `<b>${esc(p.title)}</b><p class="muted" style="margin:4px 0">${esc(p.reason)}</p>`)));
      };
      paintProps();
      // stays the same
      const v = Plan.currentVersion(S);
      const mains = Array.from(new Set([].concat(...v.template.days.map(d => d.exercises.filter(e => e.role === 'main').map(e => e.id))))).map(Views.exName);
      b.appendChild(el('span', 'eyebrow', 'What stays the same'));
      b.appendChild(el('p', 'muted', `Your core lifts (${esc(mains.slice(0, 6).join(', '))}) stay in the plan so progress can be measured. Loads still change only through double progression, from your own logged sets.`));
      // schedule
      b.appendChild(el('h3', null, 'Next week\'s complete schedule'));
      const schedBox = el('div'); b.appendChild(schedBox);
      const paintSched = () => {
        const chosen = report.proposals.filter(p => SESSION.selected.has(p.id) && !p.informational);
        const sched = chosen.length ? Review.previewSchedule(S, week, chosen, today) : currentNext(S, week);
        schedBox.innerHTML = '';
        const ul = el('ul', 'vlist'); sched.forEach(s => ul.appendChild(el('li', null, `<b>${esc(fmtDate(s.date))}</b> ${esc(s.label)}${s.kind === 'training' ? ' · ' + Math.round(s.minutes) + ' min' : ''}`))); schedBox.appendChild(ul);
        schedBox.appendChild(el('p', 'dim veffect', chosen.length ? 'This is what the plan will look like if you accept the selected changes.' : 'This is the current plan for next week, unchanged.'));
      };
      paintSched();
      // notes considered
      if (report.notesConsidered.length) {
        b.appendChild(el('span', 'eyebrow', 'Your updates that were considered'));
        const ul = el('ul', 'vlist');
        report.notesConsidered.forEach(n => ul.appendChild(el('li', null, `<span class="dim">${esc(fmtDate(n.date))}${n.category ? ' · ' + esc(n.category) : ''}</span> ${esc(n.text)} ${n.selfReported ? '<span class="pill">self-reported</span>' : ''}${n.deleted ? ' <span class="pill">deleted</span>' : ''} <button class="btn sm ghost" data-note="${esc(n.noteId)}">Open</button>`)));
        b.appendChild(ul);
        ul.querySelectorAll('[data-note]').forEach(bt => bt.onclick = () => { const n = (S.notes || []).find(x => x.id === bt.dataset.note); if (n) { Views.closeSheet(); NotesUI.compose({ edit: n, onSaved: null }); } else H().toast('That update was deleted.', 'warn'); });
      }
      // decision
      const row = el('div', 'row'); row.style.cssText = 'margin-top:16px;flex-wrap:wrap';
      const accept = el('button', 'btn primary', live.length ? 'Accept next week\'s plan' : 'Accept (no changes)'); accept.id = 'rvAccept';
      const edit = el('button', 'btn', SESSION.editing ? 'Done editing' : 'Edit'); edit.id = 'rvEdit';
      const keep = el('button', 'btn ghost', 'Keep current plan'); keep.id = 'rvKeep';
      accept.onclick = () => decide('accept'); keep.onclick = () => decide('keep');
      edit.onclick = () => { SESSION.editing = !SESSION.editing; edit.textContent = SESSION.editing ? 'Done editing' : 'Edit'; paintProps(); };
      row.append(accept, edit, keep); b.appendChild(row);
      b.appendChild(el('p', 'dim veffect', 'Accept saves a new dated plan version from next week. Keep current plan changes nothing. Either way, completed workouts are never touched, and you can go back from Plan history.'));
    });
  }
  function currentNext(S, week) {
    const nw = Plan.ensureWeek(S, Plan.addDays(week.end, 1));
    return nw.slots.map(s => ({ date: s.date, kind: s.kind, label: s.label, minutes: s.kind === 'training' ? Plan.sessionRoster(S, s).minutes : s.minutes }));
  }

  function decide(kind) {
    const S = H().S, report = SESSION.report, today = H().todayISO();
    if (Review.staleDraft(S, report)) { H().toast('Your records changed. Regenerate the report first.', 'warn'); return; }
    const before = S.plan.versions.length;
    const sel = kind === 'keep' ? [] : Array.from(SESSION.selected);
    const res = Review.finaliseReport(S, report, kind, sel, Date.now(), today);
    H().persist();
    // the message is built from what was actually saved
    Views.closeSheet();
    shell(kind === 'keep' ? 'Plan kept' : 'Review finished', (b) => {
      if (kind === 'keep' || !res.applied.length) {
        b.appendChild(el('p', null, kind === 'keep' ? '<b>You kept the current plan.</b> Nothing in it changed.' : '<b>No changes were needed.</b> The plan stays as it is.'));
      } else {
        const nv = S.plan.versions.length > before ? Plan.currentVersion(S) : null;
        b.appendChild(el('p', null, `<b>Plan updated${nv ? ` (version ${nv.n}, from ${esc(fmtDate(nv.effectiveFrom))})` : ''}.</b> These changes are saved:`));
        const ul = el('ul', 'vlist'); res.applied.forEach(a => ul.appendChild(el('li', null, esc(a)))); b.appendChild(ul);
      }
      b.appendChild(el('p', 'dim', 'Your report is saved in Weekly reviews.'));
      const row = el('div', 'row'); row.style.cssText = 'flex-wrap:wrap;margin-top:10px';
      const pl = el('button', 'btn primary', 'See my plan'); pl.onclick = () => { Views.closeSheet(); H().go('plan'); };
      row.appendChild(pl);
      if (H().AUTH_MODE === 'server') { const sc = el('button', 'btn', 'Send to my coach'); sc.onclick = () => submitToCoach(report); row.appendChild(sc); }
      b.appendChild(row);
    });
    H().renderAll();
  }

  /* optional: through the existing review and permission system */
  async function submitToCoach(report) {
    const slim = { periodStart: report.periodStart, periodEnd: report.periodEnd, stats: report.stats, facts: report.facts, attention: report.attention, reported: report.reported,
      interpretations: report.interpretations, contradictions: report.contradictions, dataGaps: report.dataGaps,
      notesConsidered: report.notesConsidered.map(n => ({ date: n.date, category: n.category, text: n.text, selfReported: n.selfReported })),
      proposals: report.proposals.map(p => ({ kind: p.kind, title: p.title, reason: p.reason })), decision: report.decision ? { kind: report.decision.kind, appliedChanges: report.decision.appliedChanges } : null,
      ai: report.ai && report.ai.status === 'ok' ? { headline: report.ai.report.headline } : null };
    try {
      const v = Plan.currentVersion(H().S);
      const r = await AUTH.api('/api/weekly-submissions', { method: 'POST', body: { weekStart: report.periodStart, report: slim, planVersionId: v ? v.id : null } });
      if (r.status === 200) H().toast('Sent to your coach.');
      else if (r.data && r.data.error === 'no_coach') H().toast('You do not have a coach assigned yet.', 'warn');
      else if (r.status === 403) H().toast('Coach review is not enabled for your account.', 'warn');
      else if (r.data && r.data.error === 'already_approved') H().toast('Your coach already approved this week.', 'warn');
      else H().toast((r.data && (r.data.message || r.data.error)) || 'Could not send it. Try again later.', 'warn');
    } catch (e) { H().toast('Could not reach the server.', 'warn'); }
  }

  /* ------------------------------------------------------------- history */
  function openHistory() {
    const S = H().S;
    shell('Weekly reviews', (b) => {
      const list = (S.reviews || []).filter(r => r.status !== 'superseded').slice().sort((a, c) => a.periodEnd < c.periodEnd ? 1 : -1);
      if (!list.length) b.appendChild(el('p', 'muted', 'No reviews yet. Your first one appears when your first full training week ends.'));
      list.forEach(r => {
        const d = r.decision || {}; const st = r.stats || {};
        const c = el('div', 'vver');
        const outcome = r.status === 'missed' ? 'Skipped: the plan carried on unchanged' : r.status === 'draft' ? 'Draft, not finished' : d.kind === 'keep' ? 'You kept the plan' : (d.appliedChanges || []).length ? `Plan updated (${plural(d.appliedChanges.length, 'change')})` : 'No changes needed';
        c.innerHTML = `<div class="spread"><b>${esc(fmtDate(r.periodStart))} to ${esc(fmtDate(r.periodEnd))}</b><span class="pill ${r.status === 'final' ? 'go' : ''}">${esc(r.status)}</span></div>
          <p class="muted" style="margin:4px 0">${st.planned != null ? `${st.completed}/${st.planned} planned sessions · ${st.uniqueTrainingDays} training days` : ''}</p><p class="muted" style="margin:0 0 6px">${esc(outcome)}</p>`;
        if (r.status !== 'missed') {
          const v = el('button', 'btn sm', r.status === 'draft' ? 'Continue' : 'Read report');
          v.onclick = () => { if (r.status === 'draft') { SESSION.period = { sch: Review.reviewSchedule(S, Date.now()), weekId: r.weekId }; SESSION.report = r; SESSION.checkin = r.checkin || prefill(S, S.plan.weeks[r.weekId]); SESSION.selected = new Set(r.proposals.filter(p => !p.informational && !p.needsConfirm).map(p => p.id)); stepReport(); } else readOnly(r); };
          c.appendChild(v);
        }
        b.appendChild(c);
      });
      const ph = el('button', 'btn ghost block', 'Plan history'); ph.style.marginTop = '12px'; ph.onclick = () => { Views.closeSheet(); PlanUI.openHistory(); }; b.appendChild(ph);
    });
  }
  function readOnly(r) {
    shell(`Report: ${fmtDate(r.periodStart)} to ${fmtDate(r.periodEnd)}`, (b) => {
      b.appendChild(aiBlock(r));
      const sect = (t, arr) => { if (!arr || !arr.length) return; b.appendChild(el('span', 'eyebrow', t)); const ul = el('ul', 'vlist'); arr.forEach(x => ul.appendChild(el('li', null, esc(x.text || x)))); b.appendChild(ul); };
      sect('Recorded', r.facts); sect('Needs attention', r.attention); sect('What you told me', r.reported); sect('Gaps', r.dataGaps);
      const d = r.decision || {};
      b.appendChild(el('span', 'eyebrow', 'What was decided'));
      b.appendChild(el('p', 'muted', esc(d.kind === 'keep' ? 'You kept the current plan.' : (d.appliedChanges || []).length ? 'Changes saved: ' + d.appliedChanges.join(' ') : 'No changes were needed.')));
      b.appendChild(el('p', 'dim veffect', 'This report is a record of what was known at the time. It is not edited when your logs change later.'));
    });
  }

  return { open, openHistory, autoCarryOver, submitToCoach, _s: SESSION };
})();
window.ReviewUI = ReviewUI;
