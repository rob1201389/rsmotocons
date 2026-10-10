# Content library

Workouts, stretch routines and recovery routines for the Recomp app. All of it is plain data plus
small pure functions in `public/library.js`. It loads as a browser script (globals on `window`) and
under node (`require('./library.js')`). There is no DOM, storage or network code in it.

Tests: `node gym/test/library.test.js` (70 checks). `test/run-all.sh` does not list this suite
yet; add `library.test` to its `for t in ...` line to include it.

## What is in it

Counts below come from `libraryStats()`.

| Set | Count |
|---|---|
| Workouts | 73 |
| Stretch and mobility poses (with animation) | 42 (14 original, 28 added) |
| Stretch routines | 43 |
| Recovery routines | 15 |
| Library-only exercise variants | 39 |

Workouts by kind: strength 9, hypertrophy 10, conditioning 8, cardio 8, bodyweight 9, home 10,
hotel 9, express 10. By difficulty: beginner 26, intermediate 36, advanced 11. Every kind has a
beginner option. Durations run from 10 to 75 minutes, 29 of them at 20 minutes or less.

Goal coverage (a workout can serve several): build_muscle 23, strength 11, fat_loss 19, recomp 36,
general_fitness 49, mobility 9.

Stretch routines by type: dynamic_warmup 12, post_workout 11, standalone 20 (5, 10, 15 and 20
minute lengths, and at least one for every body area from neck to wrists).

Recovery routines by type: walk 3, easy_movement 3, gentle_mobility 4, breathing 3, relaxation 2.

## Files

| File | Role |
|---|---|
| `public/library.js` | `WORKOUTS`, `STRETCH_ROUTINES`, `RECOVERY_ROUTINES`, helpers, `VOCAB` |
| `public/exercises.js` | adds `LIBRARY_EXERCISES` (39 variants, `libraryOnly:true`), registered in `EX_INDEX` |
| `public/lifts.js` | adds pose pairs for the new exercises |
| `public/stretches.js` | adds 28 stretch poses and extra fields on all 42 |
| `test/library.test.js` | the suite |

`library.js` must load after `exercises.js` and `stretches.js`.
It is not in the service worker's cache list (`sw.js`) or `index.html` yet.

## Library-only exercises do not touch the programme

The programme generator (`buildProgram` in `engine.js`) chooses from `EXERCISES` by `day` and
`order`. The new variants therefore live in a separate array, `LIBRARY_EXERCISES`, and are added to
`EX_INDEX` only. They carry `libraryOnly:true` and have no `day`, `order` or `prerequisite`.
`EXERCISES` still has exactly 40 entries. The test builds programmes for six profiles and proves
the output is identical to one built from the original list and that no pick is `libraryOnly`.

If you ever pass `Object.values(EX_INDEX)` to `buildProgram`, filter out `libraryOnly` first.

## Schemas

### Workout

```js
{
  id: 'w-str-full-a',                // unique, w- prefix
  name, summary,                     // summary <= 160 chars
  kind: 'strength' | 'hypertrophy' | 'conditioning' | 'cardio' | 'bodyweight' | 'home' | 'hotel' | 'express',
  goals: ['build_muscle','strength','fat_loss','recomp','general_fitness','mobility'],   // subset
  durationMin,                       // integer, derived from the blocks (see below)
  difficulty: 'beginner' | 'intermediate' | 'advanced',
  equipment: ['barbell','dumbbell','machine','cable','bands','kettlebell','cardio_machine','bench','pullup_bar','none'],
  bodyAreas: ['chest','back','shoulders','arms','legs','glutes','core','full_body','cardio'],
  effect,                            // <= 200 chars, the intended training stimulus, plain and honest
  demand: 1..5,                      // relative recovery cost
  structure: 'resistance' | 'intervals' | 'steady' | 'circuit' | 'emom' | 'ladder',
  blocks: [ ... ],
  tags: [ ... ],
  shortVersionOf?: 'w-...'           // express workouts name the longer session they trim
}
```

Blocks:

```js
{ type:'resistance', label?, exercises:[{ id, sets, repMin, repMax, restSec }] }
{ type:'intervals',  label?, rounds, work:[{ name, workSec, restSec, cue?, exerciseId? }] }
{ type:'steady',     name, minutes, intensity:'easy'|'moderate'|'hard', cue? }
{ type:'circuit',    label?, rounds, restBetweenRoundsSec, moves:[{ exerciseId?, stretchId?, name, reps?, workSec? }] }
```

`emom` is single-move intervals (work plus rest fills the minute). `ladder` is a run of one-round
circuits with changing reps.

`equipment` is derived when the workout is built: the union of what each referenced exercise needs
(`requiredEquipmentForExercise`), plus any extras such as `cardio_machine`. A pair of dumbbells and
a kettlebell are treated as interchangeable by `searchWorkouts`. An empty result becomes `['none']`.
`incline-push-up` needs only a raised surface, so it adds no item.

### Duration estimate

`estimateDurationMin(workout)` in minutes:

- resistance: per exercise, `sets x (40 s work + restSec) + 60 s` transition
- intervals: `rounds x sum(workSec + restSec)`
- steady: `minutes`
- circuit: `rounds x (sum of move times + restBetweenRoundsSec)`; a move takes its `workSec`, else 40 s

`durationMin` is that estimate rounded (to the nearest minute below 25 minutes, nearest 5 above).
The tests require it to be within 15% or 3 minutes of the estimate. Warm-up and cool-down are not
included. These are estimates, not timings from real sessions.

### Other helpers

- `hardSets(workout)` counts resistance working sets.
- `workoutMuscles(workout)` gives sets per primary muscle using `EX_INDEX`. Resistance sets count as
  written; each circuit round of a move with an `exerciseId` counts as one set.
- `searchWorkouts({ q, goal, kind, maxMin, minMin, equipment, difficulty, bodyArea, maxDemand })`
  is pure. Every filter is a hard filter. `equipment` is the list of items you have; a workout
  matches only if all of its required items are in it (`'none'` needs nothing, `[]` returns only
  no-kit workouts). `q` words must each match somewhere; results sort by relevance, then duration,
  then id.

### Stretch routine

```js
{
  id: 'r-dw-legs', name,
  type: 'dynamic_warmup' | 'post_workout' | 'standalone',
  bodyAreas: [...],
  activities: ['upper_body_day','lower_body_day','push','pull','legs','full_body','conditioning','running','desk','morning','before_bed','any'],
  durationMin, level: 'beginner' | 'intermediate',
  purpose,                           // <= 160 chars
  forStiffness: ['neck','shoulders','upper back','lower back','hips','hamstrings','quads','calves','ankles','wrists','chest'],
  steps: [{ stretchId, seconds, sides: 1|2, cue? }]
}
```

`seconds` is per side. `routineSeconds(routine)` is the sum of `seconds x sides`, and `durationMin`
is within 15% or one minute of it (the tests check this). Some routines are built with a target
length and their holds are scaled to fit (rounded to 5 s, between 15 and 90 s).

`searchRoutines({ type, bodyArea, activity, maxMin, stiffness, q })` filters, then ranks by how many
of your stiff areas it covers.

`recommendRoutines({ plannedWorkout:{ kind, bodyAreas }, stiffness, minutesAvailable, phase })`
(`phase` is `before`, `after` or `standalone`) returns up to three `{ routine, score, why }`. It
scores activity match (the planned body areas map to push, pull, legs and so on), stiffness
overlap, area overlap and a small bonus for using the time you have. Routines longer than
`minutesAvailable` are excluded. It is deterministic (ties break on id), and `why` says what
matched, or says plainly that it is a general routine when nothing matched. Every `why` ends with
a note that it is general mobility, not treatment.

### Stretch (stretches.js)

The original shape (`id, block, name, time, why, how, ms, ground, a, b`) plus `bodyAreas`,
`sides` (1 or 2), `seconds` (default hold or working time per side), `kind`
(`dynamic`, `static`, `both`) and `cue`. The 14 original entries were not edited; their new fields
are added by a block at the bottom of the file.

### Recovery routine

```js
{ id:'rc-...', name, type:'easy_movement'|'gentle_mobility'|'relaxation'|'breathing'|'walk',
  durationMin, purpose, steps:[{ label, seconds, cue, stretchId? }], notRehab:true, note }
```

`note` is one line saying the routine is general relaxation and easy movement, not rehabilitation
and not a treatment. `searchRecovery({ type, maxMin, minMin, q })` filters.

## How to add content

1. Exercise: add a `_L(...)` entry to `LIBRARY_EXERCISES` in `exercises.js`. Fill every field
   (setup, execution, breathing, at least three mistakes, at least two real `alternatives`). Use
   an existing `modality` (`load_reps`, `weighted_bodyweight`, `bodyweight_reps`, `assisted`,
   `timed_hold`, `carry`). Do not add `day`, `order` or `prerequisite`. If it needs a bench,
   pull-up bar or similar that its `equipment` field does not imply, add it to `EQUIP_EXTRA` in
   `library.js`.
2. Animation: point `anim` at an existing pose pair in `lifts.js` only if the side view genuinely
   looks the same movement. Otherwise add a pose pair using the angle conventions at the top of
   `lifts.js` (0 right, 90 down, 180 left, 270 up; the figure faces right). Make sure the ground
   contacts line up in both poses (the test checks this within 4 units) and that nothing leaves
   the frame.
3. Stretch: add to the `STRETCHES.push(...)` block in `stretches.js` with all the extra fields.
   The test fails if a stretch is not used by any routine, so add it to at least one.
4. Workout: add a `W(...)` call in `library.js`. Equipment and `durationMin` are computed. Keep
   `summary` under 160 characters and `effect` under 200. Express workouts must be 10 to 20
   minutes, set `shortVersionOf` to a longer session, and be genuinely smaller.
5. Routine: add an `R(...)` call. Pass a final target in minutes if the name promises a length.
6. Run `node gym/test/library.test.js` and `gym/test/run-all.sh`.

Writing rules the tests enforce: Australian English, metric, no em dashes, no cure, heal, treat or
rehabilitation wording (apart from the explicit "not rehabilitation" notes), no guarantees of muscle
gain or fat loss, no emoji or exclamation marks.

## Honesty limits

- The animations are original vector diagrams drawn from pose angles. They show direction and rough
  joint positions only. They are not demonstration video and have not been reviewed by a coach or
  physiotherapist. Several side views simplify the movement (a one-arm row drawn with two arms, a
  hammer curl drawn as a curl, a twist drawn as the legs lowering, wrist stretches without a hand
  segment). Notes on the affected exercises and stretches say so. The existing wording in
  `ASSET_MANIFEST` still applies to all of it, and the library exercises have no manifest entries
  (the manifest is built from `EXERCISES` only).
- All cues and instructions were written from general training practice and are unreviewed.
- Recovery routines, and all stretch and mobility routines, are general relaxation and easy movement.
  They are not rehabilitation, do not treat or make any painful movement safe, and should not be
  used in place of advice from a qualified professional. If something is sharp or worsening, stop.
- Workouts state an intended training effect. Nothing here promises muscle gain, fat loss or any
  other outcome.
- Durations are modelled estimates, and `demand` is a rough relative figure, not a measurement.
