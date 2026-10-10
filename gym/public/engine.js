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
  minLoadKg: 0
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
function blankPain() {
  return { present: false, location: null, severity: null, note: null, duringOrAfter: null };
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
function capJump(current, increment, profile) {
  const pct = (profile && profile.maxLoadJumpPct) || TUNING.maxJumpPctDefault;
  if (!current) return increment;
  const maxDelta = Math.max(increment, (current * pct) / 100);
  return Math.min(increment, maxDelta);
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
   THE DECISION
   ctx = { state, ex, variantId, checkin, todayISO, history?, last? }
   ========================================================================== */
function decide(ctx) {
  const { state, ex } = ctx;
  const today = ctx.todayISO;
  const profile = state.profile || {};
  const trace = [];
  const push = (rule, detail) => trace.push({ rule, detail });

  const last = ctx.last !== undefined ? ctx.last : null;
  const fb = last && last.feedback ? last.feedback : null;
  const sum = last ? last.summary : null;
  const mod = MODALITY[ex.modality] || MODALITY.load_reps;
  const inc = incrementFor(ex, profile);
  const ready = readiness(ctx.checkin);

  /* ---------- 0. PAIN GATE. Separate pathway, evaluated first, never averaged. */
  const sessionPain = ctx.checkin && ctx.checkin.pain && ctx.checkin.pain.present ? ctx.checkin.pain : null;
  const lastPain = fb && fb.pain && fb.pain.present ? fb.pain : null;
  const pain = lastPain || sessionPain;
  if (pain) {
    push('pain.gate', `Pain reported${pain.location ? ' at ' + pain.location : ''}${pain.severity ? ', severity ' + pain.severity : ''}`);
    const severe = pain.severity != null && Number(pain.severity) >= 5;
    const action = severe ? 'review' : 'reduce';
    const base = baselineFrom(last, ex, inc);
    const presc = severe
      ? null
      : buildPrescription(ex, scaleLoad(base, 0.8, inc), targetReps(ex, 'low'), ex.sets, mod);
    return finish({
      action,
      prescription: presc,
      pain: { ...pain, pathway: 'separate' },
      explain: {
        what: severe
          ? 'This exercise is paused pending review.'
          : 'Load cut to about 80% and reps kept to the lower end.',
        why: `You reported pain${pain.location ? ' at the ' + pain.location : ''} on this movement. Pain is handled on its own pathway and is never mixed into effort or readiness.`,
        next: severe
          ? 'Nothing is prescribed until you clear it or choose to substitute. This app does not diagnose injuries or prescribe rehabilitation — a qualified clinician should look at it.'
          : 'If it is pain-free at this load, the normal rules resume next session. If it hurts again, the exercise pauses for review.'
      },
      flags: ['pain'],
      trace, ready, confidence: 'n/a'
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

  const base = baselineFrom(last, ex, inc);
  const gap = daysSince(last.date, today);
  push('history', `Last done ${gap} day(s) ago at ${fmtLoad(base, ex)}`);

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

  /* ---------- 3b. PLATEAU — checked before the individual hold reasons, so a
        stall is caught whatever kept producing the holds. */
  const holdStreak = consecutiveHolds(state, ctx.variantId);
  if (holdStreak >= TUNING.plateauHolds) {
    push('plateau', `${holdStreak} consecutive holds at ${fmtLoad(base, ex)}`);
    return finish(substituteDecision(ex, base, mod, trace, ready,
      `This load has not moved in ${holdStreak} sessions.`));
  }

  /* ---------- 4. DID THE LAST SESSION ACTUALLY MEET THE PRESCRIPTION? */
  const metSets = sum.setsAtWorkingWeight >= Math.max(1, (sum.targetSets || ex.sets) - 0);
  const repTarget = sum.targetReps || ex.hi;
  const allRepsMet = sum.repsAtWorkingWeight.length > 0 &&
                     sum.repsAtWorkingWeight.every(r => r >= repTarget);
  const anyShort = sum.repsAtWorkingWeight.some(r => r < (sum.targetReps || ex.lo));
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
    const holds = consecutiveHolds(state, ctx.variantId);
    if (holds >= TUNING.plateauHolds) {
      return finish(substituteDecision(ex, base, mod, trace, ready,
        `Technique has been breaking down at ${fmtLoad(base, ex)} across ${holds + 1} sessions.`));
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
    const badlyShort = sum.repsAtWorkingWeight.some(r => r < (ex.lo - 1));
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

  // 8b. Missing feedback: hold. Unknown never unlocks progression.
  if (!feedbackKnown || reserveUnknown && !effort) {
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
  if (reserve != null && reserve < TUNING.reserveProgressMin && !neededLess) {
    push('reserve.low', `Only ${reserve} rep(s) in reserve, need ${TUNING.reserveProgressMin}`);
    return finish({
      action: 'hold',
      prescription: buildPrescription(ex, base, targetReps(ex, 'high'), ex.sets, mod),
      explain: {
        what: `Holding ${fmtLoad(base, ex)}.`,
        why: `You had ${reserve} clean rep${reserve === 1 ? '' : 's'} left. The engine wants at least ${TUNING.reserveProgressMin} before it adds load, so the increase lands on a session you can actually complete.`,
        next: `Repeat ${fmtLoad(base, ex)}. Two or more in reserve and it moves up.`
      },
      flags: [], trace, ready, confidence: 'high'
    });
  }

  /* ---------- 9. PROGRESS. Earned, and only one dimension at a time. */
  return finish(progressDecision(ex, base, inc, mod, profile, trace, ready,
                                 { effort, reserve, cap, sum }));
}

/* ------------------------------------------------------------- outcomes */
function progressDecision(ex, base, inc, mod, profile, trace, ready, ev) {
  const reserveTxt = ev.reserve == null ? '' : ` with ${ev.reserve} clean rep${ev.reserve === 1 ? '' : 's'} in reserve`;
  const effortTxt = ev.effort ? ev.effort.label.toLowerCase() : 'manageable';

  if (mod.progresses === 'reps') {
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
    const added = roundToIncrement(inc, inc);
    trace.push({ rule: 'progress.reps.cap', detail: `rep cap ${ex.hi} reached, add ${added}` });
    return { action: 'progress', prescription: buildPrescription(ex, added, { lo: ex.lo, hi: ex.lo }, ex.sets, mod),
      explain: {
        what: `Add ${added} kg and drop back to ${ex.lo} reps.`,
        why: `You are at the top of the rep range (${ex.hi}) and it still came back ${effortTxt}${reserveTxt}. Adding a small load and resetting the reps keeps the movement progressing instead of drifting into endurance work.`,
        next: `Build back up to ${ex.hi} reps at the new load.`
      }, flags: ['progress_load'], trace, ready, confidence: 'high' };
  }

  if (mod.progresses === 'assist') {
    const next = Math.max(0, base - inc);
    trace.push({ rule: 'progress.assist', detail: `assistance ${base} -> ${next}` });
    return { action: 'progress', prescription: buildPrescription(ex, next, targetReps(ex, 'range'), ex.sets, mod),
      explain: {
        what: `Assistance down from ${base} kg to ${next} kg.`,
        why: `On an assisted movement, less help is the progression. Last session was ${effortTxt}${reserveTxt} with controlled technique, so you can carry more of your own bodyweight.`,
        next: next === 0 ? 'That is the full unassisted movement — the next step is the unassisted variant.'
                         : `Hit ${ex.lo}–${ex.hi} reps at ${next} kg of assistance and it drops again.`
      }, flags: ['progress_assist'], trace, ready, confidence: 'high' };
  }

  if (mod.progresses === 'time') {
    const cur = ev.sum.repsAtWorkingWeight[0] || ex.lo;
    if (cur < ex.hi) {
      const next = Math.min(ex.hi, cur + 5);
      trace.push({ rule: 'progress.time', detail: `${cur}s -> ${next}s` });
      return { action: 'progress', prescription: buildPrescription(ex, base, { lo: next, hi: next }, ex.sets, mod),
        explain: {
          what: `Hold time up to ${next} seconds.`,
          why: `Last hold was ${effortTxt}${reserveTxt}. Time goes up first on a hold; load stays put so only one thing changes.`,
          next: `At ${ex.hi} seconds the progression switches to added load and the time resets to ${ex.lo}.`
        }, flags: ['progress_time'], trace, ready, confidence: 'high' };
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
  const rawInc = capJump(base, incrementFor(ex, profile), profile);
  const next = roundToIncrement(base + rawInc, incrementFor(ex, profile));
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
  d.engineVersion = 3;
  return d;
}

/* ============================================================================
   DELOAD — proposed, never applied automatically
   ========================================================================== */
function proposeDeload(state, todayStr) {
  const sessions = (state.sessions || []).filter(s => s.status === 'completed');
  if (!sessions.length) return null;
  const weeksTrained = new Set(sessions.map(s => s.date.slice(0, 4) + weekOf(s.date))).size;
  const every = (state.profile && state.profile.deloadEveryWeeks) || TUNING.deloadEveryWeeks;
  const lastDeload = state.lastDeloadWeek || 0;
  // Count exercises currently stalled.
  const stalled = [];
  const seen = new Set();
  sessions.slice(-12).forEach(s => s.entries.forEach(e => {
    if (seen.has(e.variantId)) return;
    seen.add(e.variantId);
    if (consecutiveHolds(state, e.variantId) >= TUNING.plateauHolds) stalled.push(e.variantId);
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
   Session-level advice from the check-in (time, energy, pain)
   ========================================================================== */
function sessionPlanAdvice(checkin, plannedMinutes, exerciseCount) {
  if (!checkin) return null;
  const out = [];
  const r = readiness(checkin);
  if (checkin.timeAvailableMin && plannedMinutes && checkin.timeAvailableMin < plannedMinutes * 0.75) {
    const keep = Math.max(2, Math.round(exerciseCount * (checkin.timeAvailableMin / plannedMinutes)));
    out.push({
      action: 'shorten',
      explain: {
        what: `Session trimmed to the first ${keep} exercises.`,
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
  { id: 'plateau_3', claim: 'Three consecutive holds triggers a substitution suggestion.',
    basis: 'Arbitrary but conservative threshold.', review: 'S&C coach' },
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
    incrementFor, capJump, roundToIncrement, targetReps, COACHING_ASSUMPTIONS
  };
}
