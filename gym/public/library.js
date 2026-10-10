/* ============================================================================
   Recomp content library: workouts, stretch routines, recovery routines.

   Pure data plus pure helper functions. No DOM, no storage, no network.
   Loads as a plain browser script (globals below) and under node (module.exports).

   Depends on exercises.js (EX_INDEX) and stretches.js (STRETCHES). Every id
   used here is checked against them in test/library.test.js.

   Honesty limits (also in docs/LIBRARY.md):
   - Durations are estimates from the block structure. Warm-up and cool-down
     are not included in a workout's durationMin.
   - Animations are diagrams, not reviewed technique references.
   - Recovery routines are general relaxation and easy movement. They are not
     rehabilitation and carry notRehab:true.
   - Nothing here promises muscle gain or fat loss. `effect` states the
     intended training stimulus only.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ---- dependencies ---- */
  var _ex = (typeof EX_INDEX !== 'undefined') ? EX_INDEX
          : (typeof require !== 'undefined' ? require('./exercises.js').EX_INDEX : {});
  var _st = (typeof STRETCHES !== 'undefined') ? STRETCHES
          : (typeof require !== 'undefined' ? require('./stretches.js').STRETCHES : []);
  var _stIndex = {};
  _st.forEach(function (s) { _stIndex[s.id] = s; });

  /* ---- vocab ---- */
  var KINDS = ['strength', 'hypertrophy', 'conditioning', 'cardio', 'bodyweight', 'home', 'hotel', 'express'];
  var GOALS = ['build_muscle', 'strength', 'fat_loss', 'recomp', 'general_fitness', 'mobility'];
  var EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bands', 'kettlebell', 'cardio_machine', 'bench', 'pullup_bar', 'none'];
  var BODY_AREAS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core', 'full_body', 'cardio'];
  var DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
  var STRUCTURES = ['resistance', 'intervals', 'steady', 'circuit', 'emom', 'ladder'];
  var ROUTINE_TYPES = ['dynamic_warmup', 'post_workout', 'standalone'];
  var ACTIVITIES = ['upper_body_day', 'lower_body_day', 'push', 'pull', 'legs', 'full_body', 'conditioning', 'running', 'desk', 'morning', 'before_bed', 'any'];
  var STIFFNESS = ['neck', 'shoulders', 'upper back', 'lower back', 'hips', 'hamstrings', 'quads', 'calves', 'ankles', 'wrists', 'chest'];
  var RECOVERY_TYPES = ['easy_movement', 'gentle_mobility', 'relaxation', 'breathing', 'walk'];

  /* ---- equipment needed per exercise ---- */
  var EQUIP_FROM_FIELD = { barbell: 'barbell', dumbbell: 'dumbbell', machine: 'machine', cable: 'cable',
    bands: 'bands', kettlebell: 'kettlebell', assisted: 'machine', bodyweight: null };
  var EQUIP_EXTRA = {
    'pull-up': ['pullup_bar'], 'weighted-pull-up': ['pullup_bar'], 'hanging-leg-raise': ['pullup_bar'],
    'weighted-hanging-leg-raise': ['pullup_bar'], 'inverted-row': ['pullup_bar'],
    'bench-barbell': ['bench'], 'incline-barbell-press': ['bench'], 'incline-db-press': ['bench'],
    'db-bench': ['bench'], 'chest-supported-row': ['bench'], 'incline-db-curl': ['bench'], 'db-row': ['bench'],
    'hip-thrust': ['bench'], 'bulgarian-split-squat': ['bench'], 'step-up': ['bench']
  };
  /* incline-push-up needs only a sturdy raised surface (table, bench, rail), so it adds no item. */
  /* Items that can stand in for each other when you hold only one. */
  var EQUIP_SUBSTITUTES = { dumbbell: ['kettlebell'], kettlebell: ['dumbbell'] };

  function requiredEquipmentForExercise(id) {
    var ex = _ex[id]; var out = [];
    if (!ex) return out;
    var base = EQUIP_FROM_FIELD[ex.equipment];
    if (base) out.push(base);
    (EQUIP_EXTRA[id] || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /* ---- workout helpers ---- */
  function allMoveExerciseIds(w) {
    var ids = [];
    (w.blocks || []).forEach(function (b) {
      if (b.type === 'resistance') b.exercises.forEach(function (e) { ids.push(e.id); });
      else if (b.type === 'intervals') b.work.forEach(function (m) { if (m.exerciseId) ids.push(m.exerciseId); });
      else if (b.type === 'circuit') b.moves.forEach(function (m) { if (m.exerciseId) ids.push(m.exerciseId); });
    });
    return ids;
  }

  /* Estimated minutes from the blocks (see docs/LIBRARY.md for the assumptions). */
  var ASSUMED_WORK_SEC = 40, TRANSITION_SEC = 60, DEFAULT_CIRCUIT_MOVE_SEC = 40;
  function estimateDurationMin(w) {
    var sec = 0;
    (w.blocks || []).forEach(function (b) {
      if (b.type === 'resistance') {
        b.exercises.forEach(function (e) { sec += e.sets * (ASSUMED_WORK_SEC + e.restSec) + TRANSITION_SEC; });
      } else if (b.type === 'intervals') {
        var per = 0; b.work.forEach(function (m) { per += m.workSec + m.restSec; });
        sec += b.rounds * per;
      } else if (b.type === 'steady') {
        sec += b.minutes * 60;
      } else if (b.type === 'circuit') {
        var mv = 0; b.moves.forEach(function (m) { mv += (m.workSec || DEFAULT_CIRCUIT_MOVE_SEC); });
        sec += b.rounds * (mv + b.restBetweenRoundsSec);
      }
    });
    return sec / 60;
  }
  function hardSets(w) {
    var n = 0;
    (w.blocks || []).forEach(function (b) { if (b.type === 'resistance') b.exercises.forEach(function (e) { n += e.sets; }); });
    return n;
  }
  /* Sets per primary muscle. Resistance sets count as written; each circuit
     round of a move with an exerciseId counts as one set. */
  function workoutMuscles(w) {
    var out = {};
    function add(id, n) { var ex = _ex[id]; if (!ex) return; out[ex.primary] = (out[ex.primary] || 0) + n; }
    (w.blocks || []).forEach(function (b) {
      if (b.type === 'resistance') b.exercises.forEach(function (e) { add(e.id, e.sets); });
      else if (b.type === 'circuit') b.moves.forEach(function (m) { if (m.exerciseId) add(m.exerciseId, b.rounds); });
    });
    return out;
  }
  function roundDuration(min) { return min >= 25 ? Math.round(min / 5) * 5 : Math.max(5, Math.round(min)); }

  /* ---- block builders (keep the data table readable) ---- */
  function rx(id, sets, repMin, repMax, restSec) { return { id: id, sets: sets, repMin: repMin, repMax: repMax, restSec: restSec }; }
  function res(label) { return { type: 'resistance', label: label, exercises: Array.prototype.slice.call(arguments, 1) }; }
  function iv(label, rounds) { return { type: 'intervals', label: label, rounds: rounds, work: Array.prototype.slice.call(arguments, 2) }; }
  function wk(name, workSec, restSec, cue, exerciseId) {
    var o = { name: name, workSec: workSec, restSec: restSec };
    if (cue) o.cue = cue; if (exerciseId) o.exerciseId = exerciseId; return o;
  }
  function steady(name, minutes, intensity, cue) {
    var o = { type: 'steady', name: name, minutes: minutes, intensity: intensity }; if (cue) o.cue = cue; return o;
  }
  function circ(label, rounds, restBetweenRoundsSec) {
    return { type: 'circuit', label: label, rounds: rounds, restBetweenRoundsSec: restBetweenRoundsSec, moves: Array.prototype.slice.call(arguments, 3) };
  }
  function mv(name, exerciseId, reps, workSec) {
    var o = { name: name }; if (exerciseId) o.exerciseId = exerciseId;
    if (reps) o.reps = reps; if (workSec) o.workSec = workSec; return o;
  }
  function mob(name, stretchId, workSec) { return { name: name, stretchId: stretchId, workSec: workSec }; }

  /* opts: eq (extra equipment, e.g. cardio_machine), swap (replace dumbbell with kettlebell), shortVersionOf */
  function W(id, name, summary, kind, goals, difficulty, bodyAreas, demand, structure, effect, tags, blocks, opts) {
    opts = opts || {};
    var w = { id: id, name: name, summary: summary, kind: kind, goals: goals, durationMin: 0, difficulty: difficulty,
      equipment: [], bodyAreas: bodyAreas, effect: effect, demand: demand, structure: structure, blocks: blocks, tags: tags };
    var eq = [];
    allMoveExerciseIds(w).forEach(function (eid) {
      requiredEquipmentForExercise(eid).forEach(function (x) {
        if (opts.swap && opts.swap[x]) x = opts.swap[x];
        if (eq.indexOf(x) < 0) eq.push(x);
      });
    });
    (opts.eq || []).forEach(function (x) { if (eq.indexOf(x) < 0) eq.push(x); });
    w.equipment = eq.length ? eq : ['none'];
    w.durationMin = roundDuration(estimateDurationMin(w));
    if (opts.shortVersionOf) w.shortVersionOf = opts.shortVersionOf;
    return w;
  }

  var G = {
    str: ['strength', 'general_fitness'], strRec: ['strength', 'recomp'],
    hyp: ['build_muscle', 'recomp'], hypGen: ['build_muscle', 'general_fitness']
  };

  /* ============================================================================
     WORKOUTS
     ========================================================================== */
  var WORKOUTS = [
    /* ---------------- STRENGTH ---------------- */
    W('w-str-full-a', 'Full Body Strength A', 'Squat, bench, row and Romanian deadlift in low reps with long rests.',
      'strength', ['strength', 'recomp'], 'intermediate', ['legs', 'chest', 'back', 'full_body'], 4, 'resistance',
      'Heavy sets of 3 to 5 on the big barbell lifts to practise lifting near your limit with good form.',
      ['barbell', 'full body', 'low reps', 'compound'],
      [res('Main lifts', rx('squat-barbell', 4, 3, 5, 210), rx('bench-barbell', 4, 3, 5, 180),
        rx('row-barbell', 3, 5, 6, 150), rx('rdl-barbell', 3, 5, 6, 150))]),
    W('w-str-full-b', 'Full Body Strength B', 'Deadlift, overhead press, pull-ups and split squats for a second heavy day.',
      'strength', ['strength', 'general_fitness'], 'intermediate', ['legs', 'shoulders', 'back', 'full_body'], 4, 'resistance',
      'Heavy deadlift and press work paired with a pulling movement and a single-leg lift.',
      ['barbell', 'full body', 'deadlift', 'compound'],
      [res('Main lifts', rx('deadlift-conventional', 3, 3, 5, 210), rx('ohp-barbell', 4, 3, 5, 180),
        rx('pull-up', 4, 3, 6, 150), rx('bulgarian-split-squat', 3, 6, 8, 120))]),
    W('w-str-upper', 'Upper Body Strength', 'Heavy bench, row, press and weighted pull-ups for the upper body.',
      'strength', ['strength', 'recomp'], 'advanced', ['chest', 'back', 'shoulders', 'arms'], 4, 'resistance',
      'Low-rep work on the four main upper body lifts with long rests between sets.',
      ['upper', 'barbell', 'low reps'],
      [res('Upper strength', rx('bench-barbell', 5, 3, 5, 180), rx('row-barbell', 4, 4, 6, 150),
        rx('ohp-barbell', 3, 4, 6, 150), rx('weighted-pull-up', 3, 3, 5, 180))]),
    W('w-str-lower', 'Lower Body Strength', 'Squat, Romanian deadlift, leg press and calves in low rep ranges.',
      'strength', ['strength', 'general_fitness'], 'intermediate', ['legs', 'glutes'], 4, 'resistance',
      'Heavy squatting and hinging with supporting leg work to practise lower body strength.',
      ['lower', 'barbell', 'low reps', 'legs'],
      [res('Lower strength', rx('squat-barbell', 5, 3, 5, 210), rx('rdl-barbell', 3, 5, 6, 150),
        rx('leg-press', 3, 6, 8, 120), rx('standing-calf-raise', 3, 6, 8, 90))]),
    W('w-str-push', 'Push Day: Strength Focus', 'Bench, overhead press, incline press and triceps in low reps.',
      'strength', ['strength', 'recomp'], 'intermediate', ['chest', 'shoulders', 'arms'], 3, 'resistance',
      'Heavy pressing patterns with a little triceps work at the end.',
      ['push', 'barbell', 'low reps'],
      [res('Push', rx('bench-barbell', 5, 3, 5, 180), rx('ohp-barbell', 4, 4, 6, 150),
        rx('incline-barbell-press', 3, 5, 8, 120), rx('triceps-pushdown', 3, 6, 8, 90))]),
    W('w-str-pull', 'Pull Day: Strength Focus', 'Trap-bar deadlift, pull-ups, barbell rows and curls in low reps.',
      'strength', ['strength', 'general_fitness'], 'intermediate', ['back', 'arms', 'legs'], 4, 'resistance',
      'Heavy pulling with a trap-bar deadlift, pull-ups and rows.',
      ['pull', 'barbell', 'low reps', 'deadlift'],
      [res('Pull', rx('deadlift-trap-bar', 4, 3, 5, 210), rx('pull-up', 4, 3, 6, 150),
        rx('row-barbell', 4, 5, 6, 150), rx('barbell-curl', 3, 6, 8, 90))]),
    W('w-str-beginner', 'Beginner Barbell Basics', 'Three barbell lifts, three sets of five. A simple start to lifting.',
      'strength', ['strength', 'general_fitness'], 'beginner', ['legs', 'chest', 'back', 'full_body'], 3, 'resistance',
      'Practise the squat, bench and row at a manageable weight. Add load only when all sets are clean.',
      ['beginner', 'barbell', 'full body', '3x5'],
      [res('Basics', rx('squat-barbell', 3, 5, 5, 150), rx('bench-barbell', 3, 5, 5, 150), rx('row-barbell', 3, 5, 5, 120))]),
    W('w-str-machine-starter', 'Machine Strength Starter', 'Leg press and machine presses and rows in lower reps, no barbell needed.',
      'strength', ['strength', 'general_fitness'], 'beginner', ['legs', 'chest', 'back', 'shoulders'], 2, 'resistance',
      'A guided-path way to practise heavier sets of 6 to 8 before moving to free weights.',
      ['beginner', 'machines', 'full body'],
      [res('Machines', rx('leg-press', 3, 6, 8, 120), rx('machine-chest-press', 3, 6, 8, 120),
        rx('seated-cable-row', 3, 6, 8, 120), rx('machine-shoulder-press', 3, 6, 8, 120))]),
    W('w-str-deadlift', 'Deadlift Day', 'Conventional deadlift in low reps, Romanian deadlifts and weighted leg raises.',
      'strength', ['strength', 'recomp'], 'advanced', ['back', 'legs', 'glutes', 'core'], 5, 'resistance',
      'A heavy deadlift focus with hinge and trunk support work. High recovery cost.',
      ['deadlift', 'barbell', 'low reps', 'hinge'],
      [res('Deadlift', rx('deadlift-conventional', 5, 2, 4, 240), rx('rdl-barbell', 3, 5, 6, 150)),
       res('Trunk', rx('weighted-hanging-leg-raise', 3, 6, 8, 90))]),

    /* ---------------- HYPERTROPHY ---------------- */
    W('w-hyp-push', 'Push Day: Hypertrophy', 'Incline press, chest, shoulder and triceps work in moderate reps.',
      'hypertrophy', ['build_muscle', 'recomp'], 'intermediate', ['chest', 'shoulders', 'arms'], 3, 'resistance',
      'Moderate-rep sets to the front, side and rear of the pressing muscles with a few sets close to failure.',
      ['push', 'chest', 'shoulders', 'triceps'],
      [res('Push', rx('incline-barbell-press', 4, 8, 12, 120), rx('incline-db-press', 3, 10, 12, 90),
        rx('lateral-raise', 4, 12, 20, 60), rx('cable-fly', 3, 12, 15, 60),
        rx('overhead-triceps-ext', 3, 10, 15, 60), rx('triceps-pushdown', 3, 12, 15, 60))]),
    W('w-hyp-pull', 'Pull Day: Hypertrophy', 'Pulldowns, rows, face pulls and curls in moderate reps.',
      'hypertrophy', ['build_muscle', 'recomp'], 'intermediate', ['back', 'arms', 'shoulders'], 3, 'resistance',
      'Moderate-rep back and biceps volume from a few different angles.',
      ['pull', 'back', 'biceps'],
      [res('Pull', rx('lat-pulldown', 4, 8, 12, 90), rx('chest-supported-row', 3, 10, 12, 90),
        rx('seated-cable-row', 3, 10, 12, 90), rx('face-pull', 3, 15, 20, 60),
        rx('incline-db-curl', 3, 10, 15, 60), rx('barbell-curl', 3, 10, 12, 60))]),
    W('w-hyp-legs', 'Leg Day: Hypertrophy', 'Squat, leg press, hinges, quads, hamstrings and calves.',
      'hypertrophy', ['build_muscle', 'recomp'], 'intermediate', ['legs', 'glutes'], 4, 'resistance',
      'Moderate-rep leg work covering quads, hamstrings and calves.',
      ['legs', 'lower', 'squat'],
      [res('Legs', rx('squat-barbell', 4, 6, 10, 150), rx('leg-press', 3, 10, 15, 90), rx('rdl-barbell', 3, 8, 12, 120),
        rx('leg-extension', 3, 12, 15, 60), rx('lying-leg-curl', 3, 10, 15, 60), rx('standing-calf-raise', 4, 12, 15, 60))]),
    W('w-hyp-upper', 'Upper Body Volume', 'Eight exercises for the chest, back, shoulders and arms in moderate reps.',
      'hypertrophy', ['build_muscle', 'recomp'], 'advanced', ['chest', 'back', 'shoulders', 'arms'], 4, 'resistance',
      'A high-volume upper body day. Needs good recovery between sessions.',
      ['upper', 'volume', 'chest', 'back'],
      [res('Upper volume', rx('bench-barbell', 4, 6, 10, 120), rx('row-barbell', 4, 6, 10, 120),
        rx('incline-db-press', 3, 8, 12, 90), rx('lat-pulldown', 3, 8, 12, 90), rx('lateral-raise', 3, 12, 20, 60),
        rx('face-pull', 3, 15, 20, 60), rx('barbell-curl', 3, 8, 12, 60), rx('overhead-triceps-ext', 3, 10, 15, 60))]),
    W('w-hyp-lower', 'Lower Body Volume', 'Squat, hinge, single-leg and machine work for a long leg session.',
      'hypertrophy', ['build_muscle', 'recomp'], 'advanced', ['legs', 'glutes'], 5, 'resistance',
      'High-volume lower body work. Expect real fatigue and plan the next day accordingly.',
      ['lower', 'volume', 'legs', 'glutes'],
      [res('Lower volume', rx('squat-barbell', 4, 6, 10, 150), rx('rdl-barbell', 4, 8, 10, 120),
        rx('bulgarian-split-squat', 3, 8, 12, 90), rx('leg-press', 3, 10, 15, 90),
        rx('lying-leg-curl', 3, 10, 15, 60), rx('leg-extension', 3, 12, 15, 60), rx('seated-calf-raise', 4, 15, 20, 45))]),
    W('w-hyp-full-starter', 'Full Body Starter: Machines', 'Six easy-to-learn machine and cable exercises for the whole body.',
      'hypertrophy', ['build_muscle', 'general_fitness'], 'beginner', ['legs', 'chest', 'back', 'shoulders', 'full_body'], 2, 'resistance',
      'Moderate-rep sets on guided machines to build exercise habits with low technical demand.',
      ['beginner', 'machines', 'full body'],
      [res('Machines', rx('leg-press', 3, 10, 12, 90), rx('machine-chest-press', 3, 10, 12, 90),
        rx('seated-cable-row', 3, 10, 12, 90), rx('machine-shoulder-press', 3, 10, 12, 90),
        rx('seated-leg-curl', 3, 10, 12, 90), rx('lat-pulldown', 3, 10, 12, 90))]),
    W('w-hyp-arms-delts', 'Arms and Shoulders', 'Lateral raises, presses, curls and triceps for the arms and shoulders.',
      'hypertrophy', ['build_muscle', 'recomp'], 'intermediate', ['arms', 'shoulders'], 2, 'resistance',
      'Focused arm and shoulder volume. Lower recovery cost than a leg or back day.',
      ['arms', 'shoulders', 'biceps', 'triceps'],
      [res('Arms and delts', rx('lateral-raise', 4, 12, 20, 45), rx('db-shoulder-press', 3, 8, 12, 90),
        rx('incline-db-curl', 3, 10, 15, 60), rx('overhead-triceps-ext', 3, 10, 15, 60),
        rx('hammer-curl', 3, 10, 15, 60), rx('triceps-pushdown', 3, 12, 15, 60), rx('face-pull', 3, 15, 20, 45))]),
    W('w-hyp-glutes-hams', 'Glutes and Hamstrings', 'Hip thrusts, Romanian deadlifts, split squats and curls.',
      'hypertrophy', ['build_muscle', 'recomp'], 'intermediate', ['glutes', 'legs'], 3, 'resistance',
      'Moderate-rep work on the back of the legs and hips.',
      ['glutes', 'hamstrings', 'lower'],
      [res('Posterior chain', rx('hip-thrust', 4, 8, 12, 120), rx('rdl-barbell', 3, 8, 12, 120),
        rx('bulgarian-split-squat', 3, 8, 12, 90), rx('lying-leg-curl', 3, 10, 15, 60), rx('seated-calf-raise', 3, 15, 20, 45))]),
    W('w-hyp-dumbbell', 'Dumbbell Full Body Hypertrophy', 'Six dumbbell exercises with a bench, covering every major muscle group.',
      'hypertrophy', ['build_muscle', 'general_fitness'], 'intermediate', ['chest', 'back', 'legs', 'shoulders', 'full_body'], 3, 'resistance',
      'Moderate-rep dumbbell work for the whole body. Needs only a bench and a rack of dumbbells.',
      ['dumbbell', 'full body', 'bench'],
      [res('Dumbbells', rx('db-bench', 3, 8, 12, 90), rx('db-row', 3, 8, 12, 90), rx('goblet-squat', 3, 10, 15, 90),
        rx('db-rdl', 3, 10, 12, 90), rx('db-shoulder-press', 3, 10, 12, 90), rx('db-curl', 3, 10, 15, 60))]),
    W('w-hyp-full-volume', 'Full Body Volume Day', 'Squat, bench, row, hinge, press and pulldown in one long session.',
      'hypertrophy', ['build_muscle', 'recomp'], 'advanced', ['full_body', 'legs', 'chest', 'back', 'shoulders'], 5, 'resistance',
      'A long full-body session with high volume. Best used once a week.',
      ['full body', 'volume', 'long'],
      [res('Full body volume', rx('squat-barbell', 4, 6, 10, 150), rx('bench-barbell', 4, 6, 10, 120),
        rx('row-barbell', 4, 6, 10, 120), rx('rdl-barbell', 3, 8, 10, 120), rx('ohp-barbell', 3, 8, 10, 90),
        rx('lat-pulldown', 3, 8, 12, 90), rx('lying-leg-curl', 3, 10, 15, 60), rx('lateral-raise', 3, 12, 20, 60))]),

    /* ---------------- CONDITIONING ---------------- */
    W('w-con-kb-emom', 'Kettlebell Swing EMOM', 'Twenty minutes of swings, 40 seconds on and 20 off, every minute.',
      'conditioning', ['fat_loss', 'general_fitness'], 'intermediate', ['glutes', 'back', 'full_body'], 3, 'emom',
      'Repeated hinge work that raises the heart rate and builds work capacity. Learn the swing with light weight first.',
      ['kettlebell', 'emom', 'hinge'],
      [iv('Swings', 20, wk('Kettlebell swings', 40, 20, 'Hips drive, arms guide.', 'kettlebell-swing'))]),
    W('w-con-db-complex', 'Dumbbell Complex Circuit', 'Four dumbbell moves back to back, four rounds with a rest between.',
      'conditioning', ['fat_loss', 'recomp'], 'intermediate', ['full_body', 'legs', 'back'], 3, 'circuit',
      'A full-body circuit with a moderate load that keeps the heart rate up for the length of each round.',
      ['dumbbell', 'circuit', 'full body'],
      [circ('Complex', 4, 90, mv('Dumbbell Romanian deadlift', 'db-rdl', 8), mv('Dumbbell reverse lunge', 'db-reverse-lunge', 8),
        mv('Goblet squat', 'goblet-squat', 8), mv('Dumbbell thruster', 'db-thruster', 8))]),
    W('w-con-beginner-intervals', 'Beginner Interval Circuit', 'Four easy bodyweight moves, 30 seconds on and 30 off, five rounds.',
      'conditioning', ['fat_loss', 'general_fitness'], 'beginner', ['full_body', 'cardio'], 2, 'intervals',
      'Easy-to-moderate intervals that introduce circuit-style training without much impact.',
      ['beginner', 'bodyweight', 'intervals', 'low impact'],
      [iv('Circuit', 5, wk('Bodyweight squat', 30, 30, null, 'bodyweight-squat'), wk('Incline push-up', 30, 30, null, 'incline-push-up'),
        wk('High knees (or march)', 30, 30, 'March on the spot if you prefer.', 'high-knees'), wk('Glute bridge', 30, 30, null, 'glute-bridge'))]),
    W('w-con-tabata', 'Tabata Blocks', 'Four exercises, each as eight rounds of 20 seconds on and 10 off.',
      'conditioning', ['fat_loss', 'recomp'], 'advanced', ['full_body', 'cardio', 'legs'], 4, 'intervals',
      'Short, very hard intervals. High effort and high fatigue. Stop if form falls apart.',
      ['tabata', 'hiit', 'bodyweight', 'advanced'],
      [iv('Burpees', 8, wk('Burpee', 20, 10, 'Step back if jumping is not on today.', 'burpee')),
       iv('Jump squats', 8, wk('Jump squat', 20, 10, 'Land softly.', 'jump-squat')),
       iv('Mountain climbers', 8, wk('Mountain climber', 20, 10, null, 'mountain-climber')),
       iv('High knees', 8, wk('High knees', 20, 10, null, 'high-knees'))]),
    W('w-con-ladder', 'Push-up and Squat Ladder', 'Climb from 2 to 10 push-ups and back down, with squats each rung.',
      'conditioning', ['general_fitness', 'recomp'], 'intermediate', ['chest', 'legs', 'full_body'], 3, 'ladder',
      'Ladder-style bodyweight work that adds volume in small, manageable steps.',
      ['ladder', 'bodyweight', 'push-up', 'squat'],
      [2, 4, 6, 8, 10, 8, 6, 4, 2].map(function (n) {
        return circ('Rung of ' + n, 1, 30, mv('Push-up', 'pushup', n), mv('Bodyweight squat', 'bodyweight-squat', n * 2));
      })),
    W('w-con-carry-finisher', 'Carry and Swing Finisher', 'Farmer\'s walks, swings and a thruster circuit to finish a session.',
      'conditioning', ['fat_loss', 'general_fitness'], 'intermediate', ['full_body', 'core', 'back'], 4, 'circuit',
      'Loaded carries and hinge work followed by a circuit. Grip and trunk fatigue are likely.',
      ['carry', 'kettlebell', 'dumbbell', 'finisher'],
      [res('Carry and swing', rx('farmers-walk', 4, 40, 40, 60), rx('kettlebell-swing', 4, 15, 20, 45)),
       circ('Circuit', 3, 60, mv('Dumbbell thruster', 'db-thruster', 10), mv('Burpee', 'burpee', 8), mv('Mountain climber', 'mountain-climber', null, 30))],
      { swap: null }),
    W('w-con-metabolic', 'Gym Metabolic Circuit', 'Five dumbbell and bodyweight moves, four rounds, steady pace.',
      'conditioning', ['fat_loss', 'recomp'], 'intermediate', ['full_body', 'legs', 'core'], 3, 'circuit',
      'A circuit that mixes squatting, pressing, hinging and trunk work at a moderate pace.',
      ['circuit', 'dumbbell', 'full body'],
      [circ('Circuit', 4, 60, mv('Goblet squat', 'goblet-squat', 12), mv('Push-up', 'pushup', 10), mv('Dumbbell Romanian deadlift', 'db-rdl', 12),
        mv('Dumbbell thruster', 'db-thruster', 10), mv('Plank', 'plank', null, 30))]),
    W('w-con-advanced-mix', 'Advanced Conditioning Mix', 'Rowing intervals followed by a hard burpee, swing and pull-up circuit.',
      'conditioning', ['fat_loss', 'recomp'], 'advanced', ['full_body', 'cardio', 'back'], 5, 'intervals',
      'Hard rowing efforts then a tough circuit. High effort, high recovery cost.',
      ['rower', 'hiit', 'advanced', 'circuit'],
      [iv('Row intervals', 6, wk('Row, hard', 45, 45, 'Strong but repeatable pace.')),
       circ('Finisher circuit', 4, 60, mv('Burpee', 'burpee', 10), mv('Kettlebell swing', 'kettlebell-swing', 15), mv('Pull-up', 'pull-up', 6))],
      { eq: ['cardio_machine'] }),

    /* ---------------- CARDIO ---------------- */
    W('w-car-easy-30', 'Easy Steady Cardio 30', 'Thirty minutes at a pace where you can hold a conversation.',
      'cardio', ['general_fitness', 'fat_loss'], 'beginner', ['cardio', 'legs'], 1, 'steady',
      'Easy aerobic work that is simple to recover from. Bike, cross-trainer or treadmill.',
      ['easy', 'steady', 'machine', 'beginner'],
      [steady('Easy cardio', 30, 'easy', 'You should be able to speak in full sentences.')], { eq: ['cardio_machine'] }),
    W('w-car-walk-45', 'Brisk Walk 45', 'Forty-five minutes of walking at a brisk but comfortable pace.',
      'cardio', ['general_fitness', 'fat_loss', 'mobility'], 'beginner', ['cardio', 'legs'], 1, 'steady',
      'Low-impact aerobic work that fits around training days. Needs no equipment.',
      ['walk', 'outdoor', 'beginner', 'low impact'],
      [steady('Brisk walk', 45, 'moderate', 'Swing the arms, breathe a little faster than normal.')]),
    W('w-car-run-walk', 'Run-Walk Starter', 'Eight rounds of one minute easy jog and 90 seconds of walking.',
      'cardio', ['general_fitness', 'fat_loss'], 'beginner', ['cardio', 'legs'], 2, 'intervals',
      'Short jogs broken up by walking, a gentle way to build running tolerance.',
      ['run', 'walk', 'beginner', 'intervals'],
      [iv('Run-walk', 8, wk('Easy jog', 60, 90, 'Jog slowly, walk to recover.'))]),
    W('w-car-bike-intervals', 'Bike Intervals 8 x 1', 'Easy spin, eight hard minutes-ish intervals and an easy finish.',
      'cardio', ['fat_loss', 'general_fitness'], 'intermediate', ['cardio', 'legs'], 3, 'intervals',
      'Hard one-minute efforts with easy recovery to train higher-intensity cardio.',
      ['bike', 'intervals', 'machine'],
      [steady('Easy spin', 5, 'easy'), iv('Hard efforts', 8, wk('Hard 1 minute', 60, 90, 'Hard but repeatable.')),
       steady('Cool down spin', 5, 'easy')], { eq: ['cardio_machine'] }),
    W('w-car-tempo', 'Tempo Run 40', 'Ten easy, twenty at a comfortably hard pace, ten easy.',
      'cardio', ['general_fitness', 'fat_loss'], 'intermediate', ['cardio', 'legs'], 3, 'steady',
      'A sustained effort at a comfortably hard pace, bookended by easy running.',
      ['run', 'tempo', 'outdoor'],
      [steady('Easy run', 10, 'easy'), steady('Tempo', 20, 'hard', 'Hard enough that full sentences are a stretch.'), steady('Easy run', 10, 'easy')]),
    W('w-car-rower-pyramid', 'Rower Pyramid', 'Rowing efforts that climb from one to four minutes and back.',
      'cardio', ['general_fitness', 'fat_loss'], 'intermediate', ['cardio', 'back', 'legs'], 3, 'intervals',
      'Rowing intervals of varied length to practise pacing across different durations.',
      ['rower', 'intervals', 'machine', 'pyramid'],
      [steady('Easy row', 4, 'easy'),
       iv('1 min', 1, wk('Row 1 minute', 60, 60)), iv('2 min', 1, wk('Row 2 minutes', 120, 90)),
       iv('3 min', 1, wk('Row 3 minutes', 180, 120)), iv('4 min', 1, wk('Row 4 minutes', 240, 150)),
       iv('3 min', 1, wk('Row 3 minutes', 180, 120)), iv('2 min', 1, wk('Row 2 minutes', 120, 90)),
       iv('1 min', 1, wk('Row 1 minute', 60, 60)), steady('Easy row', 4, 'easy')], { eq: ['cardio_machine'] }),
    W('w-car-long-75', 'Long Easy Session 75', 'Seventy-five minutes at an easy, sustainable pace.',
      'cardio', ['general_fitness', 'fat_loss'], 'intermediate', ['cardio', 'legs'], 3, 'steady',
      'A long, easy aerobic session to build endurance. Take food and water for the road.',
      ['long', 'easy', 'endurance', 'outdoor'],
      [steady('Easy cardio', 75, 'easy', 'Keep it conversational. If it gets hard, slow down.')]),
    W('w-car-hills', 'Hill Repeats', 'Warm up, eight hard 90 second hill efforts with a walk down, cool down.',
      'cardio', ['general_fitness', 'fat_loss'], 'advanced', ['cardio', 'legs', 'glutes'], 4, 'intervals',
      'Hard uphill efforts that load the legs and the heart. Plan a recovery day after.',
      ['hills', 'run', 'intervals', 'advanced'],
      [steady('Easy warm-up jog', 10, 'easy'), iv('Hill repeats', 8, wk('Hill, hard', 90, 90, 'Strong, steady effort up; walk down.')),
       steady('Easy cool-down', 10, 'easy')]),

    /* ---------------- BODYWEIGHT ---------------- */
    W('w-bw-full-beginner', 'Beginner Bodyweight Full Body', 'Squats, incline push-ups, bridges, bird dogs and planks. No kit needed.',
      'bodyweight', ['general_fitness', 'recomp'], 'beginner', ['full_body', 'legs', 'chest', 'core'], 2, 'resistance',
      'Simple bodyweight patterns to build a base. Choose a range you can finish with good form.',
      ['beginner', 'no equipment', 'full body'],
      [res('Basics', rx('bodyweight-squat', 3, 10, 15, 60), rx('incline-push-up', 3, 8, 12, 60), rx('glute-bridge', 3, 10, 15, 45),
        rx('bird-dog', 2, 8, 10, 45), rx('plank', 3, 20, 40, 45))]),
    W('w-bw-push', 'Bodyweight Push', 'Push-ups, pike push-ups and close-grip push-ups.',
      'bodyweight', ['build_muscle', 'general_fitness'], 'intermediate', ['chest', 'shoulders', 'arms'], 3, 'resistance',
      'Pressing volume using only body weight. Adjust the incline to find a challenging range.',
      ['push', 'no equipment', 'push-up'],
      [res('Push', rx('pushup', 4, 8, 15, 75), rx('pike-push-up', 3, 6, 10, 90), rx('diamond-push-up', 3, 6, 12, 75),
        rx('plank', 2, 30, 45, 45))]),
    W('w-bw-legs', 'Bodyweight Legs and Glutes', 'Squats, lunges, bridges, wall sits and calf raises with no equipment.',
      'bodyweight', ['general_fitness', 'recomp'], 'intermediate', ['legs', 'glutes'], 3, 'resistance',
      'Higher-rep leg work with body weight. Slow the lowering phase to make it harder.',
      ['legs', 'no equipment', 'glutes'],
      [res('Legs', rx('bodyweight-squat', 4, 15, 25, 45), rx('bodyweight-lunge', 3, 10, 15, 60), rx('glute-bridge', 4, 15, 20, 45),
        rx('wall-sit', 3, 30, 45, 60), rx('bodyweight-calf-raise', 3, 15, 25, 45))]),
    W('w-bw-core', 'Core Circuit', 'Planks, dead bugs, bird dogs, crunches and mountain climbers in four rounds.',
      'bodyweight', ['general_fitness', 'recomp'], 'beginner', ['core'], 2, 'circuit',
      'Trunk stability and control work. Slow and controlled beats fast and sloppy.',
      ['core', 'no equipment', 'circuit', 'beginner'],
      [circ('Core', 4, 45, mv('Plank', 'plank', null, 30), mv('Dead bug', 'dead-bug', 10), mv('Bird dog', 'bird-dog', 10), mv('Crunch', 'crunch', 15),
        mv('Mountain climber', 'mountain-climber', null, 30))]),
    W('w-bw-pull-bar', 'Bar and Body Pull', 'Pull-ups, inverted rows, hanging leg raises and push-ups. Needs a bar.',
      'bodyweight', ['build_muscle', 'strength'], 'advanced', ['back', 'arms', 'core'], 4, 'resistance',
      'Pulling volume using a bar or rings, balanced by push-ups and trunk work.',
      ['pull-up', 'pull', 'bar', 'advanced'],
      [res('Pull', rx('pull-up', 4, 5, 10, 120), rx('inverted-row', 3, 8, 15, 90), rx('hanging-leg-raise', 3, 6, 12, 75),
        rx('pushup', 3, 10, 20, 60), rx('superman', 3, 10, 15, 45))]),
    W('w-bw-advanced-full', 'Advanced Bodyweight Full Body', 'Push-ups, lunges, pike push-ups, jumps and a plank finisher.',
      'bodyweight', ['recomp', 'general_fitness'], 'advanced', ['full_body', 'chest', 'legs', 'shoulders'], 4, 'resistance',
      'A demanding full-body session with no equipment. Includes jumping.',
      ['advanced', 'no equipment', 'full body', 'impact'],
      [res('Strength', rx('pushup', 4, 15, 25, 60), rx('bodyweight-lunge', 4, 12, 20, 60), rx('pike-push-up', 4, 8, 12, 75),
        rx('jump-squat', 3, 10, 12, 60)),
       circ('Finisher', 3, 45, mv('Burpee', 'burpee', 8), mv('Plank', 'plank', null, 40), mv('Mountain climber', 'mountain-climber', null, 30))]),
    W('w-bw-mobility-flow', 'Mobility and Strength Flow', 'Mobility moves mixed with squats, bridges and bird dogs in four rounds.',
      'bodyweight', ['mobility', 'general_fitness'], 'beginner', ['full_body', 'core', 'legs'], 1, 'circuit',
      'Easy movement through a wide range with light strength work. Not a stretching session on its own.',
      ['mobility', 'flow', 'no equipment', 'beginner'],
      [circ('Flow', 4, 30, mob('Cat-cow', 'catcow', 40), mv('Bodyweight squat', 'bodyweight-squat', 10), mob('Deep squat hold', 'deepsquat', 30),
        mv('Glute bridge', 'glute-bridge', 10), mv('Bird dog', 'bird-dog', 8), mob('Thread the needle', 'threadneedle', 40))]),
    W('w-bw-apartment', 'Quiet Apartment Workout', 'No jumping, no noise. Squats, incline push-ups, bridges, dead bugs and planks.',
      'bodyweight', ['general_fitness', 'recomp'], 'beginner', ['full_body', 'core', 'legs'], 2, 'circuit',
      'A low-impact circuit that is easy on the neighbours and easy on the joints.',
      ['quiet', 'low impact', 'no equipment', 'beginner'],
      [circ('Quiet circuit', 4, 60, mv('Bodyweight squat', 'bodyweight-squat', 15), mv('Incline push-up', 'incline-push-up', 10),
        mv('Glute bridge', 'glute-bridge', 15), mv('Dead bug', 'dead-bug', 10), mv('Plank', 'plank', null, 30))]),

    /* ---------------- HOME ---------------- */
    W('w-home-db-full', 'Home Dumbbell Full Body', 'One pair of dumbbells: goblet squats, hinges, push-ups, presses and curls.',
      'home', ['build_muscle', 'recomp'], 'intermediate', ['full_body', 'legs', 'chest', 'shoulders'], 3, 'resistance',
      'Moderate-rep full-body work with one set of dumbbells and your body weight.',
      ['dumbbell', 'full body', 'home'],
      [res('Full body', rx('goblet-squat', 3, 10, 15, 75), rx('db-rdl', 3, 10, 12, 75), rx('pushup', 3, 8, 15, 60),
        rx('db-shoulder-press', 3, 8, 12, 75), rx('db-curl', 3, 10, 15, 60), rx('plank', 3, 30, 45, 45))]),
    W('w-home-bands-upper', 'Home Bands Upper Body', 'Band rows, pull-aparts, face pulls, push-ups and pushdowns.',
      'home', ['build_muscle', 'general_fitness'], 'beginner', ['back', 'shoulders', 'chest', 'arms'], 2, 'resistance',
      'Band-based upper body work that is gentle on the joints and easy to set up in a doorway.',
      ['bands', 'upper', 'home', 'beginner'],
      [res('Bands', rx('band-row', 3, 10, 20, 60), rx('band-pull-apart', 3, 15, 25, 45), rx('incline-push-up', 3, 8, 15, 60),
        rx('band-face-pull', 3, 15, 25, 45), rx('band-triceps-pushdown', 3, 12, 20, 45))]),
    W('w-home-legs-nokit', 'Home Lower Body, No Equipment', 'Squats, lunges, bridges, wall sit and calf raises.',
      'home', ['general_fitness', 'recomp'], 'beginner', ['legs', 'glutes'], 2, 'resistance',
      'Simple leg work using only body weight. Add reps or slow the tempo to progress.',
      ['legs', 'no equipment', 'home', 'beginner'],
      [res('Legs', rx('bodyweight-squat', 3, 12, 20, 60), rx('bodyweight-lunge', 3, 8, 12, 60), rx('glute-bridge', 3, 12, 20, 45),
        rx('wall-sit', 2, 30, 45, 60), rx('bodyweight-calf-raise', 3, 15, 20, 45))]),
    W('w-home-starter-30', '30-Minute No-Kit Starter', 'Squat, push, hinge and trunk with just your body weight.',
      'home', ['general_fitness', 'recomp'], 'beginner', ['full_body', 'legs', 'chest', 'core'], 2, 'resistance',
      'A balanced beginner session you can do in a lounge room.',
      ['beginner', 'no equipment', 'full body', 'home'],
      [res('Starter', rx('bodyweight-squat', 3, 12, 15, 60), rx('incline-push-up', 3, 8, 12, 60), rx('glute-bridge', 3, 12, 15, 60),
        rx('dead-bug', 3, 8, 10, 45), rx('bodyweight-lunge', 3, 8, 10, 60), rx('plank', 3, 20, 40, 45))]),
    W('w-home-kettlebell', 'Home Kettlebell Session', 'Swings, goblet squats and push-ups with a single kettlebell.',
      'home', ['recomp', 'general_fitness'], 'intermediate', ['full_body', 'glutes', 'legs'], 3, 'resistance',
      'Hinge, squat and push work with one kettlebell. Learn the swing with a light bell first.',
      ['kettlebell', 'home', 'full body'],
      [res('Kettlebell', rx('kettlebell-swing', 5, 10, 15, 60), rx('goblet-squat', 4, 8, 12, 75), rx('pushup', 4, 10, 15, 60),
        rx('plank', 3, 30, 45, 45))], { swap: { dumbbell: 'kettlebell' } }),
    W('w-home-push-pull', 'Home Push-Pull (Dumbbell and Bands)', 'Presses and push-ups balanced by band rows and curls.',
      'home', ['build_muscle', 'recomp'], 'intermediate', ['chest', 'back', 'shoulders', 'arms'], 3, 'resistance',
      'Upper-body pressing and pulling with a dumbbell pair and a loop band.',
      ['upper', 'dumbbell', 'bands', 'home'],
      [res('Push and pull', rx('pushup', 4, 8, 15, 75), rx('band-row', 4, 10, 20, 60), rx('db-shoulder-press', 3, 8, 12, 75),
        rx('band-pull-apart', 3, 15, 25, 45), rx('db-curl', 3, 10, 15, 60), rx('band-triceps-pushdown', 3, 12, 20, 45))]),
    W('w-home-low-impact', 'Low-Impact Home Circuit', 'Marching, squats, push-ups and bridges with no jumping.',
      'home', ['general_fitness', 'fat_loss'], 'beginner', ['full_body', 'cardio'], 2, 'circuit',
      'A steady, quiet circuit that raises the heart rate gently without impact.',
      ['low impact', 'circuit', 'no equipment', 'beginner'],
      [circ('Circuit', 4, 45, mv('March on the spot', null, null, 40), mv('Bodyweight squat', 'bodyweight-squat', 12), mv('Incline push-up', 'incline-push-up', 10),
        mv('Glute bridge', 'glute-bridge', 12), mv('Bird dog', 'bird-dog', 8))]),
    W('w-home-45-advanced', 'Home 45: One Dumbbell Pyramid', 'Squats, hinges, presses and lunges with one heavy pair of dumbbells.',
      'home', ['build_muscle', 'recomp'], 'advanced', ['full_body', 'legs', 'shoulders', 'chest'], 4, 'resistance',
      'A longer home session with a single dumbbell pair. Slow tempos and pauses make it harder.',
      ['dumbbell', 'advanced', 'full body', 'home'],
      [res('Pyramid', rx('goblet-squat', 4, 8, 12, 75), rx('db-rdl', 4, 8, 12, 75), rx('pushup', 4, 12, 20, 60),
        rx('db-shoulder-press', 3, 8, 12, 75), rx('db-reverse-lunge', 3, 8, 12, 75), rx('db-curl', 3, 10, 15, 60),
        rx('plank', 3, 40, 60, 45))]),
    W('w-home-mobility-core', 'Home Mobility and Core', 'Easy mobility moves and core work in four rounds.',
      'home', ['mobility', 'general_fitness'], 'beginner', ['core', 'full_body'], 1, 'circuit',
      'Gentle, controlled movement and trunk control. Good for a lighter day.',
      ['mobility', 'core', 'no equipment', 'beginner'],
      [circ('Flow', 4, 30, mob('Cat-cow', 'catcow', 40), mv('Dead bug', 'dead-bug', 10), mob('Open book', 'openbook', 40),
        mv('Bird dog', 'bird-dog', 8), mob('Half-kneeling hip flexor stretch', 'hipflexor', 40), mv('Plank', 'plank', null, 30))]),

    /* ---------------- HOTEL ---------------- */
    W('w-hotel-room-20', 'Hotel Room 20', 'Four bodyweight moves, four rounds. No equipment, small space.',
      'hotel', ['general_fitness', 'recomp'], 'intermediate', ['full_body', 'legs', 'chest'], 2, 'circuit',
      'A compact full-body circuit for a hotel room.',
      ['travel', 'no equipment', 'circuit', 'small space'],
      [circ('Room circuit', 4, 60, mv('Bodyweight squat', 'bodyweight-squat', 15), mv('Push-up', 'pushup', 10),
        mv('Glute bridge', 'glute-bridge', 15), mv('Mountain climber', 'mountain-climber', null, 30))]),
    W('w-hotel-bands', 'Travel Band Full Body', 'A packable band with squats, rows, pull-aparts, push-ups and bridges.',
      'hotel', ['general_fitness', 'build_muscle'], 'beginner', ['full_body', 'back', 'legs'], 2, 'resistance',
      'A light, packable session with a loop or tube band.',
      ['travel', 'bands', 'beginner', 'full body'],
      [res('Bands', rx('bodyweight-squat', 3, 12, 20, 45), rx('band-row', 3, 10, 20, 60), rx('incline-push-up', 3, 8, 15, 60),
        rx('band-pull-apart', 3, 15, 25, 45), rx('glute-bridge', 3, 12, 20, 45))]),
    W('w-hotel-gym-db', 'Hotel Gym Dumbbell Session', 'Whatever dumbbells the hotel gym has: squats, hinges, presses and curls.',
      'hotel', ['build_muscle', 'recomp'], 'intermediate', ['full_body', 'legs', 'shoulders', 'chest'], 3, 'resistance',
      'Moderate-rep full-body work with light-to-moderate hotel dumbbells.',
      ['travel', 'dumbbell', 'hotel gym', 'full body'],
      [res('Hotel gym', rx('goblet-squat', 3, 10, 15, 75), rx('db-rdl', 3, 10, 12, 75), rx('pushup', 3, 10, 15, 60),
        rx('db-shoulder-press', 3, 10, 12, 75), rx('db-curl', 3, 10, 15, 60), rx('bodyweight-calf-raise', 3, 15, 20, 45))]),
    W('w-hotel-quiet', 'Quiet Hotel Room Circuit', 'No jumping. Squats, push-ups, bridges, dead bugs and planks.',
      'hotel', ['general_fitness', 'recomp'], 'beginner', ['full_body', 'core'], 2, 'circuit',
      'A low-noise circuit that will not bother the room below.',
      ['travel', 'quiet', 'low impact', 'beginner'],
      [circ('Quiet circuit', 3, 60, mv('Bodyweight squat', 'bodyweight-squat', 15), mv('Incline push-up', 'incline-push-up', 10),
        mv('Glute bridge', 'glute-bridge', 15), mv('Dead bug', 'dead-bug', 10), mv('Plank', 'plank', null, 30))]),
    W('w-hotel-mobility', 'Travel Day Mobility', 'Easy movement to loosen up after a flight or a long drive.',
      'hotel', ['mobility', 'general_fitness'], 'beginner', ['full_body', 'core'], 1, 'circuit',
      'Gentle movement through a comfortable range. General mobility only.',
      ['travel', 'mobility', 'no equipment', 'beginner'],
      [circ('Mobility', 3, 20, mob('Chin tuck', 'chintuck', 30), mob('Arm circles', 'armcircles', 30), mob('Cat-cow', 'catcow', 40),
        mob('Standing trunk rotation', 'standingtwist', 30), mob('Walking knee hug', 'hugknee', 40), mob('Ankle circles', 'anklecircles', 30),
        mob('Deep squat hold', 'deepsquat', 30))]),
    W('w-hotel-hiit', 'Hotel Room HIIT', 'Fifteen to twenty minutes of intervals in a hotel room.',
      'hotel', ['fat_loss', 'general_fitness'], 'intermediate', ['full_body', 'cardio'], 3, 'intervals',
      'Short bodyweight intervals. Includes jumping, with a no-jump option for each move.',
      ['travel', 'hiit', 'intervals', 'no equipment'],
      [iv('Intervals', 5, wk('Jumping jacks', 40, 20, 'Step out if you prefer.', 'jumping-jack'), wk('Push-ups', 40, 20, null, 'pushup'),
        wk('Squats', 40, 20, null, 'bodyweight-squat'), wk('Mountain climbers', 40, 20, null, 'mountain-climber'))]),
    W('w-hotel-upper', 'Hotel Upper Body', 'Push-ups, dumbbell presses, curls and band or body rows.',
      'hotel', ['build_muscle', 'recomp'], 'intermediate', ['chest', 'shoulders', 'arms', 'back'], 3, 'resistance',
      'Upper-body work using hotel dumbbells and a travel band.',
      ['travel', 'upper', 'dumbbell', 'bands'],
      [res('Upper', rx('pushup', 4, 10, 20, 60), rx('db-shoulder-press', 3, 10, 12, 75), rx('band-row', 3, 10, 20, 60),
        rx('db-curl', 3, 10, 15, 60), rx('band-triceps-pushdown', 3, 12, 20, 45), rx('band-face-pull', 3, 15, 25, 45))]),
    W('w-hotel-lower', 'Hotel Lower Body', 'Goblet squats, Romanian deadlifts, lunges, bridges and calf raises.',
      'hotel', ['build_muscle', 'recomp'], 'intermediate', ['legs', 'glutes'], 3, 'resistance',
      'Lower-body work with a single dumbbell and your body weight.',
      ['travel', 'lower', 'dumbbell', 'legs'],
      [res('Lower', rx('goblet-squat', 4, 10, 15, 75), rx('db-rdl', 3, 10, 12, 75), rx('db-reverse-lunge', 3, 8, 12, 75),
        rx('glute-bridge', 3, 15, 20, 45), rx('bodyweight-calf-raise', 3, 15, 25, 45))]),

    W('w-home-morning-flow', 'Home Morning Mobility Flow', 'A relaxed morning flow for the spine, hips and shoulders. No kit.',
      'home', ['mobility', 'general_fitness'], 'beginner', ['full_body', 'core'], 1, 'circuit',
      'Easy movement through the spine, hips and shoulders to start the day. Not a workout in the strength sense.',
      ['mobility', 'morning', 'no equipment', 'beginner'],
      [circ('Morning flow', 3, 30, mob('Pelvic tilt', 'pelvictilt', 40), mob('Cat-cow', 'catcow', 45), mob('Thread the needle', 'threadneedle', 45),
        mob('Walking knee hug', 'hugknee', 40), mob('Arm circles', 'armcircles', 30), mob('Standing trunk rotation', 'standingtwist', 30))]),
    W('w-bw-hips-flow', 'Hips and Spine Flow', 'Squat holds, lunges and rotations that move the hips and spine through range.',
      'bodyweight', ['mobility', 'general_fitness'], 'intermediate', ['legs', 'glutes', 'core'], 2, 'circuit',
      'Active mobility for the hips and thoracic spine mixed with light squatting and lunging.',
      ['mobility', 'hips', 'flow', 'no equipment'],
      [circ('Hips flow', 4, 30, mob('Deep lunge with reach', 'lungereach', 40), mob('Side lunge', 'cossack', 40), mob('Deep squat hold', 'deepsquat', 40),
        mv('Reverse lunge', 'bodyweight-lunge', 8), mob('Open book', 'openbook', 40), mv('Glute bridge', 'glute-bridge', 12))]),
    W('w-hotel-flight-flow', 'Hotel Flight and Drive Flow', 'Loosen up after sitting for hours. Neck, hips, spine and ankles.',
      'hotel', ['mobility', 'general_fitness'], 'beginner', ['full_body'], 1, 'circuit',
      'Easy movement to undo long periods of sitting. General mobility only.',
      ['travel', 'mobility', 'sitting', 'no equipment'],
      [circ('Flow', 3, 20, mob('Chin tuck', 'chintuck', 30), mob('Thread the needle', 'threadneedle', 40), mob('Half-kneeling hip flexor stretch', 'hipflexor', 40),
        mob('Walking knee hug', 'hugknee', 40), mob('Knee-to-wall ankle rock', 'kneetowall', 40), mob('Ankle circles', 'anklecircles', 30))]),
    W('w-exp-hips-10', 'Express Hips 10', 'Lunge with reach, side lunge, squat hold and bridge. Two rounds.',
      'express', ['mobility', 'general_fitness'], 'beginner', ['legs', 'glutes'], 1, 'circuit',
      'A shorter version of the hips and spine flow.',
      ['express', 'mobility', 'hips', '10 minute'],
      [circ('Hips', 3, 30, mob('Deep lunge with reach', 'lungereach', 40), mob('Side lunge', 'cossack', 40), mob('Deep squat hold', 'deepsquat', 40),
        mv('Glute bridge', 'glute-bridge', 12))], { shortVersionOf: 'w-bw-hips-flow' }),

    /* ---------------- EXPRESS (10 to 20 minutes) ---------------- */
    W('w-exp-full-10', '10-Minute Full Body', 'Squat, push, bridge and plank. Three rounds, short rests.',
      'express', ['general_fitness', 'recomp'], 'beginner', ['full_body'], 1, 'circuit',
      'A short full-body circuit for a busy day. A shorter version of the beginner full-body session.',
      ['express', '10 minute', 'no equipment', 'beginner'],
      [circ('Quick circuit', 3, 45, mv('Bodyweight squat', 'bodyweight-squat', 12), mv('Incline push-up', 'incline-push-up', 10),
        mv('Glute bridge', 'glute-bridge', 12), mv('Plank', 'plank', null, 30))], { shortVersionOf: 'w-bw-full-beginner' }),
    W('w-exp-upper-15', 'Express Upper 15', 'Incline press, chest-supported row and lateral raises. Short rests.',
      'express', ['build_muscle', 'recomp'], 'intermediate', ['chest', 'back', 'shoulders'], 2, 'resistance',
      'A trimmed version of upper body volume: one press, one row and one shoulder movement.',
      ['express', 'upper', 'dumbbell', 'short'],
      [res('Upper', rx('incline-db-press', 3, 8, 12, 60), rx('chest-supported-row', 3, 8, 12, 60), rx('lateral-raise', 2, 12, 15, 45))],
      { shortVersionOf: 'w-hyp-upper' }),
    W('w-exp-legs-15', 'Express Legs 15', 'Goblet squats, dumbbell hinges and lunges with short rests.',
      'express', ['build_muscle', 'general_fitness'], 'intermediate', ['legs', 'glutes'], 2, 'resistance',
      'A trimmed version of lower body volume. Fewer exercises, shorter rests.',
      ['express', 'lower', 'dumbbell', 'short'],
      [res('Legs', rx('goblet-squat', 3, 10, 15, 45), rx('db-rdl', 3, 10, 12, 45), rx('bodyweight-lunge', 2, 10, 12, 45))],
      { shortVersionOf: 'w-hyp-lower' }),
    W('w-exp-core-10', 'Express Core 10', 'Plank, dead bug, bird dog and crunch for three rounds.',
      'express', ['general_fitness', 'recomp'], 'beginner', ['core'], 1, 'circuit',
      'A shorter version of the core circuit for a quick finish.',
      ['express', 'core', '10 minute', 'beginner'],
      [circ('Core', 3, 50, mv('Plank', 'plank', null, 30), mv('Dead bug', 'dead-bug', 8), mv('Bird dog', 'bird-dog', 8), mv('Crunch', 'crunch', 12))],
      { shortVersionOf: 'w-bw-core' }),
    W('w-exp-strength-20', 'Express Strength 20', 'Squat and bench, three sets of three to five with shorter rests.',
      'express', ['strength', 'general_fitness'], 'intermediate', ['legs', 'chest'], 3, 'resistance',
      'Two heavy lifts when time is short. A trimmed version of Full Body Strength A.',
      ['express', 'barbell', 'strength', 'short'],
      [res('Two lifts', rx('squat-barbell', 3, 3, 5, 120), rx('bench-barbell', 3, 3, 5, 120))],
      { shortVersionOf: 'w-str-full-a' }),
    W('w-exp-kb-10', 'Kettlebell EMOM 10', 'Ten minutes of swings, 40 seconds on and 20 off.',
      'express', ['fat_loss', 'general_fitness'], 'intermediate', ['glutes', 'full_body'], 2, 'emom',
      'A shorter version of the kettlebell EMOM. Learn the swing with a light bell first.',
      ['express', 'kettlebell', 'emom', '10 minute'],
      [iv('Swings', 10, wk('Kettlebell swings', 40, 20, 'Hips drive, arms guide.', 'kettlebell-swing'))],
      { shortVersionOf: 'w-con-kb-emom' }),
    W('w-exp-intervals-15', '15-Minute Outdoor Intervals', 'Warm up, ten 30 second efforts with one minute easy, cool down.',
      'express', ['fat_loss', 'general_fitness'], 'intermediate', ['cardio', 'legs'], 3, 'intervals',
      'Short, hard efforts on foot or bike. A shorter cousin of the bike interval session.',
      ['express', 'intervals', 'outdoor', 'run'],
      [steady('Easy warm-up', 2, 'easy'), iv('Efforts', 7, wk('Hard 30 seconds', 30, 60, 'Hard but repeatable.')), steady('Easy cool-down', 2, 'easy')],
      { shortVersionOf: 'w-car-bike-intervals' }),
    W('w-exp-glutes-15', 'Express Glutes 15', 'Bridges, lunges and calf raises. Beginner friendly.',
      'express', ['build_muscle', 'general_fitness'], 'beginner', ['glutes', 'legs'], 1, 'resistance',
      'A shorter glute and leg session using body weight.',
      ['express', 'glutes', 'no equipment', 'beginner'],
      [res('Glutes', rx('glute-bridge', 3, 12, 20, 45), rx('bodyweight-lunge', 3, 10, 12, 45), rx('bodyweight-calf-raise', 2, 15, 20, 30))],
      { shortVersionOf: 'w-hyp-glutes-hams' }),
    W('w-exp-mobility-10', 'Express Mobility 10', 'Cat-cow, thread the needle, hip flexor and squat holds in two rounds.',
      'express', ['mobility', 'general_fitness'], 'beginner', ['full_body', 'core'], 1, 'circuit',
      'A shorter version of the mobility flow. Easy movement, not a stretching routine.',
      ['express', 'mobility', 'beginner', '10 minute'],
      [circ('Quick flow', 3, 30, mob('Cat-cow', 'catcow', 40), mob('Thread the needle', 'threadneedle', 40), mob('Half-kneeling hip flexor stretch', 'hipflexor', 40),
        mob('Deep squat hold', 'deepsquat', 40), mob('Open book', 'openbook', 40), mob('Standing trunk rotation', 'standingtwist', 40))],
      { shortVersionOf: 'w-bw-mobility-flow' })
  ];

  /* ============================================================================
     SEARCH: workouts
     ========================================================================== */
  function _tokens(q) { return String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
  function _hay(w) {
    return {
      name: w.name.toLowerCase(), tags: w.tags.join(' ').toLowerCase(),
      kind: w.kind + ' ' + w.bodyAreas.join(' ') + ' ' + w.goals.join(' ').replace(/_/g, ' ') + ' ' + w.difficulty,
      text: (w.summary + ' ' + w.effect).toLowerCase()
    };
  }
  function _score(h, toks) {
    var s = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], hit = 0;
      if (h.name.indexOf(t) >= 0) hit = Math.max(hit, 4);
      if (h.tags.indexOf(t) >= 0) hit = Math.max(hit, 3);
      if (h.kind.indexOf(t) >= 0) hit = Math.max(hit, 2);
      if (h.text.indexOf(t) >= 0) hit = Math.max(hit, 1);
      if (!hit) return -1;                 // every word must match somewhere
      s += hit;
    }
    return s;
  }
  function equipmentFits(w, available) {
    if (!available) return true;
    var have = {}; available.forEach(function (x) { have[x] = true; if (EQUIP_SUBSTITUTES[x]) EQUIP_SUBSTITUTES[x].forEach(function (y) { have[y] = true; }); });
    return w.equipment.every(function (x) { return x === 'none' || have[x]; });
  }
  function searchWorkouts(f) {
    f = f || {};
    var toks = _tokens(f.q), out = [];
    WORKOUTS.forEach(function (w) {
      if (f.kind && w.kind !== f.kind) return;
      if (f.goal && w.goals.indexOf(f.goal) < 0) return;
      if (f.maxMin != null && w.durationMin > f.maxMin) return;
      if (f.minMin != null && w.durationMin < f.minMin) return;
      if (f.difficulty && w.difficulty !== f.difficulty) return;
      if (f.bodyArea && w.bodyAreas.indexOf(f.bodyArea) < 0) return;
      if (f.maxDemand != null && w.demand > f.maxDemand) return;
      if (f.equipment && !equipmentFits(w, f.equipment)) return;
      var rel = 0;
      if (toks.length) { rel = _score(_hay(w), toks); if (rel < 0) return; }
      out.push({ w: w, rel: rel });
    });
    out.sort(function (a, b) {
      return (b.rel - a.rel) || (a.w.durationMin - b.w.durationMin) || (a.w.id < b.w.id ? -1 : a.w.id > b.w.id ? 1 : 0);
    });
    return out.map(function (x) { return x.w; });
  }

  /* ============================================================================
     STRETCH ROUTINES
     ========================================================================== */
  function S(id, seconds, cue) {
    var st = _stIndex[id];
    var o = { stretchId: id, seconds: seconds != null ? seconds : (st ? st.seconds : 30), sides: st ? st.sides : 1 };
    var c = cue || (st && st.cue); if (c) o.cue = c;
    return o;
  }
  function routineSeconds(r) {
    var t = 0; r.steps.forEach(function (s) { t += s.seconds * s.sides; }); return t;
  }
  /* `target` (minutes) optionally scales every hold so the routine really takes about that long.
     Holds are rounded to 5 s, floored at 15 s and capped at 90 s. */
  function R(id, name, type, bodyAreas, activities, level, purpose, forStiffness, steps, target) {
    if (target) {
      var base = 0; steps.forEach(function (x) { base += x.seconds * x.sides; });
      var k = target * 60 / base;
      steps.forEach(function (x) { x.seconds = Math.min(90, Math.max(15, Math.round(x.seconds * k / 5) * 5)); });
    }
    var r = { id: id, name: name, type: type, bodyAreas: bodyAreas, activities: activities, durationMin: 0, level: level,
      purpose: purpose, forStiffness: forStiffness, steps: steps };
    r.durationMin = Math.max(1, Math.round(routineSeconds(r) / 60));
    return r;
  }

  var STRETCH_ROUTINES = [
    /* ---------------- DYNAMIC WARM-UPS ---------------- */
    R('r-dw-push', 'Push Day Warm-Up', 'dynamic_warmup', ['shoulders', 'chest', 'upper back', 'wrists'], ['push', 'upper_body_day'], 'beginner',
      'Wrists, shoulders and upper back moving before pressing.', ['shoulders', 'wrists', 'chest'],
      [S('wristcircles', 30), S('armcircles', 40), S('wallangel', 40), S('catcow', 40), S('threadneedle', 30), S('bandover', 40)]),
    R('r-dw-pull', 'Pull Day Warm-Up', 'dynamic_warmup', ['upper back', 'shoulders', 'thoracic', 'neck'], ['pull', 'upper_body_day'], 'beginner',
      'Upper back, shoulders and neck loosened before rows and pull-ups.', ['upper back', 'shoulders', 'neck'],
      [S('chintuck', 30), S('catcow', 40), S('threadneedle', 30), S('armcircles', 40), S('wallangel', 40), S('openbook', 30)]),
    R('r-dw-legs', 'Leg Day Warm-Up', 'dynamic_warmup', ['hips', 'hamstrings', 'ankles', 'glutes'], ['legs', 'lower_body_day'], 'beginner',
      'Hips, ankles and hamstrings prepared for squats and hinges.', ['hips', 'ankles', 'hamstrings'],
      [S('anklecircles', 20), S('legswing', 20), S('hugknee', 20), S('lungereach', 30), S('kneetowall', 20), S('cossack', 20), S('deepsquat', 45)]),
    R('r-dw-upper', 'Upper Body Warm-Up', 'dynamic_warmup', ['shoulders', 'upper back', 'chest', 'wrists'], ['upper_body_day', 'push', 'pull'], 'intermediate',
      'A general upper body warm-up for push or pull days.', ['shoulders', 'upper back', 'wrists'],
      [S('wristcircles', 30), S('chintuck', 30), S('armcircles', 40), S('catcow', 40), S('threadneedle', 30), S('wallangel', 40), S('standingtwist', 30)]),
    R('r-dw-lower', 'Lower Body Warm-Up', 'dynamic_warmup', ['hips', 'glutes', 'hamstrings', 'ankles'], ['lower_body_day', 'legs'], 'intermediate',
      'A general lower body warm-up for squat, hinge or lunge days.', ['hips', 'ankles', 'hamstrings'],
      [S('anklecircles', 20), S('pelvictilt', 40), S('legswing', 25), S('hugknee', 25), S('lungereach', 30), S('cossack', 25), S('inchworm', 40), S('deepsquat', 40)]),
    R('r-dw-full', 'Full Body Warm-Up', 'dynamic_warmup', ['hips', 'shoulders', 'thoracic', 'hamstrings'], ['full_body', 'any'], 'beginner',
      'Whole-body warm-up for full-body sessions.', ['hips', 'shoulders', 'lower back'],
      [S('catcow', 40), S('armcircles', 40), S('legswing', 20), S('hugknee', 20), S('lungereach', 30), S('inchworm', 40), S('deepsquat', 40)]),
    R('r-dw-conditioning', 'Conditioning Warm-Up', 'dynamic_warmup', ['hips', 'ankles', 'shoulders', 'hamstrings'], ['conditioning', 'full_body'], 'intermediate',
      'Gets the whole body ready for intervals and circuits.', ['hips', 'ankles', 'shoulders'],
      [S('anklecircles', 20), S('armcircles', 40), S('standingtwist', 30), S('legswing', 20), S('hugknee', 25), S('inchworm', 40), S('lungereach', 30)]),
    R('r-dw-running', 'Running Warm-Up', 'dynamic_warmup', ['ankles', 'hips', 'calves', 'hamstrings'], ['running', 'conditioning'], 'beginner',
      'Ankles, hips and hamstrings moving before an easy run or intervals.', ['ankles', 'calves', 'hips', 'hamstrings'],
      [S('anklecircles', 20), S('legswing', 25), S('hugknee', 25), S('lungereach', 30), S('kneetowall', 20), S('standingtwist', 30)]),
    R('r-dw-5min', 'Quick 5-Minute Warm-Up', 'dynamic_warmup', ['full_body'], ['any', 'full_body'], 'beginner',
      'A fast general warm-up when time is short.', ['hips', 'shoulders', 'lower back'],
      [S('catcow', 40), S('armcircles', 30), S('hugknee', 25), S('lungereach', 30), S('inchworm', 40)], 5),
    R('r-dw-10min', 'Ten-Minute Full Warm-Up', 'dynamic_warmup', ['hips', 'shoulders', 'thoracic', 'ankles', 'wrists'], ['any', 'full_body', 'conditioning'], 'intermediate',
      'A thorough warm-up for long or heavy sessions.', ['hips', 'shoulders', 'ankles', 'wrists'],
      [S('wristcircles', 30), S('armcircles', 40), S('catcow', 45), S('threadneedle', 40), S('openbook', 40), S('anklecircles', 30), S('legswing', 30),
       S('hugknee', 30), S('lungereach', 40), S('cossack', 30), S('inchworm', 45), S('deepsquat', 45)], 10),
    R('r-dw-squat', 'Squat Prep', 'dynamic_warmup', ['hips', 'ankles', 'glutes'], ['legs', 'lower_body_day'], 'intermediate',
      'Ankles and hips prepared for deep squatting.', ['ankles', 'hips'],
      [S('anklecircles', 20), S('kneetowall', 25), S('cossack', 25), S('lungereach', 30), S('pelvictilt', 30), S('deepsquat', 50)]),
    R('r-dw-hinge', 'Hinge and Deadlift Prep', 'dynamic_warmup', ['hamstrings', 'hips', 'lower back'], ['pull', 'lower_body_day', 'full_body'], 'intermediate',
      'Hamstrings, hips and spine moving before deadlifts and Romanian deadlifts.', ['hamstrings', 'lower back', 'hips'],
      [S('pelvictilt', 40), S('catcow', 40), S('legswing', 25), S('inchworm', 45), S('lungereach', 30), S('hugknee', 25)]),

    /* ---------------- POST-WORKOUT ---------------- */
    R('r-pw-push', 'After Push: Chest and Shoulders', 'post_workout', ['chest', 'shoulders', 'wrists'], ['push', 'upper_body_day'], 'beginner',
      'Easy holds for the chest, shoulders and wrists after pressing.', ['chest', 'shoulders', 'wrists'],
      [S('doorchest', 40), S('crossbody', 30), S('tricepsstretch', 30), S('chestopener', 30), S('wristext', 20), S('wristflex', 20), S('childs', 45)]),
    R('r-pw-pull', 'After Pull: Back and Arms', 'post_workout', ['upper back', 'shoulders', 'wrists', 'neck'], ['pull', 'upper_body_day'], 'beginner',
      'Easy holds for the upper back, shoulders and forearms after pulling.', ['upper back', 'shoulders', 'wrists', 'neck'],
      [S('childs', 45), S('crossbody', 30), S('neckflex', 30), S('twist', 35), S('wristflex', 20), S('wristext', 20), S('tricepsstretch', 30)]),
    R('r-pw-legs', 'After Legs: Quads, Hips and Calves', 'post_workout', ['quads', 'hips', 'hamstrings', 'calves'], ['legs', 'lower_body_day'], 'beginner',
      'Easy holds for the legs after squatting and lunging.', ['quads', 'hips', 'hamstrings', 'calves'],
      [S('standingquad', 30), S('hipflexor', 40), S('supinehamstring', 35), S('figurefour', 40), S('calfstep', 25), S('butterfly', 45)]),
    R('r-pw-lower', 'After Lower Body: Full Leg Cool-Down', 'post_workout', ['quads', 'glutes', 'hamstrings', 'calves', 'hips'], ['lower_body_day', 'legs'], 'intermediate',
      'A fuller set of holds after a long lower body day.', ['quads', 'hips', 'hamstrings', 'calves'],
      [S('couch', 45), S('halfsplit', 40), S('pigeon', 45), S('calfwall', 35), S('butterfly', 45), S('kneetochest', 40)]),
    R('r-pw-upper', 'After Upper Body: Whole Upper Cool-Down', 'post_workout', ['chest', 'shoulders', 'upper back', 'wrists', 'neck'], ['upper_body_day', 'push', 'pull'], 'intermediate',
      'A general set of holds after push and pull sessions.', ['chest', 'shoulders', 'upper back', 'wrists'],
      [S('doorchest', 35), S('crossbody', 30), S('tricepsstretch', 30), S('chestopener', 30), S('neckflex', 30), S('childs', 45), S('wristext', 20), S('wristflex', 20)]),
    R('r-pw-full', 'After Full Body: General Cool-Down', 'post_workout', ['full_body', 'hips', 'chest', 'hamstrings'], ['full_body', 'any'], 'beginner',
      'An easy all-over cool-down after any session.', ['hips', 'chest', 'hamstrings', 'shoulders'],
      [S('childs', 45), S('doorchest', 30), S('hipflexor', 35), S('supinehamstring', 30), S('figurefour', 35), S('kneetochest', 40)]),
    R('r-pw-conditioning', 'After Conditioning: Easy Down-Shift', 'post_workout', ['calves', 'quads', 'hips', 'hamstrings'], ['conditioning', 'running'], 'beginner',
      'Easy holds and slow breathing after intervals and circuits.', ['calves', 'quads', 'hips', 'hamstrings'],
      [S('calfwall', 30), S('standingquad', 30), S('hipflexor', 35), S('supinehamstring', 30), S('childs', 45), S('kneetochest', 40)]),
    R('r-pw-running', 'After a Run', 'post_workout', ['calves', 'quads', 'hamstrings', 'hips', 'ankles'], ['running'], 'beginner',
      'Calves, quads, hamstrings and hips after running.', ['calves', 'quads', 'hamstrings', 'hips', 'ankles'],
      [S('calfstep', 30), S('standingquad', 30), S('supinehamstring', 35), S('hipflexor', 35), S('figurefour', 35), S('kneetowall', 20)]),
    R('r-pw-short5', 'Five-Minute Cool-Down', 'post_workout', ['full_body'], ['any'], 'beginner',
      'A quick cool-down when you are short on time.', ['hips', 'chest', 'lower back'],
      [S('childs', 45), S('doorchest', 30), S('hipflexor', 30), S('supinehamstring', 30), S('kneetochest', 30)], 5),
    R('r-pw-long10', 'Ten-Minute Cool-Down', 'post_workout', ['full_body', 'hips', 'chest', 'hamstrings', 'lower back'], ['any', 'full_body'], 'intermediate',
      'A thorough cool-down after a long session.', ['hips', 'chest', 'hamstrings', 'lower back'],
      [S('childs', 45), S('doorchest', 40), S('crossbody', 30), S('couch', 45), S('halfsplit', 40), S('pigeon', 45), S('twist', 40), S('kneetochest', 45)], 10),
    R('r-pw-heavy-lower', 'After Heavy Squats or Deadlifts', 'post_workout', ['lower back', 'hips', 'glutes', 'quads', 'hamstrings'], ['legs', 'lower_body_day', 'pull'], 'intermediate',
      'Easy positions for the lower back and hips after heavy lower body lifts.', ['lower back', 'hips', 'hamstrings', 'quads'],
      [S('childs', 50), S('kneetochest', 45), S('supinetwist', 40), S('figurefour', 40), S('hipflexor', 40), S('supinehamstring', 35)]),

    /* ---------------- STANDALONE ---------------- */
    R('r-sa-desk-5', 'Desk Break: 5 Minutes', 'standalone', ['neck', 'shoulders', 'chest', 'wrists'], ['desk'], 'beginner',
      'A short reset at your desk for the neck, shoulders and wrists.', ['neck', 'shoulders', 'wrists', 'chest'],
      [S('chintuck', 30), S('necktilt', 20), S('crossbody', 20), S('chestopener', 30), S('wristext', 20), S('wristflex', 20), S('standingtwist', 30)], 5),
    R('r-sa-morning-5', 'Morning Reset: 5 Minutes', 'standalone', ['full_body', 'lower back', 'hips', 'shoulders'], ['morning'], 'beginner',
      'Five easy minutes to move the spine and hips first thing.', ['lower back', 'hips', 'shoulders'],
      [S('catcow', 40), S('childs', 40), S('hugknee', 20), S('armcircles', 30), S('standingtwist', 30), S('lungereach', 30), S('pelvictilt', 30)], 5),
    R('r-sa-morning-10', 'Morning Wake-Up: 10 Minutes', 'standalone', ['full_body', 'lower back', 'hips', 'shoulders', 'thoracic'], ['morning'], 'beginner',
      'A gentle ten-minute wake-up for the whole body.', ['lower back', 'hips', 'shoulders', 'upper back'],
      [S('pelvictilt', 40), S('kneetochest', 40), S('catcow', 45), S('threadneedle', 40), S('childs', 45), S('hipflexor', 40), S('armcircles', 30), S('hugknee', 30), S('standingtwist', 30)], 10),
    R('r-sa-bed-10', 'Before-Bed Wind-Down: 10 Minutes', 'standalone', ['lower back', 'hips', 'hamstrings', 'thoracic'], ['before_bed'], 'beginner',
      'Slow floor positions to wind down at the end of the day.', ['lower back', 'hips', 'hamstrings'],
      [S('kneetochest', 50), S('supinetwist', 45), S('figurefour', 45), S('supinehamstring', 40), S('childs', 60), S('butterfly', 50)], 10),
    R('r-sa-neck-shoulders-10', 'Neck and Shoulders: 10 Minutes', 'standalone', ['neck', 'shoulders', 'upper back', 'chest'], ['desk', 'any'], 'beginner',
      'Easy holds for the neck, shoulders and chest after screen time.', ['neck', 'shoulders', 'upper back', 'chest'],
      [S('chintuck', 30), S('necktilt', 30), S('neckflex', 30), S('crossbody', 30), S('tricepsstretch', 30), S('chestopener', 40), S('doorchest', 40),
       S('armcircles', 30), S('wallangel', 40)], 10),
    R('r-sa-hips-15', 'Hip Opener: 15 Minutes', 'standalone', ['hips', 'glutes', 'quads', 'lower back'], ['any', 'before_bed'], 'intermediate',
      'A longer session for the hips and glutes.', ['hips', 'quads', 'lower back'],
      [S('hipflexor', 50), S('couch', 50), S('figurefour', 50), S('pigeon', 50), S('butterfly', 60), S('cossack', 30), S('deepsquat', 60), S('kneetochest', 50), S('supinetwist', 40)], 15),
    R('r-sa-lowerback-10', 'Lower Back Easy: 10 Minutes', 'standalone', ['lower back', 'hips', 'glutes'], ['any', 'morning', 'before_bed'], 'beginner',
      'Gentle movement for the lower back and hips. General relaxation only.', ['lower back', 'hips'],
      [S('pelvictilt', 40), S('kneetochest', 50), S('supinetwist', 45), S('catcow', 45), S('childs', 60), S('figurefour', 45), S('cobra', 30)], 10),
    R('r-sa-thoracic-10', 'Upper Back Mobility: 10 Minutes', 'standalone', ['thoracic', 'upper back', 'shoulders', 'chest'], ['desk', 'any'], 'beginner',
      'Rotation and extension through the middle of the back.', ['upper back', 'shoulders', 'chest'],
      [S('catcow', 45), S('threadneedle', 45), S('openbook', 45), S('twist', 40), S('wallangel', 45), S('chestopener', 40), S('childs', 45)], 10),
    R('r-sa-full-20', 'Full Body Stretch: 20 Minutes', 'standalone', ['full_body', 'hips', 'hamstrings', 'chest', 'shoulders', 'lower back'], ['any', 'before_bed'], 'intermediate',
      'A complete stretching session. Best on a rest day or in the evening.', ['hips', 'hamstrings', 'shoulders', 'lower back', 'chest'],
      [S('catcow', 45), S('childs', 60), S('doorchest', 45), S('crossbody', 40), S('tricepsstretch', 40), S('twist', 45), S('couch', 55), S('hipflexor', 50),
       S('halfsplit', 45), S('pigeon', 55), S('butterfly', 60), S('calfwall', 40), S('supinehamstring', 40), S('kneetochest', 60), S('supinetwist', 45)], 20),
    R('r-sa-hamstrings-10', 'Hamstrings and Calves: 10 Minutes', 'standalone', ['hamstrings', 'calves', 'ankles'], ['any', 'running'], 'beginner',
      'Easy holds for the back of the legs.', ['hamstrings', 'calves', 'ankles'],
      [S('supinehamstring', 45), S('halfsplit', 45), S('downdog', 50), S('calfwall', 40), S('calfstep', 35), S('kneetowall', 30), S('anklecircles', 30)], 10),
    R('r-sa-quads-glutes-10', 'Quads and Glutes: 10 Minutes', 'standalone', ['quads', 'glutes', 'hips'], ['any', 'legs'], 'beginner',
      'Easy holds for the front of the thigh and the glutes.', ['quads', 'hips'],
      [S('standingquad', 35), S('couch', 50), S('hipflexor', 45), S('figurefour', 45), S('pigeon', 50), S('butterfly', 50)], 10),
    R('r-sa-wrists-5', 'Wrists and Forearms: 5 Minutes', 'standalone', ['wrists', 'shoulders'], ['desk', 'push', 'pull'], 'beginner',
      'Quick holds for the wrists and forearms after gripping or typing.', ['wrists'],
      [S('wristcircles', 40), S('wristext', 30), S('wristflex', 30), S('armcircles', 30), S('crossbody', 20), S('tricepsstretch', 20)], 5),
    R('r-sa-ankles-5', 'Ankles and Calves: 5 Minutes', 'standalone', ['ankles', 'calves'], ['running', 'legs', 'any'], 'beginner',
      'Quick mobility for the ankles and calves.', ['ankles', 'calves'],
      [S('anklecircles', 30), S('kneetowall', 30), S('calfwall', 35), S('calfstep', 30), S('downdog', 40)], 5),
    R('r-sa-chest-10', 'Chest Opener: 10 Minutes', 'standalone', ['chest', 'shoulders', 'thoracic'], ['desk', 'push'], 'beginner',
      'Opens the front of the chest and shoulders.', ['chest', 'shoulders', 'upper back'],
      [S('doorchest', 50), S('chestopener', 40), S('wallangel', 45), S('cobra', 40), S('openbook', 45), S('armcircles', 30), S('tricepsstretch', 35), S('crossbody', 30)], 10),
    R('r-sa-total-15', 'Total Body Flow: 15 Minutes', 'standalone', ['full_body', 'hips', 'thoracic', 'shoulders'], ['any', 'morning'], 'intermediate',
      'A flowing mix of mobility and stretches for the whole body.', ['hips', 'shoulders', 'lower back', 'upper back'],
      [S('catcow', 45), S('threadneedle', 40), S('openbook', 40), S('childs', 50), S('hipflexor', 45), S('lungereach', 40), S('pigeon', 45),
       S('halfsplit', 40), S('downdog', 45), S('doorchest', 40), S('supinetwist', 40)], 15),
    R('r-sa-evening-15', 'Evening Unwind: 15 Minutes', 'standalone', ['lower back', 'hips', 'hamstrings', 'neck', 'shoulders'], ['before_bed'], 'beginner',
      'A slow fifteen-minute wind-down. Quiet lights, slow breathing.', ['lower back', 'hips', 'neck', 'shoulders'],
      [S('neckflex', 40), S('necktilt', 30), S('crossbody', 30), S('childs', 60), S('kneetochest', 60), S('figurefour', 50), S('supinetwist', 45),
       S('supinehamstring', 40), S('butterfly', 60), S('cobra', 30)], 15),
    R('r-sa-lower-20', 'Lower Body Flow: 20 Minutes', 'standalone', ['hips', 'glutes', 'quads', 'hamstrings', 'calves', 'ankles'], ['any', 'legs'], 'intermediate',
      'A long lower body session, good for the day after a hard leg workout.', ['hips', 'quads', 'hamstrings', 'calves', 'ankles'],
      [S('anklecircles', 30), S('kneetowall', 40), S('calfwall', 40), S('calfstep', 35), S('standingquad', 35), S('couch', 55), S('hipflexor', 50),
       S('halfsplit', 45), S('supinehamstring', 45), S('figurefour', 50), S('pigeon', 55), S('butterfly', 60), S('cossack', 30), S('deepsquat', 60), S('kneetochest', 50)], 20),
    R('r-sa-upper-20', 'Upper Body Flow: 20 Minutes', 'standalone', ['neck', 'shoulders', 'chest', 'thoracic', 'wrists', 'upper back'], ['any', 'desk'], 'intermediate',
      'A long upper body session covering the neck, shoulders, chest, back and wrists.', ['neck', 'shoulders', 'chest', 'upper back', 'wrists'],
      [S('chintuck', 30), S('necktilt', 35), S('neckflex', 35), S('armcircles', 40), S('catcow', 45), S('threadneedle', 45), S('openbook', 45),
       S('wallangel', 45), S('doorchest', 50), S('crossbody', 40), S('tricepsstretch', 40), S('chestopener', 40), S('twist', 45), S('wristext', 30), S('wristflex', 30), S('childs', 60)], 20),
    R('r-sa-glutes-10', 'Glutes and Outer Hips: 10 Minutes', 'standalone', ['glutes', 'hips', 'lower back'], ['any', 'before_bed'], 'beginner',
      'Easy holds for the glutes and outer hips.', ['hips', 'lower back'],
      [S('figurefour', 50), S('pigeon', 50), S('supinetwist', 45), S('kneetochest', 45), S('butterfly', 50), S('childs', 45)], 10),
    R('r-sa-desk-15', 'Desk Worker Reset: 15 Minutes', 'standalone', ['neck', 'shoulders', 'chest', 'hips', 'wrists', 'upper back'], ['desk'], 'beginner',
      'A longer break for a desk day: neck, shoulders, chest, hips and wrists.', ['neck', 'shoulders', 'chest', 'hips', 'wrists'],
      [S('chintuck', 30), S('necktilt', 30), S('crossbody', 30), S('tricepsstretch', 30), S('chestopener', 40), S('wallangel', 45), S('standingtwist', 30),
       S('wristext', 25), S('wristflex', 25), S('hipflexor', 45), S('standingquad', 30), S('hugknee', 30), S('catcow', 45)], 15)
  ];

  /* ---- routine search and recommendation ---- */
  function searchRoutines(f) {
    f = f || {};
    var toks = _tokens(f.q), out = [];
    STRETCH_ROUTINES.forEach(function (r) {
      if (f.type && r.type !== f.type) return;
      if (f.bodyArea && r.bodyAreas.indexOf(f.bodyArea) < 0) return;
      if (f.activity && r.activities.indexOf(f.activity) < 0) return;
      if (f.maxMin != null && r.durationMin > f.maxMin) return;
      var rel = 0;
      if (f.stiffness && f.stiffness.length) {
        var hits = f.stiffness.filter(function (s) { return r.forStiffness.indexOf(s) >= 0; }).length;
        if (!hits) return;
        rel += hits * 3;
      }
      if (toks.length) {
        var h = (r.name + ' ' + r.purpose + ' ' + r.bodyAreas.join(' ') + ' ' + r.activities.join(' ').replace(/_/g, ' ')).toLowerCase();
        for (var i = 0; i < toks.length; i++) { if (h.indexOf(toks[i]) < 0) return; rel += 1; }
      }
      out.push({ r: r, rel: rel });
    });
    out.sort(function (a, b) { return (b.rel - a.rel) || (a.r.durationMin - b.r.durationMin) || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0); });
    return out.map(function (x) { return x.r; });
  }

  /* Which routine activities a planned workout implies. */
  function activitiesFor(plan) {
    var kind = (plan && plan.kind) || '', areas = (plan && plan.bodyAreas) || [];
    var acts = [];
    function add(a) { if (acts.indexOf(a) < 0) acts.push(a); }
    var has = function (a) { return areas.indexOf(a) >= 0; };
    if (has('chest') || has('shoulders') || has('arms')) { add('push'); add('upper_body_day'); }
    if (has('back')) { add('pull'); add('upper_body_day'); }
    if (has('legs') || has('glutes')) { add('legs'); add('lower_body_day'); }
    if (has('full_body')) add('full_body');
    if (has('cardio')) { add('running'); add('conditioning'); }
    if (kind === 'conditioning') add('conditioning');
    if (kind === 'cardio') { add('running'); add('conditioning'); }
    if (kind === 'express' || kind === 'home' || kind === 'hotel' || kind === 'bodyweight') add('full_body');
    return acts;
  }
  var PHASE_TYPE = { before: 'dynamic_warmup', after: 'post_workout', standalone: 'standalone' };

  function recommendRoutines(q) {
    q = q || {};
    var phase = q.phase || 'before', type = PHASE_TYPE[phase] || 'dynamic_warmup';
    var plan = q.plannedWorkout || {}, stiff = q.stiffness || [], minutes = q.minutesAvailable;
    var acts = phase === 'standalone' ? [] : activitiesFor(plan), areas = plan.bodyAreas || [];
    var cands = [];
    STRETCH_ROUTINES.forEach(function (r) {
      if (r.type !== type) return;
      if (minutes != null && r.durationMin > minutes) return;
      var actHits = acts.filter(function (a) { return r.activities.indexOf(a) >= 0; });
      var stiffHits = stiff.filter(function (s) { return r.forStiffness.indexOf(s) >= 0; });
      var areaHits = areas.filter(function (a) { return r.bodyAreas.indexOf(a) >= 0; });
      var score = actHits.length * 4 + stiffHits.length * 3 + areaHits.length;
      if (r.activities.indexOf('any') >= 0) score += 0.5;   // generic routines are a fallback
      if (minutes != null) score += (r.durationMin / Math.max(1, minutes)) * 0.5;   // use the time you have, a little
      cands.push({ r: r, score: score, actHits: actHits, stiffHits: stiffHits, areaHits: areaHits });
    });
    cands.sort(function (a, b) { return (b.score - a.score) || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0); });
    return cands.slice(0, 3).map(function (c) {
      var parts = [];
      if (c.actHits.length) parts.push('it is built for ' + c.actHits.map(function (a) { return a.replace(/_/g, ' '); }).join(' and '));
      if (c.stiffHits.length) parts.push('it covers ' + c.stiffHits.join(' and ') + ', which you listed as stiff');
      if (!c.actHits.length && !c.stiffHits.length && c.areaHits.length) parts.push('it covers ' + c.areaHits.slice(0, 3).join(', '));
      if (!parts.length) parts.push('it is a general ' + (phase === 'before' ? 'warm-up' : phase === 'after' ? 'cool-down' : 'routine') + ' with no closer match to your inputs');
      var fit = minutes != null ? ' and fits your ' + minutes + ' minutes at ' + c.r.durationMin : ' and takes about ' + c.r.durationMin + ' minutes';
      return { routine: c.r, score: Math.round(c.score * 100) / 100,
        why: 'Suggested because ' + parts.join(', and ') + fit + '. General mobility only, not treatment for any injury or pain.' };
    });
  }

  /* ============================================================================
     RECOVERY ROUTINES (general relaxation and easy movement, never rehabilitation)
     ========================================================================== */
  var NOTE = 'General relaxation and easy movement. It is not rehabilitation and not a treatment for any injury or condition.';
  function RC(id, name, type, purpose, steps) {
    var total = 0; steps.forEach(function (s) { total += s.seconds; });
    return { id: id, name: name, type: type, durationMin: Math.max(1, Math.round(total / 60)), purpose: purpose,
      steps: steps, notRehab: true, note: NOTE };
  }
  function st(label, seconds, cue, stretchId) { var o = { label: label, seconds: seconds, cue: cue }; if (stretchId) o.stretchId = stretchId; return o; }

  var RECOVERY_ROUTINES = [
    RC('rc-walk-20', 'Easy Walk: 20 Minutes', 'walk', 'A relaxed walk on a rest day or the day after hard training.',
      [st('Easy walk', 1200, 'Comfortable pace, shoulders loose, breathe through your nose if you can.')]),
    RC('rc-walk-30', 'Easy Walk: 30 Minutes', 'walk', 'A longer easy walk, ideally outdoors.',
      [st('Easy walk', 1800, 'Pace stays conversational the whole way.')]),
    RC('rc-walk-10-after-meal', 'Ten-Minute Stroll', 'walk', 'A short, easy walk any time in the day.',
      [st('Easy stroll', 600, 'No target pace. Just move.')]),
    RC('rc-easy-bike-20', 'Easy Spin: 20 Minutes', 'easy_movement', 'Low-effort cycling or cross-trainer work for a recovery day.',
      [st('Warm up', 120, 'Very light resistance.'), st('Easy spin', 960, 'You should be able to chat comfortably.'), st('Cool down', 120, 'Slow the pedals gradually.')]),
    RC('rc-gentle-mobility-10', 'Gentle Mobility: 10 Minutes', 'gentle_mobility', 'Easy movement through the spine, hips and shoulders.',
      [st('Cat-cow', 60, 'Move with the breath.', 'catcow'), st('Thread the needle', 90, 'Slow, each side.', 'threadneedle'), st('Open book', 90, 'Follow the hand with your eyes.', 'openbook'),
       st('Half-kneeling hip flexor', 90, 'Gentle, each side.', 'hipflexor'), st('Child\'s pose', 60, 'Breathe into the back of the ribs.', 'childs'),
       st('Knees to chest', 60, 'Hug in and let go.', 'kneetochest'), st('Walking knee hug', 60, 'Easy balance.', 'hugknee'), st('Arm circles', 30, 'Small to big.', 'armcircles')]),
    RC('rc-full-body-gentle-15', 'Full Body Gentle Flow: 15 Minutes', 'gentle_mobility', 'A slow, whole-body flow for a rest day.',
      [st('Pelvic tilt', 45, 'Small and slow.', 'pelvictilt'), st('Cat-cow', 60, 'Smooth.', 'catcow'), st('Thread the needle', 90, 'Each side.', 'threadneedle'),
       st('Child\'s pose', 60, 'Settle.', 'childs'), st('Half-kneeling hip flexor', 90, 'Each side.', 'hipflexor'), st('Lying figure-four', 90, 'Each side.', 'figurefour'),
       st('Knees to chest', 60, 'Easy.', 'kneetochest'), st('Lying knee drop twist', 90, 'Each side.', 'supinetwist'), st('Chest opener', 40, 'Tall chest.', 'chestopener'),
       st('Neck side tilt', 60, 'No pulling.', 'necktilt'), st('Ankle circles', 60, 'Each foot.', 'anklecircles'), st('Slow breathing', 120, 'Lie still, in through the nose, out a little longer.'), st('Rest', 120, 'Lie still and let go.')]),
    RC('rc-breathing-5', 'Slow Breathing: 5 Minutes', 'breathing', 'Slow, relaxed breathing to settle after a busy day or hard session.',
      [st('Settle', 60, 'Lie or sit comfortably, hands on the belly.'), st('Slow breaths', 180, 'Breathe in through the nose for about 4 seconds, out for about 6. Keep it easy.'),
       st('Rest', 60, 'Breathe normally and notice how you feel.')]),
    RC('rc-breathing-10', 'Slow Breathing: 10 Minutes', 'breathing', 'A longer slow-breathing session lying down.',
      [st('Settle', 120, 'Lie on your back, knees bent if that is comfortable.'), st('Belly breathing', 240, 'Let the belly rise as you breathe in. Out a little longer than in.'),
       st('Rib breathing', 180, 'Hands on the lower ribs and feel them widen.'), st('Rest', 60, 'Let the breathing go back to normal.')]),
    RC('rc-relaxation-10', 'Tense and Release: 10 Minutes', 'relaxation', 'Tense and release each part of the body in turn.',
      [st('Settle', 60, 'Lie down and close your eyes.'), st('Feet and calves', 90, 'Squeeze for 5 seconds, release for 20.'), st('Thighs and glutes', 90, 'Squeeze, release, notice the difference.'),
       st('Belly and chest', 90, 'Squeeze gently, release.'), st('Hands and arms', 90, 'Make fists, release.'), st('Shoulders and face', 90, 'Shrug up, release. Soften the jaw.'),
       st('Rest', 90, 'Lie still and breathe slowly.')]),
    RC('rc-sleep-winddown-15', 'Sleep Wind-Down: 15 Minutes', 'relaxation', 'A quiet routine to switch off before bed. Screens off, lights low.',
      [st('Lights low', 60, 'Put screens away.'), st('Neck forward tilt', 60, 'Let the head hang, no pulling.', 'neckflex'), st('Child\'s pose', 90, 'Breathe slowly.', 'childs'),
       st('Knees to chest', 90, 'Easy rocking if you like.', 'kneetochest'), st('Lying knee drop twist', 120, 'Each side.', 'supinetwist'), st('Lying figure-four', 120, 'Each side.', 'figurefour'),
       st('Slow breathing', 240, 'In through the nose, out slowly. Let your body get heavy.'), st('Rest', 120, 'Stay still and let go of the day.')]),
    RC('rc-morning-reset-5', 'Morning Reset: 5 Minutes', 'gentle_mobility', 'Five easy minutes to get moving in the morning.',
      [st('Cat-cow', 60, 'Wake the spine up.', 'catcow'), st('Child\'s pose', 45, 'Breathe.', 'childs'), st('Arm circles', 40, 'Big and easy.', 'armcircles'),
       st('Walking knee hug', 60, 'Each leg.', 'hugknee'), st('Standing trunk rotation', 45, 'Loose arms.', 'standingtwist'), st('Slow breaths', 50, 'Three deep breaths and a stretch.')]),
    RC('rc-rest-day-checklist', 'Rest Day Checklist', 'easy_movement', 'A simple checklist for an easy day: move a little, eat, drink, sleep.',
      [st('Easy walk', 900, 'Aim for 15 to 30 minutes, easy pace.'), st('Gentle mobility', 300, 'A few minutes of cat-cow and hips.', 'catcow'),
       st('Eat and drink', 60, 'Regular meals with some protein, and water through the day.'), st('Plan tomorrow', 60, 'Decide what you will train next and when.'),
       st('Wind down', 60, 'Set a consistent bedtime, screens off for a while before it.')]),
    RC('rc-post-hard-day-walk', 'Day-After Easy Walk and Mobility', 'easy_movement', 'An easy walk with a few easy mobility moves after a hard session.',
      [st('Easy walk', 900, 'Easy and unhurried.'), st('Ankle circles', 60, 'Each foot.', 'anklecircles'), st('Walking knee hug', 60, 'Easy.', 'hugknee'),
       st('Knee-to-wall ankle rock', 60, 'Each side.', 'kneetowall'), st('Child\'s pose', 60, 'Breathe.', 'childs'), st('Knees to chest', 60, 'Settle.', 'kneetochest')]),
    RC('rc-gentle-hips-10', 'Gentle Hips: 10 Minutes', 'gentle_mobility', 'Easy hip movement for a desk-heavy or leg-heavy day.',
      [st('Pelvic tilt', 45, 'Small and slow.', 'pelvictilt'), st('Half-kneeling hip flexor', 90, 'Each side.', 'hipflexor'), st('Lying figure-four', 90, 'Each side.', 'figurefour'),
       st('Butterfly', 60, 'Let the knees fall.', 'butterfly'), st('Side lunge', 60, 'Easy, each side.', 'cossack'), st('Knees to chest', 60, 'Settle.', 'kneetochest'),
       st('Deep squat hold', 60, 'Hold a rail if you like.', 'deepsquat'), st('Slow breathing', 120, 'Lie down and breathe slowly.')]),
    RC('rc-desk-breath-3', 'Three-Minute Desk Breather', 'breathing', 'A very short breathing and shoulder reset at your desk.',
      [st('Sit tall', 20, 'Feet flat, shoulders down.'), st('Slow breaths', 120, 'In through the nose, out a little longer.'), st('Shoulder and neck release', 40, 'Roll the shoulders back and let the head tilt side to side.', 'necktilt')])
  ];
  function searchRecovery(f) {
    f = f || {};
    var toks = _tokens(f.q), out = [];
    RECOVERY_ROUTINES.forEach(function (r) {
      if (f.type && r.type !== f.type) return;
      if (f.maxMin != null && r.durationMin > f.maxMin) return;
      if (f.minMin != null && r.durationMin < f.minMin) return;
      if (toks.length) {
        var h = (r.name + ' ' + r.purpose + ' ' + r.type.replace(/_/g, ' ')).toLowerCase();
        for (var i = 0; i < toks.length; i++) if (h.indexOf(toks[i]) < 0) return;
      }
      out.push(r);
    });
    out.sort(function (a, b) { return (a.durationMin - b.durationMin) || (a.id < b.id ? -1 : 1); });
    return out;
  }

  /* ============================================================================
     STATS
     ========================================================================== */
  function _count(arr, fn) { var o = {}; arr.forEach(function (x) { var k = fn(x); o[k] = (o[k] || 0) + 1; }); return o; }
  function libraryStats() {
    var goals = {}; GOALS.forEach(function (g) { goals[g] = WORKOUTS.filter(function (w) { return w.goals.indexOf(g) >= 0; }).length; });
    var durs = WORKOUTS.map(function (w) { return w.durationMin; });
    return {
      workouts: WORKOUTS.length,
      workoutsByKind: _count(WORKOUTS, function (w) { return w.kind; }),
      workoutsByDifficulty: _count(WORKOUTS, function (w) { return w.difficulty; }),
      workoutsByGoal: goals,
      workoutsAtOrUnder20Min: WORKOUTS.filter(function (w) { return w.durationMin <= 20; }).length,
      durationRangeMin: [Math.min.apply(null, durs), Math.max.apply(null, durs)],
      libraryExercises: Object.keys(_ex).filter(function (k) { return _ex[k].libraryOnly; }).length,
      stretches: _st.length,
      routines: STRETCH_ROUTINES.length,
      routinesByType: _count(STRETCH_ROUTINES, function (r) { return r.type; }),
      recoveryRoutines: RECOVERY_ROUTINES.length,
      recoveryByType: _count(RECOVERY_ROUTINES, function (r) { return r.type; })
    };
  }

  var API = {
    WORKOUTS: WORKOUTS, STRETCH_ROUTINES: STRETCH_ROUTINES, RECOVERY_ROUTINES: RECOVERY_ROUTINES,
    estimateDurationMin: estimateDurationMin, hardSets: hardSets, workoutMuscles: workoutMuscles,
    searchWorkouts: searchWorkouts, routineSeconds: routineSeconds, searchRoutines: searchRoutines,
    recommendRoutines: recommendRoutines, searchRecovery: searchRecovery, libraryStats: libraryStats,
    requiredEquipmentForExercise: requiredEquipmentForExercise,
    VOCAB: { KINDS: KINDS, GOALS: GOALS, EQUIPMENT: EQUIPMENT, BODY_AREAS: BODY_AREAS, DIFFICULTIES: DIFFICULTIES,
      STRUCTURES: STRUCTURES, ROUTINE_TYPES: ROUTINE_TYPES, ACTIVITIES: ACTIVITIES, STIFFNESS: STIFFNESS, RECOVERY_TYPES: RECOVERY_TYPES }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) { Object.keys(API).forEach(function (k) { root[k] = API[k]; }); }
})(typeof window !== 'undefined' ? window : null);
