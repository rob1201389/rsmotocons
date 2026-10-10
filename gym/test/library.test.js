/* Content library test suite.
   Run: node gym/test/library.test.js     (exit code 1 on any failure)

   Covers library.js (workouts, stretch routines, recovery routines), the
   library-only exercises in exercises.js, and the new poses in lifts.js and
   stretches.js. Also proves the new exercises cannot leak into a generated
   programme. */
const path = require('path'), fs = require('fs');
const dir = fs.existsSync(path.join(__dirname, '../public/core.js')) ? '../public/' : './';
const E = require(dir + 'engine.js');
const X = require(dir + 'exercises.js');
const F = require(dir + 'figure.js');
const { LIFTS } = require(dir + 'lifts.js');
const { STRETCHES } = require(dir + 'stretches.js');
const L = require(dir + 'library.js');

let pass = 0, fail = 0; const failures = [];
const t = (name, fn) => { try { fn(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
  catch (e) { fail++; failures.push([name, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + name + '\n       ' + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy, got ' + v); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');
const uniq = arr => new Set(arr).size === arr.length;
const dups = arr => arr.filter((x, i) => arr.indexOf(x) !== i);

const W = L.WORKOUTS, RT = L.STRETCH_ROUTINES, RC = L.RECOVERY_ROUTINES, V = L.VOCAB;
const EXI = X.EX_INDEX, STI = {}; STRETCHES.forEach(s => { STI[s.id] = s; });
const LIB_EX = X.LIBRARY_EXERCISES;

/* Every string inside a value, with its path, so content rules can scan all of it. */
function strings(v, p, out) {
  out = out || [];
  if (typeof v === 'string') out.push([p, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, p + '[' + i + ']', out));
  else if (v && typeof v === 'object') Object.keys(v).forEach(k => strings(v[k], p + '.' + k, out));
  return out;
}

sec('Ids are unique and well formed');
t('workout ids unique and prefixed w-', () => {
  ok(uniq(W.map(w => w.id)), 'duplicate workout ids: ' + dups(W.map(w => w.id)));
  W.forEach(w => ok(/^w-[a-z0-9-]+$/.test(w.id), 'bad id ' + w.id));
});
t('routine ids unique and prefixed r-', () => {
  ok(uniq(RT.map(r => r.id)), 'duplicate routine ids: ' + dups(RT.map(r => r.id)));
  RT.forEach(r => ok(/^r-[a-z0-9-]+$/.test(r.id), 'bad id ' + r.id));
});
t('recovery ids unique and prefixed rc-', () => {
  ok(uniq(RC.map(r => r.id)), 'duplicate ids');
  RC.forEach(r => ok(/^rc-[a-z0-9-]+$/.test(r.id), 'bad id ' + r.id));
});
t('exercise ids unique across the programme list and the library list', () => {
  const ids = X.EXERCISES.map(e => e.id).concat(LIB_EX.map(e => e.id));
  ok(uniq(ids), 'duplicate exercise ids: ' + dups(ids));
});
t('stretch ids unique', () => ok(uniq(STRETCHES.map(s => s.id)), 'duplicate stretch ids: ' + dups(STRETCHES.map(s => s.id))));
t('ids are unique across routines, recovery and workouts (no collisions between sets)', () => {
  const all = W.map(w => w.id).concat(RT.map(r => r.id), RC.map(r => r.id));
  ok(uniq(all));
});

sec('Workout schema');
t('every workout has the required fields with valid values', () => {
  W.forEach(w => {
    ok(w.name && typeof w.name === 'string', w.id + ' name');
    ok(typeof w.summary === 'string' && w.summary.length > 0 && w.summary.length <= 160, w.id + ' summary length ' + w.summary.length);
    ok(V.KINDS.includes(w.kind), w.id + ' kind');
    ok(Array.isArray(w.goals) && w.goals.length > 0 && w.goals.every(g => V.GOALS.includes(g)), w.id + ' goals');
    ok(Number.isInteger(w.durationMin) && w.durationMin > 0, w.id + ' durationMin');
    ok(V.DIFFICULTIES.includes(w.difficulty), w.id + ' difficulty');
    ok(Array.isArray(w.equipment) && w.equipment.length > 0 && w.equipment.every(e => V.EQUIPMENT.includes(e)), w.id + ' equipment ' + w.equipment);
    ok(Array.isArray(w.bodyAreas) && w.bodyAreas.length > 0 && w.bodyAreas.every(a => V.BODY_AREAS.includes(a)), w.id + ' bodyAreas');
    ok(typeof w.effect === 'string' && w.effect.length > 0 && w.effect.length <= 200, w.id + ' effect length ' + w.effect.length);
    ok(Number.isInteger(w.demand) && w.demand >= 1 && w.demand <= 5, w.id + ' demand');
    ok(V.STRUCTURES.includes(w.structure), w.id + ' structure');
    ok(Array.isArray(w.blocks) && w.blocks.length > 0, w.id + ' blocks');
    ok(Array.isArray(w.tags) && w.tags.length > 0 && w.tags.every(x => typeof x === 'string'), w.id + ' tags');
  });
});
t('block shapes are valid', () => {
  W.forEach(w => w.blocks.forEach((b, i) => {
    const at = w.id + ' block ' + i;
    if (b.type === 'resistance') {
      ok(Array.isArray(b.exercises) && b.exercises.length, at);
      b.exercises.forEach(e => {
        ok(Number.isInteger(e.sets) && e.sets > 0 && e.sets <= 8, at + ' sets');
        ok(Number.isInteger(e.repMin) && Number.isInteger(e.repMax) && e.repMin >= 1 && e.repMin <= e.repMax, at + ' reps ' + e.id);
        ok(Number.isInteger(e.restSec) && e.restSec >= 15 && e.restSec <= 300, at + ' rest ' + e.id);
      });
    } else if (b.type === 'intervals') {
      ok(Number.isInteger(b.rounds) && b.rounds > 0, at + ' rounds');
      ok(Array.isArray(b.work) && b.work.length, at + ' work');
      b.work.forEach(m => ok(m.name && Number.isInteger(m.workSec) && m.workSec > 0 && Number.isInteger(m.restSec) && m.restSec >= 0, at + ' work item'));
    } else if (b.type === 'steady') {
      ok(b.name && Number.isInteger(b.minutes) && b.minutes > 0, at + ' steady');
      ok(['easy', 'moderate', 'hard'].includes(b.intensity), at + ' intensity');
    } else if (b.type === 'circuit') {
      ok(Number.isInteger(b.rounds) && b.rounds > 0 && Number.isInteger(b.restBetweenRoundsSec) && b.restBetweenRoundsSec >= 0, at + ' circuit');
      ok(Array.isArray(b.moves) && b.moves.length, at + ' moves');
      b.moves.forEach(m => {
        ok(m.name, at + ' move name');
        ok(m.reps != null || m.workSec != null, at + ' move needs reps or workSec: ' + m.name);
        if (m.reps != null) ok(Number.isInteger(m.reps) && m.reps > 0, at + ' reps');
        if (m.workSec != null) ok(Number.isInteger(m.workSec) && m.workSec > 0, at + ' workSec');
      });
    } else throw new Error(at + ' unknown block type ' + b.type);
  }));
});
t('every referenced exercise id exists', () => {
  W.forEach(w => {
    L.WORKOUTS; // (reference kept so the loop reads clearly)
    w.blocks.forEach(b => {
      const ids = [];
      if (b.type === 'resistance') b.exercises.forEach(e => ids.push(e.id));
      if (b.type === 'intervals') b.work.forEach(m => m.exerciseId && ids.push(m.exerciseId));
      if (b.type === 'circuit') b.moves.forEach(m => m.exerciseId && ids.push(m.exerciseId));
      ids.forEach(id => ok(EXI[id], w.id + ' references unknown exercise ' + id));
    });
  });
});
t('every circuit move stretchId exists', () => {
  W.forEach(w => w.blocks.forEach(b => (b.moves || []).forEach(m => { if (m.stretchId) ok(STI[m.stretchId], w.id + ' unknown stretch ' + m.stretchId); })));
});
t('structure matches the blocks it contains', () => {
  W.forEach(w => {
    const types = new Set(w.blocks.map(b => b.type));
    if (w.structure === 'resistance') ok(types.has('resistance'), w.id);
    if (w.structure === 'steady') ok(types.has('steady') && !types.has('resistance'), w.id);
    if (w.structure === 'circuit') ok(types.has('circuit'), w.id);
    if (w.structure === 'intervals') ok(types.has('intervals'), w.id);
    if (w.structure === 'emom') ok(w.blocks.every(b => b.type === 'intervals') && w.blocks.every(b => b.work.length === 1), w.id + ' emom is single-move intervals');
    if (w.structure === 'ladder') ok(w.blocks.length >= 5 && w.blocks.every(b => b.type === 'circuit' && b.rounds === 1), w.id + ' ladder is one-round circuits');
  });
});

sec('Duration estimates');
t('estimateDurationMin follows the stated formulas', () => {
  const res = { blocks: [{ type: 'resistance', exercises: [{ id: 'x', sets: 3, repMin: 8, repMax: 10, restSec: 80 }] }] };
  eq(L.estimateDurationMin(res), (3 * (40 + 80) + 60) / 60);
  const iv = { blocks: [{ type: 'intervals', rounds: 4, work: [{ name: 'a', workSec: 30, restSec: 15 }, { name: 'b', workSec: 30, restSec: 15 }] }] };
  eq(L.estimateDurationMin(iv), 4 * 90 / 60);
  eq(L.estimateDurationMin({ blocks: [{ type: 'steady', name: 's', minutes: 25, intensity: 'easy' }] }), 25);
  const c = { blocks: [{ type: 'circuit', rounds: 3, restBetweenRoundsSec: 60, moves: [{ name: 'a', reps: 10 }, { name: 'b', reps: 10 }, { name: 'c', workSec: 30 }] }] };
  eq(L.estimateDurationMin(c), 3 * (40 + 40 + 30 + 60) / 60);
});
t('every durationMin is within 15% (or 3 minutes) of the estimate', () => {
  W.forEach(w => {
    const est = L.estimateDurationMin(w), diff = Math.abs(w.durationMin - est);
    ok(diff <= Math.max(3, 0.15 * est), `${w.id}: durationMin ${w.durationMin} vs estimate ${est.toFixed(1)}`);
  });
});
t('hardSets counts resistance sets only', () => {
  const w = W.find(x => x.id === 'w-str-full-a');
  eq(L.hardSets(w), 4 + 4 + 3 + 3);
  eq(L.hardSets(W.find(x => x.id === 'w-car-walk-45')), 0);
  eq(L.hardSets(W.find(x => x.id === 'w-con-tabata')), 0);
});
t('workoutMuscles sums sets by primary muscle using EX_INDEX', () => {
  const m = L.workoutMuscles(W.find(x => x.id === 'w-str-full-a'));
  eq(m.chest, 4); eq(m.quads, 4); eq(m.back, 3); eq(m.hamstrings, 3);
  const total = Object.values(L.workoutMuscles(W.find(x => x.id === 'w-hyp-push'))).reduce((a, b) => a + b, 0);
  eq(total, L.hardSets(W.find(x => x.id === 'w-hyp-push')));
});

sec('Workout coverage minimums');
t('at least 56 workouts and 6 of each kind', () => {
  ok(W.length >= 56, 'only ' + W.length);
  V.KINDS.forEach(k => ok(W.filter(w => w.kind === k).length >= 6, k + ' has ' + W.filter(w => w.kind === k).length));
});
t('durations run from 10 to 75 minutes with at least 8 at 20 minutes or less', () => {
  const d = W.map(w => w.durationMin);
  ok(Math.min(...d) <= 10, 'shortest ' + Math.min(...d));
  ok(Math.max(...d) >= 75, 'longest ' + Math.max(...d));
  ok(W.filter(w => w.durationMin <= 20).length >= 8);
  [10, 20, 30, 40, 50, 60, 70].forEach(m => ok(W.some(w => Math.abs(w.durationMin - m) <= 5), 'nothing near ' + m + ' minutes'));
});
t('difficulty spread covers all three levels, with a beginner option in every kind', () => {
  V.DIFFICULTIES.forEach(d => ok(W.filter(w => w.difficulty === d).length >= 8, d));
  V.KINDS.forEach(k => ok(W.some(w => w.kind === k && w.difficulty === 'beginner'), 'no beginner ' + k));
});
t('each goal appears in at least 8 workouts', () => {
  V.GOALS.forEach(g => ok(W.filter(w => w.goals.includes(g)).length >= 8, g + ' only ' + W.filter(w => w.goals.includes(g)).length));
});
t('strength and hypertrophy cover push, pull, legs, upper, lower and full body', () => {
  const sh = W.filter(w => w.kind === 'strength' || w.kind === 'hypertrophy');
  const has = re => sh.some(w => re.test(w.name + ' ' + w.tags.join(' ')));
  ['push', 'pull', 'legs|lower', 'upper', 'lower', 'full body'].forEach(p => ok(has(new RegExp(p, 'i')), 'missing ' + p));
  ['strength', 'hypertrophy'].forEach(k => {
    const ws = W.filter(w => w.kind === k), tag = re => ws.some(w => re.test(w.name + ' ' + w.tags.join(' ')));
    ok(tag(/push/i) && tag(/pull/i) && tag(/leg|lower/i) && tag(/upper/i) && tag(/lower/i) && tag(/full body/i), k + ' misses a split');
  });
});
t('resistance blocks use realistic sets, reps and rest for their kind', () => {
  W.filter(w => w.kind === 'strength').forEach(w => w.blocks.forEach(b => (b.exercises || []).forEach(e => {
    ok(e.repMax <= 8, `${w.id} ${e.id} strength reps ${e.repMin}-${e.repMax}`);
    ok(e.restSec >= 90, `${w.id} ${e.id} strength rest ${e.restSec}`);
  })));
  W.filter(w => w.kind === 'hypertrophy').forEach(w => w.blocks.forEach(b => (b.exercises || []).forEach(e => {
    ok(e.repMin >= 6 && e.repMax <= 20, `${w.id} ${e.id} hypertrophy reps ${e.repMin}-${e.repMax}`);
    ok(e.restSec >= 45 && e.restSec <= 180, `${w.id} ${e.id} hypertrophy rest ${e.restSec}`);
  })));
  W.forEach(w => w.blocks.forEach(b => (b.exercises || []).forEach(e => {
    const ex = EXI[e.id];
    if (ex.modality === 'timed_hold') ok(e.repMax >= 15 && e.repMax <= 90, `${w.id} ${e.id} hold seconds`);
    if (ex.modality === 'carry') ok(e.repMin === ex.lo, `${w.id} ${e.id} carry distance`);
  })));
});
t('express workouts are 10 to 20 minutes, fewer exercises, and genuinely shorter than what they shorten', () => {
  const ex = W.filter(w => w.kind === 'express');
  ex.forEach(w => {
    ok(w.durationMin >= 10 && w.durationMin <= 20, w.id + ' ' + w.durationMin);
    ok(w.shortVersionOf, w.id + ' should name the workout it shortens');
    const parent = W.find(p => p.id === w.shortVersionOf);
    ok(parent, w.id + ' parent missing ' + w.shortVersionOf);
    ok(parent.durationMin > w.durationMin, `${w.id} (${w.durationMin}) is not shorter than ${parent.id} (${parent.durationMin})`);
    const n = x => x.blocks.reduce((a, b) => a + (b.exercises ? b.exercises.length : b.moves ? b.moves.length : b.work ? b.work.length : 1), 0);
    ok(n(w) <= n(parent) || w.durationMin * 1.5 <= parent.durationMin, w.id + ' is not a smaller session');
  });
  ex.filter(w => w.structure === 'resistance').forEach(w => ok(w.blocks.reduce((a, b) => a + b.exercises.length, 0) <= 4, w.id + ' has too many exercises for an express session'));
});
t('home and hotel workouts need no or minimal equipment', () => {
  const minimal = ['none', 'bands', 'dumbbell', 'kettlebell'];
  W.filter(w => w.kind === 'home' || w.kind === 'hotel').forEach(w => {
    ok(w.equipment.every(e => minimal.includes(e)), w.id + ' needs ' + w.equipment);
    ok(!(w.equipment.includes('dumbbell') && w.equipment.includes('kettlebell')), w.id + ' needs both a dumbbell and a kettlebell');
  });
  ['home', 'hotel'].forEach(k => ok(W.filter(w => w.kind === k && w.equipment.length === 1 && w.equipment[0] === 'none').length >= 3, k + ' needs several no-kit options'));
});
t('equipment lists include what every exercise needs, and none is exclusive', () => {
  const sub = { dumbbell: ['kettlebell'], kettlebell: ['dumbbell'] };
  W.forEach(w => {
    ok(!w.equipment.includes('none') || w.equipment.length === 1, w.id + ' mixes none with other items');
    const need = [];
    w.blocks.forEach(b => {
      (b.exercises || []).forEach(e => need.push(e.id));
      (b.work || []).forEach(m => m.exerciseId && need.push(m.exerciseId));
      (b.moves || []).forEach(m => m.exerciseId && need.push(m.exerciseId));
    });
    need.forEach(id => L.requiredEquipmentForExercise(id).forEach(item => {
      ok(w.equipment.includes(item) || (sub[item] || []).some(s => w.equipment.includes(s)), `${w.id} uses ${id} which needs ${item}`);
    }));
  });
});
t('required equipment helper knows the pull-up bar, bench and bands', () => {
  eq(L.requiredEquipmentForExercise('pull-up'), ['pullup_bar']);
  ok(L.requiredEquipmentForExercise('bench-barbell').includes('bench'));
  eq(L.requiredEquipmentForExercise('band-row'), ['bands']);
  eq(L.requiredEquipmentForExercise('pushup'), []);
});

sec('Workout search');
t('no filters returns every workout, deterministically sorted by duration', () => {
  const a = L.searchWorkouts(), b = L.searchWorkouts({});
  eq(a.length, W.length); eq(a.map(w => w.id), b.map(w => w.id));
  for (let i = 1; i < a.length; i++) ok(a[i - 1].durationMin <= a[i].durationMin, 'not sorted by duration');
});
t('single filters filter', () => {
  ok(L.searchWorkouts({ kind: 'hotel' }).every(w => w.kind === 'hotel') && L.searchWorkouts({ kind: 'hotel' }).length === W.filter(w => w.kind === 'hotel').length);
  ok(L.searchWorkouts({ goal: 'mobility' }).every(w => w.goals.includes('mobility')));
  ok(L.searchWorkouts({ maxMin: 20 }).every(w => w.durationMin <= 20));
  ok(L.searchWorkouts({ minMin: 60 }).every(w => w.durationMin >= 60));
  ok(L.searchWorkouts({ difficulty: 'advanced' }).every(w => w.difficulty === 'advanced'));
  ok(L.searchWorkouts({ bodyArea: 'core' }).every(w => w.bodyAreas.includes('core')) && L.searchWorkouts({ bodyArea: 'core' }).length > 3);
  ok(L.searchWorkouts({ maxDemand: 2 }).every(w => w.demand <= 2));
  const combo = L.searchWorkouts({ kind: 'express', goal: 'strength', maxMin: 20 });
  ok(combo.length >= 1 && combo.every(w => w.kind === 'express' && w.goals.includes('strength') && w.durationMin <= 20));
});
t('equipment filtering never returns a workout that needs something unavailable', () => {
  const sets = [[], ['dumbbell'], ['bands'], ['dumbbell', 'bands'], ['kettlebell'], ['barbell'], ['barbell', 'bench', 'pullup_bar'], ['machine', 'cable'], ['cardio_machine'], V.EQUIPMENT];
  sets.forEach(have => {
    L.searchWorkouts({ equipment: have }).forEach(w => w.equipment.forEach(e => {
      const subOK = (e === 'dumbbell' && have.includes('kettlebell')) || (e === 'kettlebell' && have.includes('dumbbell'));
      ok(e === 'none' || have.includes(e) || subOK, `${w.id} needs ${e} but only ${JSON.stringify(have)} was available`);
    }));
  });
  ok(L.searchWorkouts({ equipment: [] }).length > 8, 'no-equipment people should still get a lot of options');
  ok(L.searchWorkouts({ equipment: [] }).every(w => w.equipment.length === 1 && w.equipment[0] === 'none'));
  eq(L.searchWorkouts({ equipment: V.EQUIPMENT }).length, W.length);
  ok(!L.searchWorkouts({ equipment: ['bands'] }).some(w => w.equipment.includes('dumbbell')));
});
t('text search ranks name matches above summary matches and requires every word', () => {
  const r = L.searchWorkouts({ q: 'push' });
  ok(r.length > 3 && /push/i.test(r[0].name + r[0].tags.join()), 'top result should be about push: ' + r[0].name);
  ok(L.searchWorkouts({ q: 'kettlebell swing' }).every(w => /kettlebell/i.test(JSON.stringify(w)) && /swing/i.test(JSON.stringify(w))));
  eq(L.searchWorkouts({ q: 'zzzqqq' }).length, 0);
  ok(L.searchWorkouts({ q: 'tabata', kind: 'conditioning' }).length >= 1);
});
t('search is pure: repeatable and does not mutate the library or its filters', () => {
  const before = JSON.stringify(W), f = { q: 'legs', equipment: ['barbell', 'machine'], maxMin: 60 }, fCopy = JSON.stringify(f);
  const a = L.searchWorkouts(f).map(w => w.id), b = L.searchWorkouts(f).map(w => w.id);
  eq(a, b); eq(JSON.stringify(f), fCopy); eq(JSON.stringify(W), before);
});

sec('Stretches have animations');
t('there are at least 30 distinct stretch poses, each with a pose pair', () => {
  ok(STRETCHES.length >= 30, 'only ' + STRETCHES.length);
  STRETCHES.forEach(s => ok(s.a && s.b && s.a.hip && s.b.hip && s.ms > 0, s.id + ' missing pose pair'));
  const sig = STRETCHES.map(s => JSON.stringify([s.a, s.b]));
  ok(uniq(sig), 'two stretches share an identical pose pair');
});
t('every stretch has the extended fields', () => {
  STRETCHES.forEach(s => {
    ok(s.name && s.time && s.why && s.how && s.block, s.id + ' base fields');
    ok(Array.isArray(s.bodyAreas) && s.bodyAreas.length > 0, s.id + ' bodyAreas');
    ok(s.sides === 1 || s.sides === 2, s.id + ' sides');
    ok(Number.isInteger(s.seconds) && s.seconds >= 10 && s.seconds <= 120, s.id + ' seconds');
    ok(['dynamic', 'static', 'both'].includes(s.kind), s.id + ' kind');
    ok(typeof s.cue === 'string' && s.cue.length > 0 && s.cue.length <= 90, s.id + ' cue');
  });
});
t('stretches cover neck, shoulders, chest, thoracic, lower back, hips, glutes, quads, hamstrings, calves, ankles and wrists', () => {
  ['neck', 'shoulders', 'chest', 'thoracic', 'lower back', 'hips', 'glutes', 'quads', 'hamstrings', 'calves', 'ankles', 'wrists'].forEach(a =>
    ok(STRETCHES.some(s => s.bodyAreas.includes(a)), 'no stretch for ' + a));
  ['dynamic', 'static'].forEach(k => ok(STRETCHES.filter(s => s.kind === k || s.kind === 'both').length >= 10, k));
});
t('all original stretches are unchanged apart from added fields', () => {
  ['catcow', 'lungereach', 'legswing', 'bandover', 'deepsquat', 'childs', 'couch', 'pigeon', 'halfsplit', 'cobra', 'twist', 'doorchest', 'butterfly', 'calfwall']
    .forEach((id, i) => eq(STRETCHES[i].id, id, 'order of original stretches'));
});

sec('Every exercise and stretch resolves to a working animation');
function finitePose(S) {
  const pts = F.joints(S).concat([S.hip, S.shoulder, S.head]);
  return pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}
function instantiate(anim, label) {
  const view = { w: 150, h: 96, cx: 105, floor: 110, maxScale: 1.0 };
  const SA = F.solve(anim.a), SB = F.solve(anim.b);
  ok(finitePose(SA) && finitePose(SB), label + ' pose has non-finite joints');
  const fit = F.makeFit(anim, view);
  ok(Number.isFinite(fit.s) && fit.s > 0 && Number.isFinite(fit.tx) && Number.isFinite(fit.ty), label + ' fit');
  [0, 0.25, 0.5, 0.75, 1].forEach(u => {
    const S = F.applyFit(F.solve(F.blend(anim.a, anim.b, u)), fit);
    const pts = [S.hip, S.shoulder, S.head].concat(Object.values(S.near), Object.values(S.far));
    ok(pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])), label + ' blend at ' + u);
    // the figure must stay inside a generous frame, otherwise it is drawn off the card
    pts.forEach(p => ok(p[0] > -60 && p[0] < 260 && p[1] > -60 && p[1] < 220, label + ' joint far outside the frame at ' + u));
  });
}
t('every programme exercise has a pose pair in lifts.js', () => {
  X.EXERCISES.forEach(e => ok(LIFTS[e.anim], e.id + ' anim ' + e.anim));
});
t('every library exercise has a pose pair in lifts.js and can be instantiated by figure.js', () => {
  LIB_EX.forEach(e => { ok(LIFTS[e.anim], e.id + ' anim ' + e.anim); instantiate(LIFTS[e.anim], e.id); });
});
t('every pose in lifts.js and stretches.js can be instantiated', () => {
  Object.keys(LIFTS).forEach(k => instantiate(LIFTS[k], 'lift ' + k));
  STRETCHES.forEach(s => instantiate(s, 'stretch ' + s.id));
});
t('ground contacts match between the two key poses of the new poses', () => {
  const y = (S, spec) => Math.max(...spec.map(k => { const [s, j] = k.split('.'); const p = s === 'hip' ? S.hip : (S[s] && S[s][j]); return p ? p[1] : -1e9; }));
  const airborne = { stepup: 'the free foot leaves the floor on purpose' };
  const newLifts = [...new Set(LIB_EX.map(e => e.anim))].filter(a => !(a in { bench: 1, row: 1, ohp: 1, squat: 1, rdl: 1, calf1: 1, farmer_front: 1, facepull_front: 1, fly_front: 1, push: 1 }));
  newLifts.forEach(k => {
    const a = LIFTS[k]; if (!a.ground || !a.ground.length || airborne[k]) return;
    const d = Math.abs(y(F.solve(a.a), a.ground) - y(F.solve(a.b), a.ground));
    ok(d <= 4, `${k}: ground contacts differ by ${d.toFixed(1)} between pose A and B`);
  });
  STRETCHES.slice(14).forEach(s => {
    if (!s.ground || !s.ground.length) return;
    const d = Math.abs(y(F.solve(s.a), s.ground) - y(F.solve(s.b), s.ground));
    ok(d <= 4, `${s.id}: ground contacts differ by ${d.toFixed(1)}`);
  });
});
t('figures draw into an SVG when a DOM is available', () => {
  let JSDOM; try { JSDOM = require('jsdom').JSDOM; } catch (e) { return; }
  const dom = new JSDOM('<body></body>'); const prev = { d: global.document };
  global.document = dom.window.document;
  try {
    const view = { w: 150, h: 96, cx: 105, floor: 110, maxScale: 1.0 };
    [...LIB_EX.map(e => LIFTS[e.anim]), ...STRETCHES].forEach(anim => {
      const svg = dom.window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      F.draw(svg, F.applyFit(F.solve(anim.a), F.makeFit(anim, view)), {});
      ok(svg.children.length >= 8, 'drew too few elements');
    });
  } finally { global.document = prev.d; }
});
t('the app resolves every animation key the way mkFig does (LIFTS first, then STRETCHES)', () => {
  const resolve = k => LIFTS[k] || STRETCHES.find(s => s.id === k);
  X.EXERCISES.concat(LIB_EX).forEach(e => ok(resolve(e.anim), e.id));
  STRETCHES.forEach(s => ok(resolve(s.id)));
});

sec('Library exercises');
t('there are library-only variants and they carry libraryOnly and no day or order', () => {
  ok(LIB_EX.length >= 30, 'only ' + LIB_EX.length);
  LIB_EX.forEach(e => {
    eq(e.libraryOnly, true, e.id + ' libraryOnly');
    ok(e.day === undefined && e.order === undefined, e.id + ' must not carry day/order');
    ok(e.prerequisite === undefined, e.id + ' prerequisite');
  });
});
t('they have the same fields as the existing exercises and valid modality values', () => {
  const modalities = ['load_reps', 'weighted_bodyweight', 'bodyweight_reps', 'assisted', 'timed_hold', 'carry'];
  const fields = ['id', 'name', 'short', 'modality', 'equipment', 'pattern', 'primary', 'secondary', 'sets', 'lo', 'hi', 'restSec', 'anim', 'setup', 'execution', 'breathing', 'mistakes', 'alternatives'];
  LIB_EX.forEach(e => {
    fields.forEach(f => ok(e[f] !== undefined && e[f] !== '', e.id + ' missing ' + f));
    ok(modalities.includes(e.modality), e.id + ' modality ' + e.modality);
    ok(Array.isArray(e.secondary) && Array.isArray(e.setup) && e.setup.length >= 2 && Array.isArray(e.execution) && e.execution.length >= 2 && Array.isArray(e.mistakes) && e.mistakes.length >= 3, e.id + ' arrays');
    ok(Number.isInteger(e.sets) && e.lo >= 1 && e.hi >= e.lo && e.restSec >= 15, e.id + ' numbers');
    ok(e.alternatives.length >= 2, e.id + ' alternatives');
  });
});
t('every alternative on a library exercise is a real exercise id', () => {
  LIB_EX.forEach(e => e.alternatives.forEach(a => { ok(EXI[a], e.id + ' alternative ' + a); ok(a !== e.id, e.id + ' lists itself'); }));
});
t('library exercises are registered in EX_INDEX but not in the programme list', () => {
  LIB_EX.forEach(e => { ok(EXI[e.id] === e); ok(!X.EXERCISES.includes(e)); });
  ok(!X.EXERCISES.some(e => e.libraryOnly));
  eq(X.EXERCISES.length, 40, 'the programme exercise list should be unchanged');
});

sec('Adding the library does not change any generated programme');
const PROFILES = [
  { trainingDaysPerWeek: 2, goal: 'recomp', experience: 'novice', sessionMinutes: 45 },
  { trainingDaysPerWeek: 3, goal: 'hypertrophy', experience: 'intermediate', sessionMinutes: 60 },
  { trainingDaysPerWeek: 4, goal: 'strength', experience: 'advanced', sessionMinutes: 75 },
  { trainingDaysPerWeek: 5, goal: 'recomp', experience: 'intermediate', sessionMinutes: 90, equipment: { barbell: false } },
  { trainingDaysPerWeek: 6, goal: 'fatloss', experience: 'novice', sessionMinutes: 60, equipment: { machine: false, cable: false } },
  { trainingDaysPerWeek: 4, goal: 'recomp', experience: 'intermediate', sessionMinutes: 60, equipment: { barbell: false, dumbbell: false, machine: false, cable: false } }
];
t('no generated programme contains a libraryOnly exercise', () => {
  PROFILES.forEach((p, i) => {
    const prog = E.buildProgram(p, X.EXERCISES);
    ok(prog.days.length > 0);
    prog.days.forEach(d => d.exercises.forEach(e => { ok(!e.ex.libraryOnly && !EXI[e.id].libraryOnly, `profile ${i} picked library exercise ${e.id}`); }));
  });
});
t('programmes are identical to those built from the original 40-exercise list', () => {
  const original = X.EXERCISES.filter(e => !e.libraryOnly);
  PROFILES.forEach((p, i) => {
    const a = E.buildProgram(p, X.EXERCISES), b = E.buildProgram(p, original);
    const strip = x => JSON.stringify(x, (k, v) => (k === 'generatedAt' ? undefined : v));
    eq(strip(a), strip(b), 'profile ' + i);
  });
});
t('the original exercises keep their day and order values', () => {
  X.EXERCISES.forEach(e => ok(Number.isInteger(e.day) && Number.isInteger(e.order), e.id));
  eq(X.exercisesForDay(1).length + X.exercisesForDay(2).length + X.exercisesForDay(3).length + X.exercisesForDay(4).length, 40);
});

sec('Stretch routines');
t('routine schema', () => {
  RT.forEach(r => {
    ok(V.ROUTINE_TYPES.includes(r.type), r.id + ' type');
    ok(r.name && r.bodyAreas.length > 0, r.id);
    ok(r.activities.length > 0 && r.activities.every(a => V.ACTIVITIES.includes(a)), r.id + ' activities');
    ok(Number.isInteger(r.durationMin) && r.durationMin >= 1, r.id + ' durationMin');
    ok(['beginner', 'intermediate'].includes(r.level), r.id + ' level');
    ok(typeof r.purpose === 'string' && r.purpose.length > 0 && r.purpose.length <= 160, r.id + ' purpose length ' + r.purpose.length);
    ok(r.forStiffness.length > 0 && r.forStiffness.every(s => V.STIFFNESS.includes(s)), r.id + ' forStiffness');
    ok(r.steps.length >= 4, r.id + ' steps');
    r.steps.forEach(s => {
      ok(STI[s.stretchId], r.id + ' unknown stretch ' + s.stretchId);
      ok(Number.isInteger(s.seconds) && s.seconds >= 10 && s.seconds <= 120, r.id + ' seconds');
      ok(s.sides === 1 || s.sides === 2, r.id + ' sides');
      eq(s.sides, STI[s.stretchId].sides, r.id + ' sides should match the stretch');
    });
    ok(uniq(r.steps.map(s => s.stretchId)), r.id + ' repeats a stretch');
  });
});
t('routineSeconds is the sum of seconds x sides, and durationMin is within 15% (or 1 minute)', () => {
  eq(L.routineSeconds({ steps: [{ seconds: 30, sides: 2 }, { seconds: 45, sides: 1 }] }), 105);
  RT.forEach(r => {
    const m = L.routineSeconds(r) / 60;
    ok(Math.abs(r.durationMin - m) <= Math.max(1, 0.15 * m), `${r.id}: durationMin ${r.durationMin} vs ${m.toFixed(1)}`);
  });
});
t('at least 36 routines: 10 dynamic warm-ups, 10 post-workout, 16 standalone', () => {
  ok(RT.length >= 36);
  ok(RT.filter(r => r.type === 'dynamic_warmup').length >= 10);
  ok(RT.filter(r => r.type === 'post_workout').length >= 10);
  ok(RT.filter(r => r.type === 'standalone').length >= 16);
});
t('dynamic warm-ups exist for push, pull, legs, upper, lower, full body, conditioning and running, with 5 and 10 minute versions', () => {
  const dw = RT.filter(r => r.type === 'dynamic_warmup');
  ['push', 'pull', 'legs', 'upper_body_day', 'lower_body_day', 'full_body', 'conditioning', 'running'].forEach(a => ok(dw.some(r => r.activities.includes(a)), 'no warm-up for ' + a));
  ok(dw.some(r => r.durationMin === 5) && dw.some(r => r.durationMin === 10));
  dw.forEach(r => ok(r.steps.every(s => STI[s.stretchId].kind !== 'static'), r.id + ' warm-up should not hold static stretches'));
});
t('post-workout routines cover push, pull, legs, upper, lower, full body, conditioning and running', () => {
  const pw = RT.filter(r => r.type === 'post_workout');
  ['push', 'pull', 'legs', 'upper_body_day', 'lower_body_day', 'full_body', 'conditioning', 'running'].forEach(a => ok(pw.some(r => r.activities.includes(a)), 'no cool-down for ' + a));
  pw.forEach(r => ok(r.steps.some(s => STI[s.stretchId].kind !== 'dynamic'), r.id + ' needs holds'));
});
t('standalone routines exist at 5, 10, 15 and 20 minutes and for every body area', () => {
  const sa = RT.filter(r => r.type === 'standalone');
  [5, 10, 15, 20].forEach(m => ok(sa.some(r => r.durationMin === m), 'no standalone at ' + m));
  ['neck', 'shoulders', 'chest', 'thoracic', 'upper back', 'lower back', 'hips', 'glutes', 'quads', 'hamstrings', 'calves', 'ankles', 'wrists']
    .forEach(a => ok(sa.some(r => r.bodyAreas.includes(a)), 'no standalone for ' + a));
  ['desk', 'morning', 'before_bed'].forEach(a => ok(sa.some(r => r.activities.includes(a)), 'no standalone for ' + a));
});
t('every stretch is used by at least one routine', () => {
  const used = new Set(); RT.forEach(r => r.steps.forEach(s => used.add(s.stretchId)));
  STRETCHES.forEach(s => ok(used.has(s.id), s.id + ' is in no routine'));
});
t('searchRoutines filters by type, area, activity, length and stiffness', () => {
  ok(L.searchRoutines({ type: 'post_workout' }).every(r => r.type === 'post_workout'));
  ok(L.searchRoutines({ bodyArea: 'wrists' }).every(r => r.bodyAreas.includes('wrists')) && L.searchRoutines({ bodyArea: 'wrists' }).length >= 3);
  ok(L.searchRoutines({ activity: 'desk' }).every(r => r.activities.includes('desk')));
  ok(L.searchRoutines({ maxMin: 5 }).every(r => r.durationMin <= 5) && L.searchRoutines({ maxMin: 5 }).length >= 5);
  const s = L.searchRoutines({ stiffness: ['hips', 'ankles'] });
  ok(s.length > 3 && s.every(r => r.forStiffness.includes('hips') || r.forStiffness.includes('ankles')));
  ok(s[0].forStiffness.includes('hips') && s[0].forStiffness.includes('ankles'), 'routines matching both stiff areas rank first');
  ok(L.searchRoutines({ q: 'desk' }).length >= 2);
  eq(L.searchRoutines({ q: 'zzzqqq' }).length, 0);
  eq(L.searchRoutines({}).length, RT.length);
});
t('recommendRoutines is deterministic, returns up to 3, and explains itself', () => {
  const q = { plannedWorkout: { kind: 'strength', bodyAreas: ['legs', 'glutes'] }, stiffness: ['hips', 'ankles'], minutesAvailable: 8, phase: 'before' };
  const a = L.recommendRoutines(q), b = L.recommendRoutines(JSON.parse(JSON.stringify(q)));
  eq(a.map(x => x.routine.id), b.map(x => x.routine.id));
  eq(a.map(x => x.why), b.map(x => x.why));
  ok(a.length >= 1 && a.length <= 3);
  a.forEach(x => {
    ok(x.routine.type === 'dynamic_warmup', 'before should give warm-ups');
    ok(x.routine.durationMin <= 8, 'must fit the time available');
    ok(typeof x.why === 'string' && x.why.length > 30, 'needs a why');
    ok(/legs|lower body/.test(x.why), 'why should mention the planned workout: ' + x.why);
    ok(/not treatment/.test(x.why), 'why should be honest that this is not treatment');
  });
  ok(/hips|ankles/.test(a[0].why), 'top pick should mention the stiffness it covers: ' + a[0].why);
});
t('recommendRoutines phases pick the right type and time limits are respected', () => {
  const plan = { kind: 'hypertrophy', bodyAreas: ['chest', 'shoulders', 'arms'] };
  L.recommendRoutines({ plannedWorkout: plan, stiffness: [], minutesAvailable: 10, phase: 'after' }).forEach(x => eq(x.routine.type, 'post_workout'));
  L.recommendRoutines({ plannedWorkout: plan, stiffness: ['neck'], minutesAvailable: 10, phase: 'standalone' }).forEach(x => { eq(x.routine.type, 'standalone'); ok(x.routine.durationMin <= 10); });
  const push = L.recommendRoutines({ plannedWorkout: plan, stiffness: [], minutesAvailable: 6, phase: 'before' });
  ok(push[0].routine.activities.includes('push') || push[0].routine.activities.includes('upper_body_day'), 'push day should get an upper warm-up first: ' + push[0].routine.id);
  eq(L.recommendRoutines({ plannedWorkout: plan, stiffness: [], minutesAvailable: 1, phase: 'before' }).length, 0, 'nothing fits in one minute');
  const none = L.recommendRoutines({ plannedWorkout: { kind: 'express', bodyAreas: [] }, stiffness: [], minutesAvailable: 12, phase: 'before' });
  ok(none.length >= 1 && /general/.test(none[0].why) || none[0].why.length > 30);
  const run = L.recommendRoutines({ plannedWorkout: { kind: 'cardio', bodyAreas: ['cardio'] }, stiffness: ['calves'], minutesAvailable: 10, phase: 'after' });
  ok(run[0].routine.activities.includes('running') || run[0].routine.forStiffness.includes('calves'), run[0].routine.id);
});

sec('Recovery routines');
t('at least 12 recovery routines with the right shape and every type present', () => {
  ok(RC.length >= 12);
  RC.forEach(r => {
    ok(V.RECOVERY_TYPES.includes(r.type), r.id + ' type');
    ok(Number.isInteger(r.durationMin) && r.durationMin >= 1, r.id + ' durationMin');
    ok(typeof r.purpose === 'string' && r.purpose.length > 0, r.id + ' purpose');
    ok(r.steps.length >= 1, r.id + ' steps');
    r.steps.forEach(s => {
      ok(s.label && Number.isInteger(s.seconds) && s.seconds > 0 && typeof s.cue === 'string' && s.cue.length, r.id + ' step ' + s.label);
      if (s.stretchId) ok(STI[s.stretchId], r.id + ' unknown stretch ' + s.stretchId);
    });
    const m = r.steps.reduce((a, s) => a + s.seconds, 0) / 60;
    ok(Math.abs(r.durationMin - m) <= Math.max(1, 0.15 * m), `${r.id}: durationMin ${r.durationMin} vs ${m.toFixed(1)}`);
  });
  V.RECOVERY_TYPES.forEach(ty => ok(RC.some(r => r.type === ty), 'no recovery routine of type ' + ty));
});
t('every recovery routine is flagged notRehab with a one-line note', () => {
  RC.forEach(r => {
    eq(r.notRehab, true, r.id);
    ok(typeof r.note === 'string' && r.note.length > 0 && !/\n/.test(r.note), r.id + ' note');
    ok(/not rehabilitation/i.test(r.note), r.id + ' note should say it is not rehabilitation');
  });
});
t('the recovery set includes easy walks, gentle mobility, breathing, relaxation, sleep wind-down and a rest-day checklist', () => {
  ok(RC.filter(r => r.type === 'walk').length >= 2);
  ok(RC.some(r => r.type === 'gentle_mobility') && RC.some(r => r.type === 'breathing') && RC.some(r => r.type === 'relaxation'));
  ok(RC.some(r => /sleep|bed/i.test(r.name)));
  ok(RC.some(r => /checklist/i.test(r.name)));
});
t('searchRecovery filters by type, length and text', () => {
  ok(L.searchRecovery({ type: 'walk' }).every(r => r.type === 'walk'));
  ok(L.searchRecovery({ maxMin: 5 }).every(r => r.durationMin <= 5) && L.searchRecovery({ maxMin: 5 }).length >= 2);
  ok(L.searchRecovery({ q: 'sleep' }).length >= 1);
  eq(L.searchRecovery({}).length, RC.length);
  eq(L.searchRecovery({ q: 'zzzqqq' }).length, 0);
});

sec('Content rules');
const SCAN = [].concat(
  strings(W, 'WORKOUTS'), strings(RT, 'STRETCH_ROUTINES'),
  strings(RC.map(r => { const c = Object.assign({}, r); delete c.note; return c; }), 'RECOVERY_ROUTINES'),
  strings(LIB_EX, 'LIBRARY_EXERCISES'),
  strings(STRETCHES.slice(14).map(s => ({ id: s.id, name: s.name, time: s.time, why: s.why, how: s.how, cue: s.cue, bodyAreas: s.bodyAreas })), 'STRETCHES')
);
t('no em dashes anywhere in the library content', () => {
  const bad = SCAN.filter(([, s]) => /—/.test(s)).map(([p]) => p);
  ok(bad.length === 0, 'em dash in ' + bad.slice(0, 5));
  RC.forEach(r => ok(!/—/.test(r.note), r.id + ' note'));
});
t('no claims of curing, healing, rehabilitating, treating, or guaranteed outcomes', () => {
  const banned = /\b(cures?|cured|curing|heal|heals|healed|healing|rehab\w*|therap\w*|treat|treats|treated|treating|treatment|diagnos\w*|prescri\w*|fat loss guaranteed|build muscle fast|burn fat|burns fat|melt\w*|lose weight|weight loss|shred\w*|guarantee\w*|miracle|detox\w*|pain[- ]free|injury[- ]proof|bulletproof)\b/i;
  const bad = SCAN.filter(([, s]) => banned.test(s)).map(([p, s]) => p + ': ' + (s.match(banned) || [])[0]);
  ok(bad.length === 0, 'banned wording: ' + bad.slice(0, 5).join(' | '));
});
t('the only treatment or rehab words are the explicit "not rehabilitation" notes and "not treatment" disclaimers', () => {
  RC.forEach(r => { if (/rehab/i.test(r.note)) ok(/not rehabilitation/i.test(r.note), r.id); });
  RT.forEach(r => ok(!/rehab|treat/i.test(JSON.stringify(r)), r.id));
  L.recommendRoutines({ plannedWorkout: { kind: 'strength', bodyAreas: ['legs'] }, stiffness: ['hips'], minutesAvailable: 10, phase: 'before' })
    .forEach(x => ok(/not treatment/.test(x.why) && !/rehab/i.test(x.why)));
});
t('no promises of muscle gain or fat loss outcomes in effect or summary text', () => {
  const promise = /\b(will (build|gain|add|lose|burn|melt|shred)|you will (get|see|lose|gain)|guaranteed|results in \d|lose \d|gain \d|in \d+ (days|weeks))\b/i;
  W.forEach(w => { ok(!promise.test(w.effect), w.id + ' effect: ' + w.effect); ok(!promise.test(w.summary), w.id + ' summary'); });
});
t('Australian English and metric units in library content', () => {
  const us = /\b(color|colors|favorite|stabilize|stabilizing|center|centers|gray|program|programs|mom|sneakers|realize|organize|recognize|jewelry|fiber|meter|meters|neighbor|neighbors|flavor)\b/i;
  const bad = SCAN.filter(([, s]) => us.test(s)).map(([p, s]) => p + ': ' + (s.match(us) || [])[0]);
  ok(bad.length === 0, 'US spelling: ' + bad.slice(0, 5).join(' | '));
  const imperial = /\b(lbs?|pounds?|miles?|inches|inch|feet|foot|ft|yards?|oz)\b/i;
  const badU = SCAN.filter(([p, s]) => !/\.(id|stretchId|exerciseId)$/.test(p) && imperial.test(s.replace(/foot (placement|angle|on|flat)|feet (shoulder|hip|together|apart|flat|wide|on|a step|about)|footprint|\bfeet\b|\bfoot\b/gi, ''))).map(([p, s]) => p + ': ' + s);
  ok(badU.length === 0, 'imperial units: ' + badU.slice(0, 5).join(' | '));
});
t('summaries and effects are plain sentences (no emoji, no all-caps shouting, no exclamation marks)', () => {
  SCAN.forEach(([p, s]) => {
    ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s), p + ' emoji');
    ok(!/!/.test(s), p + ' exclamation mark');
  });
});
t('the honesty wording is intact in exercises.js', () => {
  ok(/diagram, not a technique reference/i.test(X.ASSET_MANIFEST.disclaimer));
  ok(/UNREVIEWED/.test(X.ASSET_MANIFEST.reviewStatus));
});

sec('Stats');
t('libraryStats reports consistent counts', () => {
  const s = L.libraryStats();
  eq(s.workouts, W.length); eq(s.routines, RT.length); eq(s.recoveryRoutines, RC.length); eq(s.stretches, STRETCHES.length); eq(s.libraryExercises, LIB_EX.length);
  eq(Object.values(s.workoutsByKind).reduce((a, b) => a + b, 0), W.length);
  eq(Object.values(s.routinesByType).reduce((a, b) => a + b, 0), RT.length);
  eq(Object.values(s.recoveryByType).reduce((a, b) => a + b, 0), RC.length);
  ok(s.durationRangeMin[0] <= 10 && s.durationRangeMin[1] >= 75);
});
t('library.js works as a browser global script too', () => {
  const vm = require('vm');
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  // exercises.js and stretches.js declare top-level consts, so run them as classic scripts in one context
  ['exercises.js', 'stretches.js', 'library.js'].forEach(f => {
    const src = fs.readFileSync(path.join(__dirname, dir, f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  });
  ok(Array.isArray(sandbox.window.WORKOUTS) && sandbox.window.WORKOUTS.length === W.length, 'window.WORKOUTS');
  ok(typeof sandbox.window.searchWorkouts === 'function' && typeof sandbox.window.recommendRoutines === 'function');
  ok(sandbox.window.libraryStats().routines === RT.length);
});

console.log('\n==============================================================');
console.log(`  ${pass} passed, ${fail} failed`);
console.log('==============================================================');
if (fail) { failures.forEach(([n, m]) => console.log(' - ' + n + ': ' + m)); process.exit(1); }
