/* ============================================================================
   Recomp weekly review engine.

   Every number in a report is computed here, in application code, from the
   user's own records. The AI service is given the verified results and asked
   only for wording; it can never change a prescription. Proposals come from the
   rules below, which sit on top of double progression and the pain and
   recovery safeguards, and every accepted proposal produces a real, saved change
   to the plan (plan.js).

   Three kinds of statement are kept apart everywhere:
     recorded        computed from logged sessions, check-ins and imports
     reported        what the user said in the check-in or in a written update
     interpretation  a tentative reading of the two, always worded as tentative
   ========================================================================== */
const Review = (function () {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const P = NODE ? require('./plan.js') : Plan;
  const E = NODE ? require('./engine.js') : {
    resolveSettings: (...a) => window.resolveSettings(...a), evaluateEntry: (...a) => window.evaluateEntry(...a),
    effectiveEx: (...a) => window.effectiveEx(...a), proposeDeload: (...a) => window.proposeDeload(...a),
    openConcernFor: (...a) => window.openConcernFor(...a), openPainConcern: (...a) => window.openPainConcern(...a),
    get TUNING() { return TUNING; }, get EFFORT_SCALE() { return EFFORT_SCALE; }
  };
  const C = NODE ? require('./core.js') : {
    addDays: (...a) => window.addDays(...a), daysBetween: (...a) => window.daysBetween(...a), checksum: (...a) => window.checksum(...a),
    macroTargets: (...a) => window.macroTargets(...a), weeklyRate: (...a) => window.weeklyRate(...a), trailingAverage: (...a) => window.trailingAverage(...a)
  };
  const X = NODE ? require('./exercises.js') : { get EX_INDEX() { return EX_INDEX; } };
  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : null;
  const plural = (n, w, w2) => n + ' ' + (n === 1 ? w : (w2 || w + 's'));

  /* ------------------------------------------------------------ timezone */
  function localParts(ms, tz) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const o = {}; f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
    return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) % 24, minute: Number(o.minute) };
  }
  const localDate = (ms, tz) => localParts(ms, tz).date;

  /* ----------------------------------------------------------- due logic */
  /* The training week ends on the review day, so a review period is exactly one
     training week. The check-in is due from the review time on that day. */
  function reviewSchedule(state, nowMs) {
    const g = state.goals; if (!g || !state.plan) return null;
    const tz = g.timezone || 'Australia/Sydney';
    const now = localParts(nowMs, tz);
    const [hh, mm] = String(g.reviewTime || '18:00').split(':').map(Number);
    const dow = P.isoDow(now.date);
    const back = (dow - g.reviewDay + 7) % 7;                 // days since the most recent review day
    let reviewDate = P.addDays(now.date, -back);
    const reachedTime = back > 0 || (now.hour * 60 + now.minute >= hh * 60 + mm);
    if (!reachedTime) reviewDate = P.addDays(reviewDate, -7);
    const periodEnd = reviewDate, periodStart = P.addDays(reviewDate, -6);
    const nextReview = P.addDays(reviewDate, 7);
    const existing = (state.reviews || []).find(r => r.periodEnd === periodEnd && r.status !== 'superseded') || null;
    const planStart = state.plan.versions[0] ? state.plan.versions[0].effectiveFrom : null;
    const hasData = planStart && planStart <= periodEnd;
    const daysLate = P.diffDays(periodEnd, now.date);
    let status = 'upcoming';
    if (!hasData) status = 'upcoming';
    else if (existing && existing.status === 'final') status = 'done';
    else if (existing && existing.status === 'dismissed') status = 'dismissed';
    else status = daysLate >= 2 ? 'overdue' : 'due';
    return { tz, today: now.date, periodStart, periodEnd, reviewDate, nextReview, status, daysLate: Math.max(0, daysLate),
      daysUntilNext: P.diffDays(now.date, nextReview), existing, hasData, reviewTime: g.reviewTime };
  }

  /* ----------------------------------------------------- written updates */
  const NOTE_CATEGORIES = ['progress', 'energy', 'technique', 'schedule', 'recovery', 'preferences', 'pain'];
  function addNote(state, spec, nowMs, tz) {
    state.notes = state.notes || [];
    const text = String(spec.text || '').trim();
    if (!text) return { ok: false, problems: ['Write something first.'] };
    if (text.length > 1200) return { ok: false, problems: ['Keep an update under 1,200 characters.'] };
    const cat = NOTE_CATEGORIES.indexOf(spec.category) >= 0 ? spec.category : null;
    const n = { id: uid('nt'), text, category: cat, author: spec.author || 'self',
      date: spec.date || localDate(nowMs, tz || 'Australia/Sydney'), createdAt: nowMs, editedAt: null,
      linked: spec.linked ? { sessionId: spec.linked.sessionId || null, exerciseId: spec.linked.exerciseId || null, slotId: spec.linked.slotId || null } : null,
      /* A note describing an unlogged workout stays self-reported unless the user links a logged session. */
      selfReportedWorkout: !!spec.selfReportedWorkout, origin: spec.origin || 'today' };
    state.notes.push(n);
    if (n.category === 'pain' && n.linked && n.linked.exerciseId) E.openPainConcern(state, { location: 'reported in a written update', severity: null, note: null }, n.linked.exerciseId, n.date);
    return { ok: true, note: n };
  }
  function editNote(state, id, patch, nowMs) {
    const n = (state.notes || []).find(x => x.id === id); if (!n) return { ok: false, problems: ['Update not found.'] };
    if (patch.text != null) { const t = String(patch.text).trim(); if (!t) return { ok: false, problems: ['An update cannot be empty. Delete it instead.'] }; n.text = t.slice(0, 1200); }
    if (patch.category !== undefined) n.category = NOTE_CATEGORIES.indexOf(patch.category) >= 0 ? patch.category : null;
    n.editedAt = nowMs;
    return { ok: true, note: n };
  }
  /* Deleting removes the note everywhere, including text copied into stored reports. */
  function deleteNote(state, id) {
    const before = (state.notes || []).length;
    state.notes = (state.notes || []).filter(n => n.id !== id);
    (state.reviews || []).forEach(r => {
      (r.notesConsidered || []).forEach(nc => { if (nc.noteId === id) { nc.text = '[deleted by you]'; nc.deleted = true; } });
      if (r.ai && r.ai.report && r.ai.report.notesConsidered) r.ai.report.notesConsidered = r.ai.report.notesConsidered.filter(x => x.noteId !== id);
    });
    (state.noteSuggestions || []).forEach(s => { if (s.noteId === id && s.status === 'pending') s.status = 'withdrawn'; });
    return { ok: before !== state.notes.length };
  }
  function saveDraft(state, key, draft, nowMs) {
    state.noteDrafts = state.noteDrafts || {};
    if (!draft || !String(draft.text || '').trim()) { delete state.noteDrafts[key]; return; }
    state.noteDrafts[key] = Object.assign({}, draft, { savedAt: nowMs });
  }
  const getDraft = (state, key) => (state.noteDrafts || {})[key] || null;
  const notesBetween = (state, start, end) => (state.notes || []).filter(n => n.date >= start && n.date <= end).sort((a, b) => a.createdAt - b.createdAt);

  /* Suggestions found in a note are SHOWN for confirmation; nothing is applied
     until the user says yes. Deterministic keyword rules, not a model. */
  function extractSuggestions(state, note) {
    const t = note.text.toLowerCase(); const out = [];
    const add = (kind, text, apply) => out.push({ id: uid('sg'), noteId: note.id, kind, text, apply, status: 'pending', at: Date.now() });
    const names = Object.values(X.EX_INDEX).filter(e => !e.libraryOnly);
    const mentioned = names.filter(e => t.includes((e.short || e.name).toLowerCase()) || t.includes(e.name.toLowerCase()));
    if (/(hate|dislike|can't stand|cannot stand|don't like|do not like)/.test(t)) mentioned.forEach(e => add('preference', `Avoid ${e.name} in future plans?`, { op: 'dislike', exerciseId: e.id }));
    if (/(enjoy|loved|love|liked|really like)/.test(t)) mentioned.forEach(e => add('preference', `Keep ${e.name} as an exercise you enjoy?`, { op: 'like', exerciseId: e.id }));
    const mins = t.match(/(?:only have|only got|about|around)?\s*(\d{2})\s*(?:min|minutes)\b/);
    if (/(shorter|less time|short on time|only have|only got)/.test(t) && mins && Number(mins[1]) >= 15 && Number(mins[1]) <= 90)
      add('duration', `Plan sessions of about ${mins[1]} minutes?`, { op: 'sessionMinutes', value: Number(mins[1]) });
    const times = t.match(/(?:only )?trained (once|twice|three times|\d)\b/);
    if (/(busy|work was|no time|travel)/.test(t) && times) add('schedule', 'Plan fewer training days while it is busy?', { op: 'daysDelta', value: -1 });
    if (/\b(knee|shoulder|elbow|back|hip|wrist|ankle|neck)\b[^.]*\b(pain|hurt|sore|twinge|sharp|ache)/.test(t) || note.category === 'pain')
      add('pain', 'Pain or discomfort was mentioned. Open it for review?', { op: 'pain_review', exerciseId: note.linked && note.linked.exerciseId || null });
    note._suggested = true;
    state.noteSuggestions = (state.noteSuggestions || []).concat(out);
    return out;
  }
  /* Applying a confirmed suggestion changes goals/preferences, never silently. */
  function applySuggestion(state, id, nowMs) {
    const s = (state.noteSuggestions || []).find(x => x.id === id); if (!s || s.status !== 'pending') return { ok: false };
    const g = state.goals; const a = s.apply;
    if (a.op === 'dislike') { g.preferences.disliked = Array.from(new Set((g.preferences.disliked || []).concat([a.exerciseId]))); g.preferences.liked = (g.preferences.liked || []).filter(x => x !== a.exerciseId); }
    else if (a.op === 'like') g.preferences.liked = Array.from(new Set((g.preferences.liked || []).concat([a.exerciseId])));
    else if (a.op === 'sessionMinutes') g.sessionMinutes = a.value;
    else if (a.op === 'daysDelta') g.daysPerWeek = Math.max(1, g.daysPerWeek + a.value);
    else if (a.op === 'pain_review') { state.painReviews = (state.painReviews || []).concat([{ id: uid('pr'), noteId: s.noteId, exerciseId: a.exerciseId, at: nowMs, status: 'open' }]);
      if (a.exerciseId) E.openPainConcern(state, { location: 'reported in a written update' }, a.exerciseId, new Date(nowMs).toISOString().slice(0, 10)); }
    g.updatedAt = nowMs; s.status = 'accepted'; s.decidedAt = nowMs;
    return { ok: true, needsPlanRegeneration: ['dislike', 'sessionMinutes', 'daysDelta'].indexOf(a.op) >= 0 };
  }
  function dismissSuggestion(state, id) { const s = (state.noteSuggestions || []).find(x => x.id === id); if (s) s.status = 'dismissed'; return !!s; }

  /* ---------------------------------------------------------- statistics */
  const WEEKS_SESSIONS = (state, start, end) => (state.sessions || []).filter(s => s.status === 'completed' && s.date >= start && s.date <= end);
  function performedSets(sess) {
    let n = 0; (sess.entries || []).forEach(e => { if (!e.skipped) n += (e.sets || []).filter(s => !s.warmup && s.role !== 'backoff' && (s.status === 'confirmed' || s.status === 'edited')).length; });
    return n;
  }
  function plannedSets(sess) {
    let n = 0; (sess.entries || []).forEach(e => { n += (e.sets || []).filter(s => !s.warmup && s.role !== 'backoff').length; });
    return n;
  }
  function exerciseChanges(state, start, end) {
    const out = [];
    const byVariant = {};
    WEEKS_SESSIONS(state, start, end).forEach(s => (s.entries || []).forEach(e => { if (!e.skipped && e.sets && e.sets.length) (byVariant[e.variantId] = byVariant[e.variantId] || []).push({ s, e }); }));
    Object.keys(byVariant).forEach(id => {
      const ex = X.EX_INDEX[id]; if (!ex) return;
      const settings = E.resolveSettings(state, ex), eff = E.effectiveEx(ex, settings);
      const cur = byVariant[id].map(x => ({ x, ev: E.evaluateEntry(x.e, settings, eff) })).filter(x => x.ev.baseline != null);
      if (!cur.length) return;
      const best = cur[cur.length - 1];
      // the last comparable session before this period
      const prior = [];
      (state.sessions || []).filter(s => s.status === 'completed' && s.date < start).sort((a, b) => a.date < b.date ? -1 : 1).forEach(s => (s.entries || []).forEach(e => {
        if (e.variantId === id && !e.skipped) { const ev = E.evaluateEntry(e, settings, eff); if (ev.baseline != null && !(e.decision && e.decision.action === 'deload')) prior.push({ s, ev }); } }));
      const p = prior[prior.length - 1] || null;
      const reps = best.ev.atLoadReps, total = reps.reduce((a, b) => a + b, 0);
      const rec = { exerciseId: id, name: ex.short || ex.name, load: best.ev.baseline, reps, date: best.x.s.date, kind: 'first', detail: '' };
      if (p) {
        const pTotal = p.ev.atLoadReps.reduce((a, b) => a + b, 0);
        const assisted = ex.modality === 'assisted';
        const loadUp = assisted ? best.ev.baseline < p.ev.baseline : best.ev.baseline > p.ev.baseline;
        if (loadUp) { rec.kind = 'load_gain'; rec.from = p.ev.baseline; }
        else if (best.ev.baseline === p.ev.baseline && total > pTotal) { rec.kind = 'rep_gain'; rec.from = pTotal; rec.fromReps = p.ev.atLoadReps; }
        else if (best.ev.baseline === p.ev.baseline && total === pTotal) rec.kind = 'same';
        else rec.kind = 'down';
      }
      rec.earned = !!(best.x.e.decision && best.x.e.decision.flags && (best.x.e.decision.flags.includes('progress_load') || best.x.e.decision.flags.includes('progress_assist')));
      rec.technique = best.x.e.feedback && best.x.e.feedback.technique || null;
      rec.effort = best.x.e.feedback && best.x.e.feedback.effort || null;
      rec.reserve = best.x.e.feedback && best.x.e.feedback.reserve != null ? best.x.e.feedback.reserve : null;
      rec.capacity = best.x.e.feedback && best.x.e.feedback.capacity || null;
      rec.hasFeedback = !!(rec.effort || rec.reserve != null);
      rec.pain = !!(best.x.e.feedback && best.x.e.feedback.pain && best.x.e.feedback.pain.present);
      out.push(rec);
    });
    return out;
  }
  /* too easy / appropriate / too hard, from the effort and reserve that were recorded */
  function difficultyOf(rec) {
    if (!rec.hasFeedback) return null;
    if (rec.capacity === 'needed_less' || rec.effort === 'maximum' || rec.reserve === 0) return 'hard';
    if (rec.effort === 'very_easy' || (rec.effort === 'manageable' && (rec.reserve == null || rec.reserve >= 3)) || rec.reserve === '4+' || rec.reserve >= 4) return 'easy';
    return 'ok';
  }

  function computeWeekStats(state, week, nowISO) {
    const slots = week.slots;
    const trainSlots = slots.filter(s => s.kind === 'training');
    const planned = trainSlots.length;
    const completed = trainSlots.filter(s => s.status === 'completed').length;
    const partial = trainSlots.filter(s => s.status === 'partial').length;
    const skipped = trainSlots.filter(s => s.status === 'skipped');
    const missed = trainSlots.filter(s => s.status === 'missed');
    const stillPlanned = trainSlots.filter(s => s.status === 'planned').length;
    const rescheduled = slots.filter(s => ['training', 'conditioning'].includes(s.kind) && s.moves.length > 0).length;
    const onTime = trainSlots.filter(s => s.status === 'completed' && (s.completedOn || s.date) === s.agreedDate).length;
    const extraSessions = WEEKS_SESSIONS(state, week.start, week.end).filter(s => s.extra && !s.replacesSlotId);
    const sessions = WEEKS_SESSIONS(state, week.start, week.end);
    const trainDates = new Set(); sessions.forEach(s => { if (performedSets(s) > 0 || s.condPts > 0) trainDates.add(s.date); });
    const condSlots = slots.filter(s => s.kind === 'conditioning');
    const stretchSlots = slots.filter(s => s.kind === 'stretch');
    const stretchLogs = (state.stretchLog || []).filter(l => l.date >= week.start && l.date <= week.end && l.type !== 'recovery');
    const recoveryLogs = (state.stretchLog || []).filter(l => l.date >= week.start && l.date <= week.end && l.type === 'recovery');
    const restDays = slots.filter(s => ['rest', 'recovery'].includes(s.kind));
    const minsPlanned = trainSlots.reduce((a, s) => a + (s.minutes || 0), 0);
    const minsDone = sessions.reduce((a, s) => a + Math.round(((s.endedAt || s.startedAt) - s.startedAt) / 60000) , 0);
    const ex = exerciseChanges(state, week.start, week.end);
    const load = P.weekLoad(state, week);
    const stats = {
      planned, completed, partial, missed: missed.length, skipped: skipped.length, stillPlanned, rescheduled,
      additional: extraSessions.length, uniqueTrainingDays: trainDates.size,
      completionPct: pct(Math.min(completed, planned), planned),            // planned sessions only; extras never lift it
      onTimePct: pct(onTime, planned),
      conditioningPlanned: condSlots.length, conditioningDone: condSlots.filter(s => s.status === 'completed').length,
      stretchSessionsPlanned: stretchSlots.length, stretchSessionsDone: stretchLogs.length,
      recoverySessionsDone: recoveryLogs.length, restDaysKept: restDays.length,
      hardSets: load.hardSets, conditioningMinutes: load.conditioningMinutes,
      repGains: ex.filter(x => x.kind === 'rep_gain').length, loadGains: ex.filter(x => x.kind === 'load_gain').length,
      exercisesLogged: ex.length, painFlags: ex.filter(x => x.pain).length,
      techniqueConcerns: ex.filter(x => x.technique === 'deteriorating').length,
      missedForTime: skipped.concat(missed).filter(s => s.missReason === 'time').length,
      missedForCapacity: skipped.concat(missed).filter(s => s.missReason === 'capacity').length,
      plannedMinutes: minsPlanned
    };
    return { stats, exercises: ex, load, slots: { trainSlots, skipped, missed } };
  }

  /* wellness, nutrition and data coverage, with honest staleness */
  const STALE_DAYS = 3;
  function wellnessSummary(state, start, end, todayISO) {
    const w = state.wellness || {};
    const sleep = (w.sleep || []).filter(x => x.date >= start && x.date <= end);
    const imports = (w.imports || []).filter(i => i.kind !== 'activity' || true);
    const coverageEnd = imports.reduce((m, i) => (i.coverage && i.coverage.to > m ? i.coverage.to : m), '');
    const out = { sleepNights: sleep.length, avgSleepHours: sleep.length ? Math.round(sleep.reduce((a, x) => a + x.hours, 0) / sleep.length * 10) / 10 : null,
      coverageEnd: coverageEnd || null, stale: !coverageEnd || P.diffDays(coverageEnd, todayISO) > STALE_DAYS, hasImport: imports.length > 0 };
    const cks = WEEKS_SESSIONS(state, start, end).map(s => s.checkin).filter(Boolean);
    const avg = k => { const v = cks.map(c => c[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; };
    out.checkins = cks.length; out.avgEnergy = avg('energy'); out.avgSleepRating = avg('sleep'); out.avgSoreness = avg('soreness');
    return out;
  }
  function nutritionReadiness(state, start, end) {
    const days = []; for (let d = start; d <= end; d = P.addDays(d, 1)) days.push(d);
    const intake = state.intake || {};
    const logged = days.filter(d => intake[d] && intake[d].kcal > 0).length;
    const from = P.addDays(end, -13);
    const bw = (state.bodyweight || []).filter(b => b.date >= from && b.date <= end);
    const span = bw.length >= 2 ? P.diffDays(bw[0].date, bw[bw.length - 1].date) : 0;
    const missing = [];
    if (logged < 5) missing.push(`Food intake was logged on ${logged} of ${days.length} days. At least 5 are needed.`);
    if (bw.length < 3 || span < 10) missing.push(`Weigh-ins: ${bw.length} in the last 14 days spanning ${span} days. At least 3, over 10 days or more, are needed.`);
    return { ready: missing.length === 0, loggedDays: logged, totalDays: days.length, weighIns: bw.length, spanDays: span, missing };
  }

  /* --------------------------------------------------------------- facts */
  function buildFacts(state, week, calc, wellness, nowISO) {
    const s = calc.stats; const facts = [], attention = []; let n = 0;
    const F = (arr, kind, text, extra) => { arr.push(Object.assign({ id: 'f' + (++n), kind, text, basis: 'recorded' }, extra || {})); };
    if (s.planned > 0) F(facts, 'sessions', `${s.completed} of ${s.planned} planned sessions were completed${s.partial ? `, plus ${s.partial} partly done` : ''}.`);
    F(facts, 'days', `${plural(s.uniqueTrainingDays, 'training day')} with logged training.`);
    if (s.additional) F(facts, 'extra', `${plural(s.additional, 'additional workout')} done on top of the plan. These do not count towards planned-session completion.`);
    if (s.rescheduled) F(facts, 'rescheduled', `${plural(s.rescheduled, 'session')} moved within the week.`);
    calc.exercises.filter(x => x.kind === 'rep_gain').forEach(x => F(facts, 'rep_gain', `${x.name}: ${x.reps.join(' / ')} reps at ${x.load} kg, up from ${x.fromReps ? x.fromReps.join(' / ') : x.from} at the same weight.`, { exerciseId: x.exerciseId }));
    calc.exercises.filter(x => x.kind === 'load_gain').forEach(x => F(facts, 'load_gain', `${x.name}: now ${x.load} kg, up from ${x.from} kg${x.earned ? ' (an increase the progression rules had earned)' : ''}.`, { exerciseId: x.exerciseId }));
    calc.exercises.filter(x => x.kind === 'first').forEach(x => F(facts, 'first', `${x.name}: first logged performance, ${x.reps.join(' / ')} reps at ${x.load} kg.`, { exerciseId: x.exerciseId }));
    const controlled = calc.exercises.filter(x => x.technique === 'controlled').length;
    if (controlled) F(facts, 'technique', `Technique was logged as controlled on ${plural(controlled, 'exercise')}.`);
    if (s.stretchSessionsDone) F(facts, 'stretch', `${plural(s.stretchSessionsDone, 'stretch session')} logged.`);
    if (s.recoverySessionsDone) F(facts, 'recovery', `${plural(s.recoverySessionsDone, 'recovery session')} logged.`);
    if (s.restDaysKept && calc.slots.trainSlots.length) F(facts, 'rest', `${plural(s.restDaysKept, 'rest or recovery day')} in the week, all valid parts of the plan.`);
    // needs attention
    if (s.missed + s.skipped > 0) F(attention, 'missed', `${plural(s.missed + s.skipped, 'planned session')} not done${s.missedForTime ? ` (${s.missedForTime} for lack of time)` : ''}${s.missedForCapacity ? ` (${s.missedForCapacity} because it was too much)` : ''}.`);
    calc.exercises.filter(x => x.kind === 'down').forEach(x => F(attention, 'down', `${x.name}: ${x.reps.join(' / ')} reps at ${x.load} kg, lower than the previous comparable session.`, { exerciseId: x.exerciseId }));
    if (s.painFlags) F(attention, 'pain', `Pain or discomfort was flagged on ${plural(s.painFlags, 'exercise')}. That goes to review, not to progression.`);
    if (s.techniqueConcerns) F(attention, 'technique_concern', `Technique was logged as deteriorating on ${plural(s.techniqueConcerns, 'exercise')}.`);
    const noFb = calc.exercises.filter(x => !x.hasFeedback).length;
    if (noFb) F(attention, 'feedback_missing', `No effort feedback on ${plural(noFb, 'exercise')}, so those cannot unlock a load increase.`);
    return { facts, attention };
  }

  /* --------------------------------------------------------- proposals */
  const mkProposal = (kind, title, reason, ops, extra) => Object.assign({ id: uid('pp'), kind, title, reason, ops: ops || [], needsConfirm: false, evidence: [] }, extra || {});
  /*
     checkin = { overall:1-5|null, energy, sleep, soreness (1-5|null), difficulty:{exerciseId:'easy'|'ok'|'hard'},
                 pain:[{area, exerciseId?, note?}], fit:'ok'|'too_long'|'too_short'|null, capacity:'more'|'about_right'|'less'|null,
                 missedWhy:{slotId:'time'|'capacity'|...}, next:{minutes:int|null, days:int|null, unavailable:[equip]},
                 enjoyed:string, disliked:string, goalChanged:boolean }
  */
  function buildProposals(state, week, calc, wellness, checkin, todayISO, opts) {
    opts = opts || {};
    const ck = checkin || null;
    const out = [], blocked = [];
    const s = calc.stats;
    const v = P.versionById(state, week.versionId) || P.currentVersion(state);
    const nextStart = P.addDays(week.end, 1);
    const goals = state.goals;

    // R0. Pain and technique take precedence over everything else.
    const painAreas = (ck && ck.pain || []).slice();
    (state.notes || []).filter(n => n.category === 'pain' && n.date >= week.start && n.date <= week.end).forEach(n => painAreas.push({ area: 'written update', noteId: n.id, exerciseId: n.linked && n.linked.exerciseId }));
    calc.exercises.filter(x => x.pain).forEach(x => painAreas.push({ area: x.name, exerciseId: x.exerciseId }));
    const painExercises = new Set(painAreas.map(p => p.exerciseId).filter(Boolean));
    const painUnlinked = painAreas.some(p => !p.exerciseId);
    if (painAreas.length) out.push(mkProposal('pain_review', 'Pain or discomfort is open for review',
      'Pain follows its own pathway. Load increases are held and nothing is prescribed to work through it. This app does not diagnose injuries or prescribe rehabilitation, so a qualified clinician is the right person to look at it.',
      [], { needsConfirm: true, safeguard: true, blocksProgression: painUnlinked ? 'all' : Array.from(painExercises) }));
    const techBad = new Set(calc.exercises.filter(x => x.technique === 'deteriorating').map(x => x.exerciseId));

    // R2. Capacity: reduced demand when the week was too much and performance fell
    const under = calc.exercises.filter(x => x.kind === 'down').length;
    const lowState = ck && ((ck.energy != null && ck.energy <= 2) || (ck.sleep != null && ck.sleep <= 2));
    const needLess = ck && ck.capacity === 'less';
    const repeated = under >= 2 || (s.techniqueConcerns >= 2);
    let reduced = false;
    if (needLess || (lowState && repeated)) {
      const ops = [];
      v.template.days.forEach(d => d.exercises.filter(e => e.role !== 'main' && e.sets > 2).forEach(e =>
        ops.push({ op: 'template_exercise', dayId: d.id, exerciseId: e.id, set: { sets: e.sets - 1 }, text: `${(X.EX_INDEX[e.id] || {}).short || e.id}: ${e.sets} to ${e.sets - 1} sets from next week.` })));
      if (ops.length) ops.push({ op: 'week_hold', weekStart: nextStart, text: 'No load increases next week while the workload is reduced.' });
      if (ops.length) { out.push(mkProposal('reduce_demand', 'Reduce the workload next week',
        needLess ? 'You said the week was more than you needed, so accessory sets come down by one and the main lifts keep their sets.'
                 : `Energy or sleep was low and performance dropped on ${plural(under, 'exercise')}. Accessory sets come down by one for a week and no load increases are added on top.`, ops, { tentative: !needLess })); reduced = true; }
    }
    // R9. Deload only when the evidence supports it, always confirmed
    const dl = E.proposeDeload(state, todayISO);
    const underperformWeeks = (state.reviews || []).slice(-2).filter(r => r.stats && r.stats.exercisesLogged && r.flags && r.flags.underperformed).length;
    if ((dl && !state.activeDeload) || (reduced && underperformWeeks >= 1 && repeated)) {
      out.push(mkProposal('deload', 'A deload week', dl ? dl.reason : 'Performance fell in consecutive weeks while recovery was low.',
        [{ op: 'deload', startISO: nextStart, text: `Easy week from ${nextStart}: about 60% of your usual loads.` }], { needsConfirm: true }));
    }
    // R3/R4. Missed time versus missed capacity; next week's real availability
    const nxt = ck && ck.next || {};
    const timeMisses = s.missedForTime + (ck && ck.fit === 'too_long' ? 1 : 0);
    const wantMinutes = nxt.minutes || (timeMisses >= 1 ? Math.max(25, Math.round(goals.sessionMinutes * 0.75)) : null);
    if (wantMinutes && wantMinutes < goals.sessionMinutes && !needLess) {
      out.push(mkProposal('shorten', `Sessions of about ${wantMinutes} minutes next week`,
        nxt.minutes ? `You will have about ${wantMinutes} minutes a session next week.` : `${plural(timeMisses, 'session')} could not be done for lack of time, so the plan fits your time instead of asking for more. Missed sessions are not added on top.`,
        [{ op: 'week_minutes', minutes: wantMinutes, weekStart: nextStart, text: `Next week's sessions trimmed to about ${wantMinutes} minutes: accessories first, main lifts kept.` }]));
    }
    if (nxt.days && nxt.days < goals.daysPerWeek) out.push(mkProposal('fewer_days', `${nxt.days} training days next week`,
      `You will have ${nxt.days} days available. The week is laid out around that, with the main lifts kept. Sessions that no longer fit are not squeezed into other days.`,
      [{ op: 'week_days', days: nxt.days, weekStart: nextStart, text: `Next week has ${nxt.days} training days.` }]));
    if (nxt.unavailable && nxt.unavailable.length) out.push(mkProposal('equipment', 'Work around unavailable equipment next week',
      `${nxt.unavailable.join(', ')} will not be available. Exercises that need it are swapped for ones that do not, keeping their own history.`,
      [{ op: 'week_equipment', unavailable: nxt.unavailable, weekStart: nextStart, text: `Next week avoids ${nxt.unavailable.join(', ')}.` }]));
    // R5. Unsuitable exercises: accessories change, core lifts stay consistent
    const hard = Object.keys((ck && ck.difficulty) || {}).filter(id => ck.difficulty[id] === 'hard');
    hard.forEach(id => {
      const day = v.template.days.find(d => d.exercises.some(e => e.id === id)); const slot = day && day.exercises.find(e => e.id === id);
      const ex = X.EX_INDEX[id]; if (!day || !slot || !ex) return;
      const isCore = slot.role === 'main';
      const bad = techBad.has(id) || painExercises.has(id);
      const prior = (state.reviews || []).slice(-2).filter(r => r.hardExercises && r.hardExercises.includes(id)).length;
      if (!isCore || bad || prior >= 1) {
        const alt = (ex.alternatives || []).map(a => X.EX_INDEX[a]).find(a => a && !a.libraryOnly && a.primary === ex.primary && P.equipmentOk(a, goals.equipment) && !P.avoided(a, goals) && !day.exercises.some(e => e.id === a.id));
        if (alt && !painExercises.has(id)) out.push(mkProposal('swap_exercise', `Change ${ex.short || ex.name}`, `You found it too hard${bad ? ', and technique was a concern' : prior ? ' two weeks running' : ''}. ${alt.name} trains the same muscle. Its history is kept separately, so you can come back to ${ex.short || ex.name} and compare like with like.`,
          [{ op: 'template_swap', dayId: day.id, from: id, to: alt.id, text: `${ex.short || ex.name} replaced by ${alt.short || alt.name}.` }]));
      } else out.push(mkProposal('hold_core', `Keep ${ex.short || ex.name}`, `It felt hard, but it is a core lift and swapping it would make progress unmeasurable. Double progression holds the load until the reps are earned.`, [], { informational: true }));
    });
    // R6. One volume increase at most, never on an exercise that also gained load, never when anything else is being reduced
    const easy = Object.keys((ck && ck.difficulty) || {}).filter(id => ck.difficulty[id] === 'easy');
    const loadGained = new Set(calc.exercises.filter(x => x.kind === 'load_gain').map(x => x.exerciseId));
    if (!reduced && !painAreas.length && s.planned > 0 && (s.completionPct || 0) >= 90 && easy.length >= 2 && !(ck && ck.capacity === 'less') && !(lowState)) {
      for (const id of easy) {
        const day = v.template.days.find(d => d.exercises.some(e => e.id === id)); const slot = day && day.exercises.find(e => e.id === id);
        if (slot && !loadGained.has(id) && !techBad.has(id) && slot.sets < 5 && slot.role !== 'main') {
          out.push(mkProposal('add_set', `One more set of ${(X.EX_INDEX[id] || {}).short || id}`, 'It was easy, you completed the week as planned, and recovery looks fine. One extra set is the only volume increase this week, and it is not added where the load also went up.',
            [{ op: 'template_exercise', dayId: day.id, exerciseId: id, set: { sets: slot.sets + 1 }, text: `${(X.EX_INDEX[id] || {}).short || id}: ${slot.sets} to ${slot.sets + 1} sets from next week.` }])); break;
        }
      }
    }
    // R7. Conditioning
    const cond = v.template.conditioning && v.template.conditioning[0];
    if (cond && s.conditioningPlanned) {
      if (lowState && s.conditioningDone < s.conditioningPlanned && !reduced) out.push(mkProposal('conditioning', 'Ease conditioning next week', 'Energy was low and conditioning was not all done. The first conditioning session is shortened a little.',
        [{ op: 'template_conditioning', id: cond.id, set: { minutes: Math.max(15, cond.minutes - 10) }, text: `Conditioning: ${cond.minutes} to ${Math.max(15, cond.minutes - 10)} minutes.` }]));
      else if (goals.primary === 'fat_loss' && s.conditioningDone >= s.conditioningPlanned && !lowState && !reduced && !painAreas.length && cond.minutes < 45)
        out.push(mkProposal('conditioning', 'A little more conditioning', 'Conditioning was all done and energy was fine. Ten more minutes on the first session supports the fat-loss goal without touching your lifting.',
          [{ op: 'template_conditioning', id: cond.id, set: { minutes: cond.minutes + 10 }, text: `Conditioning: ${cond.minutes} to ${cond.minutes + 10} minutes.` }]));
    }
    // R8. Stretch and recovery from reported stiffness and soreness
    const stiff = ck && ck.stiffness && ck.stiffness.length;
    if ((stiff || (ck && ck.soreness != null && ck.soreness >= 4)) && (v.template.stretchSlots || 0) < 3)
      out.push(mkProposal('stretch', 'Add stretch time', stiff ? `You reported stiffness (${ck.stiffness.join(', ')}). A stretch session goes into next week. This is general mobility work, not treatment.` : 'Soreness was high. A stretch session goes into next week. This is general mobility work, not treatment.',
        [{ op: 'template_stretch', count: (v.template.stretchSlots || 0) + 1, text: 'One more stretch session next week.' }]));
    // R10. Nutrition: only with sufficient intake and weight data
    const nr = nutritionReadiness(state, week.start, week.end);
    let nutrition = { ready: nr.ready, missing: nr.missing };
    if (nr.ready && goals.primary === 'fat_loss') {
      const rate = C.weeklyRate(state, 14, week.end);
      if (rate != null) {
        const target = -0.5, deficit = state.nutrition.deficitKcal;
        if (rate > -0.15 && deficit < 700) out.push(mkProposal('nutrition', 'Raise the deficit slightly', `Over the last 14 days your weight trend is ${rate > 0 ? '+' : ''}${rate.toFixed(2)} kg a week against roughly ${target} kg, with food logged on ${nr.loggedDays} of ${nr.totalDays} days. A 100 kcal larger deficit is proposed.`,
          [{ op: 'nutrition', set: { deficitKcal: deficit + 100 }, text: `Daily deficit ${deficit} to ${deficit + 100} kcal.` }], { needsConfirm: true }));
        else if (rate < -1.0) out.push(mkProposal('nutrition', 'Ease the deficit', `Weight is falling about ${Math.abs(rate).toFixed(2)} kg a week, faster than is comfortable for keeping muscle. A 100 kcal smaller deficit is proposed.`,
          [{ op: 'nutrition', set: { deficitKcal: Math.max(0, deficit - 100) }, text: `Daily deficit ${deficit} to ${Math.max(0, deficit - 100)} kcal.` }], { needsConfirm: true }));
      }
    }
    // goals changed (confirmed by the user in the check-in)
    if (ck && ck.goalChanged) out.push(mkProposal('goal_change', 'Review your goals', 'You said your goals or priorities have changed. Open My plan to change them; the plan is rebuilt from your new goals and your history is kept.', [], { informational: true, needsConfirm: true }));
    // progression block: nothing may raise load on exercises under pain/technique review
    const blocksAll = painUnlinked;
    // a missed review cadence note is handled by the caller
    return { proposals: out, nutrition, blocksAll, painExercises: Array.from(painExercises), techBad: Array.from(techBad) };
  }

  /* -------------------------------------------------------------- report */
  function sourceVersion(state, week) {
    const bits = [];
    WEEKS_SESSIONS(state, week.start, week.end).forEach(s => bits.push(s.id + ':' + (s.entries || []).reduce((a, e) => a + (e.sets || []).map(x => `${x.status}${x.actualWeight}${x.actualReps}`).join(''), '')));
    week.slots.forEach(s => bits.push(s.id + s.status + s.date));
    notesBetween(state, week.start, week.end).forEach(n => bits.push(n.id + ':' + (n.editedAt || n.createdAt) + ':' + n.text.length));
    return C.checksum(bits.join('|'));
  }
  function buildReport(state, week, checkin, nowMs, opts) {
    opts = opts || {};
    const todayISO = opts.todayISO || localDate(nowMs, state.goals.timezone);
    const calc = computeWeekStats(state, week, todayISO);
    const wellness = wellnessSummary(state, week.start, week.end, todayISO);
    const { facts, attention } = buildFacts(state, week, calc, wellness, todayISO);
    const pr = buildProposals(state, week, calc, wellness, checkin, todayISO, opts);
    const notes = notesBetween(state, week.start, week.end);
    // reported (the user's words) kept apart from recorded facts
    const reported = []; let rn = 0;
    if (checkin) {
      const R = (text, extra) => reported.push(Object.assign({ id: 'r' + (++rn), text, basis: 'reported' }, extra || {}));
      if (checkin.overall != null) R(`You rated the week ${checkin.overall} out of 5.`);
      if (checkin.energy != null) R(`Energy: ${checkin.energy} out of 5.`);
      if (checkin.sleep != null) R(`Sleep: ${checkin.sleep} out of 5.`);
      if (checkin.soreness != null) R(`Soreness: ${checkin.soreness} out of 5.`);
      if (checkin.capacity === 'less') R('You said you needed less than the plan asked.'); if (checkin.capacity === 'more') R('You said you could have managed more.');
      if (checkin.fit === 'too_long') R('Sessions ran too long for your week.');
      Object.keys(checkin.difficulty || {}).forEach(id => R(`${(X.EX_INDEX[id] || {}).short || id} felt ${checkin.difficulty[id] === 'ok' ? 'about right' : checkin.difficulty[id] === 'easy' ? 'too easy' : 'too hard'}.`, { exerciseId: id }));
      (checkin.pain || []).forEach(p => R(`You reported pain or discomfort: ${p.area}${p.note ? ' (' + p.note + ')' : ''}.`));
      if (checkin.enjoyed) R(`You enjoyed: ${checkin.enjoyed}`); if (checkin.disliked) R(`You did not enjoy: ${checkin.disliked}`);
    }
    const notesConsidered = notes.map(n => {
      const linkedLogged = n.linked && n.linked.sessionId && (state.sessions || []).some(s => s.id === n.linked.sessionId && s.status === 'completed');
      return { noteId: n.id, date: n.date, category: n.category, text: n.text.length > 220 ? n.text.slice(0, 217) + '...' : n.text,
        linked: n.linked, basis: 'reported', selfReported: !linkedLogged, edited: !!n.editedAt };
    });
    // tentative interpretations only where recorded and reported data can be compared honestly
    const interpretations = []; let inn = 0;
    const I = text => interpretations.push({ id: 'i' + (++inn), text, basis: 'interpretation', tentative: true });
    if (checkin && checkin.energy != null && checkin.energy <= 2 && calc.exercises.filter(x => x.kind === 'down').length)
      I('Performance dipped on some exercises in a week you described as low energy. That may be connected, but one week is not enough to say.');
    if (calc.stats.completionPct != null && calc.stats.completionPct >= 90 && calc.stats.repGains >= 1) I('Consistent attendance and rep gains at unchanged weights fit the progression working as designed.');
    notes.filter(n => n.category === 'schedule' && n.selfReportedWorkout).forEach(n => I('A written update mentions training that is not in your log. It is counted as self-reported only, not as a completed workout.'));
    // data gaps
    const gaps = [];
    if (!wellness.hasImport) gaps.push('No Garmin or wearable data has been imported, so sleep and recovery come from your own ratings only.');
    else if (wellness.stale) gaps.push(`Imported wearable data ends on ${wellness.coverageEnd}, which is too old to describe this week. It is not used as today's readiness.`);
    if (calc.exercises.some(x => !x.hasFeedback)) gaps.push('Some exercises have no effort feedback, so they could not unlock a load increase.');
    if (!checkin) gaps.push('No check-in was completed. This summary uses your logged training only, and nothing about how the week felt is assumed.');
    if (!pr.nutrition.ready) gaps.push('Nutrition targets were not reviewed: ' + (pr.nutrition.missing[0] || 'intake and weight data are incomplete') + ' Planned meals are never treated as food eaten.');
    const proposals = pr.proposals;
    const diffMap = {};
    calc.exercises.forEach(x => { const d = difficultyOf(x); if (!d) return; const m = diffMap[x.exerciseId] = diffMap[x.exerciseId] || { exercise: x.name, tooEasy: 0, appropriate: 0, tooHard: 0 };
      if (d === 'easy') m.tooEasy++; else if (d === 'hard') m.tooHard++; else m.appropriate++; });
    Object.keys((checkin && checkin.difficulty) || {}).forEach(id => { const ex = X.EX_INDEX[id]; if (!ex) return;
      const m = diffMap[id] = diffMap[id] || { exercise: ex.short || ex.name, tooEasy: 0, appropriate: 0, tooHard: 0 };
      const d = checkin.difficulty[id]; if (d === 'easy') m.tooEasy++; else if (d === 'hard') m.tooHard++; else m.appropriate++; });
    // honest contradiction handling
    const contradictions = [];
    if (checkin && checkin.capacity === 'more' && calc.stats.completionPct != null && calc.stats.completionPct < 50)
      contradictions.push('You said you could have managed more, but fewer than half the planned sessions were logged. Nothing is increased until that is clearer: was it time, or the plan?');
    if (checkin && checkin.energy != null && checkin.energy >= 4 && calc.exercises.some(x => difficultyOf(x) === 'hard'))
      contradictions.push('Energy was reported as good while some exercises were logged at maximum effort. Both are kept as recorded; the plan holds those loads.');
    const dueInfo = reviewSchedule(state, nowMs);
    const report = {
      id: uid('rv'), weekId: week.id, periodStart: week.start, periodEnd: week.end, timezone: state.goals.timezone,
      status: 'draft', createdAt: nowMs, generatedAt: nowMs, sourceVersion: sourceVersion(state, week),
      source: { sessions: WEEKS_SESSIONS(state, week.start, week.end).length, notes: notes.length, checkin: !!checkin },
      stats: calc.stats, facts, attention, reported, interpretations, contradictions, notesConsidered,
      wellness, nutrition: pr.nutrition, dataGaps: gaps, proposals, blocksAll: pr.blocksAll,
      hardExercises: Object.keys((checkin && checkin.difficulty) || {}).filter(id => checkin.difficulty[id] === 'hard'),
      flags: { underperformed: calc.exercises.filter(x => x.kind === 'down').length >= 2 },
      exerciseDifficulty: Object.values(diffMap),
      checkin: checkin || null, noCheckin: !checkin, decision: null, ai: { status: 'not_requested' }
    };
    report.proposedSchedule = previewSchedule(state, week, proposals.filter(p => !p.informational), todayISO);
    return report;
  }

  /* The complete proposed weekly schedule, produced by applying the proposals to
     a copy of the plan, so what is shown is exactly what accepting would save. */
  function cloneForPreview(state) {
    return { goals: JSON.parse(JSON.stringify(state.goals)), plan: JSON.parse(JSON.stringify(state.plan)), planOverrides: JSON.parse(JSON.stringify(state.planOverrides || {})),
      profile: state.profile, sessions: [], bodyweight: state.bodyweight, nutrition: JSON.parse(JSON.stringify(state.nutrition)), _preview: true };
  }
  function applyProposalOps(state, proposals, todayISO, source) {
    const ops = []; proposals.forEach(p => (p.ops || []).forEach(o => ops.push(o)));
    const tmplOps = ops.filter(o => String(o.op).startsWith('template_'));
    const result = { applied: [], version: null };
    const weekOps = ops.filter(o => String(o.op).startsWith('week_'));
    const slotOps = ops.filter(o => !String(o.op).startsWith('template_') && !String(o.op).startsWith('week_') && o.op !== 'nutrition' && o.op !== 'deload');
    if (tmplOps.length || slotOps.length || proposals.length) {
      const r = P.acceptVersion(state, { ops: tmplOps.concat(slotOps), reason: proposals.map(p => p.title).join('; '), source: source || 'weekly_review',
        proposalId: proposals.map(p => p.id).join(',') }, todayISO);
      result.version = r.version; result.applied = result.applied.concat(r.applied);
    }
    // one-week constraints become real slot modifications on next week's slots
    weekOps.forEach(o => {
      const w = P.ensureWeek(state, o.weekStart); if (!w) return;
      if (o.op === 'week_minutes') w.slots.filter(s => s.kind === 'training' && s.status === 'planned').forEach(s => {
        const pv = P.previewDayAdjust(state, s.id, 'less_time', { minutes: o.minutes });
        if (pv.ok && pv.changed) { pv.mods.forEach(m => s.mods.push(Object.assign({ at: Date.now(), source: 'weekly_review' }, m))); }
      });
      else if (o.op === 'week_equipment') w.slots.filter(s => s.kind === 'training' && s.status === 'planned').forEach(s => {
        const pv = P.previewDayAdjust(state, s.id, 'equipment', { unavailable: o.unavailable });
        if (pv.ok && pv.changed) pv.mods.forEach(m => s.mods.push(Object.assign({ at: Date.now(), source: 'weekly_review' }, m)));
      });
      else if (o.op === 'week_hold') w.slots.filter(s => s.kind === 'training' && s.status === 'planned').forEach(s => { s.holdProgression = true; });
      else if (o.op === 'week_days') {
        const trains = w.slots.filter(s => s.kind === 'training' && s.status === 'planned');
        const drop = Math.max(0, trains.length - o.days);
        trains.slice(-drop).forEach(s => { s.kind = 'recovery'; s.label = 'Recovery day'; s.minutes = 15; s.history = (s.history || []).concat([{ at: Date.now(), action: 'converted', to: 'recovery', reason: o.text }]); s.droppedTraining = true; });
      }
      result.applied.push(o.text);
    });
    ops.filter(o => o.op === 'nutrition').forEach(o => { Object.assign(state.nutrition, o.set); result.applied.push(o.text); });
    ops.filter(o => o.op === 'deload').forEach(o => { if (typeof acceptDeload === 'function' || NODE) { const eng = NODE ? require('./engine.js') : { acceptDeload }; eng.acceptDeload(state, o.startISO); result.applied.push(o.text); } });
    return result;
  }
  function previewSchedule(state, week, proposals, todayISO) {
    const copy = cloneForPreview(state);
    applyProposalOps(copy, proposals, todayISO, 'preview');
    const nextStart = P.addDays(week.end, 1);
    const nw = P.ensureWeek(copy, nextStart);
    return nw.slots.map(s => ({ date: s.date, dow: P.DOW_NAMES[P.isoDow(s.date)], kind: s.kind, label: s.label, minutes: s.mods && s.mods.length && s.kind === 'training' ? P.sessionRoster(copy, s).minutes : s.minutes }));
  }

  /* ------------------------------------------------- accept / keep / history */
  function finaliseReport(state, report, decision, selectedIds, nowMs, todayISO) {
    state.reviews = state.reviews || [];
    const chosen = report.proposals.filter(p => selectedIds.indexOf(p.id) >= 0 && !p.informational);
    let version = null, applied = [];
    if (decision === 'accept' && chosen.length) {
      const r = applyProposalOps(state, chosen, todayISO, 'weekly_review'); version = r.version; applied = r.applied;
    }
    report.status = 'final'; report.finalisedAt = nowMs;
    report.decision = { kind: decision, selectedIds: decision === 'keep' ? [] : selectedIds, appliedChanges: applied, versionId: version ? version.id : null,
      at: nowMs, note: decision === 'keep' ? 'You kept the current plan. Nothing in the plan changed.' : '' };
    const i = state.reviews.findIndex(r => r.id === report.id);
    if (i >= 0) state.reviews[i] = report; else state.reviews.push(report);
    return { report, version, applied };
  }
  /* A check-in that never happens must not produce invented feedback or increases. */
  function carryOverMissed(state, week, nowMs) {
    state.reviews = state.reviews || [];
    if (state.reviews.some(r => r.periodEnd === week.end)) return null;
    const r = { id: uid('rv'), weekId: week.id, periodStart: week.start, periodEnd: week.end, status: 'missed', createdAt: nowMs, stats: computeWeekStats(state, week, week.end).stats,
      decision: { kind: 'carry_over', appliedChanges: [], at: nowMs, note: 'No check-in was completed. The plan continues unchanged and conservatively, with no automatic increases. You will be asked again.' } };
    state.reviews.push(r); return r;
  }
  function staleDraft(state, report) {
    const week = Object.values(state.plan.weeks).find(w => w.id === report.weekId);
    return week ? sourceVersion(state, week) !== report.sourceVersion : false;
  }

  /* ------------------------------------------------ AI payload and fallback */
  function aiPayload(report, goals) {
    const s = report.stats; const stats = {};
    ['planned', 'completed', 'partial', 'missed', 'skipped', 'rescheduled', 'additional', 'uniqueTrainingDays', 'completionPct', 'onTimePct',
      'conditioningPlanned', 'conditioningDone', 'stretchSessionsDone', 'recoverySessionsDone', 'restDaysKept', 'repGains', 'loadGains', 'painFlags', 'techniqueConcerns'].forEach(k => { stats[k] = s[k] == null ? null : s[k]; });
    const trim = (t, n) => String(t).slice(0, n);
    const fb = {}; (report.exerciseDifficulty || []).forEach(d => { fb[d.exercise] = d; });
    return {
      period: { start: report.periodStart, end: report.periodEnd, timezone: trim(report.timezone || 'Australia/Sydney', 60) },
      goal: { primary: trim(goals.primary, 60), secondary: (goals.secondary || []).slice(0, 3).map(x => trim(x, 60)) },
      stats,
      facts: report.facts.slice(0, 40).map(f => ({ id: f.id, kind: trim(f.kind, 30), text: trim(f.text, 240) })),
      attention: report.attention.slice(0, 20).map(f => ({ id: f.id, kind: trim(f.kind, 30), text: trim(f.text, 240) })),
      notes: report.notesConsidered.slice(0, 25).map(n => ({ id: n.noteId, category: n.category || 'none', date: n.date, text: trim(n.text, 600), linked: n.linked && n.linked.exerciseId ? trim(n.linked.exerciseId, 80) : null, selfReported: !!n.selfReported })),
      feedback: Object.values(fb).slice(0, 30).map(d => ({ exercise: trim(d.exercise, 60), tooEasy: d.tooEasy | 0, appropriate: d.appropriate | 0, tooHard: d.tooHard | 0 })),
      proposals: report.proposals.filter(p => !p.informational || p.kind === 'pain_review').slice(0, 12).map(p => ({ id: p.id, kind: trim(p.kind, 30), text: trim(p.title, 240), reason: trim(p.reason, 240) })),
      dataGaps: report.dataGaps.slice(0, 12).map(x => trim(x, 200))
    };
  }
  function numbersIn(str) { return (String(str).match(/\d+(?:\.\d+)?/g) || []); }
  function allowedNumbers(payload) {
    const set = new Set();
    Object.values(payload.stats).forEach(v => { if (v != null) set.add(String(v)); });
    payload.facts.concat(payload.attention).forEach(f => numbersIn(f.text).forEach(n => set.add(n)));
    payload.proposals.forEach(p => numbersIn(p.text + ' ' + p.reason).forEach(n => set.add(n)));
    return set;
  }
  /* Same guard the server applies. A model answer that cites a number the app did
     not compute is rejected whole, and the statistics summary is shown instead. */
  function validateAiOutput(out, payload) {
    if (!out || typeof out !== 'object') return { ok: false, why: 'not an object' };
    const allowed = allowedNumbers(payload);
    const ids = new Set(payload.facts.concat(payload.attention).map(f => f.id).concat(payload.notes.map(n => n.id)));
    const texts = [out.headline].concat((out.wentWell || []).map(x => x.text), (out.needsAttention || []).map(x => x.text), (out.nextWeek || []).map(x => x.text),
      (out.notesConsidered || []).map(x => x.observation), out.caveats || []);
    for (const t of texts) for (const n of numbersIn(t || '')) if (!allowed.has(n)) return { ok: false, why: `unsupported number ${n}` };
    const pids = new Set(payload.proposals.map(p => p.id));
    const clean = { headline: String(out.headline || '').slice(0, 140),
      wentWell: (out.wentWell || []).slice(0, 6).map(x => ({ text: String(x.text).slice(0, 240), basis: (x.basis || []).filter(b => ids.has(b)) })),
      needsAttention: (out.needsAttention || []).slice(0, 6).map(x => ({ text: String(x.text).slice(0, 240), basis: (x.basis || []).filter(b => ids.has(b)) })),
      nextWeek: (out.nextWeek || []).slice(0, 6).map(x => ({ text: String(x.text).slice(0, 240), proposalId: x.proposalId && pids.has(x.proposalId) ? x.proposalId : null })),
      notesConsidered: (out.notesConsidered || []).filter(x => payload.notes.some(n => n.id === x.noteId)).slice(0, 25).map(x => ({ noteId: x.noteId, observation: String(x.observation).slice(0, 240), kind: x.kind === 'interpretation' ? 'interpretation' : 'reported' })),
      caveats: (out.caveats || []).slice(0, 6).map(x => String(x).slice(0, 200)) };
    return { ok: true, report: clean };
  }
  /* Ask the secure backend. Never throws, never hangs: a failure is a status. */
  async function requestAi(report, goals, fetchImpl, timeoutMs) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { status: 'unavailable', reason: 'no network layer' };
    const payload = aiPayload(report, goals);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeoutMs || 25000);
    try {
      const res = await f('/api/ai/weekly-review', { method: 'POST', credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined,
        headers: { 'Content-Type': 'application/json', 'X-Recomp-Request': '1' }, body: JSON.stringify({ payload }) });
      let data = null; try { data = await res.json(); } catch (e) {}
      if (res.status === 503) return { status: 'not_configured', reason: 'The AI service is not set up on this server.' };
      if (res.status === 429) return { status: 'rate_limited', reason: 'Too many AI requests. Try again later.' };
      if (res.status === 403) return { status: 'forbidden', reason: 'AI reviews are not enabled for this account.' };
      if (!res.ok || !data || !data.report) return { status: 'unavailable', reason: 'The AI service could not be reached.' };
      const v = validateAiOutput(data.report, payload);
      if (!v.ok) return { status: 'invalid', reason: 'The AI answer contained something the app could not verify, so it was discarded.' };
      return { status: 'ok', model: data.model || null, generatedAt: data.generatedAt || null, report: v.report, payloadNotes: payload.notes.length };
    } catch (e) { return { status: 'unavailable', reason: e && e.name === 'AbortError' ? 'The AI service took too long.' : 'The AI service could not be reached.' }; }
    finally { clearTimeout(timer); }
  }
  /* Statistics-only summary. Plainly labelled; it never claims to be AI. */
  function fallbackSummary(report) {
    const s = report.stats; const lines = [];
    lines.push(s.planned ? `You completed ${s.completed} of ${s.planned} planned sessions${s.partial ? ` and ${s.partial} partly` : ''}, across ${plural(s.uniqueTrainingDays, 'training day')}.` : 'There were no planned training sessions in this period.');
    if (s.additional) lines.push(`${plural(s.additional, 'additional workout')} on top of the plan.`);
    if (s.repGains) lines.push(`${plural(s.repGains, 'exercise')} gained reps at an unchanged weight.`);
    if (s.loadGains) lines.push(`${plural(s.loadGains, 'exercise')} moved up in weight.`);
    if (s.stretchSessionsDone || s.recoverySessionsDone) lines.push(`Stretch sessions: ${s.stretchSessionsDone}. Recovery sessions: ${s.recoverySessionsDone}.`);
    if (report.attention.length) lines.push('Needs attention: ' + report.attention.map(a => a.text).join(' '));
    if (report.notesConsidered.length) lines.push(`${plural(report.notesConsidered.length, 'written update')} considered.`);
    return { label: 'Statistics summary. This was not written by AI.', lines };
  }

  return { reviewSchedule, localParts, localDate, NOTE_CATEGORIES, addNote, editNote, deleteNote, saveDraft, getDraft, notesBetween,
    extractSuggestions, applySuggestion, dismissSuggestion, computeWeekStats, exerciseChanges, difficultyOf, wellnessSummary, nutritionReadiness,
    buildFacts, buildProposals, buildReport, previewSchedule, applyProposalOps, finaliseReport, carryOverMissed, staleDraft, sourceVersion,
    aiPayload, validateAiOutput, requestAi, fallbackSummary, allowedNumbers, STALE_DAYS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Review;
