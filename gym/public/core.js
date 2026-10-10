/* ============================================================================
   Recomp core — schema v3, migration, sessions, records, nutrition, backup.
   Pure logic, no DOM. Loaded as a classic script in the browser and required
   by the node test suite.
   ========================================================================== */

const SCHEMA_VERSION = 3;

/* ---------------------------------------------------------------- defaults */
const DEFAULT_INCREMENTS = {
  barbell: 2.5,      // smallest pair of plates most gyms have
  dumbbell: 2.0,     // next dumbbell up
  machine: 5.0,      // pin stack
  cable: 2.5,
  bodyweight: 2.5,   // added load
  assisted: 5.0,     // assistance stack (reducing assistance = progress)
  carry: 2.5,
  hold: 2.5
};

const DEFAULT_PROFILE = {
  name: '',
  goal: 'recomp',                 // recomp | strength | hypertrophy | fatloss
  experience: 'intermediate',     // novice | intermediate | advanced
  units: 'kg',
  heightCm: null,
  bodyweightKg: 86,
  trainingDaysPerWeek: 4,
  sessionMinutes: 60,
  equipment: {
    barbell: true, dumbbell: true, machine: true, cable: true,
    pullupBar: true, bench: true, abWheel: true, landmine: true, kettlebell: false
  },
  increments: { ...DEFAULT_INCREMENTS },
  // Coaching guardrails — see COACHING_ASSUMPTIONS in engine.js
  maxLoadJumpPct: 5,              // never add more than this % in one step
  deloadEveryWeeks: 6,            // suggested, user-confirmed, never automatic
  returnBreakDays: 14             // beyond this, treat as returning from a break
};

const DEFAULT_NUTRITION = {
  deficitKcal: 400,
  proteinPerKg: 2.0,
  fatPerKg: 0.8,
  maintenanceFactor: 33,          // kcal per kg; a formula estimate, not measured
  mode: 'dynamic'                 // dynamic | static  (static holds targets fixed)
};

const DEFAULT_PREFS = {
  theme: 'system',                // system | light | dark
  reducedMotion: 'system',        // system | on | off
  confirmSuggested: true,         // suggested numbers must be confirmed, never auto-logged
  restTimerAutoStart: true
};

function blankState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    profile: JSON.parse(JSON.stringify(DEFAULT_PROFILE)),
    nutrition: { ...DEFAULT_NUTRITION },
    prefs: { ...DEFAULT_PREFS },
    program: { startDate: todayISO(), weeks: 13 },
    sessions: [],          // stable-id, dated session records
    bodyweight: [],        // [{date:'YYYY-MM-DD', kg}]
    bests: {},             // derived; always recomputed, never incremented in place
    migrations: [],        // audit trail of schema upgrades
    lastBackup: null,
    lastBackupVerified: false
  };
}

/* ------------------------------------------------------------------- dates */
function todayISO(d) { return isoOf(d || new Date()); }
function isoOf(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function daysBetween(aISO, bISO) {
  return Math.round((parseISO(bISO) - parseISO(aISO)) / 86400000);
}
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); }

/* ----------------------------------------------------------------- ids */
let _idCounter = 0;
function newId(prefix) {
  _idCounter++;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${_idCounter.toString(36)}${rand}`;
}

/* ============================================================================
   SESSIONS
   A session is a dated, stable-id record of one training session. Sessions are
   never keyed by week, so the same day can be repeated as often as you like.
   ========================================================================== */

function newSession(dayId, dateISO) {
  return {
    id: newId('s'),
    dayId,
    date: dateISO || todayISO(),
    startedAt: Date.now(),
    endedAt: null,
    status: 'in_progress',         // in_progress | completed | abandoned
    checkin: null,                 // pre-session readiness, see engine.js
    entries: [],                   // per-exercise
    dateEstimated: false
  };
}

function newEntry(exerciseId, variantId) {
  return {
    exerciseId,
    variantId: variantId || exerciseId,
    sets: [],
    feedback: null,                // collected after the exercise
    decision: null,                // engine output recorded at time of prescription
    substitutedFrom: null,
    skipped: false
  };
}

/* A set separates what was PRESCRIBED from what was PERFORMED.
   `status` is explicit: 'pending' until the user acts on it. A suggested value
   is never counted as performance until status becomes 'confirmed' or 'edited'. */
function newSet(planned) {
  return {
    plannedWeight: planned && planned.weight != null ? planned.weight : null,
    plannedReps: planned && planned.reps != null ? planned.reps : null,
    actualWeight: null,
    actualReps: null,
    status: 'pending',             // pending | confirmed | edited | skipped
    warmup: false,
    ts: null
  };
}

const PERFORMED = new Set(['confirmed', 'edited']);
function isPerformed(s) { return PERFORMED.has(s.status); }
function workingSets(entry) {
  return (entry.sets || []).filter(s => isPerformed(s) && !s.warmup);
}

/* Confirming a set copies the plan into actuals ONLY on explicit action. */
function confirmSet(set) {
  if (set.plannedWeight == null && set.plannedReps == null) return false;
  set.actualWeight = set.plannedWeight;
  set.actualReps = set.plannedReps;
  set.status = 'confirmed';
  set.ts = Date.now();
  return true;
}
function editSet(set, weight, reps) {
  // An edit records exactly what the user typed. Blank stays null, not inherited.
  set.actualWeight = (weight === '' || weight == null) ? null : Number(weight);
  set.actualReps = (reps === '' || reps == null) ? null : Number(reps);
  set.status = 'edited';
  set.ts = Date.now();
  return true;
}
function unlogSet(set) {
  set.actualWeight = null; set.actualReps = null; set.status = 'pending'; set.ts = null;
}

/* ============================================================================
   WORKING WEIGHT
   The old engine prescribed from the HEAVIEST set, so one heavy single pulled
   every future set up with it. The comparable working load is the modal weight
   across performed working sets; ties resolve downward (conservative).
   ========================================================================== */
function modeWeight(sets) {
  const ws = sets.map(s => s.actualWeight).filter(w => w != null && !Number.isNaN(w));
  if (!ws.length) return null;
  const counts = new Map();
  ws.forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
  let best = null, bestN = -1;
  [...counts.entries()].sort((a, b) => a[0] - b[0]).forEach(([w, n]) => {
    if (n > bestN) { best = w; bestN = n; }      // strict > keeps the LOWER on a tie
  });
  return best;
}

/* Summarise one performed entry into the facts the engine reasons about. */
function summariseEntry(entry, ex) {
  const sets = workingSets(entry);
  const ww = modeWeight(sets);
  const atWorking = sets.filter(s => s.actualWeight === ww);
  const reps = sets.map(s => s.actualReps).filter(r => r != null);
  const plannedReps = (entry.sets || []).map(s => s.plannedReps).filter(r => r != null);
  const targetReps = plannedReps.length ? Math.max(...plannedReps) : (ex ? ex.hi : null);
  const targetSets = (entry.sets || []).length || (ex ? ex.sets : 0);
  return {
    performedSets: sets.length,
    targetSets,
    workingWeight: ww,
    setsAtWorkingWeight: atWorking.length,
    repsAtWorkingWeight: atWorking.map(s => s.actualReps).filter(r => r != null),
    minReps: reps.length ? Math.min(...reps) : null,
    maxReps: reps.length ? Math.max(...reps) : null,
    topWeight: sets.length ? Math.max(...sets.map(s => s.actualWeight || 0)) : null,
    targetReps,
    volume: sets.reduce((a, s) => a + (s.actualWeight || 0) * (s.actualReps || 0), 0),
    mixedLoads: new Set(sets.map(s => s.actualWeight)).size > 1
  };
}

/* ============================================================================
   HISTORY LOOKUPS — by exercise VARIANT, across dated sessions
   ========================================================================== */
function completedSessions(state) {
  return state.sessions
    .filter(s => s.status === 'completed')
    .sort((a, b) => (a.date === b.date ? a.startedAt - b.startedAt : a.date < b.date ? -1 : 1));
}
function historyFor(state, variantId) {
  const out = [];
  completedSessions(state).forEach(sess => {
    sess.entries.forEach(e => {
      if (e.variantId !== variantId || e.skipped) return;
      if (!workingSets(e).length) return;
      out.push({ session: sess, entry: e });
    });
  });
  return out;
}
function lastPerformance(state, variantId, ex) {
  const h = historyFor(state, variantId);
  if (!h.length) return null;
  const { session, entry } = h[h.length - 1];
  return { date: session.date, sessionId: session.id, entry,
           summary: summariseEntry(entry, ex), feedback: entry.feedback || null };
}

/* ============================================================================
   RECORDS
   Recomputed from scratch every time, so a correction to a mistyped set
   actually lowers the record instead of leaving a phantom best behind.
   Record types follow the exercise's modality rather than one global rule.
   ========================================================================== */
function e1rm(weight, reps) {
  if (!weight || !reps || reps < 1) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));   // Epley
}

function recomputeBests(state, exIndex) {
  const bests = {};
  completedSessions(state).forEach(sess => {
    sess.entries.forEach(entry => {
      const ex = exIndex ? exIndex[entry.variantId] : null;
      const mode = (ex && ex.modality) || 'load_reps';
      const sets = workingSets(entry);
      if (!sets.length) return;
      const b = bests[entry.variantId] || (bests[entry.variantId] = { modality: mode });
      const touch = (k, v, meta) => {
        if (v == null || Number.isNaN(v)) return;
        if (b[k] == null || v > b[k]) { b[k] = v; b[k + '_on'] = sess.date; if (meta) b[k + '_meta'] = meta; }
      };
      let sessionReps = 0, sessionVol = 0;
      sets.forEach(s => {
        const w = s.actualWeight, r = s.actualReps;
        sessionReps += (r || 0);
        sessionVol += (w || 0) * (r || 0);
        if (mode === 'load_reps' || mode === 'weighted_bodyweight') {
          touch('heaviest', w);
          touch('e1rm', e1rm(w, r), { weight: w, reps: r });
          touch('setVolume', (w || 0) * (r || 0));
        } else if (mode === 'assisted') {
          // Less assistance is better, so the record is the LOWEST assistance.
          if (w != null && (b.leastAssist == null || w < b.leastAssist)) {
            b.leastAssist = w; b.leastAssist_on = sess.date;
          }
          touch('mostReps', r);
        } else if (mode === 'bodyweight_reps') {
          touch('mostReps', r);
        } else if (mode === 'timed_hold') {
          touch('longestHold', r); touch('heaviest', w);
        } else if (mode === 'carry') {
          touch('heaviest', w); touch('longestCarry', r);
        }
      });
      touch('sessionReps', sessionReps);
      touch('sessionVolume', sessionVol);
    });
  });
  state.bests = bests;
  return bests;
}

/* ============================================================================
   BODYWEIGHT — calendar-window averages, not "last N entries"
   ========================================================================== */
function bwSorted(state) {
  return [...(state.bodyweight || [])].sort((a, b) => a.date < b.date ? -1 : 1);
}
function logBodyweight(state, kg, dateISO) {
  const date = dateISO || todayISO();
  const i = (state.bodyweight || []).findIndex(e => e.date === date);
  if (i >= 0) state.bodyweight[i].kg = kg;        // one entry per calendar day
  else (state.bodyweight = state.bodyweight || []).push({ date, kg });
  return state.bodyweight;
}
/* Average of entries whose DATE falls in the trailing `days` calendar window
   ending at `endISO`. Three weigh-ins in one morning no longer masquerade as
   three days of data; a month-old entry no longer counts as "this week". */
function trailingAverage(state, days, endISO) {
  const end = endISO || todayISO();
  const start = addDays(end, -(days - 1));
  const inWin = bwSorted(state).filter(e => e.date >= start && e.date <= end);
  if (!inWin.length) return { avg: null, n: 0, start, end };
  const avg = inWin.reduce((a, e) => a + e.kg, 0) / inWin.length;
  return { avg, n: inWin.length, start, end };
}
/* Weekly rate of change from the trend, using two calendar windows.
   Mirrors MacroFactor's documented approach of working from a trend over a
   fixed calendar window rather than raw scale weight. */
function weeklyRate(state, windowDays, endISO) {
  const end = endISO || todayISO();
  const w = windowDays || 20;
  const recent = trailingAverage(state, Math.ceil(w / 2), end);
  const prior = trailingAverage(state, Math.ceil(w / 2), addDays(end, -Math.ceil(w / 2)));
  if (recent.avg == null || prior.avg == null) return null;
  const deltaKg = recent.avg - prior.avg;
  return deltaKg / (Math.ceil(w / 2) / 7);
}

/* ============================================================================
   NUTRITION — targets drive the meal plan, not a hard-coded template
   ========================================================================== */
function macroTargets(state) {
  const p = state.profile, n = state.nutrition;
  const bw = currentBodyweight(state) || p.bodyweightKg;
  const maintenance = Math.round(bw * n.maintenanceFactor);
  const kcal = Math.max(1200, maintenance - n.deficitKcal);   // floor, as MacroFactor does
  const protein = Math.round(bw * n.proteinPerKg);
  const fat = Math.round(bw * n.fatPerKg);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { maintenance, kcal, protein, carbs, fat, bodyweightKg: bw,
           floored: (maintenance - n.deficitKcal) < 1200 };
}
function currentBodyweight(state) {
  const t = trailingAverage(state, 7);
  if (t.avg != null) return Math.round(t.avg * 10) / 10;
  const all = bwSorted(state);
  return all.length ? all[all.length - 1].kg : null;
}

/* A meal plan is GENERATED from the targets. Each component scales, so when
   calories move the plan moves with them instead of silently disagreeing. */
const FOOD = {
  oats:     { per: 'g',  kcal: 3.79, p: 0.134, c: 0.676, f: 0.069, label: 'rolled oats' },
  egg:      { per: 'ea', kcal: 72,   p: 6.3,   c: 0.4,   f: 4.8,   label: 'whole eggs' },
  milk:     { per: 'ml', kcal: 0.64, p: 0.034, c: 0.05,  f: 0.033, label: 'milk' },
  banana:   { per: 'ea', kcal: 105,  p: 1.3,   c: 27,    f: 0.4,   label: 'banana' },
  chicken:  { per: 'g',  kcal: 1.65, p: 0.31,  c: 0,     f: 0.036, label: 'chicken breast' },
  rice:     { per: 'g',  kcal: 1.30, p: 0.027, c: 0.28,  f: 0.003, label: 'cooked rice' },
  yoghurt:  { per: 'g',  kcal: 0.59, p: 0.10,  c: 0.036, f: 0.004, label: 'Greek yoghurt' },
  almonds:  { per: 'g',  kcal: 5.79, p: 0.212, c: 0.216, f: 0.499, label: 'almonds' },
  beef:     { per: 'g',  kcal: 1.76, p: 0.26,  c: 0,     f: 0.08,  label: 'lean beef' },
  potato:   { per: 'g',  kcal: 0.87, p: 0.02,  c: 0.20,  f: 0.001, label: 'potato' },
  oil:      { per: 'ml', kcal: 8.84, p: 0,     c: 0,     f: 1.0,   label: 'olive oil' },
  veg:      { per: 'g',  kcal: 0.35, p: 0.025, c: 0.06,  f: 0.003, label: 'mixed veg' },
  whey:     { per: 'g',  kcal: 4.0,  p: 0.80,  c: 0.08,  f: 0.05,  label: 'whey protein' }
};

function buildMealPlan(targets) {
  // Protein anchors first, then carbs fill the energy gap, then fat tops up.
  const P = targets.protein, F = targets.fat, C = targets.carbs;
  const plan = [
    { slot: 'Breakfast', items: [
      { food: 'egg',     qty: 3 },
      { food: 'oats',    qty: round5(C * 0.26 / 0.676) },
      { food: 'milk',    qty: round25(200) },
      { food: 'banana',  qty: 1 } ] },
    { slot: 'Lunch', items: [
      { food: 'chicken', qty: round5(P * 0.33 / 0.31) },
      { food: 'rice',    qty: round5(C * 0.30 / 0.28) },
      { food: 'veg',     qty: 150 },
      { food: 'oil',     qty: round5(F * 0.14) } ] },
    { slot: 'Snack', items: [
      { food: 'yoghurt', qty: round5(P * 0.15 / 0.10) },
      { food: 'almonds', qty: round5(F * 0.22 / 0.499) } ] },
    { slot: 'Dinner', items: [
      { food: 'beef',    qty: round5(P * 0.30 / 0.26) },
      { food: 'potato',  qty: round5(C * 0.28 / 0.20) },
      { food: 'veg',     qty: 150 },
      { food: 'oil',     qty: round5(F * 0.14) } ] }
  ];
  // The protein-dense foods are not the only protein in the plan: oats, milk,
  // potato and veg all contribute. Solve for the overshoot instead of assuming
  // the anchors carry the whole target.
  const anchors = [['Lunch','chicken',0.31], ['Snack','yoghurt',0.10], ['Dinner','beef',0.26]];
  for (let pass = 0; pass < 4; pass++) {
    const tot = planTotals(plan);
    const gap = tot.p - P;                       // positive = too much protein
    if (Math.abs(gap) <= 5) break;
    const anchorP = anchors.reduce((a, [slot, food, per]) => {
      const m = plan.find(x => x.slot === slot);
      const it = m && m.items.find(i => i.food === food);
      return a + (it ? it.qty * per : 0);
    }, 0);
    if (anchorP <= 0) break;
    const scale = Math.max(0.4, Math.min(1.6, (anchorP - gap) / anchorP));
    anchors.forEach(([slot, food]) => {
      const m = plan.find(x => x.slot === slot);
      const it = m && m.items.find(i => i.food === food);
      if (it) it.qty = round5(it.qty * scale);
    });
  }
  let tot = planTotals(plan);
  // Only top up with whey if the plan still falls short.
  const gapP = P - tot.p;
  if (gapP > 12) {
    plan.push({ slot: 'Top-up', items: [{ food: 'whey', qty: round5(gapP / 0.80) }] });
    tot = planTotals(plan);
  }
  return { plan, totals: tot, targets,
           variance: {
             kcal: Math.round(tot.kcal - targets.kcal),
             p: Math.round(tot.p - P), c: Math.round(tot.c - C), f: Math.round(tot.f - F)
           } };
}
function planTotals(plan) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  plan.forEach(m => m.items.forEach(i => {
    const f = FOOD[i.food]; if (!f) return;
    t.kcal += f.kcal * i.qty; t.p += f.p * i.qty; t.c += f.c * i.qty; t.f += f.f * i.qty;
  }));
  return { kcal: Math.round(t.kcal), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) };
}
function round5(n) { return Math.max(0, Math.round(n / 5) * 5); }
function round25(n) { return Math.max(0, Math.round(n / 25) * 25); }

/* ============================================================================
   MIGRATION — versioned, audited, additive
   ========================================================================== */
function detectVersion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.schemaVersion === 'number') return raw.schemaVersion;
  if (raw.logs && typeof raw.logs === 'object') return 1;   // the original shape
  return null;
}

/* v1 shape: { week, settings:{weight,deficit,ppk}, logs:{'<week>:<exId>':{sets:[{weight,reps,done}],ts}},
              bests:{exId:{e1rm,...}}, bw:[{d:<ms>,kg}], lastBackup }
   Week-keyed logs collapse into one dated session per (week, day).            */
function migrateV1toV3(old, dayOfExercise, exIndex, variantMap) {
  const s = blankState();
  s.createdAt = old.createdAt || Date.now();
  if (old.settings) {
    if (old.settings.weight) s.profile.bodyweightKg = old.settings.weight;
    if (old.settings.deficit != null) s.nutrition.deficitKcal = old.settings.deficit;
    if (old.settings.ppk != null) s.nutrition.proteinPerKg = old.settings.ppk;
  }
  s.bodyweight = (old.bw || [])
    .filter(e => e && e.kg != null)
    .map(e => ({ date: isoOf(new Date(e.d || Date.now())), kg: e.kg }));
  // de-duplicate to one entry per calendar day, keeping the last
  const byDate = new Map();
  s.bodyweight.forEach(e => byDate.set(e.date, e));
  s.bodyweight = [...byDate.values()].sort((a, b) => a.date < b.date ? -1 : 1);

  // Reconstruct sessions. Dates are unknown in v1, so they are derived from the
  // program start and flagged as estimated rather than invented silently.
  const startISO = s.program.startDate;
  const buckets = new Map();   // 'week:day' -> entries
  Object.keys(old.logs || {}).forEach(key => {
    const m = /^(\d+):(.+)$/.exec(key);
    if (!m) return;
    const week = Number(m[1]), exId = m[2];
    const log = old.logs[key];
    if (!log || !Array.isArray(log.sets)) return;
    const variantId = (variantMap && variantMap[exId]) || exId;
    const day = dayOfExercise ? (dayOfExercise[exId] || 0) : 0;
    const bk = `${week}:${day}`;
    if (!buckets.has(bk)) buckets.set(bk, { week, day, entries: [], ts: log.ts || null });
    const bucket = buckets.get(bk);
    if (log.ts && (!bucket.ts || log.ts < bucket.ts)) bucket.ts = log.ts;

    const entry = newEntry(exId, variantId);
    if (variantId !== exId) entry.migratedFromId = exId;
    log.sets.forEach(os => {
      const set = newSet({ weight: null, reps: null });
      const done = !!os.done;
      const w = os.weight === '' || os.weight == null ? null : Number(os.weight);
      const r = os.reps === '' || os.reps == null ? null : Number(os.reps);
      if (done) {
        // v1 could not distinguish a confirmed suggestion from a typed value,
        // so migrated sets are marked 'edited' (treated as real performance)
        // and flagged for provenance.
        set.actualWeight = w; set.actualReps = r;
        set.status = 'edited'; set.migrated = true;
        set.ts = log.ts || null;
      }
      entry.sets.push(set);
    });
    if (entry.sets.some(x => isPerformed(x))) bucket.entries.push(entry);
  });

  [...buckets.values()]
    .sort((a, b) => a.week - b.week || a.day - b.day)
    .forEach(b => {
      if (!b.entries.length) return;
      const sess = newSession(b.day || 1,
        b.ts ? isoOf(new Date(b.ts)) : addDays(startISO, (b.week - 1) * 7 + (b.day - 1)));
      sess.dateEstimated = !b.ts;
      sess.status = 'completed';
      sess.endedAt = b.ts || null;
      sess.entries = b.entries;
      sess.migratedFromWeek = b.week;
      s.sessions.push(sess);
    });

  recomputeBests(s, exIndex);     // discard v1's monotonic bests entirely
  s.lastBackup = old.lastBackup || null;
  s.lastBackupVerified = false;
  s.migrations.push({ from: 1, to: SCHEMA_VERSION, at: Date.now(),
                      sessions: s.sessions.length,
                      note: 'week-keyed logs split into dated sessions; legacy exercise ids mapped to variants; records recomputed' });
  return s;
}

function migrate(raw, opts) {
  opts = opts || {};
  const v = detectVersion(raw);
  if (v == null) return { state: blankState(), migrated: false, from: null };
  if (v === SCHEMA_VERSION) {
    const st = Object.assign(blankState(), raw);
    st.profile = Object.assign({}, DEFAULT_PROFILE, raw.profile || {});
    st.profile.increments = Object.assign({}, DEFAULT_INCREMENTS, (raw.profile || {}).increments || {});
    st.nutrition = Object.assign({}, DEFAULT_NUTRITION, raw.nutrition || {});
    st.prefs = Object.assign({}, DEFAULT_PREFS, raw.prefs || {});
    return { state: st, migrated: false, from: v };
  }
  if (v === 1) {
    return { state: migrateV1toV3(raw, opts.dayOfExercise, opts.exIndex, opts.variantMap), migrated: true, from: 1 };
  }
  if (v === 2) { // reserved: v2 never shipped publicly
    const st = Object.assign(blankState(), raw, { schemaVersion: SCHEMA_VERSION });
    st.migrations = (st.migrations || []).concat([{ from: 2, to: SCHEMA_VERSION, at: Date.now() }]);
    return { state: st, migrated: true, from: 2 };
  }
  // Unknown FUTURE version: refuse rather than mangle it.
  return { state: null, migrated: false, from: v,
           error: `Data is from a newer version (v${v}) than this app understands (v${SCHEMA_VERSION}).` };
}

/* ============================================================================
   BACKUP — validated both ways, and "saved" only ever means verified
   ========================================================================== */
function checksum(str) {            // FNV-1a, enough to catch truncation/corruption
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function makeBackup(state) {
  const payload = JSON.parse(JSON.stringify(state));
  delete payload._savedAt;
  const body = JSON.stringify(payload);
  return {
    format: 'recomp-backup',
    schemaVersion: state.schemaVersion,
    exportedAt: new Date().toISOString(),
    counts: {
      sessions: (state.sessions || []).length,
      performedSets: (state.sessions || []).reduce((a, s) =>
        a + s.entries.reduce((b, e) => b + workingSets(e).length, 0), 0),
      bodyweight: (state.bodyweight || []).length
    },
    checksum: checksum(body),
    data: payload
  };
}
function validateBackup(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Not a JSON object.'] };
  if (obj.format !== 'recomp-backup') errs.push('Not a Recomp backup file.');
  if (!obj.data || typeof obj.data !== 'object') errs.push('Backup contains no data block.');
  if (obj.data) {
    const v = detectVersion(obj.data);
    if (v == null) errs.push('Unrecognised data shape.');
    else if (v > SCHEMA_VERSION) errs.push(`Backup is schema v${v}; this app reads up to v${SCHEMA_VERSION}.`);
    if (obj.data.sessions && !Array.isArray(obj.data.sessions)) errs.push('sessions is not a list.');
    if (obj.data.bodyweight && !Array.isArray(obj.data.bodyweight)) errs.push('bodyweight is not a list.');
  }
  if (obj.checksum && obj.data) {
    const body = JSON.stringify(obj.data);
    if (checksum(body) !== obj.checksum) errs.push('Checksum mismatch — the file looks corrupted or edited.');
  }
  if (errs.length) return { ok: false, errors: errs };
  const counted = {
    sessions: (obj.data.sessions || []).length,
    bodyweight: (obj.data.bodyweight || []).length
  };
  const warn = [];
  if (obj.counts && obj.counts.sessions !== counted.sessions) {
    warn.push(`Header says ${obj.counts.sessions} sessions, file contains ${counted.sessions}.`);
  }
  return { ok: true, errors: [], warnings: warn, counts: counted, exportedAt: obj.exportedAt };
}

/* ======================================================================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA_VERSION, DEFAULT_PROFILE, DEFAULT_NUTRITION, DEFAULT_PREFS, DEFAULT_INCREMENTS,
    blankState, newId, todayISO, isoOf, parseISO, daysBetween, addDays,
    newSession, newEntry, newSet, confirmSet, editSet, unlogSet, isPerformed, workingSets,
    modeWeight, summariseEntry, completedSessions, historyFor, lastPerformance,
    e1rm, recomputeBests,
    logBodyweight, trailingAverage, weeklyRate, currentBodyweight,
    macroTargets, buildMealPlan, planTotals, FOOD,
    detectVersion, migrate, migrateV1toV3,
    makeBackup, validateBackup, checksum
  };
}
