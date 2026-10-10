/* ============================================================================
   Recomp adaptive engine.

   Deterministic, offline, explainable. Every decision returns a rule trace and
   a "what changed / why / next target" the UI shows verbatim.

   DESIGN RULES (enforced in code, not just intent):
     1. Completing the prescribed reps is NEVER on its own sufficient to add
        load. Effort, technique, comparable working sets and recent workload
        all gate it.
     2. Missing feedback stays UNKNOWN. Unknown never unlocks progression.
     3. Pain is never averaged into readiness and never treated as effort. It
        runs on its own stop/review pathway.
     4. Load and volume never increase in the same session for one exercise.
     5. No automatic deload. Deloads are proposed and must be confirmed.
   ========================================================================== */

/* Coaching parameters that encode judgement calls. These are the numbers a
   qualified S&C coach or physio should review — see COACHING_ASSUMPTIONS. */
const TUNING = {
  readyGoodMin: 7,          // readiness >= this: normal progression allowed
  readyLowMax: 4,           // readiness <= this: hold or reduce
  reserveProgressMin: 2,    // need >= 2 clean reps left to add load
  staleDays: 14,            // longer than this since the variant: returning
  deconditionPctPerWeek: 3, // load trimmed per week away, capped
  deconditionMaxPct: 15,
  plateauHolds: 3,          // consecutive holds at one load before intervening
  repCapBeforeLoad: 1.0,    // fraction of the rep range top before adding load
  maxJumpPctDefault: 5,
  heavyWeekSets: 22,        // per-muscle weekly set ceiling before easing off
  minLoadKg: 0,
  maxEffortDefault: 'near_limit',  // highest effort that still allows an increase
  plateauWindow: 4,         // comparable sessions that must show no improvement
  plateauMinDays: 14,       // ... spread over at least this many days
  plateauMinFeedback: 3,    // ... with feedback recorded on at least this many
  plateauImprovePct: 1      // best performance must beat the earlier best by this %
};

const EFFORT_SCALE = {
  very_easy:   { v: 1, label: 'Very easy' },
  manageable:  { v: 2, label: 'Manageable' },
  challenging: { v: 3, label: 'Challenging' },
  near_limit:  { v: 4, label: 'Near limit' },
  maximum:     { v: 5, label: 'Maximum' }
};
const RESERVE_SCALE = { '0': 0, '1': 1, '2': 2, '3': 3, '4+': 4, 'unsure': null };
const TECHNIQUE = ['controlled', 'deteriorating', 'unsure'];
const CAPACITY = ['another_set', 'enough', 'needed_less'];

function blankFeedback() {
  return { effort: null, reserve: null, technique: null, capacity: null, pain: null, at: null };
}
/* Pain is its own object and is never coerced into a number. */
/* Pain is described, not scored. The flags below are the ones that route to
   review on their own, regardless of how low the number is: a 2/10 that is
   sharp, or comes with numbness, is not a 2/10 worth training through. */
const CONCERNING_PAIN_FLAGS = ['sharp', 'swelling', 'numbness', 'givingWay', 'night', 'worsening'];
function blankPain() {
  return { present: false, location: null, severity: null, note: null, duringOrAfter: null,
           sharp: false, swelling: false, numbness: false, givingWay: false,
           night: false, worsening: false };
}
function painIsConcerning(pain) {
  if (!pain || !pain.present) return false;
  if (CONCERNING_PAIN_FLAGS.some(f => pain[f])) return true;
  return pain.severity != null && Number(pain.severity) >= 5;
}
function concerningReasons(pain) {
  const out = [];
  if (pain.sharp) out.push('you described it as sharp');
  if (pain.numbness) out.push('you reported numbness');
  if (pain.givingWay) out.push('the joint gave way');
  if (pain.swelling) out.push('there is swelling');
  if (pain.night) out.push('it wakes you at night');
  if (pain.worsening) out.push('it is getting worse');
  if (pain.severity != null && Number(pain.severity) >= 5) out.push(`you rated it ${pain.severity} out of 10`);
  return out;
}

/* ---- persistent pain concerns -------------------------------------------
   A concerning report opens a concern that stays open until the user clears
   it. It does not evaporate because the next session happened to be quiet. */
function openPainConcern(state, pain, variantId, dateISO) {
  state.painConcerns = state.painConcerns || [];
  const existing = state.painConcerns.find(c =>
    c.status === 'open' && c.variantId === variantId && c.location === pain.location);
  if (existing) {
    existing.lastReported = dateISO;
    existing.reports = (existing.reports || 1) + 1;
    return existing;
  }
  const c = {
    id: 'pc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    variantId, location: pain.location || null,
    severity: pain.severity != null ? Number(pain.severity) : null,
    flags: CONCERNING_PAIN_FLAGS.filter(f => pain[f]),
    note: pain.note || null,
    openedOn: dateISO, lastReported: dateISO, reports: 1,
    status: 'open', resolvedOn: null, resolution: null
  };
  state.painConcerns.push(c);
  return c;
}
function resolvePainConcern(state, id, dateISO, resolution) {
  const c = (state.painConcerns || []).find(x => x.id === id);
  if (!c) return null;
  c.status = 'resolved'; c.resolvedOn = dateISO; c.resolution = resolution || null;
  return c;
}
function openConcernFor(state, variantId) {
  return (state.painConcerns || []).find(c => c.status === 'open' && c.variantId === variantId) || null;
}
/* Scan history and open a concern for every concerning report not yet tracked. */
function syncPainConcerns(state) {
  (state.sessions || []).forEach(sess => {
    if (sess.status !== 'completed') return;
    (sess.entries || []).forEach(e => {
      const p = e.feedback && e.feedback.pain;
      if (painIsConcerning(p)) openPainConcern(state, p, e.variantId, sess.date);
    });
    const cp = sess.checkin && sess.checkin.pain;
    if (painIsConcerning(cp)) openPainConcern(state, cp, cp.location ? ('area:' + cp.location) : 'session', sess.date);
  });
  return state.painConcerns || [];
}

/* ----------------------------------------------------------- readiness
   Built from energy, sleep and soreness only. Pain is deliberately excluded:
   mixing it in would let a painful session average out to "fine".            */
function blankCheckin() {
  return { energy: null, sleep: null, soreness: null, timeAvailableMin: null,
           pain: null, at: null };
}
function readiness(checkin) {
  if (!checkin) return { score: null, known: false, parts: {}, reason: 'No check-in recorded' };
  const e = checkin.energy, s = checkin.sleep, so = checkin.soreness;
  const known = [e, s, so].filter(v => v != null).length;
  if (!known) return { score: null, known: false, parts: {}, reason: 'Check-in skipped' };
  // energy and sleep 1..5 (higher better); soreness 1..5 (higher = more sore)
  const vals = [];
  if (e != null) vals.push(e * 2);
  if (s != null) vals.push(s * 2);
  if (so != null) vals.push((6 - so) * 2);
  const score = vals.reduce((a, b) => a + b, 0) / vals.length;  // 2..10
  return { score: Math.round(score * 10) / 10, known: true, partial: known < 3,
           parts: { energy: e, sleep: s, soreness: so },
           reason: known < 3 ? 'Partial check-in' : 'Full check-in' };
}

/* ---------------------------------------------------- modality behaviour */
const MODALITY = {
  load_reps:           { progresses: 'load',  unit: 'reps' },
  weighted_bodyweight: { progresses: 'load',  unit: 'reps' },
  bodyweight_reps:     { progresses: 'reps',  unit: 'reps' },
  assisted:            { progresses: 'assist', unit: 'reps' },   // less assistance is progress
  timed_hold:          { progresses: 'time',  unit: 's' },
  carry:               { progresses: 'load',  unit: 'm' }
};

function incrementFor(ex, profile) {
  const inc = (profile && profile.increments) || {};
  return inc[ex.equipment] != null ? inc[ex.equipment] : (inc[ex.modality] || 2.5);
}
/* Returns the load increase that is allowed, or 0 when the smallest increment
   the gym can actually make is larger than the configured cap. Previously this
   computed max() then min() of the same pair and always returned `increment`,
   so the cap never applied. */
function capJump(current, increment, profile) {
  const pct = (profile && profile.maxLoadJumpPct) || TUNING.maxJumpPctDefault;
  if (!current) return increment;          // no baseline: nothing to cap against
  const cap = (current * pct) / 100;
  if (increment > cap) return 0;           // cannot move load without overshooting
  return increment;
}
function roundToIncrement(w, inc) {
  if (!inc) return Math.round(w * 2) / 2;
  return Math.round(w / inc) * inc;
}

/* ------------------------------------------------------- workload context */
function recentWorkload(state, ex, endISO, days) {
  const end = endISO || (typeof todayISO === 'function' ? todayISO() : null);
  const win = days || 7;
  let sets = 0;
  (state.sessions || []).forEach(s => {
    if (s.status !== 'completed') return;
    if (end && (s.date > end || s.date < addDaysSafe(end, -(win - 1)))) return;
    s.entries.forEach(e => {
      const def = (state._exIndex || {})[e.variantId];
      if (!def || !ex) return;
      if (def.primary && ex.primary && def.primary === ex.primary) {
        sets += (e.sets || []).filter(x => x.status === 'confirmed' || x.status === 'edited').length;
      }
    });
  });
  return { setsForMuscle: sets, window: win, muscle: ex ? ex.primary : null };
}
function addDaysSafe(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n);
  const z = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function daysSince(aISO, bISO) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  return Math.round((p(bISO) - p(aISO)) / 86400000);
}

/* --------------------------------------------------------- plateau check */
function consecutiveHolds(state, variantId) {
  const out = [];
  (state.sessions || []).filter(s => s.status === 'completed')
    .sort((a, b) => a.date < b.date ? 1 : -1)              // newest first
    .forEach(s => s.entries.forEach(e => {
      if (e.variantId === variantId && e.decision) out.push(e.decision.action);
    }));
  let n = 0;
  for (const a of out) { if (a === 'hold') n++; else break; }
  return n;
}

/* ============================================================================
   PROGRESSION SETTINGS, PER-SET TARGETS AND DOUBLE PROGRESSION

   Each exercise VARIANT can carry its own progression settings (state
   .exerciseSettings[variantId]). With none stored it resolves to defaults built
   from the exercise definition and the profile, so every exercise behaves as it
   did before until the user changes it. Settings, history and decisions are
   keyed by variant, so a barbell press and a dumbbell press never share them.

   METHODS
     double    Hold the load and build reps within a range, set by set. When every
               required working set reaches the top of the range, at the
               prescribed load, with acceptable effort, technique and feedback,
               add one available equipment increment and reset the reps to the
               bottom of the range. (On an assisted machine the "increase" is
               LESS assistance.)
     reps      Reps only: bodyweight work. Build reps; optionally add load once
               the cap is reached (addLoadAtCap).
     duration  Holds: build seconds, then optionally add load.
     distance  Carries: build distance, or when the distance is fixed move load.
     manual    The app never changes the load. It reports, you decide.
   ========================================================================== */
const PROGRESSION_METHODS = {
  double:   { label: 'Double progression', unit: 'reps' },
  reps:     { label: 'Reps only',          unit: 'reps' },
  duration: { label: 'Duration',           unit: 's' },
  distance: { label: 'Distance',           unit: 'm' },
  manual:   { label: 'Manual',             unit: null }
};
function defaultMethodFor(ex) {
  switch (ex.modality) {
    case 'bodyweight_reps': return 'reps';
    case 'timed_hold':      return 'duration';
    case 'carry':           return 'distance';
    default:                return 'double';
  }
}
/* Changing any of these changes what "qualifying" means, so sessions before the
   change stop counting towards the next increase. Increments and the jump limit
   do not: they change what is allowed, not what was achieved. */
const QUALIFYING_FIELDS = ['method', 'sets', 'repMin', 'repMax', 'minReserve',
                           'maxEffort', 'qualifyingSessions', 'requireTechnique'];

function r2(x) { return Math.round(x * 100) / 100; }

function resolveSettings(state, ex) {
  const profile = (state && state.profile) || {};
  const stored = ((state && state.exerciseSettings) || {})[ex.id] || null;
  const baseInc = incrementFor(ex, profile);
  const unitStep = (ex.modality === 'timed_hold' || ex.modality === 'carry') ? 5 : 1;
  const d = {
    method: defaultMethodFor(ex),
    sets: ex.sets, repMin: ex.lo, repMax: ex.hi,
    increments: [baseInc],
    minReserve: TUNING.reserveProgressMin,
    maxEffort: TUNING.maxEffortDefault,
    qualifyingSessions: 1,
    maxJumpPct: profile.maxLoadJumpPct || TUNING.maxJumpPctDefault,
    requireTechnique: false,
    addLoadAtCap: true,       // reps/duration: add load after the cap (legacy behaviour)
    strictLimit: false,       // carries with a fixed distance may exceed the limit, loudly
    backoff: null,            // { sets, pct } deliberate lighter sets after the working sets
    repStep: unitStep,        // how much a per-set target moves between sessions
    qualEpoch: null, changedAt: null
  };
  const s = Object.assign({}, d, stored || {});
  s.increments = cleanIncrements(s.increments, baseInc);
  s.maxEffortV = (EFFORT_SCALE[s.maxEffort] || EFFORT_SCALE[TUNING.maxEffortDefault]).v;
  if (!PROGRESSION_METHODS[s.method]) s.method = d.method;
  s.variantId = ex.id;
  s.source = stored ? 'custom' : 'default';
  return s;
}
function cleanIncrements(list, fallback) {
  const out = (Array.isArray(list) ? list : [list])
    .map(Number).filter(n => Number.isFinite(n) && n > 0)
    .map(r2);
  const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
  return uniq.length ? uniq : [fallback || 2.5];
}
/* The exercise as the engine reasons about it: the definition with the user's
   sets and rep range laid over it. Everything downstream reads ex.sets, ex.lo
   and ex.hi, so the settings take effect everywhere without special cases. */
function effectiveEx(ex, settings) {
  return Object.assign({}, ex, { sets: settings.sets, lo: settings.repMin, hi: settings.repMax });
}

/* Validate and normalise what the settings form (or a restored backup) hands
   over. Returns the cleaned settings and a list of problems; never throws. */
function normaliseSettings(raw, ex) {
  const problems = [];
  const intIn = (v, lo, hi, name, dflt) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < lo || n > hi) { problems.push(`${name} must be a whole number from ${lo} to ${hi}.`); return dflt; }
    return n;
  };
  const r = raw || {};
  const out = {};
  out.method = PROGRESSION_METHODS[r.method] ? r.method : (problems.push('Choose a progression method.'), defaultMethodFor(ex));
  out.sets = intIn(r.sets, 1, 10, 'Working sets', ex.sets);
  const maxRep = (ex.modality === 'timed_hold' || ex.modality === 'carry') ? 600 : 100;
  out.repMin = intIn(r.repMin, 1, maxRep, 'Minimum', ex.lo);
  out.repMax = intIn(r.repMax, 1, maxRep, 'Maximum', ex.hi);
  if (out.repMax < out.repMin) problems.push('The maximum cannot be below the minimum.');
  let incs = r.increments;
  if (typeof incs === 'string') incs = incs.split(/[\s,;/]+/).filter(Boolean);
  const cleaned = (Array.isArray(incs) ? incs : []).map(Number);
  if (!cleaned.length || cleaned.some(n => !Number.isFinite(n) || n <= 0 || n > 100)) {
    problems.push('Increments must be positive numbers, for example 1.25, 2.5, 5.');
    out.increments = [2.5];
  } else out.increments = cleanIncrements(cleaned, 2.5);
  out.minReserve = intIn(r.minReserve, 0, 4, 'Reps in reserve', TUNING.reserveProgressMin);
  out.maxEffort = EFFORT_SCALE[r.maxEffort] ? r.maxEffort : (problems.push('Choose a highest acceptable effort.'), TUNING.maxEffortDefault);
  out.qualifyingSessions = intIn(r.qualifyingSessions, 1, 5, 'Qualifying sessions', 1);
  const jp = Number(r.maxJumpPct);
  if (!Number.isFinite(jp) || jp < 0.5 || jp > 25) { problems.push('The progression limit must be between 0.5% and 25%.'); out.maxJumpPct = TUNING.maxJumpPctDefault; }
  else out.maxJumpPct = jp;
  out.requireTechnique = !!r.requireTechnique;
  out.addLoadAtCap = r.addLoadAtCap === undefined ? true : !!r.addLoadAtCap;
  out.strictLimit = !!r.strictLimit;
  if (r.backoff && (r.backoff.sets || r.backoff.pct)) {
    const bs = intIn(r.backoff.sets, 1, 4, 'Back-off sets', 1);
    const bp = Number(r.backoff.pct);
    if (!Number.isFinite(bp) || bp < 50 || bp > 95) problems.push('Back-off load must be 50% to 95% of the top load.');
    out.backoff = { sets: bs, pct: Number.isFinite(bp) ? bp : 85 };
  } else out.backoff = null;
  out.repStep = intIn(r.repStep === undefined ? ((ex.modality === 'timed_hold' || ex.modality === 'carry') ? 5 : 1) : r.repStep, 1, 60, 'Step', 1);
  return { settings: out, problems };
}

/* Save settings for a variant. Qualifying history restarts only when a field
   that changes what "qualifies" actually changed. Completed sessions, their
   prescriptions and their decisions are never touched. */
function saveExerciseSettings(state, ex, incoming, dateISO) {
  const before = resolveSettings(state, ex);
  const { settings, problems } = normaliseSettings(incoming, ex);
  if (problems.length) return { ok: false, problems };
  const changedQual = QUALIFYING_FIELDS.some(k => JSON.stringify(before[k]) !== JSON.stringify(settings[k]));
  state.exerciseSettings = state.exerciseSettings || {};
  const prev = state.exerciseSettings[ex.id] || {};
  state.exerciseSettings[ex.id] = Object.assign({}, settings, {
    qualEpoch: changedQual ? (dateISO || null) : (prev.qualEpoch || null),
    changedAt: Date.now()
  });
  return { ok: true, settings: resolveSettings(state, ex), restartedQualifying: changedQual };
}
function resetExerciseSettings(state, ex) {
  if (state.exerciseSettings) delete state.exerciseSettings[ex.id];
  return resolveSettings(state, ex);
}

/* ---------------------------------------------------------- set analysis
   Only performed, non-warm-up, non-back-off sets with a weight and a rep count
   are evidence. A skipped or unconfirmed set is not. */
function _perf(s) { return !!s && (s.status === 'confirmed' || s.status === 'edited'); }
function _isTop(s) { return !!s && !s.warmup && s.role !== 'backoff'; }
function _plannedTop(entry) { return (entry.sets || []).filter(_isTop); }
function _doneTop(entry) {
  return _plannedTop(entry).filter(s => _perf(s) &&
    s.actualReps != null && !Number.isNaN(s.actualReps) &&
    s.actualWeight != null && !Number.isNaN(s.actualWeight));
}
function _modal(values, preferLower) {
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = null, bestN = -1;
  [...counts.entries()].sort((a, b) => preferLower ? a[0] - b[0] : b[0] - a[0]).forEach(([v, n]) => {
    if (n > bestN) { best = v; bestN = n; }
  });
  return best;
}
/* "At or beyond the load" means at least as hard. For an assisted machine the
   harder weight is the LOWER one. */
function _atLeastAsHard(w, load, assisted) {
  return assisted ? w <= load + 1e-9 : w >= load - 1e-9;
}

/* Evaluate ONE recorded session of an exercise against the settings.
   Everything the next decision, the preview and the tests need is here. */
function evaluateEntry(entry, settings, ex) {
  const assisted = ex.modality === 'assisted';
  const planned = _plannedTop(entry);
  const done = _doneTop(entry);
  const plannedLoads = planned.map(s => s.plannedWeight).filter(w => w != null);
  const dec = entry.decision && entry.decision.prescription;
  const prescribed = plannedLoads.length ? _modal(plannedLoads, !assisted)
                   : (dec && dec.load != null ? dec.load : null);

  /* The comparable load is the prescribed load when most of the sets were done at
     or beyond it; otherwise it is what was actually done (modal, ties resolve
     to the easier load). A heavy opener followed by lighter back-off sets
     therefore never turns into "all sets at the heavier load". */
  let baseline = null;
  if (done.length) {
    const reached = prescribed != null
      ? done.filter(s => _atLeastAsHard(s.actualWeight, prescribed, assisted)) : [];
    baseline = (prescribed != null && reached.length && reached.length * 2 >= done.length)
      ? prescribed : _modal(done.map(s => s.actualWeight), !assisted);
    if (assisted && baseline != null && prescribed == null) baseline = _modal(done.map(s => s.actualWeight), false);
  }
  const atLoad = baseline == null ? [] : done.filter(s => _atLeastAsHard(s.actualWeight, baseline, assisted));
  const atLoadReps = atLoad.map(s => s.actualReps);
  const exactReps = baseline == null ? [] : done.filter(s => Math.abs(s.actualWeight - baseline) < 1e-9).map(s => s.actualReps);
  const need = settings.sets;
  const topCount = atLoadReps.filter(r => r >= settings.repMax).length;
  const setsOk = atLoad.length >= need;
  const repsOk = topCount >= need;

  const fbk = entry.feedback || null;
  const effort = fbk && fbk.effort ? EFFORT_SCALE[fbk.effort] || null : null;
  const reserve = fbk && fbk.reserve != null ? RESERVE_SCALE[String(fbk.reserve)] : undefined;
  const tech = fbk && fbk.technique ? fbk.technique : null;
  const cap = fbk && fbk.capacity ? fbk.capacity : null;
  const pain = !!(fbk && fbk.pain && fbk.pain.present);
  const sufficient = !!(effort || reserve != null) && !(settings.requireTechnique && (!tech || tech === 'unsure'));

  const blocks = [];
  if (!setsOk) blocks.push('sets');
  if (!repsOk) blocks.push('reps');
  if (!sufficient) blocks.push('feedback_missing');
  if (cap === 'needed_less') blocks.push('needed_less');
  if (tech === 'deteriorating') blocks.push('technique');
  if (pain) blocks.push('pain');
  if ((effort && effort.v >= 5) || reserve === 0) blocks.push('maximal');
  else if (effort && effort.v > settings.maxEffortV) blocks.push('effort');
  if (reserve != null && reserve > 0 && reserve < settings.minReserve) blocks.push('reserve');

  return {
    baseline, prescribed, performed: done.length, plannedCount: planned.length,
    atLoadReps, exactReps, need, setsOk, repsOk, topCount, blocks,
    qualifies: blocks.length === 0,
    effort, reserve: reserve === undefined ? null : reserve, tech, cap, pain, sufficient,
    allReps: done.map(s => s.actualReps)
  };
}

/* ------------------------------------------------- history (engine-local) */
function historyEntries(state, variantId) {
  const out = [];
  (state.sessions || []).filter(s => s.status === 'completed')
    .sort((a, b) => a.date === b.date ? (a.startedAt || 0) - (b.startedAt || 0) : (a.date < b.date ? -1 : 1))
    .forEach(sess => (sess.entries || []).forEach(e => {
      if (e.variantId !== variantId || e.skipped) return;
      if (!_doneTop(e).length) return;
      out.push({ session: sess, entry: e });
    }));
  return out;
}
/* Consecutive qualifying sessions at the same comparable load, newest first.
   Sessions before the last qualifying-rule change do not count. */
function qualifyingStreak(state, variantId, settings, ex, load) {
  const hist = historyEntries(state, variantId).reverse();
  let n = 0;
  for (const h of hist) {
    if (settings.qualEpoch && h.session.date < settings.qualEpoch) break;
    const ev = evaluateEntry(h.entry, settings, ex);
    if (ev.baseline == null || Math.abs(ev.baseline - load) > 1e-9) break;
    if (!ev.qualifies) break;
    n++;
  }
  return n;
}
function techniqueStreak(state, variantId) {
  const hist = historyEntries(state, variantId).reverse();
  let n = 0;
  for (const h of hist) {
    if (h.entry.feedback && h.entry.feedback.technique === 'deteriorating') n++; else break;
  }
  return n;
}
function priorNonDeloadEntry(state, variantId, beforeEntry) {
  const hist = historyEntries(state, variantId);
  const i = hist.findIndex(h => h.entry === beforeEntry);
  const upto = i < 0 ? hist : hist.slice(0, i);
  for (let k = upto.length - 1; k >= 0; k--) {
    const a = upto[k].entry.decision && upto[k].entry.decision.action;
    if (a !== 'deload') return upto[k];
  }
  return null;
}

/* ------------------------------------------------------- plateau detection
   A stall is NOT "the load stayed the same for three sessions": adding reps at
   one load is progress and is the whole point of double progression. A plateau
   needs enough comparable history, no improvement in comparable performance
   (load OR reps at that load), and feedback recorded on enough of those
   sessions that the stall is not just missing information.

   Comparable performance score = the best set's estimated strength, using the
   Epley form on an effective load: the load itself; bodyweight plus load for
   bodyweight work; bodyweight minus assistance on an assisted machine. Where
   there is no load at all it falls back to reps. */
function perfScore(entry, ex, bw) {
  const body = bw || 80;
  let best = 0;
  _doneTop(entry).forEach(s => {
    let eff;
    if (ex.modality === 'assisted') eff = Math.max(1, body - s.actualWeight);
    else if (ex.modality === 'bodyweight_reps' || ex.modality === 'timed_hold') eff = body * 0.6 + s.actualWeight;
    else eff = s.actualWeight;
    const v = eff > 0 ? eff * (1 + s.actualReps / 30) : s.actualReps;
    if (v > best) best = v;
  });
  return best;
}
function detectPlateau(state, variantId, settings, ex, todayStr) {
  const W = TUNING.plateauWindow;
  const bw = state.profile && state.profile.bodyweightKg;
  let hist = historyEntries(state, variantId).filter(h => {
    const a = h.entry.decision && h.entry.decision.action;
    return a !== 'deload';                           // an easy week is not evidence of a stall
  });
  if (settings.qualEpoch) hist = hist.filter(h => h.session.date >= settings.qualEpoch);
  if (hist.length < W) return null;
  const win = hist.slice(-W);
  const earlier = hist.slice(0, hist.length - (W - 1));          // everything up to and including the window's first session
  const ref = Math.max(...earlier.map(h => perfScore(h.entry, ex, bw)));
  const recentBest = Math.max(...win.slice(1).map(h => perfScore(h.entry, ex, bw)));
  if (recentBest > ref * (1 + TUNING.plateauImprovePct / 100)) return null;      // something improved
  const spanDays = daysSince(win[0].session.date, win[win.length - 1].session.date);
  if (spanDays < TUNING.plateauMinDays) return null;
  const known = win.filter(h => { const f = h.entry.feedback; return f && (f.effort || (f.reserve != null && f.reserve !== 'unsure')); }).length;
  if (known < TUNING.plateauMinFeedback) return null;                            // unknown stays unknown
  return { sessions: W, spanDays, feedbackKnown: known };
}

/* ------------------------------------------------------ choosing the increase
   Returns the smallest available increment that respects the progression limit,
   or says why none does. Never invents a weight the user has not listed. */
function pickIncrease(base, settings) {
  const incs = settings.increments;
  const pct = settings.maxJumpPct;
  const cap = base ? (base * pct) / 100 : Infinity;
  const okList = incs.filter(i => i <= cap + 1e-9);
  if (okList.length) return { allowed: true, inc: okList[0], next: r2((base || 0) + okList[0]), pct, cap };
  return { allowed: false, smallest: incs[0], pct, cap, asPct: base ? (incs[0] / base) * 100 : null };
}

/* -------------------------------------------------------- per-set targets
   Targets come from what each set actually did last time at this load. They
   move at most one step per session and are clamped to the range, so the app
   never jumps straight to the maximum on every set.
     build   each set +1 step, up to the maximum      (the normal case)
     repeat  each set as last time                    (blocked by effort etc.)
     reset   the bottom of the range on every set     (after a load increase)
     mid     the middle of the range                  (easing back)             */
function buildSetTargets(prevReps, n, repMin, repMax, mode, step) {
  const st = step || 1;
  const prev = (prevReps || []).filter(r => r != null);
  const fallback = prev.length ? Math.min(...prev) : repMin;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = i < prev.length ? prev[i] : fallback;
    let t;
    if (mode === 'reset') t = repMin;
    else if (mode === 'mid') t = Math.round((repMin + repMax) / 2);
    else if (mode === 'repeat') t = p;
    else t = p + st;
    out.push(Math.max(repMin, Math.min(repMax, t)));
  }
  return out;
}

/* ============================================================================
   THE DECISION
   ctx = { state, ex, variantId, checkin, todayISO, history?, last? }
   ========================================================================== */
function decideCore(ctx) {
  const { state } = ctx;
  const settings = resolveSettings(state, ctx.ex);
  const ex = effectiveEx(ctx.ex, settings);          // sets and rep range come from the settings
  const isDouble = settings.method === 'double';
  const today = ctx.todayISO;
  const profile = Object.assign({}, state.profile || {}, { maxLoadJumpPct: settings.maxJumpPct });
  const trace = [];
  const push = (rule, detail) => trace.push({ rule, detail });

  const last = ctx.last !== undefined ? ctx.last : null;
  const fb = last && last.feedback ? last.feedback : null;
  const evd = (isDouble && last && last.entry) ? evaluateEntry(last.entry, settings, ex) : null;
  const sum = last ? (evd ? Object.assign({}, last.summary, {
      workingWeight: evd.baseline, repsAtWorkingWeight: evd.atLoadReps,
      setsAtWorkingWeight: evd.atLoadReps.length, targetSets: evd.need, targetReps: settings.repMax
    }) : last.summary) : null;
  const mod = MODALITY[ex.modality] || MODALITY.load_reps;
  const inc = settings.increments[0];
  const ready = readiness(ctx.checkin);
  const today0 = ctx.todayISO;

  /* ---------- 0. PAIN GATE. Separate pathway, evaluated first, never averaged.
        A low number does not authorise training through a concerning report. */
  syncPainConcerns(state);
  const sessionPain = ctx.checkin && ctx.checkin.pain && ctx.checkin.pain.present ? ctx.checkin.pain : null;
  const lastPain = fb && fb.pain && fb.pain.present ? fb.pain : null;
  const pain = lastPain || sessionPain;
  const standingConcern = openConcernFor(state, ctx.variantId);

  if (pain && painIsConcerning(pain)) {
    const why = concerningReasons(pain);
    push('pain.concerning', `Pain at ${pain.location || 'an unspecified site'}: ${why.join('; ')}`);
    if (ctx.todayISO) openPainConcern(state, pain, ctx.variantId, ctx.todayISO);
    return finish({
      action: 'review', paused: true, prescription: null,
      pain: { ...pain, pathway: 'separate', concerning: true },
      resumeOptions: [
        { id: 'substitute', label: 'Train something else today',
          detail: 'Pick an alternative that does not load the painful area.' },
        { id: 'skip', label: 'Skip this exercise',
          detail: 'Leave it out. Nothing is logged and nothing progresses.' },
        { id: 'clear', label: 'Mark the concern resolved',
          detail: 'Only once it is genuinely pain-free, or a clinician has cleared you.' }
      ],
      explain: {
        what: `${ex.name} is paused. No sets are prescribed.`,
        why: `You reported pain at the ${pain.location || 'affected area'} and ${why.join(', and ')}. ` +
             `That is handled on its own pathway — it is never mixed into effort or readiness, and a low rating does not override it.`,
        next: 'It stays paused until you mark the concern resolved or choose a substitute. ' +
              'This app does not diagnose injuries and does not prescribe rehabilitation — a qualified clinician should look at it.'
      },
      flags: ['pain', 'paused'], trace, ready, confidence: 'n/a'
    });
  }

  if (standingConcern) {
    push('pain.unresolved', `Open concern at ${standingConcern.location || 'unspecified'} since ${standingConcern.openedOn}`);
    return finish({
      action: 'review', paused: true, prescription: null,
      resumeOptions: [
        { id: 'substitute', label: 'Train something else', detail: 'Keep working around it.' },
        { id: 'skip', label: 'Skip this exercise', detail: 'Leave it out today.' },
        { id: 'clear', label: 'Mark the concern resolved', detail: 'Clears the pause and the normal rules resume.' }
      ],
      explain: {
        what: `${ex.name} is still paused from an earlier report.`,
        why: `You reported concerning pain on this movement on ${standingConcern.openedOn} and it has not been marked resolved. ` +
             `A quiet session since then is not the same as the concern being cleared, so it does not reopen on its own.`,
        next: 'Clear the concern when it is genuinely pain-free, or substitute. ' +
              'This app does not diagnose injuries and does not prescribe rehabilitation.'
      },
      flags: ['pain_unresolved', 'paused'], trace, ready, confidence: 'n/a'
    });
  }

  if (pain) {   // present but not concerning: back off, keep training, stay watchful
    push('pain.mild', `Mild pain reported${pain.location ? ' at ' + pain.location : ''}`);
    const base0 = baselineFrom(last, ex, inc);
    return finish({
      action: 'reduce',
      prescription: buildPrescription(ex, scaleLoad(base0, 0.8, inc), targetReps(ex, 'low'), ex.sets, mod),
      pain: { ...pain, pathway: 'separate', concerning: false },
      explain: {
        what: 'Load cut to about 80% and reps kept to the lower end.',
        why: `You reported pain${pain.location ? ' at the ' + pain.location : ''} without any of the signs that would pause it outright. ` +
             `Pain is handled on its own pathway and is never mixed into effort or readiness.`,
        next: 'If it is pain-free at this load, the normal rules resume next session. ' +
              'If it sharpens, spreads, or you notice numbness or swelling, it pauses for review. ' +
              'This app does not diagnose injuries and does not prescribe rehabilitation.'
      },
      flags: ['pain'], trace, ready, confidence: 'n/a'
    });
  }

  /* ---------- 1. FIRST TIME — calibrate, never guess a load. */
  if (!last || !sum || sum.workingWeight == null) {
    push('calibrate', 'No comparable performance on record for this variant');
    return finish({
      action: 'calibrate',
      prescription: buildPrescription(ex, null, targetReps(ex, 'range'), ex.sets, mod),
      explain: {
        what: 'Calibration session — you choose the load.',
        why: 'There is no logged performance for this exercise yet, so there is nothing to progress from. Nothing is suggested, because a guessed number logged as real would corrupt every later decision.',
        next: `Work to a load you could hold for ${ex.lo}–${ex.hi} ${mod.unit} with about two in reserve, and log what you actually did.`
      },
      flags: ['first_time'], trace, ready, confidence: 'none'
    });
  }

  const base = evd ? evd.baseline : baselineFrom(last, ex, inc);
  const gap = daysSince(last.date, today);
  push('history', `Last done ${gap} day(s) ago at ${fmtLoad(base, ex)}`);

  /* ---------- 1b. MANUAL: the app never moves the load. */
  if (settings.method === 'manual') return finish(manualDecision(ex, base, last, settings, gap, trace, ready, mod));

  /* ---------- 2. RETURN AFTER A BREAK — before any progression logic. */
  if (gap > (profile.returnBreakDays || TUNING.staleDays)) {
    const weeks = Math.floor(gap / 7);
    const pct = Math.min(TUNING.deconditionMaxPct, weeks * TUNING.deconditionPctPerWeek);
    const newLoad = scaleLoad(base, 1 - pct / 100, inc);
    push('return.break', `${gap} days away, trimming ${pct}%`);
    return finish({
      action: 'reduce',
      prescription: buildPrescription(ex, newLoad, targetReps(ex, 'mid'), ex.sets, mod),
      explain: {
        what: `Load eased back ${pct}% to ${fmtLoad(newLoad, ex)}.`,
        why: `It has been ${gap} days since you last did this. Picking up at the old load after a break is where people get hurt, so the first session back is deliberately conservative.`,
        next: 'Clear this comfortably and the normal rules take over next session — you should be back to where you were within two or three sessions.'
      },
      flags: ['returning'], trace, ready, confidence: 'medium'
    });
  }

  /* ---------- 3. READINESS — poor readiness caps the upside. */
  let readinessCap = false;
  if (ready.known && ready.score <= TUNING.readyLowMax) {
    readinessCap = true;
    push('readiness.low', `Readiness ${ready.score}/10`);
  } else if (ready.known) {
    push('readiness', `Readiness ${ready.score}/10`);
  } else {
    push('readiness.unknown', 'No check-in — readiness unknown, treated neutrally');
  }

  /* ---------- 3a. ACTIVE DELOAD — an accepted deload changes the prescription. */
  const dl = inDeload(state, today);
  if (dl) {
    const light = scaleLoad(base, dl.factor, inc);
    push('deload.active', `Deload ${dl.startDate} to ${dl.endDate}, factor ${dl.factor}`);
    return finish({
      action: 'deload',
      prescription: buildPrescription(ex, light, targetReps(ex, 'mid'), ex.sets, mod),
      explain: {
        what: `Easy week: ${fmtLoad(light, ex)}, about ${Math.round(dl.factor * 100)}% of your working load.`,
        why: `You accepted a deload running ${dl.startDate} to ${dl.endDate}. Every set this week is deliberately light — ` +
             `the point is to shed fatigue, so stopping well short on each set is the instruction, not a failure.`,
        next: `Normal progression resumes automatically after ${dl.endDate}. Nothing you do this week counts against you.`
      },
      flags: ['deload'], trace, ready, confidence: 'high'
    });
  }

  /* ---------- 3a'. RE-ENTRY AFTER A DELOAD. The light week is not the baseline.
        Go back to the load used before it, repeat that session's reps, and do
        not progress on the first session back. */
  if (last.entry && last.entry.decision && last.entry.decision.action === 'deload') {
    const prior = priorNonDeloadEntry(state, ctx.variantId, last.entry);
    const pe = prior ? evaluateEntry(prior.entry, settings, ex) : null;
    if (pe && pe.baseline != null) {
      push('deload.reentry', `Back to ${fmtLoad(pe.baseline, ex)}, the load before the deload`);
      return finish({
        action: 'hold',
        prescription: Object.assign(buildPrescription(ex, pe.baseline, targetReps(ex, 'range'), ex.sets, mod),
          { setTargets: buildSetTargets(pe.atLoadReps, settings.sets, settings.repMin, settings.repMax, 'repeat', settings.repStep) }),
        explain: {
          what: `Back to ${fmtLoad(pe.baseline, ex)}, the load you were using before the deload.`,
          why: 'The deload week was deliberately light, so it is not a starting point. The first session back repeats the reps from before it and does not add load.',
          next: 'Normal progression resumes after this session, from the load you were actually working at.'
        },
        flags: ['post_deload'], trace, ready, confidence: 'medium'
      });
    }
  }

  /* ---------- 3b. PLATEAU: from comparable performance and feedback across
        enough history. Adding reps at one load is progress, so a load that
        has simply stayed put is NOT a stall. */
  const plateau = detectPlateau(state, ctx.variantId, settings, ex, today);
  if (plateau) {
    push('plateau', `${plateau.sessions} comparable sessions over ${plateau.spanDays} days, no improvement in load or reps`);
    return finish(substituteDecision(ex, base, mod, trace, ready,
      `Across the last ${plateau.sessions} comparable sessions (${plateau.spanDays} days) neither the load nor the reps at that load have improved, and feedback was recorded on ${plateau.feedbackKnown} of them.`));
  }

  /* ---------- 4. DID THE LAST SESSION ACTUALLY MEET THE PRESCRIPTION? */
  const repTarget = isDouble ? settings.repMax : (sum.targetReps || ex.hi);
  const allRepsMet = isDouble ? (evd.setsOk && evd.repsOk)
    : (sum.repsAtWorkingWeight.length > 0 && sum.repsAtWorkingWeight.every(r => r >= repTarget));
  push('completion', `${sum.setsAtWorkingWeight}/${sum.targetSets} sets at ${fmtLoad(sum.workingWeight, ex)}; reps ${sum.repsAtWorkingWeight.join(', ') || '—'} vs target ${repTarget}`);
  if (sum.mixedLoads) push('mixed.loads', `Working load taken as the most common set (${fmtLoad(sum.workingWeight, ex)}), not the heaviest (${fmtLoad(sum.topWeight, ex)})`);

  /* ---------- 5. FEEDBACK — unknown stays unknown. */
  const effort = fb && fb.effort ? EFFORT_SCALE[fb.effort] : null;
  const reserve = fb && fb.reserve != null ? RESERVE_SCALE[String(fb.reserve)] : undefined;
  const tech = fb && fb.technique ? fb.technique : null;
  const cap = fb && fb.capacity ? fb.capacity : null;
  const feedbackKnown = !!(effort || reserve != null || tech);
  if (!feedbackKnown) push('feedback.missing', 'No effort, reserve or technique recorded — unknown, so progression stays locked');
  else push('feedback', `effort=${effort ? effort.label : 'unknown'}, reserve=${reserve == null ? 'unsure' : reserve}, technique=${tech || 'unknown'}, capacity=${cap || 'unknown'}`);

  /* ---------- 6. TECHNIQUE BREAKDOWN overrides a good-looking result. */
  if (tech === 'deteriorating') {
    push('technique.deteriorating', 'Form degraded — load held');
    const tStreak = techniqueStreak(state, ctx.variantId);
    if (tStreak >= TUNING.plateauHolds) {
      return finish(substituteDecision(ex, base, mod, trace, ready,
        `Technique has been breaking down at ${fmtLoad(base, ex)} across ${tStreak} sessions.`));
    }
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'mid'), ex.sets, mod),
      explain: {
        what: `Staying at ${fmtLoad(base, ex)} and dropping to the middle of the rep range.`,
        why: 'You logged technique as deteriorating. Adding load to a movement that is already breaking down buys a worse rep, not a stronger one.',
        next: `Earn ${ex.hi} clean ${mod.unit} with control at this load and the load moves up next time.`
      },
      flags: ['technique'], trace, ready, confidence: 'high'
    });
  }

  /* ---------- 7. MISSED THE REPS — hold or reduce. */
  if (!allRepsMet) {
    // A heavier extra set is not a short set at the working load: judge only the sets AT it.
    const badlyShort = (isDouble ? evd.exactReps : sum.repsAtWorkingWeight).some(r => r < (ex.lo - 1));
    if (isDouble && !badlyShort) {
      // Double progression: the load is not earned yet, so it holds and the reps build.
      const reps = evd.atLoadReps;
      const incomplete = !evd.setsOk;
      push('reps.building', incomplete
        ? `${reps.length}/${evd.need} sets at ${fmtLoad(base, ex)}`
        : `Reps ${reps.join(', ')} vs top ${settings.repMax}`);
      return finish({
        action: 'hold',
        prescription: buildPrescription(ex, base, targetReps(ex, 'range'), ex.sets, mod),
        explain: {
          what: `Staying at ${fmtLoad(base, ex)} and building reps.`,
          why: incomplete
            ? `Only ${reps.length} of ${evd.need} working sets were completed at ${fmtLoad(base, ex)} (lighter or unfinished sets do not count towards the load), so it has not been earned yet.`
            : `Not every set reached ${settings.repMax} ${mod.unit} yet (${reps.join(' / ')}). The load stays put and each set adds a rep, and that is progress at the same weight.`,
          next: `Reach ${settings.repMax} ${mod.unit} on all ${ex.sets} sets at ${fmtLoad(base, ex)} with the effort and technique you set, and the load moves up.`
        },
        flags: ['building_reps'], trace, ready, confidence: 'high'
      });
    }
    const action = badlyShort ? 'reduce' : 'hold';
    const newLoad = badlyShort ? scaleLoad(base, 0.92, inc) : base;
    push(badlyShort ? 'reps.well.short' : 'reps.short',
         `Lowest set ${Math.min(...sum.repsAtWorkingWeight)} vs target ${repTarget}`);
    return finish({
      action,
      prescription: buildPrescription(ex, newLoad, targetReps(ex, 'range'), ex.sets, mod),
      explain: {
        what: badlyShort
          ? `Load reduced to ${fmtLoad(newLoad, ex)}.`
          : `Staying at ${fmtLoad(base, ex)} to finish the rep range.`,
        why: badlyShort
          ? `Your sets fell below ${ex.lo} ${mod.unit}, which is under the working range for this exercise. The load is ahead of you.`
          : `You did not reach ${repTarget} ${mod.unit} on every working set, so the load has not been earned yet.`,
        next: `Hit ${repTarget} ${mod.unit} on all ${ex.sets} sets at ${fmtLoad(newLoad, ex)}, then it moves up.`
      },
      flags: badlyShort ? ['regression'] : [], trace, ready, confidence: 'high'
    });
  }

  /* ---------- 8. REPS MET. This is where "completed the reps" stops being enough. */
  push('reps.met', 'All working sets met the rep target');

  const maxedOut = effort && effort.v >= 5;
  const nearLimit = effort && effort.v === 4;
  const noReserve = reserve === 0;
  const lowReserve = reserve === 1;
  const neededLess = cap === 'needed_less';
  const reserveUnknown = reserve == null;

  // 8a0. "Needed less" means the load was too much. It is a back-off signal and
  //      must be evaluated BEFORE anything that could raise the load. It used to
  //      sit inside the reserve guard as an exemption, which let it progress.
  if (neededLess) {
    push('capacity.needed_less', 'User reported the session needed less work');
    const heavy = maxedOut || nearLimit || noReserve;
    const newLoad = heavy ? scaleLoad(base, 0.95, inc) : base;
    return finish({
      action: heavy ? 'reduce' : 'hold',
      prescription: buildPrescription(ex, newLoad, targetReps(ex, 'mid'), ex.sets, mod),
      explain: {
        what: heavy ? `Load eased back to ${fmtLoad(newLoad, ex)}.` : `Holding ${fmtLoad(base, ex)}.`,
        why: 'You finished the reps but said you needed less work than this. That is a signal the dose was too high, ' +
             'so it is treated as a reason to back off, never as permission to add load — whatever the reps said.',
        next: `Repeat ${fmtLoad(newLoad, ex)} and see how it lands. It moves up only when it comes back manageable with reps to spare.`
      },
      flags: ['needed_less'], trace, ready, confidence: 'high'
    });
  }

  // 8a. Maximum effort or nothing left in the tank: a successful grind is not a
  //     mandate to add load. Repeat it and earn it with room to spare.
  if (maxedOut || noReserve) {
    push('effort.maximal', 'Reps met but at maximum effort / zero reps in reserve');
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'high'), ex.sets, mod),
      explain: {
        what: `Holding ${fmtLoad(base, ex)}.`,
        why: 'You finished the reps, but at maximum effort with nothing left in reserve. Completing reps on its own does not earn more load — repeating this load with a rep or two to spare does.',
        next: `Same ${fmtLoad(base, ex)}. When it comes back as "challenging" with two clean ${mod.unit} left, the load goes up.`
      },
      flags: ['maximal_effort'], trace, ready, confidence: 'high'
    });
  }

  // 8a'. Effort above the limit set for this exercise (but short of maximum).
  if (effort && effort.v > settings.maxEffortV) {
    push('effort.above_limit', `${effort.label} is above the allowed ${EFFORT_SCALE[settings.maxEffort].label.toLowerCase()}`);
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'high'), ex.sets, mod),
      explain: {
        what: `Holding ${fmtLoad(base, ex)}.`,
        why: `You finished the reps, but effort came back ${effort.label.toLowerCase()}, above the ${EFFORT_SCALE[settings.maxEffort].label.toLowerCase()} you set as the most this exercise may cost before the load goes up.`,
        next: `Repeat ${fmtLoad(base, ex)} and aim for ${EFFORT_SCALE[settings.maxEffort].label.toLowerCase()} or easier.`
      },
      flags: ['effort_high'], trace, ready, confidence: 'high'
    });
  }

  // 8b. Missing feedback: hold. Unknown never unlocks progression.
  if (!feedbackKnown || reserveUnknown && !effort || (isDouble && settings.requireTechnique && (!tech || tech === 'unsure'))) {
    push('feedback.unknown.hold', 'Not enough feedback to justify a load increase');
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'high'), ex.sets, mod),
      explain: {
        what: `Holding ${fmtLoad(base, ex)}.`,
        why: 'You hit the reps, but there is no effort or technique feedback from last time. The app will not guess how hard it was, so it holds rather than risk a jump you had not earned.',
        next: `Log how the sets felt this session and the engine can move the load next time.`
      },
      flags: ['unknown_feedback'], trace, ready, confidence: 'low'
    });
  }

  // 8c. Low readiness: hold even on a clean result.
  if (readinessCap) {
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'mid'), ex.sets, mod),
      explain: {
        what: `Holding ${fmtLoad(base, ex)} today.`,
        why: `Your check-in came back low (readiness ${ready.score}/10 from energy, sleep and soreness). A load increase on a bad day usually turns into a missed session.`,
        next: 'This is a one-session hold. Next session the normal rules apply again.'
      },
      flags: ['low_readiness'], trace, ready, confidence: 'medium'
    });
  }

  // 8d. Recent workload ceiling for this muscle.
  const wl = recentWorkload(state, ex, today, 7);
  if (wl.setsForMuscle > TUNING.heavyWeekSets) {
    push('workload.high', `${wl.setsForMuscle} sets for ${wl.muscle} in the last 7 days`);
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'mid'), ex.sets, mod),
      explain: {
        what: `Holding ${fmtLoad(base, ex)} and keeping volume where it is.`,
        why: `You have already done ${wl.setsForMuscle} working sets for ${wl.muscle} in the last seven days, which is at the top of what is usually productive. Adding load on top of that volume is how a good week turns into a stalled one.`,
        next: 'Load moves again once the weekly volume for this muscle comes back down.'
      },
      flags: ['high_workload'], trace, ready, confidence: 'medium'
    });
  }

  // 8e. Not enough in reserve.
  if (reserve != null && reserve < settings.minReserve) {
    push('reserve.low', `Only ${reserve} rep(s) in reserve, need ${settings.minReserve}`);
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'high'), ex.sets, mod),
      explain: {
        what: `Holding ${fmtLoad(base, ex)}.`,
        why: `You had ${reserve} clean rep${reserve === 1 ? '' : 's'} left. This exercise needs at least ${settings.minReserve} before it adds load, so the increase lands on a session you can actually complete.`,
        next: `Repeat ${fmtLoad(base, ex)}. ${settings.minReserve} or more in reserve and it moves up.`
      },
      flags: [], trace, ready, confidence: 'high'
    });
  }

  // 8f. Several qualifying sessions may be required before the load moves.
  if (isDouble && settings.qualifyingSessions > 1) {
    const streak = qualifyingStreak(state, ctx.variantId, settings, ex, base);
    if (streak < settings.qualifyingSessions) {
      push('qualifying.wait', `${streak} of ${settings.qualifyingSessions} qualifying sessions at ${fmtLoad(base, ex)}`);
      return finish({
        action: 'hold',
        prescription: buildPrescription(ex, base, targetReps(ex, 'high'), ex.sets, mod),
        explain: {
          what: `Holding ${fmtLoad(base, ex)}: qualifying session ${streak} of ${settings.qualifyingSessions}.`,
          why: `That session met the standard (all ${ex.sets} sets at ${settings.repMax} ${mod.unit} with the effort and technique you set). This exercise needs ${settings.qualifyingSessions} in a row before the load goes up, so one good session is recorded, not rewarded yet.`,
          next: `Repeat ${fmtLoad(base, ex)} to the same standard. ${settings.qualifyingSessions - streak} more qualifying session${settings.qualifyingSessions - streak === 1 ? '' : 's'} and it moves up.`
        },
        flags: ['qualifying_wait'], trace, ready, confidence: 'high'
      });
    }
  }

  /* ---------- 9. PROGRESS. Earned, and only one dimension at a time. */
  return finish(progressDecision(ex, base, inc, mod, profile, trace, ready,
                                 { effort, reserve, cap, sum, settings, evd }));
}

/* ------------------------------------------------------------- outcomes */
function progressDecision(ex, base, inc, mod, profile, trace, ready, ev) {
  if (ev.settings && ev.settings.method === 'double') return doubleProgress(ex, base, mod, trace, ready, ev);
  const reserveTxt = ev.reserve == null ? '' : ` with ${ev.reserve} clean rep${ev.reserve === 1 ? '' : 's'} in reserve`;
  const effortTxt = ev.effort ? ev.effort.label.toLowerCase() : 'manageable';

  const m = ev.settings ? ev.settings.method : null;
  const kind = m === 'reps' ? 'reps' : m === 'duration' ? 'time' : m === 'distance' ? (ex.lo < ex.hi ? 'time' : 'load') : mod.progresses;
  const stepUnit = ev.settings ? ev.settings.repStep : 5;
  const addLoadAtCap = !ev.settings || ev.settings.addLoadAtCap !== false;
  if (kind === 'reps') {
    // Bodyweight: add a rep until the cap, then suggest adding load.
    const atCap = (ev.sum.repsAtWorkingWeight[0] || 0) >= ex.hi;
    if (!atCap) {
      const next = Math.min(ex.hi, (ev.sum.minReps || ex.lo) + 1);
      trace.push({ rule: 'progress.reps', detail: `+1 rep to ${next}` });
      return { action: 'progress', prescription: buildPrescription(ex, base, { lo: next, hi: next }, ex.sets, mod),
        explain: {
          what: `Target up to ${next} reps per set.`,
          why: `Last time came back ${effortTxt}${reserveTxt} with technique controlled. On a bodyweight movement the rep count is the thing that goes up — load stays where it is so only one variable moves.`,
          next: `Clear ${next} on every set and it climbs again, up to ${ex.hi}. After that the progression switches to added load.`
        }, flags: ['progress_reps'], trace, ready, confidence: 'high' };
    }
    if (!addLoadAtCap) {
      trace.push({ rule: 'progress.reps.cap.hold', detail: `rep cap ${ex.hi} reached, reps-only method` });
      return { action: 'hold', prescription: buildPrescription(ex, base, { lo: ex.hi, hi: ex.hi }, ex.sets, mod),
        explain: {
          what: `Holding at the top of the range (${ex.hi} reps).`,
          why: `You are at ${ex.hi} reps on every set and this exercise is set to reps only, so the app does not add load for you.`,
          next: `Raise the rep range, add load yourself, or switch the method to double progression in this exercise's settings.`
        }, flags: ['reps_cap'], trace, ready, confidence: 'high' };
    }
    const added = roundToIncrement(inc, inc);
    trace.push({ rule: 'progress.reps.cap', detail: `rep cap ${ex.hi} reached, add ${added}` });
    return { action: 'progress', prescription: buildPrescription(ex, added, { lo: ex.lo, hi: ex.lo }, ex.sets, mod),
      explain: {
        what: `Add ${added} kg and drop back to ${ex.lo} reps.`,
        why: `You are at the top of the rep range (${ex.hi}) and it still came back ${effortTxt}${reserveTxt}. Adding a small load and resetting the reps keeps the movement progressing instead of drifting into endurance work.`,
        next: `Build back up to ${ex.hi} reps at the new load.`
      }, flags: ['progress_load'], trace, ready, confidence: 'high' };
  }

  if (kind === 'assist') {
    const next = Math.max(0, base - inc);
    trace.push({ rule: 'progress.assist', detail: `assistance ${base} -> ${next}` });
    return { action: 'progress', prescription: buildPrescription(ex, next, targetReps(ex, 'range'), ex.sets, mod),
      explain: {
        what: `Assistance down from ${base} kg to ${next} kg.`,
        why: `On an assisted movement, less help is the progression. Last session was ${effortTxt}${reserveTxt} with controlled technique, so you can carry more of your own bodyweight.`,
        next: next === 0 ? 'That is the full unassisted movement, so the next step is the unassisted variant.'
                         : `Hit ${ex.lo}–${ex.hi} reps at ${next} kg of assistance and it drops again.`
      }, flags: ['progress_assist'], trace, ready, confidence: 'high' };
  }

  if (kind === 'time') {
    const cur = ev.sum.repsAtWorkingWeight[0] || ex.lo;
    if (cur < ex.hi) {
      const next = Math.min(ex.hi, cur + stepUnit);
      trace.push({ rule: 'progress.time', detail: `${cur}s -> ${next}s` });
      return { action: 'progress', prescription: buildPrescription(ex, base, { lo: next, hi: next }, ex.sets, mod),
        explain: {
          what: `Hold time up to ${next} seconds.`,
          why: `Last hold was ${effortTxt}${reserveTxt}. Time goes up first on a hold; load stays put so only one thing changes.`,
          next: `At ${ex.hi} seconds the progression switches to added load and the time resets to ${ex.lo}.`
        }, flags: ['progress_time'], trace, ready, confidence: 'high' };
    }
    if (!addLoadAtCap) {
      return { action: 'hold', prescription: buildPrescription(ex, base, { lo: ex.hi, hi: ex.hi }, ex.sets, mod),
        explain: { what: `Holding at the top of the range (${ex.hi}).`,
          why: `You are at ${ex.hi} on every set and this exercise does not add load automatically.`,
          next: 'Raise the range, add load yourself, or change the method in this exercise\'s settings.' },
        flags: ['reps_cap'], trace, ready, confidence: 'high' };
    }
    const nl = roundToIncrement((base || 0) + inc, inc);
    trace.push({ rule: 'progress.time.cap', detail: `time cap, load -> ${nl}` });
    return { action: 'progress', prescription: buildPrescription(ex, nl, { lo: ex.lo, hi: ex.lo }, ex.sets, mod),
      explain: {
        what: `Add load to ${nl} kg and reset the hold to ${ex.lo} seconds.`,
        why: `You are holding the full ${ex.hi} seconds and it still came back ${effortTxt}. Past about ${ex.hi} seconds a hold trains endurance rather than strength, so load takes over.`,
        next: `Build the time back to ${ex.hi} seconds at ${nl} kg.`
      }, flags: ['progress_load'], trace, ready, confidence: 'high' };
  }

  // Default: load-based (including carries, where distance is fixed).
  const smallest = ev.settings ? ev.settings.increments[0] : incrementFor(ex, profile);
  const rawInc = capJump(base, smallest, profile);
  if (rawInc === 0) {
    // The smallest weight this gym can add is a bigger jump than the cap allows.
    // Chase reps to the top of the range instead of overshooting silently.
    const pct = (profile && profile.maxLoadJumpPct) || TUNING.maxJumpPctDefault;
    const asPct = base ? ((smallest / base) * 100).toFixed(0) : '?';
    const atTop = (ev.sum.repsAtWorkingWeight[0] || 0) >= ex.hi;
    const noAltDimension = ex.lo === ex.hi && !(ev.settings && ev.settings.strictLimit);   // carries: distance is fixed, nothing else to move
    if (noAltDimension) {
      // Blocking here would stall the exercise permanently, so the increment is
      // allowed and the overshoot is stated rather than hidden.
      const forced = roundToIncrement(base + smallest, smallest);
      trace.push({ rule: 'progress.load.over_cap', detail: `${asPct}% jump allowed: no other dimension to progress` });
      return {
        action: 'progress',
        prescription: buildPrescription(ex, forced, targetReps(ex, 'fixed'), ex.sets, mod),
        explain: {
          what: `Load up ${smallest} kg to ${forced} kg.`,
          why: `You earned the increase. This is a ${asPct}% jump, slightly over your ${pct}% cap, ` +
               `but the distance on a carry is fixed and ${smallest} kg is the smallest load you have — ` +
               `holding would stall it indefinitely, so the jump is taken and flagged rather than hidden.`,
          next: `Carry ${forced} kg for the full ${ex.hi} m walking tall. Distance stays fixed; load is the only thing that moves. If it is a step too far, log what you actually managed and it will come back down.`
        },
        flags: ['progress_load', 'increment_over_cap'], trace, ready, confidence: 'medium'
      };
    }
    trace.push({ rule: 'progress.load.blocked', detail: `smallest increment ${smallest}kg = ${asPct}% of ${base}kg, cap ${pct}%` });
    return {
      action: 'hold',
      prescription: buildPrescription(ex, base,
        atTop ? targetReps(ex, 'high') : { lo: Math.min(ex.hi, (ev.sum.minReps || ex.lo) + 1), hi: ex.hi },
        ex.sets, mod),
      explain: {
        what: atTop
          ? `Staying at ${fmtLoad(base, ex)} — the load cannot move yet.`
          : `Staying at ${fmtLoad(base, ex)} and chasing reps to ${ex.hi}.`,
        why: `You earned an increase, but the smallest increment you have for this exercise is ${smallest} kg, ` +
             `which is ${asPct}% of ${base} kg — over your ${pct}% cap. Rather than quietly making a jump that big, ` +
             `the load holds and the reps do the work.`,
        next: atTop
          ? `To move the load you need a smaller increment — micro-plates, or a different implement. You can also raise the cap in Profile if ${asPct}% is a jump you are happy with.`
          : `Build to ${ex.hi} reps on every set at ${fmtLoad(base, ex)}. That is real progress at the same load.`
      },
      flags: ['increment_blocked'], trace, ready, confidence: 'high'
    };
  }
  const next = roundToIncrement(base + rawInc, smallest);
  const delta = Math.round((next - base) * 100) / 100;
  trace.push({ rule: 'progress.load', detail: `${base} -> ${next} (+${delta})` });
  const isCarry = ex.modality === 'carry';
  return {
    action: 'progress',
    prescription: buildPrescription(ex, next, targetReps(ex, isCarry ? 'fixed' : 'range'), ex.sets, mod),
    explain: {
      what: `Load up ${delta} kg to ${next} kg.`,
      why: `You completed every working set at ${base} kg, and it came back ${effortTxt}${reserveTxt} with technique controlled. That combination — not the reps on their own — is what earns the increase.`,
      next: isCarry
        ? `Hold ${next} kg for the full ${ex.hi} m walking tall. Distance stays fixed; load is the only thing that moves.`
        : `Hit ${ex.lo}–${ex.hi} reps on all ${ex.sets} sets at ${next} kg. Volume stays the same this session — load and sets never go up together.`
    },
    flags: ['progress_load'], trace, ready, confidence: 'high'
  };
}

function substituteDecision(ex, base, mod, trace, ready, because) {
  const alts = (ex.alternatives || []).slice(0, 3);
  trace.push({ rule: 'substitute', detail: `offering ${alts.length} alternative(s)` });
  return {
    action: 'substitute',
    prescription: buildPrescription(ex, scaleLoad(base, 0.9, 2.5), targetReps(ex, 'range'), ex.sets, mod),
    alternatives: alts,
    explain: {
      what: alts.length ? `Suggesting a swap to ${alts[0]}, or a 10% back-off at ${ex.name}.`
                        : `Suggesting a 10% back-off and a rebuild.`,
      why: `${because} A stall this long is usually the movement, the fatigue or the setup rather than effort — and grinding the same load a fourth time rarely breaks it.`,
      next: 'Swapping keeps the muscle working while the pattern gets a break. Your history for this exercise is kept separately, so you can come back to it and compare like with like.'
    },
    flags: ['plateau'], trace, ready, confidence: 'medium'
  };
}


/* ============================================================================
   DOUBLE PROGRESSION: the earned step
   ========================================================================== */
function doubleProgress(ex, base, mod, trace, ready, ev) {
  const s = ev.settings;
  const sets = s.sets;
  const reserveTxt = ev.reserve == null ? '' : ` with ${ev.reserve} clean rep${ev.reserve === 1 ? '' : 's'} in reserve`;
  const effortTxt = ev.effort ? ev.effort.label.toLowerCase() : 'manageable';
  const did = `all ${sets} working sets at ${s.repMax} ${mod.unit}`;

  if (ex.modality === 'assisted') {
    const dec = s.increments[0];
    const next = Math.max(0, r2(base - dec));
    trace.push({ rule: 'progress.assist', detail: `assistance ${base} -> ${next}` });
    return { action: 'progress', prescription: buildPrescription(ex, next, targetReps(ex, 'low'), ex.sets, mod),
      explain: {
        what: `Assistance down from ${base} kg to ${next} kg; reps reset to ${s.repMin}.`,
        why: `You completed ${did} with ${base} kg of assistance. It came back ${effortTxt}${reserveTxt}, and technique stayed controlled. On an assisted movement, less help is the progression.`,
        next: next === 0 ? 'That is the full unassisted movement — the next step is the unassisted variant.'
                         : `Build back up to ${s.repMax} reps at ${next} kg of assistance, then it drops again.`
      }, flags: ['progress_assist'], trace, ready, confidence: 'high' };
  }

  const step = pickIncrease(base, s);
  if (!step.allowed) {
    const asPct = step.asPct == null ? '?' : step.asPct.toFixed(0);
    trace.push({ rule: 'progress.load.blocked', detail: `smallest increment ${step.smallest}kg = ${asPct}% of ${base}kg, limit ${step.pct}%` });
    return { action: 'hold', prescription: buildPrescription(ex, base, targetReps(ex, 'high'), ex.sets, mod),
      explain: {
        what: `Staying at ${fmtLoad(base, ex)}: the load cannot move yet.`,
        why: `You completed ${did}, which earns an increase, but the smallest increment you have for this exercise is ${step.smallest} kg, ` +
             `which is ${asPct}% of ${base} kg and over your ${step.pct}% progression limit. Rather than quietly making a jump that big, the load holds.`,
        next: `To move the load you need a smaller increment (micro-plates, a lighter implement) or a higher limit. Change either in this exercise's progression settings. ` +
              `Until then repeat ${fmtLoad(base, ex)} to the same standard.`
      }, flags: ['increment_blocked'], trace, ready, confidence: 'high' };
  }
  const delta = r2(step.next - base);
  trace.push({ rule: 'progress.load', detail: `${base} -> ${step.next} (+${delta})` });
  return { action: 'progress', prescription: buildPrescription(ex, step.next, targetReps(ex, 'low'), ex.sets, mod),
    explain: {
      what: `Load up ${delta} kg to ${step.next} kg; reps reset to ${s.repMin}.`,
      why: `You completed ${did} at ${base} kg. It came back ${effortTxt}${reserveTxt}, and technique stayed controlled. That combination, not the reps on their own, is what earns the increase.`,
      next: `Build from ${s.repMin} back towards ${s.repMax} on every set at ${step.next} kg. Sets stay at ${sets}: load and sets never go up together.`
    }, flags: ['progress_load'], trace, ready, confidence: 'high' };
}

/* Manual: the app reports, the user decides. Nothing here changes the load. */
function manualDecision(ex, base, last, settings, gap, trace, ready, mod) {
  const reps = last && last.entry ? evaluateEntry(last.entry, settings, ex).atLoadReps : [];
  const note = gap != null && gap > TUNING.staleDays
    ? ` It has been ${gap} days since you last did this, so consider easing back yourself.` : '';
  trace.push({ rule: 'manual', detail: 'progression method is manual' });
  return {
    action: 'hold',
    prescription: Object.assign(buildPrescription(ex, base, targetReps(ex, 'range'), ex.sets, mod),
      { setTargets: reps.length ? buildSetTargets(reps, settings.sets, settings.repMin, settings.repMax, 'repeat', 1)
                                : Array(settings.sets).fill(settings.repMin) }),
    explain: {
      what: `Manual progression: ${fmtLoad(base, ex)}, ${settings.sets} × ${settings.repMin}–${settings.repMax}.`,
      why: 'You set this exercise to manual, so the app does not raise, lower or reset the load for you. It repeats what you did last time.' + note,
      next: 'Change the load or reps yourself when you are ready. Your change is recorded as yours, separate from anything the app would have suggested.'
    },
    flags: ['manual'], trace, ready, confidence: 'n/a'
  };
}

/* ============================================================================
   ATTACHING TARGETS AND THE PROGRESSION SUMMARY TO A DECISION
   ========================================================================== */
function deriveSetTargets(d, settings, ex, evd) {
  const p = d.prescription;
  if (!p) return null;
  const n = p.sets, lo = settings.repMin, hi = settings.repMax, st = settings.repStep;
  const f = d.flags || [];
  if (settings.method !== 'double') return Array(n).fill(Math.max(1, p.repsHigh));
  if (d.action === 'calibrate') return Array(n).fill(Math.round((lo + hi) / 2));
  if (d.action === 'progress') return Array(n).fill(lo);                       // reset after an increase
  if (d.action === 'reduce') return Array(n).fill(f.includes('regression') ? lo : Math.max(lo, Math.min(hi, p.repsHigh)));
  if (d.action === 'deload' || d.action === 'substitute') return Array(n).fill(Math.max(lo, Math.min(hi, p.repsHigh)));
  const prev = evd ? evd.atLoadReps : [];
  return buildSetTargets(prev, n, lo, hi, f.includes('building_reps') ? 'build' : 'repeat', st);
}
function backoffFor(prescription, settings, ex, profile) {
  if (!settings.backoff || !prescription || prescription.load == null || !prescription.load) return null;
  const inc = settings.increments[0];
  const load = Math.max(0, roundToIncrement(prescription.load * settings.backoff.pct / 100, inc));
  return { sets: settings.backoff.sets, pct: settings.backoff.pct, load, reps: settings.repMax };
}

function decide(ctx) {
  const d = decideCore(ctx);
  return attachProgression(ctx, d);
}
function attachProgression(ctx, d) {
  const settings = resolveSettings(ctx.state, ctx.ex);
  const ex = effectiveEx(ctx.ex, settings);
  const last = ctx.last || null;
  const evd = last && last.entry ? evaluateEntry(last.entry, settings, ex) : null;
  const p = d.prescription;
  if (p) {
    if (!p.setTargets) p.setTargets = deriveSetTargets(d, settings, ex, evd);
    const bo = backoffFor(p, settings, ex, ctx.state.profile);
    if (bo) p.backoff = bo;
  }
  d.progression = buildProgressionInfo(ctx, d, settings, ex, evd);
  return d;
}

function _fmtReps(list) { return list.join(' / '); }
function _loadShort(w, ex) {
  if (ex.modality === 'assisted') return `${w} kg assist`;
  if (ex.modality === 'bodyweight_reps' && !w) return 'BW';
  return `${w} kg`;
}
function buildProgressionInfo(ctx, d, settings, ex, evd) {
  const p = d.prescription;
  const f = d.flags || [];
  const meth = PROGRESSION_METHODS[settings.method];
  const unit = (MODALITY[ex.modality] || MODALITY.load_reps).unit;
  const unitTxt = unit === 'reps' ? '' : ' ' + unit;
  const range = settings.repMin === settings.repMax ? `${settings.repMin}` : `${settings.repMin}–${settings.repMax}`;
  const info = {
    method: settings.method, methodLabel: meth.label, unit,
    sets: settings.sets, repMin: settings.repMin, repMax: settings.repMax,
    qualifying: { have: 0, need: settings.qualifyingSessions },
    status: 'held', requirements: [], nextIncrease: null,
    lastReps: null, lastLoad: null, lastSets: null,
    load: p ? p.load : null, setTargets: p ? p.setTargets : null,
    header: null, lastText: null, todayText: null, nextText: null,
    heldBy: null
  };

  /* status */
  if (d.paused) info.status = 'paused';
  else if (d.action === 'calibrate') info.status = 'calibrating';
  else if (f.includes('manual')) info.status = 'manual';
  else if (d.action === 'deload') info.status = 'deload';
  else if (d.action === 'substitute') info.status = 'plateau';
  else if (d.action === 'reduce') info.status = 'reduced';
  else if (f.includes('progress_load') || f.includes('progress_assist')) info.status = 'earned';
  else if (f.includes('progress_reps') || f.includes('progress_time')) info.status = 'building';
  else if (f.includes('increment_blocked')) info.status = 'blocked';
  else if (f.includes('building_reps')) info.status = 'building';
  else info.status = 'held';
  const hb = ['needed_less','maximal_effort','unknown_feedback','low_readiness','high_workload','technique','qualifying_wait','post_deload','pain']
    .find(x => f.includes(x));
  info.heldBy = hb || null;

  if (!p) {                                         // paused: nothing is prescribed
    info.header = `${ex.short || ex.name} paused`;
    info.nextText = d.explain ? d.explain.next : '';
    return info;
  }

  const loadTxt = p.load != null ? fmtLoad(p.load, ex) : null;
  info.header = loadTxt ? `${loadTxt} · ${settings.sets} × ${range}${unitTxt}` : `Choose your load · ${settings.sets} × ${range}${unitTxt}`;

  /* last time */
  if (evd && evd.performed) {
    info.lastReps = evd.allReps.slice();
    info.lastLoad = evd.baseline;
    const doneSets = _doneTop(ctx.last.entry);
    info.lastSets = doneSets.map(s => ({ w: s.actualWeight, r: s.actualReps }));
    const sameLoad = new Set(info.lastSets.map(x => x.w)).size === 1;
    info.lastText = sameLoad
      ? `Last time: ${_fmtReps(info.lastSets.map(x => x.r))}${p.load !== info.lastSets[0].w && p.load != null ? ' at ' + fmtLoad(info.lastSets[0].w, ex) : ''}`
      : `Last time: ${info.lastSets.map(x => `${x.r} × ${_loadShort(x.w, ex)}`).join(' / ')}`;
  } else info.lastText = 'Last time: no comparable session yet';
  if (p.setTargets) info.todayText = `Today: ${_fmtReps(p.setTargets)}`;

  /* progress towards the next increase (double progression) */
  const nextLoadBase = p.load;
  if (settings.method === 'double') {
    const streak = (evd && evd.baseline != null && ctx.state)
      ? qualifyingStreak(ctx.state, ctx.variantId || ctx.ex.id, settings, ex, evd.baseline) : 0;
    info.qualifying.have = streak;
    info.setsAtTop = evd ? { have: Math.min(evd.topCount, settings.sets), need: settings.sets } : { have: 0, need: settings.sets };
    const Ltxt = loadTxt || 'the working load';
    const justEarned = info.status === 'earned';
    const mk = (id, text, met) => ({ id, text, met });
    const fresh = justEarned;      // a new load starts a fresh cycle
    const known = evd && evd.sufficient;
    const effLabel = EFFORT_SCALE[settings.maxEffort].label.toLowerCase();
    info.requirements = [
      mk('sets', `Complete all ${settings.sets} working sets at ${Ltxt}`, fresh ? false : (evd ? evd.setsOk : false)),
      mk('reps', `Reach ${settings.repMax} ${unit === 'reps' ? 'reps' : unit} on every one of them`, fresh ? false : (evd ? evd.repsOk : false)),
      mk('effort', `Effort no higher than ${effLabel}, with at least ${settings.minReserve} clean rep${settings.minReserve === 1 ? '' : 's'} in reserve`,
         fresh || !evd ? null : (known ? !(evd.blocks.includes('maximal') || evd.blocks.includes('effort') || evd.blocks.includes('reserve')) : null)),
      mk('technique', 'Technique stays controlled',
         fresh || !evd ? null : (evd.tech === 'deteriorating' ? false : (evd.tech === 'controlled' ? true : null))),
      mk('capacity', 'You did not need less than the prescribed work',
         fresh || !evd ? null : (evd.cap === 'needed_less' ? false : (evd.cap ? true : null))),
      mk('pain', 'No pain reported and no open pain concern',
         fresh || !evd ? null : (evd.pain || openConcernFor(ctx.state, ctx.variantId || ctx.ex.id) ? false : true))
    ];
    if (settings.qualifyingSessions > 1) {
      info.requirements.push(mk('sessions',
        `${settings.qualifyingSessions} qualifying sessions in a row (${fresh ? 0 : streak} so far)`, fresh ? false : streak >= settings.qualifyingSessions));
    }
    /* proposed next load */
    let ni;
    if (ex.modality === 'assisted') {
      const inc = settings.increments[0];
      const to = Math.max(0, r2((nextLoadBase || 0) - inc));
      ni = { allowed: nextLoadBase != null && nextLoadBase > 0, to, delta: r2(to - (nextLoadBase || 0)), repsAfter: settings.repMin, assisted: true };
    } else if (nextLoadBase != null) {
      const pk = pickIncrease(nextLoadBase, settings);
      ni = pk.allowed ? { allowed: true, to: pk.next, delta: pk.inc, repsAfter: settings.repMin }
                      : { allowed: false, to: null, delta: null, repsAfter: settings.repMin,
                          blockedBecause: `the smallest increment (${pk.smallest} kg) is over your ${pk.pct}% progression limit` };
    } else ni = null;
    info.nextIncrease = ni;

    const need = [
      `complete all ${settings.sets} sets at ${settings.repMax}${unit === 'reps' ? ' reps' : unitTxt} with controlled technique, ` +
      `at least ${settings.minReserve} clean rep${settings.minReserve === 1 ? '' : 's'} in reserve and effort no higher than ${effLabel}`
    ];
    if (justEarned) {
      info.nextText = `Reps reset to ${settings.repMin} on all ${settings.sets} sets. ` +
        `The next increase after that needs all ${settings.sets} sets at ${settings.repMax}${unit === 'reps' ? ' reps' : unitTxt} again.`;
    } else if (info.status === 'blocked') {
      info.nextText = `Weight increase earned but not possible: ${ni && ni.blockedBecause ? ni.blockedBecause : 'no available increment fits the limit'}. The load holds.`;
    } else if (info.status === 'building' || info.status === 'held' || info.status === 'reduced' || info.status === 'calibrating') {
      const after = ni && ni.allowed ? ` Then ${fmtLoad(ni.to, ex)} × ${range}, reps reset to ${settings.repMin}.`
                  : ni && !ni.allowed && !ni.assisted ? ` The increase would not be possible yet: ${ni.blockedBecause}.` : '';
      info.nextText = `Next weight increase: ${need[0]}.` +
        (settings.qualifyingSessions > 1 ? ` Needed on ${settings.qualifyingSessions} sessions in a row (${streak} so far).` : '') + after;
    } else if (d.explain) info.nextText = d.explain.next;
  } else if (settings.method === 'manual') {
    info.nextText = 'Manual progression: the app does not change this load. You set it.';
  } else {
    info.nextText = d.explain ? d.explain.next : '';
  }
  return info;
}

/* ============================================================================
   ACCEPT / HOLD / EDIT: manual choices are recorded SEPARATELY from the
   automatic recommendation. entry.decision is never rewritten; the choice and
   what was actually applied live in entry.progressionChoice. Only sets that
   have not been performed are touched.
   ========================================================================== */
function holdAlternative(decision) {
  const info = decision && decision.progression;
  const p = decision && decision.prescription;
  if (!p || !info || info.lastLoad == null) return null;
  const reps = info.lastReps && info.lastReps.length ? info.lastReps : (p.setTargets || []);
  const n = p.sets;
  const targets = [];
  for (let i = 0; i < n; i++) {
    const r = i < reps.length ? reps[i] : (reps.length ? Math.min(...reps) : info.repMin);
    targets.push(Math.max(info.repMin, Math.min(info.repMax, r)));
  }
  return { action: 'hold', load: info.lastLoad, setTargets: targets, sets: n };
}
/* One dimension at a time: a manual edit may not raise the load AND add sets. */
function checkManualEdit(decision, edit, settings) {
  const problems = [], warnings = [];
  const info = decision && decision.progression;
  const e = edit || {};
  if (e.load == null || !Number.isFinite(Number(e.load)) || Number(e.load) < 0) problems.push('Enter a load of 0 or more.');
  const t = Array.isArray(e.setTargets) ? e.setTargets.map(Number) : [];
  if (!t.length || t.length > 10 || t.some(r => !Number.isFinite(r) || r < 1 || r > 600)) problems.push('Enter a rep target for each set, from 1 to 10 sets.');
  if (problems.length) return { ok: false, problems, warnings };
  const load = Number(e.load);
  const lastLoad = info && info.lastLoad != null ? info.lastLoad : null;
  const prescribedSets = settings ? settings.sets : (decision.prescription && decision.prescription.sets);
  const raised = lastLoad != null && load > lastLoad + 1e-9;
  if (raised && t.length > prescribedSets) problems.push('Do not raise the load and add sets in the same step. Change one, then the other next time.');
  if (settings && lastLoad && raised) {
    const pct = ((load - lastLoad) / lastLoad) * 100;
    if (pct > settings.maxJumpPct + 1e-9) warnings.push(`That is a ${pct.toFixed(1)}% jump, over your ${settings.maxJumpPct}% progression limit. It will be recorded as a manual change.`);
  }
  if (settings && t.some(r => r > settings.repMax)) warnings.push(`A target is above the top of your range (${settings.repMax}).`);
  return { ok: problems.length === 0, problems, warnings };
}
function _blankSet(w, r, role) {
  return { plannedWeight: w, plannedReps: r, actualWeight: null, actualReps: null,
           status: 'pending', warmup: false, role: role || 'working', ts: null };
}
function applyProgressionChoice(entry, choice, edit, settings, nowMs) {
  const d = entry && entry.decision;
  if (!d || !d.prescription) return { ok: false, problems: ['There is no prescription to change.'] };
  const rec = { action: d.action, load: d.prescription.load,
                setTargets: (d.prescription.setTargets || []).slice(), sets: d.prescription.sets };
  let applied, warnings = [];
  if (choice === 'accept') applied = rec;
  else if (choice === 'hold') {
    applied = holdAlternative(d);
    if (!applied) return { ok: false, problems: ['There is no earlier load to hold at.'] };
  } else if (choice === 'edit') {
    const chk = checkManualEdit(d, edit, settings);
    if (!chk.ok) return { ok: false, problems: chk.problems };
    warnings = chk.warnings;
    applied = { load: Number(edit.load), setTargets: edit.setTargets.map(Number), sets: edit.setTargets.length };
  } else return { ok: false, problems: ['Unknown choice.'] };

  /* touch pending top sets only; performed sets and back-off sets are left alone */
  const top = (entry.sets || []).filter(s => !s.warmup && s.role !== 'backoff');
  let ti = 0;
  top.forEach(s => {
    if (s.status === 'pending' && ti < applied.sets) {
      s.plannedWeight = applied.load;
      s.plannedReps = applied.setTargets[ti];
    }
    ti++;
  });
  for (let i = top.length; i < applied.sets; i++) {            // more sets requested
    const ns = _blankSet(applied.load, applied.setTargets[i]);
    const firstBackoff = (entry.sets || []).findIndex(s => s.role === 'backoff');
    if (firstBackoff >= 0) entry.sets.splice(firstBackoff, 0, ns); else entry.sets.push(ns);
  }
  if (top.length > applied.sets) {                              // fewer: drop only unperformed ones
    let drop = top.length - applied.sets;
    for (let i = entry.sets.length - 1; i >= 0 && drop > 0; i--) {
      const s = entry.sets[i];
      if (!s.warmup && s.role !== 'backoff' && s.status === 'pending') { entry.sets.splice(i, 1); drop--; }
    }
  }
  if (settings && settings.backoff) {
    const inc = settings.increments[0];
    const bl = Math.max(0, roundToIncrement(applied.load * settings.backoff.pct / 100, inc));
    (entry.sets || []).forEach(s => { if (s.role === 'backoff' && s.status === 'pending') s.plannedWeight = bl; });
  }
  entry.progressionChoice = {
    chosen: choice === 'accept' ? 'accepted' : choice === 'hold' ? 'held' : 'edited',
    recommended: rec, applied, warnings, at: nowMs || Date.now()
  };
  return { ok: true, applied, warnings, choice: entry.progressionChoice.chosen };
}

/* -------------------------------------------------------------- helpers */
function baselineFrom(last, ex, inc) {
  if (!last || !last.summary) return null;
  const mod = MODALITY[ex.modality] || MODALITY.load_reps;
  if (mod.progresses === 'reps') return last.summary.workingWeight || 0;
  return last.summary.workingWeight;
}
function scaleLoad(base, factor, inc) {
  if (base == null) return null;
  const v = roundToIncrement(base * factor, inc || 2.5);
  return Math.max(TUNING.minLoadKg, v);
}
function targetReps(ex, where) {
  if (where === 'low')   return { lo: ex.lo, hi: ex.lo };
  if (where === 'mid')   return { lo: ex.lo, hi: Math.round((ex.lo + ex.hi) / 2) };
  if (where === 'high')  return { lo: ex.hi, hi: ex.hi };
  if (where === 'fixed') return { lo: ex.hi, hi: ex.hi };
  return { lo: ex.lo, hi: ex.hi };
}
function buildPrescription(ex, load, reps, sets, mod) {
  return {
    load: load == null ? null : Math.round(load * 100) / 100,
    repsLow: reps.lo, repsHigh: reps.hi,
    sets: sets || ex.sets,
    unit: mod ? mod.unit : 'reps',
    modality: ex.modality,
    volumeChanged: false          // load and volume never move together
  };
}
function fmtLoad(w, ex) {
  if (w == null) return 'an unknown load';
  if (ex && ex.modality === 'bodyweight_reps') return w ? `bodyweight +${w} kg` : 'bodyweight';
  if (ex && ex.modality === 'assisted') return `${w} kg assistance`;
  return `${w} kg`;
}
function finish(d) {
  d.at = Date.now();
  d.engineVersion = 4;
  return d;
}

/* ============================================================================
   DELOAD — proposed, never applied automatically
   ========================================================================== */
function proposeDeload(state, todayStr) {
  const sessions = (state.sessions || []).filter(s => s.status === 'completed');
  if (!sessions.length) return null;
  if (state.activeDeload && state.activeDeload.status === 'active') return null;
  if (state.deloadDismissedUntil && todayStr && todayStr < state.deloadDismissedUntil) return null;
  const weeksTrained = new Set(sessions.map(s => s.date.slice(0, 4) + weekOf(s.date))).size;
  const every = (state.profile && state.profile.deloadEveryWeeks) || TUNING.deloadEveryWeeks;
  const lastDeload = state.lastDeloadWeek || 0;
  // Count exercises currently stalled.
  const stalled = [];
  const seen = new Set();
  sessions.slice(-12).forEach(s => s.entries.forEach(e => {
    if (seen.has(e.variantId)) return;
    seen.add(e.variantId);
    const exd = (state._exIndex || {})[e.variantId];
    if (exd) {
      const st = resolveSettings(state, exd);
      if (detectPlateau(state, e.variantId, st, effectiveEx(exd, st), todayStr)) stalled.push(e.variantId);
    }
  }));
  const dueByTime = weeksTrained - lastDeload >= every;
  if (!dueByTime && stalled.length < 3) return null;
  return {
    proposed: true,
    reason: dueByTime
      ? `${weeksTrained} weeks of training logged since the last easy week.`
      : `${stalled.length} exercises have stalled at the same load.`,
    stalled,
    plan: 'One week at about 60% of your usual working loads, same movements, same sets, stopping well short on every set.',
    requiresConfirmation: true,
    explain: {
      what: 'A deload week is suggested, not applied.',
      why: dueByTime
        ? `You have trained ${weeksTrained} weeks without an easy week. Accumulated fatigue is the usual reason progress flattens before the training itself is wrong.`
        : `Several exercises have stopped moving at once, which more often means fatigue than a bad program.`,
      next: 'Accept and the next week is prescribed light. Decline and nothing changes — the suggestion comes back in a week.'
    }
  };
}
function weekOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const jan1 = new Date(y, 0, 1);
  return String(Math.ceil(((dt - jan1) / 86400000 + jan1.getDay() + 1) / 7)).padStart(2, '0');
}


/* ============================================================================
   SESSION SHORTENING — advice that actually changes the roster
   The old sessionPlanAdvice announced a trim and then handed back the full
   roster, so the explanation described a workout that never happened.
   ========================================================================== */
function exerciseTier(ex, idx) {
  // 0 = the lifts the session exists for, 1 = accessories, 2 = core/finishers
  if (ex.block === 'core') return 2;
  const main = ['squat', 'hinge', 'horizontal push', 'horizontal pull',
                'vertical push', 'vertical pull', 'single-leg squat'];
  if (main.indexOf(ex.pattern) >= 0 && idx < 4) return 0;
  return 1;
}
function applySessionPlan(roster, checkin, profile) {
  const planned = (profile && profile.sessionMinutes) || 60;
  const avail = checkin && checkin.timeAvailableMin;
  const full = { kept: roster.slice(), dropped: [], shortened: false,
                 explain: { what: `Full session: all ${roster.length} exercises.`,
                            why: 'You have the time for the whole session.',
                            next: 'Work through it in order.' } };
  if (!avail || avail >= planned * 0.75) return full;

  const target = Math.max(2, Math.round(roster.length * (avail / planned)));
  if (target >= roster.length) return full;

  const ranked = roster.map((ex, idx) => ({ ex, idx, tier: exerciseTier(ex, idx) }))
    .sort((a, b) => a.tier - b.tier || a.idx - b.idx);
  const keepSet = new Set(ranked.slice(0, target).map(r => r.idx));
  const kept = roster.filter((_, i) => keepSet.has(i));
  const dropped = roster.filter((_, i) => !keepSet.has(i));

  return {
    kept, dropped, shortened: true,
    explain: {
      what: `Session trimmed to ${kept.length} exercises: ${kept.map(e => e.short).join(', ')}.`,
      why: `You have ${avail} minutes against a ${planned}-minute session. The compounds are kept and ` +
           `${dropped.length} accessor${dropped.length === 1 ? 'y is' : 'ies are'} dropped — ` +
           `rushing the main lifts to fit the small stuff in is the wrong trade.`,
      next: `${dropped.map(e => e.short).join(', ')} ${dropped.length === 1 ? 'is' : 'are'} not owed back. ` +
            `They roll into the next session of this day.`
    }
  };
}

/* ============================================================================
   DELOAD — accepted deloads actually change prescriptions, within dated bounds
   ========================================================================== */
const DELOAD_FACTOR = 0.6;
const DELOAD_DAYS = 7;

function acceptDeload(state, startISO) {
  const start = startISO || (typeof todayISO === 'function' ? todayISO() : null);
  const end = addDaysSafe(start, DELOAD_DAYS - 1);
  state.activeDeload = {
    id: 'dl_' + Date.now().toString(36),
    startDate: start, endDate: end,
    factor: DELOAD_FACTOR, acceptedAt: Date.now(), status: 'active'
  };
  delete state.deloadDismissedUntil;
  return state.activeDeload;
}
function dismissDeload(state, todayStr) {
  const t = todayStr || (typeof todayISO === 'function' ? todayISO() : null);
  state.deloadDismissedUntil = addDaysSafe(t, 7);
  return state.deloadDismissedUntil;
}
function inDeload(state, todayStr) {
  const d = state.activeDeload;
  if (!d || d.status !== 'active') return null;
  if (todayStr < d.startDate || todayStr > d.endDate) return null;
  return d;
}
/* Called on load and after each session: retires a deload once its window ends. */
function closeDeloadIfDue(state, todayStr) {
  const d = state.activeDeload;
  if (!d) return null;
  if (todayStr <= d.endDate) return null;
  d.status = 'completed'; d.closedOn = todayStr;
  state.deloadHistory = (state.deloadHistory || []).concat([d]);
  state.lastDeloadOn = d.endDate;
  delete state.activeDeload;
  return d;
}

/* ============================================================================
   PROGRAMME GENERATION — goal, experience, availability and time actually
   decide the split, the exercise count, the sets and the rep ranges.
   ========================================================================== */
const GOAL_PRESCRIPTION = {
  strength:    { lo: 3,  hi: 6,  setBias:  1, rest: 'long',   label: 'strength' },
  hypertrophy: { lo: 8,  hi: 12, setBias:  0, rest: 'medium', label: 'hypertrophy' },
  recomp:      { lo: 6,  hi: 10, setBias:  0, rest: 'medium', label: 'recomposition' },
  fatloss:     { lo: 10, hi: 15, setBias: -1, rest: 'short',  label: 'fat loss' }
};
const EXPERIENCE_SETS = { novice: 2, intermediate: 3, advanced: 4 };

const SPLITS = {
  2: [['full', 'Full body A'], ['full', 'Full body B']],
  3: [['full', 'Full body A'], ['full', 'Full body B'], ['full', 'Full body C']],
  4: [['upper', 'Upper A'], ['lower', 'Lower A'], ['upper', 'Upper B'], ['lower', 'Lower B']],
  5: [['upper', 'Upper A'], ['lower', 'Lower A'], ['push', 'Push'], ['pull', 'Pull'], ['lower', 'Lower B']],
  6: [['push', 'Push A'], ['pull', 'Pull A'], ['lower', 'Lower A'],
      ['push', 'Push B'], ['pull', 'Pull B'], ['lower', 'Lower B']]
};
const DAY_PATTERN = {
  full:  ['legs', 'push', 'pull', 'legs', 'push', 'pull', 'core', 'core'],
  upper: ['push', 'pull', 'push', 'pull', 'push', 'pull', 'core', 'core'],
  lower: ['legs', 'legs', 'legs', 'legs', 'core', 'core', 'legs', 'core'],
  push:  ['push', 'push', 'push', 'push', 'core', 'push', 'core', 'core'],
  pull:  ['pull', 'pull', 'pull', 'pull', 'core', 'pull', 'core', 'core']
};
function groupOf(ex) {
  if (ex.block === 'core') return 'core';
  const p = ex.pattern || '';
  if (/push|press|adduction|abduction|elbow extension/.test(p)) return 'push';
  if (/pull|row|flexion$|elbow flexion/.test(p)) return 'pull';
  if (/squat|hinge|knee|ankle|leg/.test(p)) return 'legs';
  if (/anti-|rotation|carry/.test(p)) return 'core';
  return 'push';
}
function equipmentAvailable(ex, equipment) {
  const map = { barbell: 'barbell', dumbbell: 'dumbbell', machine: 'machine',
                cable: 'cable', bodyweight: null, assisted: 'machine' };
  const need = map[ex.equipment];
  if (!need) return true;
  return (equipment || {})[need] !== false;   // only an explicit false excludes
}
function buildProgram(profile, allExercises) {
  const days = Math.max(2, Math.min(6, profile.trainingDaysPerWeek || 4));
  const goal = GOAL_PRESCRIPTION[profile.goal] || GOAL_PRESCRIPTION.recomp;
  const baseSets = EXPERIENCE_SETS[profile.experience] != null
    ? EXPERIENCE_SETS[profile.experience] : EXPERIENCE_SETS.intermediate;
  const mins = profile.sessionMinutes || 60;
  const perDay = Math.max(3, Math.min(8, Math.round((mins - 8) / 9)));
  const split = SPLITS[days] || SPLITS[4];
  const notes = [];

  const pool = allExercises.filter(e => !e.prerequisite);   // start at the base variant
  const byGroup = {};
  pool.forEach(e => { (byGroup[groupOf(e)] = byGroup[groupOf(e)] || []).push(e); });
  Object.keys(byGroup).forEach(g => byGroup[g].sort((a, b) => a.day - b.day || a.order - b.order));

  const used = new Set();
  const out = split.map(([kind, name], di) => {
    const wanted = DAY_PATTERN[kind].slice(0, perDay);
    const picks = [];
    wanted.forEach(group => {
      const candidates = (byGroup[group] || []);
      let pick = candidates.find(e => !used.has(e.id) && equipmentAvailable(e, profile.equipment));
      if (!pick) {
        // fall back to another group rather than letting the day collapse
        for (const g of ['push', 'pull', 'legs', 'core']) {
          pick = (byGroup[g] || []).find(e => !used.has(e.id) && equipmentAvailable(e, profile.equipment));
          if (pick) { notes.push(`${name}: no ${group} exercise left that fits your equipment, used ${pick.short} instead.`); break; }
        }
      } else if (candidates.some(e => !used.has(e.id) && !equipmentAvailable(e, profile.equipment)) &&
                 candidates.indexOf(pick) > 0) {
        const skipped = candidates.find(e => !used.has(e.id) && !equipmentAvailable(e, profile.equipment));
        if (skipped && skipped.order < pick.order) {
          notes.push(`${skipped.short} needs ${skipped.equipment}, which you have turned off — substituted ${pick.short}.`);
        }
      }
      if (!pick) return;
      used.add(pick.id);
      const isCore = pick.block === 'core';
      const sets = Math.max(2, baseSets + goal.setBias + (isCore ? 0 : 1) - (picks.length > 3 ? 1 : 0));
      // a movement's own range still bounds the goal range
      const lo = Math.max(pick.lo, Math.min(goal.lo, pick.hi));
      const hi = Math.min(Math.max(pick.hi, lo), Math.max(goal.hi, lo));
      picks.push({ ex: pick, id: pick.id, sets, repsLow: lo, repsHigh: hi,
                   restSec: pick.restSec, group });
    });
    return { index: di + 1, kind, name, exercises: picks };
  });

  const totalSets = out.reduce((a, d) => a + d.exercises.reduce((b, e) => b + e.sets, 0), 0);
  const explain =
    `${days} days a week, ${mins} minutes a session, built for ${goal.label}. ` +
    `That gives ${perDay} exercises a day in the ${goal.lo}–${goal.hi} rep range, ` +
    `${totalSets} working sets a week at ${profile.experience || 'intermediate'} volume.` +
    (notes.length ? ` ${notes.length} substitution${notes.length === 1 ? '' : 's'} were made for your equipment.` : '');

  return { days: out, notes, explain, goal: goal.label, perDay, totalSets,
            generatedAt: Date.now(), inputs: {
              trainingDaysPerWeek: days, goal: profile.goal, experience: profile.experience,
              sessionMinutes: mins } };
}

/* ============================================================================
   Session-level advice from the check-in (time, energy, pain)
   ========================================================================== */
function sessionPlanAdvice(checkin, plannedMinutes, exerciseCount) {
  if (!checkin) return null;
  const out = [];
  const r = readiness(checkin);
  if (checkin.timeAvailableMin && plannedMinutes && checkin.timeAvailableMin < plannedMinutes * 0.75) {
    const keep = Math.max(2, Math.round(exerciseCount * (checkin.timeAvailableMin / plannedMinutes)));
    out.push({
      action: 'shorten', keep, dropped: Math.max(0, exerciseCount - keep),
      explain: {
        what: `Session trimmed to ${keep} exercises.`,
        why: `You have ${checkin.timeAvailableMin} minutes against a ${plannedMinutes}-minute session. Rushing the compounds to fit the accessories in is the wrong trade.`,
        next: 'The dropped accessories are not owed back — they roll into the next session of this day.'
      }
    });
  }
  if (r.known && r.score <= TUNING.readyLowMax) {
    out.push({
      action: 'ease',
      explain: {
        what: 'Progression paused for this session.',
        why: `Readiness came back ${r.score}/10 from energy, sleep and soreness. Loads hold rather than climb today.`,
        next: 'Normal rules resume next session — a single low day does not change the plan.'
      }
    });
  }
  if (checkin.pain && checkin.pain.present) {
    out.push({
      action: 'pain_review',
      explain: {
        what: `Exercises loading the ${checkin.pain.location || 'affected area'} are flagged for review.`,
        why: 'Pain reported at check-in is handled separately from effort and readiness, and is never averaged into them.',
        next: 'You can skip, substitute or back the load off on each flagged exercise. This app does not diagnose injuries or prescribe rehabilitation.'
      }
    });
  }
  return out.length ? out : null;
}

/* ============================================================================
   ASSUMPTIONS REQUIRING QUALIFIED REVIEW
   Surfaced in the app under Profile → Coaching assumptions, and listed here so
   they are reviewable in one place rather than buried in the code.
   ========================================================================== */
const COACHING_ASSUMPTIONS = [
  { id: 'reserve_2', claim: 'At least 2 clean reps in reserve before load increases.',
    basis: 'Common autoregulation practice (RIR-based). Not derived from a trial on this user.',
    review: 'S&C coach' },
  { id: 'jump_5pct', claim: 'Single load increases capped at 5% of the working load.',
    basis: 'Conservative default to avoid jumps that cannot be completed.', review: 'S&C coach' },
  { id: 'decondition', claim: 'After a break, load trimmed 3% per week away, capped at 15%.',
    basis: 'Judgement call. Detraining rates vary widely by training age and layoff length.',
    review: 'S&C coach' },
  { id: 'weekly_sets_22', claim: 'More than 22 working sets per muscle per week caps progression.',
    basis: 'Upper end of commonly cited hypertrophy volume ranges; individual tolerance varies.',
    review: 'S&C coach' },
  { id: 'plateau_4', claim: 'A plateau is four comparable sessions over at least 14 days with no improvement in load or reps at that load (under 1% better than before), and feedback recorded on at least three of them.',
    basis: 'Judgement call. Reps gained at the same weight count as progress, so an unchanged load is never a stall on its own.', review: 'S&C coach' },
  { id: 'double_step', claim: 'Each set\'s rep target moves up at most one rep per session, from what that set did last time at the same load.',
    basis: 'Conservative so the target is achievable. A faster step would reach the top of the range sooner but is not backed by a trial on this user.', review: 'S&C coach' },
  { id: 'effort_cap', claim: 'The default highest effort that still allows a load increase is "near limit", with two clean reps in reserve.',
    basis: 'Matches the earlier fixed rule. Both are now set per exercise.', review: 'S&C coach' },
  { id: 'backoff_85', claim: 'A back-off prescription defaults to 85% of the top load, and its reps never count towards qualifying the top load.',
    basis: 'Common practice; the percentage is chosen per exercise.', review: 'S&C coach' },
  { id: 'e1rm_epley', claim: 'Estimated 1RM uses the Epley formula.',
    basis: 'Published formula; accuracy degrades above about 10 reps.', review: 'S&C coach' },
  { id: 'pain_sev_5', claim: 'Pain rated 5+ pauses the exercise pending review.',
    basis: 'Safety-biased cut-off chosen by the developer, not a clinical threshold.',
    review: 'Physiotherapist / clinician — this is the assumption most in need of review' },
  { id: 'maintenance_33', claim: 'Maintenance calories estimated as bodyweight × 33.',
    basis: 'Population formula. Individual expenditure commonly differs by several hundred kcal.',
    review: 'Dietitian' },
  { id: 'protein_2gkg', claim: 'Protein set at 2.0 g per kg bodyweight.',
    basis: 'Upper end of commonly cited ranges for training in a deficit.', review: 'Dietitian' },
  { id: 'readiness_eq', claim: 'Readiness = mean of energy, sleep and inverted soreness, scaled 2–10.',
    basis: 'Invented for this app. No validation. Pain is deliberately excluded.',
    review: 'S&C coach / sports scientist' }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TUNING, EFFORT_SCALE, RESERVE_SCALE, TECHNIQUE, CAPACITY, MODALITY,
    blankFeedback, blankPain, blankCheckin, readiness,
    decide, proposeDeload, sessionPlanAdvice, consecutiveHolds, recentWorkload,
    incrementFor, capJump, roundToIncrement, targetReps, COACHING_ASSUMPTIONS,
    applySessionPlan, exerciseTier,
    acceptDeload, dismissDeload, inDeload, closeDeloadIfDue,
    buildProgram, groupOf, equipmentAvailable, GOAL_PRESCRIPTION, EXPERIENCE_SETS,
    painIsConcerning, concerningReasons, CONCERNING_PAIN_FLAGS,
    openPainConcern, resolvePainConcern, openConcernFor, syncPainConcerns,
    PROGRESSION_METHODS, defaultMethodFor, resolveSettings, normaliseSettings, saveExerciseSettings,
    resetExerciseSettings, effectiveEx, evaluateEntry, qualifyingStreak, detectPlateau, pickIncrease,
    buildSetTargets, holdAlternative, checkManualEdit, applyProgressionChoice, perfScore
  };
}
