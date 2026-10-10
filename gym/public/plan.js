/* ============================================================================
   Recomp planning engine.

   Pure and deterministic: no DOM, no clock (the caller passes dates), no
   randomness. Everything the app says about the plan is derived from the data
   structures below, and every "plan adjusted" message is produced by a function
   here that has already changed them. Nothing is explained that was not done.

   DATA (all inside the user's state, so it syncs and backs up with the rest)
     state.goals            primary goal, secondary goals, availability, equipment,
                            preferences, limitations, milestones, review day, timezone
     state.plan.versions    immutable dated versions of the programme template
     state.plan.currentId   the version used for weeks that have not started
     state.plan.weeks       one object per training week, with explicit slots
     state.plan.log         every change to the plan, in order, with the reason
     state.planOverrides    per-exercise sets and rep range from the current version

   AGREED PLAN INTEGRITY
     A week's slots are its agreed plan. Once a week has started they are frozen:
     a slot can be completed, shortened, moved or skipped, and every one of those
     is recorded on the slot, but it can never be deleted. Adherence is always
     measured against the slots that were agreed, so tidying history cannot
     improve it.
   ========================================================================== */
const Plan = (function () {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const E = NODE ? require('./engine.js') : {
    buildProgram: (...a) => window.buildProgram(...a), decide: (...a) => window.decide(...a),
    get TUNING() { return TUNING; }
  };
  const C = NODE ? require('./core.js') : {
    addDays: (...a) => window.addDays(...a), parseISO: (...a) => window.parseISO(...a),
    isoOf: (...a) => window.isoOf(...a), daysBetween: (...a) => window.daysBetween(...a),
    topSets: (...a) => window.topSets(...a), workingSets: (...a) => window.workingSets(...a),
    newSession: (...a) => window.newSession(...a), newEntry: (...a) => window.newEntry(...a), newSet: (...a) => window.newSet(...a),
    lastPerformance: (...a) => window.lastPerformance(...a)
  };
  const X = NODE ? require('./exercises.js') : {
    get EXERCISES() { return EXERCISES; }, get EX_INDEX() { return EX_INDEX; }
  };
  const LIB = () => (NODE ? (function () { try { return require('./library.js'); } catch (e) { return null; } })()
                          : (typeof Library !== 'undefined' ? Library : (typeof WORKOUTS !== 'undefined' ? { WORKOUTS } : null)));

  /* ------------------------------------------------------------- dates */
  const addDays = (iso, n) => C.addDays(iso, n);
  const diffDays = (a, b) => C.daysBetween(a, b);
  const isoDow = iso => { const d = C.parseISO(iso).getDay(); return d === 0 ? 7 : d; };   // 1 Mon .. 7 Sun
  const DOW_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const r1 = x => Math.round(x * 10) / 10;
  const uid = (p, seed) => p + '_' + (seed || Date.now().toString(36)) + Math.random().toString(36).slice(2, 6);

  /* ------------------------------------------------------------- goals */
  const GOAL_IDS = ['build_muscle', 'strength', 'fat_loss', 'recomp', 'general_fitness', 'mobility'];
  const GOALS = {
    build_muscle: { label: 'Build muscle', engine: 'hypertrophy',
      main: { lo: 6, hi: 10, sets: 3 }, acc: { lo: 8, hi: 15, sets: 3 }, condMin: 30, stretchSlots: 1,
      effect: 'Moderate reps (6 to 10 on the main lifts, 8 to 15 on accessories), enough sets per muscle to grow, and only light conditioning so recovery goes into training.' },
    strength: { label: 'Improve strength', engine: 'strength',
      main: { lo: 3, hi: 6, sets: 4 }, acc: { lo: 6, hi: 10, sets: 3 }, condMin: 30, stretchSlots: 1,
      effect: 'Lower reps (3 to 6) on the main lifts with longer rests and more sets, accessories at 6 to 10. The same core lifts stay in the plan so progress can be measured.' },
    fat_loss: { label: 'Lose fat, keep muscle', engine: 'recomp',
      main: { lo: 6, hi: 10, sets: 3 }, acc: { lo: 8, hi: 12, sets: 2 }, condMin: 90, stretchSlots: 1,
      effect: 'Keeps the heavier compound lifting that protects muscle, trims accessory volume to ease recovery in a deficit, and adds weekly conditioning.' },
    recomp: { label: 'Body recomposition', engine: 'recomp',
      main: { lo: 6, hi: 10, sets: 3 }, acc: { lo: 8, hi: 12, sets: 3 }, condMin: 60, stretchSlots: 1,
      effect: 'A middle path: 6 to 10 reps on the main lifts, 8 to 12 on accessories, and moderate conditioning.' },
    general_fitness: { label: 'Improve general fitness', engine: 'recomp',
      main: { lo: 8, hi: 12, sets: 3 }, acc: { lo: 10, hi: 15, sets: 2 }, condMin: 120, stretchSlots: 2,
      effect: 'Full-body sessions at 8 to 12 reps with fewer sets, more weekly conditioning and regular mobility.' },
    mobility: { label: 'Improve mobility and consistency', engine: 'recomp',
      main: { lo: 8, hi: 12, sets: 2 }, acc: { lo: 10, hi: 15, sets: 2 }, condMin: 60, stretchSlots: 3,
      effect: 'Short, easy-to-keep sessions with fewer sets, regular walking and three stretch sessions a week. The aim is turning up reliably.' }
  };
  const EXPERIENCE_VOLUME = { novice: { setCeiling: 40, sets: -1 }, intermediate: { setCeiling: 56, sets: 0 }, advanced: { setCeiling: 72, sets: 1 } };

  /* Each setting, and what changing it does. Shown next to the control. */
  const SETTING_EFFECTS = {
    primary: g => `${(GOALS[g] || GOALS.recomp).effect}`,
    secondary: g => g && GOALS[g] ? `Adds a secondary emphasis: ${GOALS[g].label.toLowerCase()}. It nudges conditioning and stretch time, never the main lifts.` : 'Optional. A secondary goal nudges conditioning and stretch time without changing the main lifts.',
    experience: e => ({ novice: 'Fewer sets per exercise and a lower weekly set ceiling so you can recover while you learn the lifts.',
      intermediate: 'The standard number of sets and ceiling.', advanced: 'One extra set on the main lifts and a higher weekly ceiling.' }[e] || ''),
    daysPerWeek: n => n <= 3 ? `${n} training days means full-body sessions, so each muscle is trained more often.` : n === 4 ? 'Four days splits training into upper and lower sessions.' : `${n} days uses a push, pull and legs style split with a rest day or two.`,
    sessionMinutes: m => `Sessions are trimmed to about ${m} minutes: accessories go first, then extra sets, and the main lifts stay.`,
    equipment: () => 'Exercises needing equipment you turn off are swapped for ones you can do. Each swap keeps its own progress history.',
    preferredDays: () => 'Training lands on these days when it can, spaced so hard days are not back to back.',
    reviewDay: () => 'Your training week ends on the review day. The check-in and next week\'s plan are due then.'
  };
  function explainSetting(key, value) { const f = SETTING_EFFECTS[key]; return f ? f(value) : ''; }

  function defaultGoals(profile, tz) {
    const map = { recomp: 'recomp', strength: 'strength', hypertrophy: 'build_muscle', fatloss: 'fat_loss' };
    const p = profile || {};
    return {
      primary: map[p.goal] || 'recomp', secondary: [],
      experience: p.experience || 'intermediate',
      daysPerWeek: p.trainingDaysPerWeek || 4,
      preferredDays: [], sessionMinutes: p.sessionMinutes || 60,
      equipment: Object.assign({ barbell: true, dumbbell: true, machine: true, cable: true, bands: true, kettlebell: false, bodyweight: true }, p.equipment || {}),
      preferences: { disliked: [], liked: [], enjoys: [] },
      limitations: [],                       // [{ area, note, avoidExercises:[ids] }] chosen by the user, never diagnosed
      milestones: [], reviewDay: 7, reviewTime: '18:00',
      timezone: tz || 'Australia/Sydney', startDate: null, updatedAt: null
    };
  }
  function validateGoals(g) {
    const problems = [];
    if (!GOALS[g.primary]) problems.push('Choose a primary goal.');
    const sec = (g.secondary || []);
    if (sec.length > 2) problems.push('Choose at most two secondary goals.');
    if (sec.some(s => !GOALS[s] || s === g.primary)) problems.push('Secondary goals must be different from the primary goal.');
    if (!(g.daysPerWeek >= 1 && g.daysPerWeek <= 6)) problems.push('Training days must be between 1 and 6.');
    if (!(g.sessionMinutes >= 10 && g.sessionMinutes <= 150)) problems.push('Session length must be between 10 and 150 minutes.');
    if (!(g.reviewDay >= 1 && g.reviewDay <= 7)) problems.push('Choose a review day.');
    if ((g.preferredDays || []).some(d => !(d >= 1 && d <= 7))) problems.push('Preferred days must be days of the week.');
    return problems;
  }

  /* ---------------------------------------------- equipment & exercise fit */
  const EQUIP_NEED = { barbell: 'barbell', dumbbell: 'dumbbell', machine: 'machine', cable: 'cable', assisted: 'machine', bands: 'bands', kettlebell: 'kettlebell' };
  function equipmentOk(ex, equipment) {
    const need = EQUIP_NEED[ex.equipment];
    if (!need) return true;
    return (equipment || {})[need] !== false;
  }
  const MAIN_PATTERNS = ['squat', 'hinge', 'horizontal push', 'horizontal pull', 'vertical push', 'vertical pull', 'single-leg squat'];
  const isMainLift = (ex, idx) => ex.block !== 'core' && MAIN_PATTERNS.indexOf(ex.pattern) >= 0 && idx < 4;
  function avoided(ex, goals) {
    const pref = goals.preferences || {};
    if ((pref.disliked || []).indexOf(ex.id) >= 0) return 'you chose to avoid it';
    for (const l of (goals.limitations || [])) if ((l.avoidExercises || []).indexOf(ex.id) >= 0) return `you chose to avoid it (${l.area || 'limitation'})`;
    return null;
  }
  /* Time model used everywhere: warm-up, then each set as work plus rest, plus a
     short transition between exercises. Deliberately simple and consistent. */
  const WARMUP_MIN = 6, WORK_SEC = 45, TRANSITION_SEC = 60;
  function exerciseMinutes(ex, sets) { return (sets * (WORK_SEC + (ex.restSec || 90)) + TRANSITION_SEC) / 60; }
  function sessionMinutes(items) {
    return Math.round(WARMUP_MIN + items.reduce((a, it) => a + exerciseMinutes(it.ex || X.EX_INDEX[it.id], it.sets), 0));
  }

  /* ---------------------------------------------------- template generation */
  function generateTemplate(goals, opts) {
    opts = opts || {};
    const rule = GOALS[goals.primary] || GOALS.recomp;
    const xp = EXPERIENCE_VOLUME[goals.experience] || EXPERIENCE_VOLUME.intermediate;
    const profileForBuild = { trainingDaysPerWeek: goals.daysPerWeek, goal: rule.engine, experience: goals.experience,
                              sessionMinutes: goals.sessionMinutes, equipment: goals.equipment };
    const pool = X.EXERCISES.filter(e => !e.libraryOnly && !avoided(e, goals));
    const base = E.buildProgram(profileForBuild, pool);
    const days = base.days.map((d, di) => {
      const seenFamily = new Set();
      const dayExercises = d.exercises.filter(p => { const fam = p.id.split('-')[0]; if (seenFamily.has(fam)) return false; seenFamily.add(fam); return true; });
      let items = dayExercises.map((p, idx) => {
        const ex = X.EX_INDEX[p.id];
        const main = isMainLift(ex, idx);
        const band = main ? rule.main : rule.acc;
        // The exercise's own range still bounds the goal range.
        const lo = Math.max(ex.lo, Math.min(band.lo, ex.hi));
        const hi = Math.min(Math.max(ex.hi, lo), Math.max(band.hi, lo));
        let sets = Math.max(2, band.sets + (main ? xp.sets : 0));
        if (ex.block === 'core') sets = Math.min(sets, 3);
        return { id: ex.id, ex, sets, repMin: lo, repMax: hi, role: main ? 'main' : 'accessory', restSec: ex.restSec };
      });
      // Fit the chosen session length: accessories go first, then extra sets, never the main lifts.
      const target = goals.sessionMinutes;
      let guard = 0;
      while (sessionMinutes(items) > target && guard++ < 60) {
        const accIdx = items.map((it, i) => ({ it, i })).filter(x => x.it.role === 'accessory').reverse();
        const withExtra = accIdx.find(x => x.it.sets > 2);
        if (withExtra) { withExtra.it.sets -= 1; continue; }
        if (accIdx.length) { items.splice(accIdx[0].i, 1); continue; }
        const mainSets = items.filter(x => x.role === 'main' && x.sets > 2);
        if (mainSets.length) { mainSets[mainSets.length - 1].sets -= 1; continue; }
        break;
      }
      return { id: 'td' + (di + 1), index: di + 1, name: d.name, kind: d.kind,
               exercises: items.map(it => ({ id: it.id, sets: it.sets, repMin: it.repMin, repMax: it.repMax, role: it.role })),
               minutes: sessionMinutes(items) };
    });
    // conditioning and stretch slots: by goal, topped up by secondary goals
    let condMin = rule.condMin, stretchSlots = rule.stretchSlots;
    (goals.secondary || []).forEach(s => {
      const r = GOALS[s]; if (!r) return;
      condMin = Math.max(condMin, Math.round((condMin + r.condMin) / 2) + (r.condMin > condMin ? 15 : 0));
      stretchSlots = Math.max(stretchSlots, r.stretchSlots);
    });
    const condSlots = condMin <= 0 ? [] : [{ id: 'tc1', minutes: Math.min(45, Math.max(20, Math.round(condMin / (condMin >= 90 ? 3 : 2)))), intensity: 'easy' },
      ...(condMin >= 60 ? [{ id: 'tc2', minutes: Math.min(30, Math.max(15, Math.round(condMin / 4))), intensity: condMin >= 90 ? 'mixed' : 'moderate' }] : []),
      ...(condMin >= 120 ? [{ id: 'tc3', minutes: 30, intensity: 'easy' }] : [])];
    const overrides = {};
    days.forEach(d => d.exercises.forEach(e => { overrides[e.id] = { sets: e.sets, repMin: e.repMin, repMax: e.repMax }; }));
    return { days, conditioning: condSlots, stretchSlots, overrides,
             rule: { goal: goals.primary, main: rule.main, acc: rule.acc, condMin }, notes: base.notes || [] };
  }

  /* --------------------------------------------------------- weekday layout */
  /* Choose which days of the week train. Prefer the user's days, keep hard days
     apart, never more than the days they said they have. */
  function chooseTrainingDows(n, preferred, startsOn) {
    const all = [1, 2, 3, 4, 5, 6, 7];
    const order = d => ((d - startsOn + 7) % 7);
    let best = null;
    const combos = [];
    (function rec(start, cur) {
      if (cur.length === n) { combos.push(cur.slice()); return; }
      for (let i = start; i < all.length; i++) { cur.push(all[i]); rec(i + 1, cur); cur.pop(); }
    })(0, []);
    combos.forEach(c => {
      const ord = c.map(order).sort((a, b) => a - b);
      let consecutive = 0, minGap = 99;
      for (let i = 0; i < ord.length; i++) {
        const gap = i === ord.length - 1 ? (ord[0] + 7 - ord[i]) : ord[i + 1] - ord[i];
        if (ord.length > 1) { minGap = Math.min(minGap, gap); if (gap === 1) consecutive++; }
      }
      const prefHits = preferred && preferred.length ? c.filter(d => preferred.indexOf(d) >= 0).length : 0;
      // preferred days dominate, then fewer back-to-back days, then wider minimum gap
      const score = prefHits * 100 - consecutive * 10 + (minGap === 99 ? 0 : minGap);
      if (!best || score > best.score) best = { score, days: c.slice() };
    });
    return best.days.sort((a, b) => order(a) - order(b));
  }

  /* ------------------------------------------------------------ the plan */
  function ensurePlan(state) {
    state.plan = state.plan || { versions: [], currentId: null, weeks: {}, log: [], adjustLog: [] };
    state.plan.weeks = state.plan.weeks || {}; state.plan.log = state.plan.log || []; state.plan.adjustLog = state.plan.adjustLog || [];
    state.planOverrides = state.planOverrides || {};
    return state.plan;
  }
  const currentVersion = state => { const p = state.plan; return p && p.versions.find(v => v.id === p.currentId) || null; };
  const versionById = (state, id) => (state.plan ? state.plan.versions : []).find(v => v.id === id) || null;

  function logChange(state, entry) {
    ensurePlan(state);
    const e = Object.assign({ at: Date.now(), id: uid('chg') }, entry);
    state.plan.log.push(e);
    return e;
  }
  /* New immutable version. effectiveFrom is the first date it may apply to. */
  function addVersion(state, spec) {
    ensurePlan(state);
    const prev = currentVersion(state);
    const v = {
      id: uid('pv'), n: state.plan.versions.length + 1, createdAt: spec.createdAt || Date.now(),
      effectiveFrom: spec.effectiveFrom, source: spec.source, reason: spec.reason || '',
      parentId: prev ? prev.id : null,
      goals: JSON.parse(JSON.stringify(spec.goals)),
      template: JSON.parse(JSON.stringify(spec.template)),
      phase: spec.phase || (prev && prev.phase) || { name: 'build', block: 1, startedOn: spec.effectiveFrom },
      changes: spec.changes || [], proposalId: spec.proposalId || null
    };
    state.plan.versions.push(v);
    state.plan.currentId = v.id;
    state.planOverrides = Object.assign({}, v.template.overrides || {});
    logChange(state, { type: 'version', versionId: v.id, n: v.n, source: v.source, reason: v.reason, effectiveFrom: v.effectiveFrom, changes: v.changes });
    return v;
  }
  function createInitialPlan(state, todayISO, goals) {
    ensurePlan(state);
    const g = goals || state.goals;
    const template = generateTemplate(g);
    return addVersion(state, { effectiveFrom: todayISO, source: 'initial', reason: `First plan for ${GOALS[g.primary].label.toLowerCase()}, ${g.daysPerWeek} days a week, about ${g.sessionMinutes} minutes.`,
      goals: g, template, phase: { name: 'build', block: 1, startedOn: todayISO } });
  }

  /* ------------------------------------------------------------- weeks */
  function weekStartsOn(goals) { return ((goals.reviewDay || 7) % 7) + 1; }      // day after the review day
  function weekContaining(state, dateISO) {
    ensurePlan(state);
    return Object.values(state.plan.weeks).find(w => dateISO >= w.start && dateISO <= w.end) || null;
  }
  function lastWeek(state) {
    const ws = Object.values(state.plan.weeks).sort((a, b) => a.start < b.start ? -1 : 1);
    return ws.length ? ws[ws.length - 1] : null;
  }
  function nextWeekRange(state, fromISO) {
    const sOn = weekStartsOn(state.goals);
    const prev = lastWeek(state);
    let start;
    if (prev) start = addDays(prev.end, 1);
    else {
      /* The first week begins the day the plan does, so days before it can never count as missed. */
      const v0 = state.plan.versions[0];
      start = v0 && v0.effectiveFrom <= fromISO && diffDays(v0.effectiveFrom, fromISO) <= 6 ? v0.effectiveFrom : fromISO;
      if (!(v0 && v0.effectiveFrom <= fromISO)) { start = fromISO; while (isoDow(start) !== sOn) start = addDays(start, -1); if (diffDays(start, fromISO) > 6) start = fromISO; }
    }
    let end = addDays(start, 6);
    // a changed review day makes the transitional week shorter, never longer than seven days
    for (let d = addDays(start, 1); d <= end; d = addDays(d, 1)) { if (isoDow(d) === sOn) { end = addDays(d, -1); break; } }
    return { start, end };
  }
  function slotId(weekStart, kind, n) { return `sl_${weekStart}_${kind}${n}`; }

  /* Build the slots for one week from a version. Pure; the caller stores it. */
  function layoutWeek(version, start, end, goals) {
    const t = version.template;
    const len = diffDays(start, end) + 1;
    const dates = []; for (let i = 0; i < len; i++) dates.push(addDays(start, i));
    const dowsInWeek = dates.map(isoDow);
    const sOn = isoDow(start);
    const nTrain = Math.min(t.days.length, Math.max(1, Math.round(t.days.length * len / 7)));
    const pref = (version.goals.preferredDays || []);
    const trainDows = chooseTrainingDows(Math.min(nTrain, len), pref.filter(d => dowsInWeek.indexOf(d) >= 0), sOn)
      .filter(d => dowsInWeek.indexOf(d) >= 0);
    const slots = [];
    const usedDates = new Set();
    // keep the template's session order stable week to week by rotating from the last used day
    const rot = ((version.n || 1) + (version.rotation || 0)) % Math.max(1, t.days.length);
    trainDows.forEach((dow, i) => {
      const date = dates[dowsInWeek.indexOf(dow)];
      const td = t.days[(i + (version.dayOffset || 0)) % t.days.length];
      usedDates.add(date);
      slots.push({ id: slotId(start, 'tr', i + 1), kind: 'training', date, agreedDate: date, label: td.name, dayId: td.id,
        minutes: td.minutes, status: 'planned', origin: 'plan', mods: [], moves: [] });
    });
    const free = dates.filter(d => !usedDates.has(d));
    // conditioning on free days that follow a training day by at least one rest day when possible
    const condDays = free.filter(d => !usedDates.has(addDays(d, -1)) || free.length <= (t.conditioning || []).length + 1);
    (t.conditioning || []).slice(0, Math.max(0, free.length - 1)).forEach((c, i) => {
      const date = (condDays.filter(d => !usedDates.has(d))[0]) || free.filter(d => !usedDates.has(d))[0];
      if (!date) return;
      usedDates.add(date);
      slots.push({ id: slotId(start, 'cd', i + 1), kind: 'conditioning', date, agreedDate: date, label: `Conditioning: ${c.intensity}`,
        minutes: c.minutes, status: 'planned', origin: 'plan', intensity: c.intensity, mods: [], moves: [] });
    });
    const rest = dates.filter(d => !usedDates.has(d));
    // at least one full rest day is always kept; stretch sessions go on other free days
    let stretchLeft = Math.min(t.stretchSlots || 0, Math.max(0, rest.length - 1));
    rest.forEach((date, i) => {
      if (stretchLeft > 0 && i % 2 === 0) {
        stretchLeft--; slots.push({ id: slotId(start, 'st', i + 1), kind: 'stretch', date, agreedDate: date, label: 'Stretch session',
          minutes: 12, status: 'planned', origin: 'plan', mods: [], moves: [] });
      } else {
        const afterHard = usedDates.has(addDays(date, -1));
        slots.push({ id: slotId(start, 'rc', i + 1), kind: afterHard ? 'recovery' : 'rest', date, agreedDate: date,
          label: afterHard ? 'Recovery day' : 'Rest day', minutes: afterHard ? 15 : 0, status: 'planned', origin: 'plan', mods: [], moves: [] });
      }
    });
    slots.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return slots;
  }

  /* Make sure a week exists. Weeks are generated from the version in force when
     they are first needed, then belong to that version. */
  function ensureWeek(state, dateISO) {
    ensurePlan(state);
    let w = weekContaining(state, dateISO);
    if (w) return w;
    const v = currentVersion(state);
    if (!v) return null;
    let guard = 0;
    while (!w && guard++ < 60) {
      const range = nextWeekRange(state, dateISO);
      const ver = (state.plan.versions.filter(x => x.effectiveFrom <= range.start).sort((a, b) => a.n - b.n).pop()) || v;
      const weekVer = ver.n >= v.n ? ver : v;
      const slots = layoutWeek(weekVer.id === v.id ? v : weekVer, range.start, range.end, state.goals);
      const id = 'wk_' + range.start;
      state.plan.weeks[id] = { id, start: range.start, end: range.end, versionId: weekVer.id, status: 'planned', frozenAt: null, slots, createdAt: Date.now() };
      w = weekContaining(state, dateISO);
    }
    return w;
  }
  /* Freeze a week once it has begun: its slots become the agreed plan. */
  function freezeIfStarted(state, todayISO) {
    Object.values(state.plan.weeks).forEach(w => {
      if (!w.frozenAt && todayISO >= w.start) { w.frozenAt = Date.now(); w.status = 'frozen'; w.slots.forEach(s => { s.agreed = true; }); }
      if (todayISO > w.end && w.status !== 'closed') w.status = 'closed';
    });
  }
  /* Mark planned training/conditioning slots in the past as missed, never delete. */
  function reconcile(state, todayISO) {
    ensurePlan(state);
    freezeIfStarted(state, todayISO);
    Object.values(state.plan.weeks).forEach(w => w.slots.forEach(s => {
      if (s.status === 'planned' && s.date < todayISO && (s.kind === 'training' || s.kind === 'conditioning')) {
        s.status = 'missed'; s.history = (s.history || []).concat([{ at: Date.now(), action: 'missed', reason: 'The day passed without a logged session.' }]);
      }
    }));
  }

  /* ============================================================================
     WORKLOAD
     Hard sets (performed working sets, by muscle) and conditioning points
     (minutes x intensity: easy 1, moderate 2, hard 3). Extras and imported
     activities count exactly like planned work.
     ========================================================================== */
  const INTENSITY = { easy: 1, moderate: 2, mixed: 2, hard: 3 };
  function workoutLoad(w) {
    const byMuscle = {}; let hardSets = 0, cond = 0, minutes = 0;
    (w.blocks || []).forEach(b => {
      if (b.type === 'resistance') (b.exercises || []).forEach(e => {
        const ex = X.EX_INDEX[e.id]; hardSets += e.sets;
        if (ex) byMuscle[ex.primary] = (byMuscle[ex.primary] || 0) + e.sets;
      });
      else if (b.type === 'intervals') { const sec = (b.work || []).reduce((a, x) => a + x.workSec, 0) * b.rounds; cond += (sec / 60) * 3; minutes += sec / 60; }
      else if (b.type === 'steady') { cond += b.minutes * (INTENSITY[b.intensity] || 2); minutes += b.minutes; }
      else if (b.type === 'circuit') { const m = (b.rounds * (b.moves || []).length * 40) / 60; cond += m * 2; minutes += m; }
    });
    return { hardSets, byMuscle, condPts: Math.round(cond), conditioningMinutes: Math.round(minutes) };
  }
  function sessionLoad(sess) {
    const byMuscle = {}; let hardSets = 0;
    (sess.entries || []).forEach(e => {
      if (e.skipped) return;
      const n = (e.sets || []).filter(s => !s.warmup && (s.status === 'confirmed' || s.status === 'edited')).length;
      hardSets += n;
      const ex = X.EX_INDEX[e.variantId]; if (ex && n) byMuscle[ex.primary] = (byMuscle[ex.primary] || 0) + n;
    });
    return { hardSets, byMuscle, condPts: Math.round(sess.condPts || 0), conditioningMinutes: Math.round(sess.condMinutes || 0) };
  }
  function externalLoad(state, start, end) {
    let cond = 0, minutes = 0;
    ((state.wellness && state.wellness.activities) || []).forEach(a => {
      if (a.date < start || a.date > end || a.linkedSessionId || a.excluded) return;
      cond += (a.minutes || 0) * (INTENSITY[a.intensity] || 2); minutes += a.minutes || 0;
    });
    return { condPts: Math.round(cond), conditioningMinutes: Math.round(minutes) };
  }
  function weekLoad(state, week) {
    const total = { hardSets: 0, byMuscle: {}, condPts: 0, conditioningMinutes: 0, days: new Set(), sessions: 0, extras: 0 };
    (state.sessions || []).forEach(s => {
      if (s.status !== 'completed' || s.date < week.start || s.date > week.end) return;
      const l = sessionLoad(s);
      total.hardSets += l.hardSets; total.condPts += l.condPts; total.conditioningMinutes += l.conditioningMinutes;
      Object.keys(l.byMuscle).forEach(m => { total.byMuscle[m] = (total.byMuscle[m] || 0) + l.byMuscle[m]; });
      if (l.hardSets || l.condPts) { total.days.add(s.date); total.sessions++; if (s.extra) total.extras++; }
    });
    const ex = externalLoad(state, week.start, week.end);
    total.condPts += ex.condPts; total.conditioningMinutes += ex.conditioningMinutes;
    total.externalMinutes = ex.conditioningMinutes;
    return total;
  }
  function plannedRemaining(state, week, fromISO) {
    const out = { hardSets: 0, byMuscle: {}, condPts: 0, slots: [] };
    const v = versionById(state, week.versionId) || currentVersion(state);
    week.slots.forEach(s => {
      if (s.status !== 'planned' || s.date < fromISO) return;
      if (s.kind === 'training') {
        const r = sessionRoster(state, s);
        r.items.forEach(it => { out.hardSets += it.sets; const ex = X.EX_INDEX[it.id]; if (ex) out.byMuscle[ex.primary] = (out.byMuscle[ex.primary] || 0) + it.sets; });
        out.slots.push(s.id);
      } else if (s.kind === 'conditioning') { out.condPts += s.minutes * (INTENSITY[s.intensity] || 2); out.slots.push(s.id); }
    });
    return out;
  }
  function capacity(state, readiness) {
    const g = state.goals || {};
    const xp = EXPERIENCE_VOLUME[g.experience] || EXPERIENCE_VOLUME.intermediate;
    const condCeil = { general_fitness: 320, fat_loss: 300, mobility: 240, recomp: 240, build_muscle: 200, strength: 180 }[g.primary] || 240;
    const f = readiness != null && readiness <= E.TUNING.readyLowMax ? 0.8 : 1;
    return { setCeiling: Math.round(xp.setCeiling * f), condCeiling: Math.round(condCeil * f),
             maxSessions: (g.daysPerWeek || 4) + 1, factor: f };
  }
  function strainLevel(load, cap, sessionsAfter) {
    const ratio = Math.max(load.hardSets / cap.setCeiling, load.condPts / cap.condCeiling, sessionsAfter / cap.maxSessions);
    return { ratio: Math.round(ratio * 100) / 100, level: ratio <= 0.85 ? 'ok' : ratio <= 1.0 ? 'high' : 'excessive' };
  }

  /* ============================================================================
     SESSION ROSTER (what a planned session actually contains)
     ========================================================================== */
  function dayOf(state, week, slot) {
    const v = versionById(state, week.versionId) || currentVersion(state);
    return v ? v.template.days.find(d => d.id === slot.dayId) || null : null;
  }
  function weekOfSlot(state, slotIdOrSlot) {
    const id = typeof slotIdOrSlot === 'string' ? slotIdOrSlot : slotIdOrSlot.id;
    return Object.values(state.plan.weeks).find(w => w.slots.some(s => s.id === id)) || null;
  }
  function findSlot(state, id) { const w = weekOfSlot(state, id); return w ? { week: w, slot: w.slots.find(s => s.id === id) } : null; }
  /* Apply a slot's recorded modifications to its template day. */
  function sessionRoster(state, slot) {
    const week = weekOfSlot(state, slot);
    const day = week ? dayOf(state, week, slot) : null;
    const notes = [];
    let items = day ? day.exercises.map(e => ({ id: e.id, sets: e.sets, repMin: e.repMin, repMax: e.repMax, role: e.role })) : [];
    (slot.mods || []).forEach(m => {
      if (m.type === 'drop') items = items.filter(i => i.id !== m.exerciseId);
      else if (m.type === 'sets') items.forEach(i => { if (i.id === m.exerciseId) { i.sets = m.sets; i.modified = true; } });
      else if (m.type === 'swap') items.forEach(i => { if (i.id === m.from) { const nx = X.EX_INDEX[m.to]; i.id = m.to; if (nx) { i.repMin = Math.max(nx.lo, Math.min(i.repMin, nx.hi)); i.repMax = Math.min(nx.hi, Math.max(i.repMax, i.repMin)); } i.swappedFrom = m.from; } });
      if (m.reason) notes.push(m.reason);
    });
    const minutes = items.length ? sessionMinutes(items) : 0;
    return { items, minutes, notes, dayName: day ? day.name : slot.label };
  }

  /* ============================================================================
     MOVING SESSIONS (never cramming, never losing progression)
     Progression lives in each exercise's own history, so a session keeps its
     identity (Upper A is still Upper A) wherever it falls in the week.
     ========================================================================== */
  const isHardKind = k => k === 'training';
  function trainingDays(week, exceptSlot) { return week.slots.filter(s => s.kind === 'training' && s !== exceptSlot && (s.status === 'planned' || s.status === 'completed' || s.status === 'partial')); }
  function kindOfSlot(state, week, s) { const d = dayOf(state, week, s); return d ? d.kind : 'full'; }
  function crampCheck(state, week, slot, toDate) {
    const problems = [], warnings = [];
    const others = trainingDays(week, slot);
    if (others.some(s => s.date === toDate)) problems.push('There is already a training session that day. Two sessions are not stacked.');
    const dates = others.map(s => s.date).concat([toDate]).sort();
    const idx = dates.indexOf(toDate);
    let run = 1; for (let i = idx - 1; i >= 0 && diffDays(dates[i], dates[i + 1]) === 1; i--) run++;
    for (let i = idx + 1; i < dates.length && diffDays(dates[i - 1], dates[i]) === 1; i++) run++;
    if (run >= 3) problems.push('That would make three training days in a row.');
    const myKind = kindOfSlot(state, week, slot);
    others.forEach(o => {
      if (Math.abs(diffDays(o.date, toDate)) === 1 && kindOfSlot(state, week, o) === myKind && myKind !== 'full')
        problems.push(`${o.label} is on the next or previous day and trains the same muscles.`);
      else if (Math.abs(diffDays(o.date, toDate)) === 1) warnings.push(`${o.label} is the day next to it, so the two sessions are back to back.`);
    });
    return { problems, warnings };
  }
  function moveSlot(state, slotId, toDate, reason, todayISO) {
    const f = findSlot(state, slotId);
    if (!f) return { ok: false, problems: ['That session could not be found.'] };
    const { week, slot } = f;
    if (['completed', 'partial'].includes(slot.status)) return { ok: false, problems: ['A finished session cannot be moved.'] };
    if (toDate < todayISO) return { ok: false, problems: ['A session cannot be moved into the past.'] };
    if (toDate < week.start || toDate > week.end) return { ok: false, problems: ['Sessions move within their own training week. A missed session is not carried into the next one.'] };
    if (toDate === slot.date) return { ok: false, problems: ['It is already on that day.'] };
    const target = week.slots.find(s => s.date === toDate && s !== slot && s.status === 'planned' && ['rest', 'recovery', 'stretch'].includes(s.kind));
    const occupiedHard = week.slots.find(s => s.date === toDate && s !== slot && ['training', 'conditioning'].includes(s.kind) && !['skipped', 'missed'].includes(s.status));
    if (slot.kind === 'training') {
      const chk = crampCheck(state, week, slot, toDate);
      if (chk.problems.length) return { ok: false, problems: chk.problems, warnings: chk.warnings };
      if (occupiedHard) return { ok: false, problems: ['Another session is already on that day.'] };
    } else if (occupiedHard) return { ok: false, problems: ['Another session is already on that day.'] };
    const from = slot.date;
    const rec = { at: Date.now(), from, to: toDate, reason: reason || 'moved by you' };
    slot.moves.push(rec); slot.date = toDate;
    slot.history = (slot.history || []).concat([{ at: rec.at, action: 'moved', from, to: toDate, reason: rec.reason }]);
    if (target) { target.moves.push({ at: rec.at, from: target.date, to: from, reason: 'swapped to make room' }); target.date = from; }
    week.slots.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    logChange(state, { type: 'move', slotId, label: slot.label, from, to: toDate, reason: rec.reason });
    return { ok: true, slot, swappedWith: target ? target.id : null, warnings: crampCheck(state, week, slot, toDate).warnings };
  }
  /* Where could a missed or at-risk session go without stacking anything? */
  function suggestReschedule(state, slotId, todayISO) {
    const f = findSlot(state, slotId); if (!f) return { options: [], note: 'Session not found.' };
    const { week, slot } = f;
    const options = [];
    for (let d = todayISO > slot.date ? todayISO : addDays(slot.date, 1); d <= week.end; d = addDays(d, 1)) {
      const free = week.slots.find(s => s.date === d && s !== slot && ['rest', 'recovery', 'stretch'].includes(s.kind) && s.status === 'planned');
      if (!free) continue;
      const chk = crampCheck(state, week, Object.assign({}, slot, { date: slot.date }), d);
      if (!chk.problems.length) options.push({ date: d, warnings: chk.warnings, replaces: free.kind });
    }
    // keep one full rest day in the week
    const restDays = week.slots.filter(s => s.kind === 'rest' && s.status === 'planned' && s.date >= todayISO).length;
    const safe = options.filter(o => o.replaces !== 'rest' || restDays > 1);
    return { options: safe.slice(0, 3), note: safe.length ? '' : 'No safe day is left this week. It stays recorded as missed and is not added on top of the other sessions.' };
  }
  function skipSlot(state, slotId, reason, why) {
    const f = findSlot(state, slotId); if (!f) return { ok: false };
    const { slot } = f; if (['completed', 'partial'].includes(slot.status)) return { ok: false, problems: ['Already finished.'] };
    slot.status = 'skipped'; slot.missReason = why || 'other';   // 'time' | 'capacity' | 'illness' | 'travel' | 'other'
    slot.history = (slot.history || []).concat([{ at: Date.now(), action: 'skipped', reason: reason || '', category: slot.missReason }]);
    logChange(state, { type: 'skip', slotId, label: slot.label, category: slot.missReason, reason: reason || '' });
    return { ok: true, slot };
  }
  function classifyMiss(state, slotId, why) {
    const f = findSlot(state, slotId); if (!f) return { ok: false };
    f.slot.missReason = why; f.slot.history = (f.slot.history || []).concat([{ at: Date.now(), action: 'classified', category: why }]);
    return { ok: true };
  }
  /* A logged session completes (or partly completes) the slot it was started from. */
  function completeSlot(state, slotId, sess, ratio) {
    const f = findSlot(state, slotId); if (!f) return null;
    const { slot } = f;
    slot.status = ratio >= 0.75 ? 'completed' : 'partial'; slot.sessionId = sess.id; slot.completedOn = sess.date; slot.ratio = Math.round(ratio * 100) / 100;
    slot.history = (slot.history || []).concat([{ at: Date.now(), action: slot.status, sessionId: sess.id, ratio: slot.ratio }]);
    return slot;
  }

  /* ============================================================================
     EXTRA WORKOUTS: previewed against the week before anything is saved
     ========================================================================== */
  function previewExtra(state, workout, dateISO, todayISO, readiness) {
    const week = ensureWeek(state, dateISO);
    const load = workoutLoad(workout);
    const done = weekLoad(state, week);
    const remaining = plannedRemaining(state, week, todayISO);
    const cap = capacity(state, readiness);
    const projected = { hardSets: done.hardSets + remaining.hardSets + load.hardSets, condPts: done.condPts + remaining.condPts + load.condPts };
    const plannedDays = week.slots.filter(s => s.kind === 'training' && !['skipped', 'missed'].includes(s.status)).length;
    const sessionsAfter = plannedDays + done.extras + 1;
    const before = strainLevel({ hardSets: done.hardSets + remaining.hardSets, condPts: done.condPts + remaining.condPts }, cap, plannedDays + done.extras);
    const after = strainLevel(projected, cap, sessionsAfter);
    const changes = [];
    // sessions within a day of the extra that train the same muscles
    week.slots.filter(s => s.kind === 'training' && s.status === 'planned' && s.date >= todayISO && Math.abs(diffDays(s.date, dateISO)) <= 1).forEach(s => {
      const r = sessionRoster(state, s);
      r.items.forEach(it => {
        const ex = X.EX_INDEX[it.id];
        if (ex && load.byMuscle[ex.primary] && it.sets > 2)
          changes.push({ id: `${s.id}:${it.id}`, op: 'slot_mod', slotId: s.id, mod: { type: 'sets', exerciseId: it.id, sets: it.sets - 1, reason: `One set less on ${ex.short || ex.name} because the extra session trains ${ex.primary} the day ${diffDays(dateISO, s.date) > 0 ? 'before' : 'after'}.` },
            text: `${s.label}: ${ex.short || ex.name} from ${it.sets} to ${it.sets - 1} sets.` });
      });
    });
    if (after.level === 'excessive') {
      const nextHard = week.slots.filter(s => s.kind === 'conditioning' && s.status === 'planned' && s.date >= todayISO).slice(-1)[0]
        || week.slots.filter(s => s.kind === 'training' && s.status === 'planned' && s.date > dateISO).slice(-1)[0];
      if (nextHard) changes.push({ id: `${nextHard.id}:convert`, op: 'convert_slot', slotId: nextHard.id, toKind: 'recovery',
        text: `${nextHard.label} on ${nextHard.date} becomes a recovery day, so the week stays within what you can recover from.` });
    }
    const advice = after.level === 'ok' ? 'This fits the week.'
      : after.level === 'high' ? 'This is a demanding week with the extra session. Accepting the suggested adjustments keeps it manageable.'
      : 'Adding this on top of the plan would overload the week. It is better to replace a planned session, or accept the adjustments below.';
    const sameDaySlot = week.slots.find(s => s.date === dateISO && ['training', 'conditioning'].includes(s.kind) && s.status === 'planned');
    return { week: week.id, date: dateISO, workoutId: workout.id, load, done: { hardSets: done.hardSets, condPts: done.condPts, sessions: done.sessions },
      remaining: { hardSets: remaining.hardSets, condPts: remaining.condPts }, capacity: cap, before, after, projected, changes, advice,
      conflict: sameDaySlot ? { slotId: sameDaySlot.id, label: sameDaySlot.label } : null };
  }
  function applyChanges(state, changes, ctx) {
    ctx = ctx || {}; const applied = [];
    (changes || []).forEach(c => {
      const f = c.slotId ? findSlot(state, c.slotId) : null;
      if (c.op === 'slot_mod' && f) {
        if (f.slot.status !== 'planned') return;
        f.slot.mods.push(Object.assign({ at: Date.now(), source: ctx.source || 'plan' }, c.mod));
        applied.push(c.text || c.mod.reason);
      } else if (c.op === 'convert_slot' && f) {
        if (f.slot.status !== 'planned') return;
        const from = f.slot.kind;
        f.slot.history = (f.slot.history || []).concat([{ at: Date.now(), action: 'converted', from, to: c.toKind, reason: c.text || '' }]);
        f.slot.kind = c.toKind; f.slot.label = c.toKind === 'recovery' ? 'Recovery day' : c.toKind === 'rest' ? 'Rest day' : f.slot.label; f.slot.minutes = c.toKind === 'recovery' ? 15 : 0;
        applied.push(c.text || `Changed to ${c.toKind}.`);
      } else if (c.op === 'slot_move' && f) {
        const r = moveSlot(state, c.slotId, c.toDate, c.reason, ctx.todayISO);
        if (r.ok) applied.push(c.text || `Moved to ${c.toDate}.`);
      }
    });
    if (applied.length) logChange(state, { type: 'adjust', source: ctx.source || 'plan', reason: ctx.reason || '', applied });
    return applied;
  }
  /* Add an extra (or replacement) session record that counts everywhere. */
  function registerExtra(state, spec) {
    ensurePlan(state);
    const week = ensureWeek(state, spec.date);
    const entry = { id: uid('ex'), at: Date.now(), date: spec.date, workoutId: spec.workoutId, replacesSlotId: spec.replacesSlotId || null, sessionId: spec.sessionId || null, impact: spec.impact || null };
    week.extras = (week.extras || []).concat([entry]);
    if (spec.replacesSlotId) {
      const f = findSlot(state, spec.replacesSlotId);
      if (f && f.slot.status === 'planned') {
        f.slot.status = 'completed'; f.slot.replacedBy = spec.workoutId; f.slot.sessionId = spec.sessionId; f.slot.completedOn = spec.date; f.slot.ratio = 1;
        f.slot.history = (f.slot.history || []).concat([{ at: Date.now(), action: 'replaced', by: spec.workoutId }]);
      }
    }
    logChange(state, { type: 'extra', workoutId: spec.workoutId, date: spec.date, replaces: spec.replacesSlotId || null });
    return entry;
  }

  /* ============================================================================
     DAILY ADJUSTMENTS: preview first, apply on confirmation, keep the reasons
     ========================================================================== */
  function trimToMinutes(items, targetMin) {
    const out = items.map(i => Object.assign({}, i)); const changes = []; let guard = 0;
    while (sessionMinutes(out) > targetMin && guard++ < 80) {
      const accIdx = out.map((it, i) => ({ it, i })).filter(x => x.it.role !== 'main').reverse();
      const spare = accIdx.find(x => x.it.sets > 2);
      if (spare) { spare.it.sets -= 1; changes.push({ type: 'sets', exerciseId: spare.it.id, sets: spare.it.sets }); continue; }
      if (accIdx.length) { const d = out.splice(accIdx[0].i, 1)[0]; changes.push({ type: 'drop', exerciseId: d.id }); continue; }
      const mains = out.filter(x => x.role === 'main' && x.sets > 2);
      if (mains.length) { const m = mains[mains.length - 1]; m.sets -= 1; changes.push({ type: 'sets', exerciseId: m.id, sets: m.sets }); continue; }
      // last resort: keep the first two main lifts, drop the rest
      const mainIdx = out.map((it, i) => ({ it, i })).filter(x => x.it.role === 'main');
      if (mainIdx.length > 2) { const d = out.splice(mainIdx[mainIdx.length - 1].i, 1)[0]; changes.push({ type: 'drop', exerciseId: d.id }); continue; }
      break;
    }
    return { items: out, changes, fits: sessionMinutes(out) <= targetMin };
  }
  /* Equipment unavailable: swap to an alternative that is possible, has the same
     primary muscle, and keeps its own history. */
  function swapForEquipment(items, unavailable) {
    const out = items.map(i => Object.assign({}, i)); const changes = []; const unresolved = [];
    out.forEach(i => {
      const ex = X.EX_INDEX[i.id];
      if (!ex) return;
      const need = EQUIP_NEED[ex.equipment];
      if (!need || unavailable.indexOf(need) < 0) return;
      const alt = (ex.alternatives || []).map(id => X.EX_INDEX[id]).find(a => a && !a.libraryOnly && a.primary === ex.primary &&
        (!EQUIP_NEED[a.equipment] || unavailable.indexOf(EQUIP_NEED[a.equipment]) < 0) && !out.some(o => o.id === a.id));
      if (alt) { changes.push({ type: 'swap', from: i.id, to: alt.id }); i.id = alt.id; }
      else unresolved.push(i.id);
    });
    unresolved.forEach(id => { const k = out.findIndex(o => o.id === id); if (k >= 0) { out.splice(k, 1); changes.push({ type: 'drop', exerciseId: id }); } });
    return { items: out, changes, dropped: unresolved };
  }
  function previewDayAdjust(state, slotId, kind, params) {
    const f = findSlot(state, slotId); if (!f) return { ok: false, problems: ['Session not found.'] };
    const { slot } = f;
    if (slot.kind !== 'training') return { ok: false, problems: ['Only training sessions can be shortened or changed.'] };
    if (slot.status !== 'planned') return { ok: false, problems: ['That session is already finished.'] };
    params = params || {};
    const before = sessionRoster(state, slot);
    let items = before.items, mods = [], reason = '', why = '';
    if (kind === 'less_time') {
      const target = Math.max(10, Math.round(params.minutes || 30));
      const r = trimToMinutes(items, target); items = r.items; mods = r.changes;
      reason = `You have ${target} minutes today.`;
      why = r.changes.length ? 'Accessories and extra sets go first, then lower-priority main lifts. The first two main lifts stay so their progression can still be measured.' : 'The session already fits.';
      params.fits = r.fits;
    } else if (kind === 'equipment') {
      const r = swapForEquipment(items, params.unavailable || []); items = r.items; mods = r.changes;
      reason = `${(params.unavailable || []).join(', ')} not available today.`;
      why = r.changes.length ? 'Each swap uses an exercise for the same muscle and keeps its own history.' : 'Nothing in this session needs that equipment.';
    } else if (kind === 'feel_different') {
      const level = params.level === 'better' ? 'better' : 'worse';
      if (level === 'worse') {
        items.forEach(i => { if (i.sets > 2 && i.role !== 'main') { mods.push({ type: 'sets', exerciseId: i.id, sets: i.sets - 1 }); } });
        reason = 'You feel worse today.'; why = 'Accessory sets drop by one and no load increases today. The main lifts keep their sets.';
      } else { reason = 'You feel better today.'; why = 'The plan does not add work on a good day. Load only goes up through the progression rules, and any pain flag still comes first.'; }
    } else return { ok: false, problems: ['Unknown adjustment.'] };
    const afterItems = applyModsToItems(before.items, mods);
    const after = { items: afterItems, minutes: afterItems.length ? sessionMinutes(afterItems) : 0 };
    return { ok: true, slotId, kind, params, reason, why, mods: mods.map(m => Object.assign({}, m, { reason })),
      before: { minutes: before.minutes, exercises: before.items.length, sets: before.items.reduce((a, i) => a + i.sets, 0) },
      after: { minutes: after.minutes, exercises: after.items.length, sets: after.items.reduce((a, i) => a + i.sets, 0) },
      holdProgression: kind === 'feel_different' && params.level !== 'better', changed: mods.length > 0,
      fits: kind === 'less_time' ? params.fits : null };
  }
  function applyModsToItems(items, mods) {
    let out = items.map(i => Object.assign({}, i));
    mods.forEach(m => {
      if (m.type === 'drop') out = out.filter(i => i.id !== m.exerciseId);
      else if (m.type === 'sets') out.forEach(i => { if (i.id === m.exerciseId) i.sets = m.sets; });
      else if (m.type === 'swap') out.forEach(i => { if (i.id === m.from) i.id = m.to; });
    });
    return out;
  }
  function applyDayAdjust(state, preview, liveSession) {
    const f = findSlot(state, preview.slotId); if (!f) return { ok: false };
    const { slot } = f;
    preview.mods.forEach(m => slot.mods.push(Object.assign({ at: Date.now(), source: 'daily:' + preview.kind }, m)));
    if (preview.holdProgression) slot.holdProgression = true;
    state.plan.adjustLog.push({ at: Date.now(), slotId: slot.id, date: slot.date, kind: preview.kind, params: preview.params, reason: preview.reason, why: preview.why,
      before: preview.before, after: preview.after, changes: preview.mods.length });
    logChange(state, { type: 'daily', kind: preview.kind, slotId: slot.id, reason: preview.reason, changes: preview.mods.length });
    /* An active session keeps everything already performed: only unperformed entries change. */
    const kept = [];
    if (liveSession) {
      (liveSession.entries || []).forEach(e => {
        const m = preview.mods.find(x => (x.type === 'drop' && x.exerciseId === e.variantId));
        const performed = (e.sets || []).some(s => s.status === 'confirmed' || s.status === 'edited');
        if (m && performed) kept.push(e.variantId);
      });
    }
    return { ok: true, slot, keptPerformed: kept };
  }

  /* ============================================================================
     PHASES AND MILESTONES: the plan has no end date
     ========================================================================== */
  function blockInfo(state, weekStart) {
    const v0 = state.plan && state.plan.versions[0];
    const startedOn = (v0 && v0.effectiveFrom) || weekStart;
    const idx = Math.max(0, Math.floor(diffDays(startedOn, weekStart) / 7));
    const every = ((state.profile && state.profile.deloadEveryWeeks) || 6);
    return { weekIndex: idx + 1, block: Math.floor(idx / every) + 1, weekInBlock: (idx % every) + 1, blockLength: every,
             phase: (idx % every) === every - 1 ? 'consolidate' : 'build' };
  }
  function milestoneProgress(state, m, todayISO) {
    const out = { id: m.id, label: m.label, target: m.target, due: m.due || null, current: null, pct: null, status: 'no_data' };
    if (m.kind === 'bodyweight') {
      const bw = (state.bodyweight || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
      if (bw.length) { const cur = bw[bw.length - 1].kg, start = m.start != null ? m.start : bw[0].kg;
        out.current = cur; out.pct = Math.max(0, Math.min(100, Math.round(((start - cur) / (start - m.target || 1)) * 100)));
        if (m.target > start) out.pct = Math.max(0, Math.min(100, Math.round(((cur - start) / (m.target - start)) * 100)));
        out.status = out.pct >= 100 ? 'reached' : 'in_progress'; }
    } else if (m.kind === 'lift') {
      const b = (state.bests || {})[m.exerciseId];
      if (b && b.e1rm) { out.current = b.e1rm; const start = m.start || b.e1rm; out.pct = Math.max(0, Math.min(100, Math.round(((b.e1rm - start) / ((m.target - start) || 1)) * 100)));
        out.status = b.e1rm >= m.target ? 'reached' : 'in_progress'; if (b.e1rm >= m.target) out.pct = 100; }
    } else if (m.kind === 'consistency') {
      const weeks = Object.values(state.plan.weeks).filter(w => w.status === 'closed').slice(-m.weeks);
      const okWeeks = weeks.filter(w => { const s = w.slots.filter(x => x.kind === 'training'); return s.length && s.filter(x => ['completed'].includes(x.status)).length / s.length >= 0.75; }).length;
      out.current = okWeeks; out.pct = Math.min(100, Math.round(okWeeks / m.weeks * 100)); out.status = okWeeks >= m.weeks ? 'reached' : 'in_progress';
    }
    if (m.due && todayISO && todayISO > m.due && out.status !== 'reached') out.status = 'overdue';
    return out;
  }
  function addMilestone(state, m) {
    state.goals.milestones = state.goals.milestones || [];
    const ms = Object.assign({ id: uid('ms'), createdAt: Date.now() }, m);
    state.goals.milestones.push(ms); return ms;
  }

  /* ============================================================================
     VERSIONS: propose, accept, history, rollback (future sessions only)
     ========================================================================== */
  function cloneTemplate(v) { return JSON.parse(JSON.stringify(v.template)); }
  function applyTemplateOps(template, ops) {
    const applied = [];
    ops.forEach(o => {
      if (o.op === 'template_exercise') {
        const d = template.days.find(x => x.id === o.dayId); const e = d && d.exercises.find(x => x.id === o.exerciseId);
        if (e) { Object.assign(e, o.set); template.overrides[o.exerciseId] = Object.assign({}, template.overrides[o.exerciseId], { sets: e.sets, repMin: e.repMin, repMax: e.repMax }); applied.push(o.text || `${o.exerciseId} updated`); }
      } else if (o.op === 'template_swap') {
        const d = template.days.find(x => x.id === o.dayId); const e = d && d.exercises.find(x => x.id === o.from);
        const nx = X.EX_INDEX[o.to];
        if (e && nx) { e.id = o.to; e.repMin = Math.max(nx.lo, Math.min(e.repMin, nx.hi)); e.repMax = Math.min(nx.hi, Math.max(e.repMax, e.repMin)); delete template.overrides[o.from];
          template.overrides[o.to] = { sets: e.sets, repMin: e.repMin, repMax: e.repMax }; applied.push(o.text || `${o.from} replaced by ${o.to}`); }
      } else if (o.op === 'template_conditioning') {
        const c = template.conditioning.find(x => x.id === o.id);
        if (c) { Object.assign(c, o.set); applied.push(o.text || 'conditioning changed'); }
      } else if (o.op === 'template_stretch') { template.stretchSlots = o.count; applied.push(o.text || 'stretch sessions changed'); }
    });
    return applied;
  }
  function nextWeekStart(state, todayISO) {
    ensureWeek(state, todayISO);
    const w = weekContaining(state, todayISO);
    return addDays(w.end, 1);
  }
  /* Create a new dated version from template operations. Takes effect from the
     next week; weeks already generated for the future are repointed to it. */
  function acceptVersion(state, spec, todayISO) {
    ensurePlan(state);
    const cur = currentVersion(state);
    const effectiveFrom = spec.effectiveFrom || nextWeekStart(state, todayISO);
    const template = cloneTemplate(cur);
    const ops = (spec.ops || []).filter(o => String(o.op).startsWith('template_'));
    const applied = applyTemplateOps(template, ops);
    const v = addVersion(state, { effectiveFrom, source: spec.source || 'weekly_review', reason: spec.reason || '', goals: spec.goals || cur.goals, template, phase: spec.phase,
      changes: applied.concat(spec.extraChanges || []), proposalId: spec.proposalId });
    // weeks that have not started yet follow the new version; started weeks keep theirs
    Object.values(state.plan.weeks).forEach(w => { if (w.start >= effectiveFrom && !w.frozenAt) w.versionId = v.id; });
    const slotOps = (spec.ops || []).filter(o => !String(o.op).startsWith('template_'));
    const slotApplied = applyChanges(state, slotOps, { source: spec.source || 'weekly_review', reason: spec.reason, todayISO });
    return { version: v, applied: applied.concat(slotApplied), effectiveFrom };
  }
  /* Roll back: a NEW version carrying the older template, effective from next
     week. Completed workouts and started weeks are never touched. */
  function rollbackTo(state, versionId, todayISO) {
    const target = versionById(state, versionId); if (!target) return { ok: false, problems: ['Version not found.'] };
    const cur = currentVersion(state);
    if (target.id === cur.id) return { ok: false, problems: ['That is already the current plan.'] };
    const effectiveFrom = nextWeekStart(state, todayISO);
    const v = addVersion(state, { effectiveFrom, source: 'rollback', reason: `Went back to plan version ${target.n}.`, goals: target.goals, template: target.template, phase: cur.phase,
      changes: [`Template restored from version ${target.n}.`] });
    v.restoredFrom = target.id;
    Object.values(state.plan.weeks).forEach(w => { if (w.start >= effectiveFrom && !w.frozenAt) w.versionId = v.id; });
    return { ok: true, version: v, effectiveFrom };
  }
  /* Keep planOverrides equal to the version governing today's week, so a change
     accepted for next week does not alter this week's prescriptions. */
  function syncOverrides(state, todayISO) {
    ensurePlan(state);
    const w = ensureWeek(state, todayISO);
    const v = (w && versionById(state, w.versionId)) || currentVersion(state);
    state.planOverrides = v ? Object.assign({}, v.template.overrides || {}) : {};
    return state.planOverrides;
  }



  /* ============================================================================
     BUILDING A SESSION FROM A SLOT
     One code path for the app and the tests: the roster comes from the plan, each
     exercise's prescription comes from double progression, and nothing here is
     performance until the user confirms it.
     ========================================================================== */
  function seedSetsFor(entry, ex, d) {
    const p = d.prescription; entry.sets = [];
    const n = p ? p.sets : ex.sets;
    for (let i = 0; i < n; i++) {
      const t = p && p.setTargets && p.setTargets[i] != null ? p.setTargets[i] : (p ? p.repsHigh : Math.round((ex.lo + ex.hi) / 2));
      entry.sets.push(C.newSet({ weight: p ? p.load : null, reps: t }));
    }
    if (p && p.backoff) for (let i = 0; i < p.backoff.sets; i++) entry.sets.push(C.newSet({ weight: p.backoff.load, reps: p.backoff.reps, role: 'backoff' }));
  }
  function buildSession(state, slotId, checkin, todayISO) {
    const f = findSlot(state, slotId); if (!f) return { ok: false, problems: ['Session not found.'] };
    const { week, slot } = f;
    if (slot.kind !== 'training') return { ok: false, problems: ['That is not a training session.'] };
    syncOverrides(state, todayISO);
    const roster = sessionRoster(state, slot);
    const dayIdx = (versionById(state, week.versionId) || currentVersion(state)).template.days.findIndex(d => d.id === slot.dayId) + 1;
    const sess = C.newSession(dayIdx || 1, todayISO);
    sess.slotId = slot.id; sess.dayName = roster.dayName; sess.checkin = checkin || null; sess.plan = { fromPlan: true, notes: roster.notes };
    state._exIndex = X.EX_INDEX;
    roster.items.forEach(it => {
      const ex = X.EX_INDEX[it.id]; if (!ex) return;
      const entry = C.newEntry(ex.id, ex.id);
      const d = E.decide({ state, ex, variantId: ex.id, checkin: checkin || null, todayISO, last: C.lastPerformance(state, ex.id, ex),
        settingsOverride: it.modified ? { sets: it.sets } : undefined, holdLoad: !!slot.holdProgression });
      entry.decision = d; seedSetsFor(entry, ex, d); sess.entries.push(entry);
    });
    return { ok: true, session: sess, slot, roster };
  }
  /* Apply new modifications to a session that is already running. Anything the
     user has already performed stays exactly as logged. */
  function reflowLiveSession(state, sess, mods, todayISO) {
    const kept = [], changed = [];
    const performed = e => (e.sets || []).some(s => s.status === 'confirmed' || s.status === 'edited');
    mods.forEach(m => {
      if (m.type === 'drop') {
        const i = sess.entries.findIndex(e => e.variantId === m.exerciseId);
        if (i < 0) return;
        if (performed(sess.entries[i])) kept.push(m.exerciseId); else { sess.entries.splice(i, 1); changed.push(`Removed ${(X.EX_INDEX[m.exerciseId] || {}).short || m.exerciseId}.`); }
      } else if (m.type === 'sets') {
        const e = sess.entries.find(x => x.variantId === m.exerciseId); if (!e) return;
        let top = e.sets.filter(s => !s.warmup && s.role !== 'backoff');
        let extra = top.length - m.sets;
        for (let k = e.sets.length - 1; k >= 0 && extra > 0; k--) {
          const st = e.sets[k]; if (!st.warmup && st.role !== 'backoff' && st.status === 'pending') { e.sets.splice(k, 1); extra--; }
        }
        if (extra > 0) kept.push(m.exerciseId); else changed.push(`${(X.EX_INDEX[m.exerciseId] || {}).short || m.exerciseId}: ${m.sets} sets.`);
      } else if (m.type === 'swap') {
        const i = sess.entries.findIndex(e => e.variantId === m.from); if (i < 0) return;
        if (performed(sess.entries[i])) { kept.push(m.from); return; }
        const ex = X.EX_INDEX[m.to]; if (!ex) return;
        const entry = C.newEntry(ex.id, ex.id); entry.substitutedFrom = m.from;
        const d = E.decide({ state, ex, variantId: ex.id, checkin: sess.checkin || null, todayISO, last: C.lastPerformance(state, ex.id, ex) });
        entry.decision = d; seedSetsFor(entry, ex, d); sess.entries[i] = entry;
        changed.push(`${(X.EX_INDEX[m.from] || {}).short || m.from} swapped for ${ex.short || ex.name}.`);
      }
    });
    return { changed, keptPerformed: kept };
  }

  /* ============================================================================
     CHANGING GOALS, AVAILABILITY OR EQUIPMENT
     The plan is rebuilt as a NEW version from next week. Completed sessions and
     every exercise's history are untouched. Where a rep range moves a lot, the
     start load for the new range is re-estimated from the recent best, once.
     ========================================================================== */
  function e1rmOf(w, r) { return !w || !r ? 0 : (r === 1 ? w : w * (1 + r / 30)); }
  function describeTemplateDiff(oldT, newT) {
    const out = []; const flat = t => { const m = {}; t.days.forEach(d => d.exercises.forEach(e => { m[e.id] = Object.assign({ day: d.name }, e); })); return m; };
    const a = flat(oldT), b = flat(newT);
    Object.keys(b).forEach(id => {
      const nm = (X.EX_INDEX[id] || {}).short || id;
      if (!a[id]) out.push(`${nm} added to ${b[id].day}.`);
      else if (a[id].sets !== b[id].sets || a[id].repMin !== b[id].repMin || a[id].repMax !== b[id].repMax)
        out.push(`${nm}: ${a[id].sets} × ${a[id].repMin}–${a[id].repMax} to ${b[id].sets} × ${b[id].repMin}–${b[id].repMax}.`);
    });
    Object.keys(a).forEach(id => { if (!b[id]) out.push(`${(X.EX_INDEX[id] || {}).short || id} removed. Its history is kept.`); });
    if (oldT.days.length !== newT.days.length) out.push(`Training days: ${oldT.days.length} to ${newT.days.length} a week.`);
    return out;
  }
  function changeGoals(state, patch, todayISO, reason) {
    ensurePlan(state);
    const next = JSON.parse(JSON.stringify(state.goals)); Object.assign(next, patch);
    if (patch.equipment) next.equipment = Object.assign({}, state.goals.equipment, patch.equipment);
    if (patch.preferences) next.preferences = Object.assign({}, state.goals.preferences, patch.preferences);
    const problems = validateGoals(next); if (problems.length) return { ok: false, problems };
    const cur = currentVersion(state);
    const template = generateTemplate(next);
    const effectiveFrom = nextWeekStart(state, todayISO);
    const rebased = [];
    // re-estimate the start load where the rep range moved by 2 or more
    Object.keys(template.overrides).forEach(id => {
      const o = template.overrides[id], old = cur.template.overrides[id]; const ex = X.EX_INDEX[id];
      const best = (state.bests || {})[id];
      if (!old || !best || !best.e1rm || !ex) return;
      const midOld = (old.repMin + old.repMax) / 2, midNew = (o.repMin + o.repMax) / 2;
      if (Math.abs(midNew - midOld) < 2) return;
      const inc = ((state.profile && state.profile.increments) || {})[ex.equipment] || 2.5;
      const reps = Math.round(midNew);
      const raw = (best.e1rm / (1 + reps / 30)) * 0.95;
      const load = Math.max(0, Math.round(raw / inc) * inc);
      if (load > 0 && ex.modality !== 'assisted') { o.startLoad = load; o.since = effectiveFrom; rebased.push(`${ex.short || ex.name}: start at ${load} kg for ${o.repMin}–${o.repMax} reps (about 95% of your recent best estimate).`); }
    });
    const diff = describeTemplateDiff(cur.template, template).concat(rebased);
    const changedKeys = Object.keys(patch);
    const v = addVersion(state, { effectiveFrom, source: 'goal_change', reason: reason || `Changed ${changedKeys.join(', ')}.`, goals: next, template, changes: diff });
    state.goals = next; state.goals.updatedAt = Date.now();
    // weeks that have not started are rebuilt; started weeks and all sessions are untouched
    Object.keys(state.plan.weeks).forEach(k => { const w = state.plan.weeks[k]; if (w.start >= effectiveFrom && !w.frozenAt) delete state.plan.weeks[k]; });
    return { ok: true, version: v, effectiveFrom, changes: diff };
  }
  /* What is on a date, and the next few days, for Today and My plan. */
  function slotsOn(state, dateISO) { const w = ensureWeek(state, dateISO); return w ? w.slots.filter(s => s.date === dateISO) : []; }
  function upcoming(state, fromISO, days) {
    const out = []; for (let i = 0; i < days; i++) { const d = addDays(fromISO, i); out.push({ date: d, slots: slotsOn(state, d) }); } return out;
  }
  const hasPlan = state => !!(state && state.goals && state.plan && state.plan.versions && state.plan.versions.length);
  function planHistory(state) { ensurePlan(state); return state.plan.log.slice().reverse(); }

  return { GOALS, GOAL_IDS, EXPERIENCE_VOLUME, SETTING_EFFECTS, explainSetting, defaultGoals, validateGoals,
    equipmentOk, isMainLift, avoided, exerciseMinutes, sessionMinutes, WARMUP_MIN, generateTemplate, chooseTrainingDows,
    isoDow, DOW_NAMES, addDays, diffDays, uid, r1, ensurePlan, currentVersion, versionById, logChange, addVersion, createInitialPlan,
    weekStartsOn, weekContaining, lastWeek, nextWeekRange, layoutWeek, ensureWeek, freezeIfStarted, reconcile,
    workoutLoad, sessionLoad, weekLoad, plannedRemaining, capacity, strainLevel, sessionRoster, dayOf, weekOfSlot, findSlot,
    crampCheck, moveSlot, suggestReschedule, skipSlot, classifyMiss, completeSlot, previewExtra, applyChanges, registerExtra,
    previewDayAdjust, applyDayAdjust, trimToMinutes, swapForEquipment, blockInfo, milestoneProgress, addMilestone,
    cloneTemplate, applyTemplateOps, nextWeekStart, acceptVersion, rollbackTo, syncOverrides, INTENSITY,
    changeGoals, describeTemplateDiff, hasPlan, slotsOn, upcoming, planHistory, seedSetsFor, buildSession, reflowLiveSession, _E: E, _C: C, _X: X, LIB };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Plan;
