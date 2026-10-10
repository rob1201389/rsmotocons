/* ============================================================================
   Recomp exercise library.

   Every entry is a VARIANT with its own id, its own performance history and
   its own animation. Movements that were previously bundled (pulldown/pull-up,
   bodyweight/weighted leg raise, conventional/trap-bar deadlift) are separate
   entries, because they are different exercises and averaging their history
   together makes progress unmeasurable.

   modality drives the engine:
     load_reps | weighted_bodyweight | bodyweight_reps | assisted | timed_hold | carry

   `anim` names a pose pair in lifts.js. `assets` records provenance — see
   ASSET_MANIFEST at the bottom and ASSETS.md for the review status.
   ========================================================================== */

const EXERCISES = [
/* ------------------------------------------------------------- DAY 1: UPPER A */
{ id:'bench-barbell', name:'Barbell bench press', short:'Bench press', day:1, order:1,
  modality:'load_reps', equipment:'barbell', pattern:'horizontal push',
  primary:'chest', secondary:['front delt','triceps'], direction:'Bar travels down to the lower chest and back up over the shoulders.',
  sets:4, lo:5, hi:8, restSec:180, anim:'bench',
  setup:['Eyes under the bar, feet flat and planted.','Shoulder blades pulled back and down, small arch in the lower back.','Grip so the forearms are vertical at the bottom.'],
  execution:['Unrack and settle the bar over the shoulders.','Lower under control to the lower chest, elbows about 45° from the torso.','Press back up and slightly toward the face.'],
  breathing:'Big breath in and brace at the top, hold it through the rep, breathe out past the hardest point.',
  mistakes:['Elbows flared straight out — hard on the shoulder and weaker.','Bouncing the bar off the chest.','Heels lifting or hips coming off the bench.'],
  alternatives:['db-bench','incline-barbell-press','machine-chest-press'] },

{ id:'row-barbell', name:'Barbell bent-over row', short:'Barbell row', day:1, order:2,
  modality:'load_reps', equipment:'barbell', pattern:'horizontal pull',
  primary:'back', secondary:['rear delt','biceps'], direction:'Bar pulled from arms-extended up to the lower ribs.',
  sets:4, lo:6, hi:10, restSec:150, anim:'row',
  setup:['Hinge to roughly 45°, flat back, knees soft.','Bar hanging under the shoulders.','Brace hard before the first rep.'],
  execution:['Pull to the lower ribs, driving the elbows back past the torso.','Pause briefly, then lower under control to full extension.'],
  breathing:'Breathe in at the bottom, brace, pull, breathe out at the bottom of the next rep.',
  mistakes:['Torso rising with each rep until it becomes a shrug.','Jerking the weight with the lower back.','Pulling to the collarbone instead of the ribs.'],
  alternatives:['chest-supported-row','seated-cable-row','db-row'] },

{ id:'ohp-barbell', name:'Barbell overhead press', short:'Overhead press', day:1, order:3,
  modality:'load_reps', equipment:'barbell', pattern:'vertical push',
  primary:'shoulders', secondary:['triceps','upper chest'], direction:'Bar from the front rack straight overhead to lockout.',
  sets:3, lo:8, hi:10, restSec:150, anim:'ohp',
  setup:['Bar resting on the front delts, grip just outside the shoulders.','Squeeze the glutes and brace the abs.','Elbows slightly in front of the bar.'],
  execution:['Press up, moving the head back slightly to clear the bar.','At lockout the bar is over the mid-foot, head through.','Lower under control to the front delts.'],
  breathing:'Breathe in and brace before each rep, out at lockout. Do not hold it through a whole set.',
  mistakes:['Leaning back to turn it into a standing incline press.','Pressing around the face instead of moving the head.','Losing the brace so the lower back takes the load.'],
  alternatives:['db-shoulder-press','machine-shoulder-press'] },

{ id:'lat-pulldown', name:'Lat pulldown', short:'Pulldown', day:1, order:4,
  modality:'load_reps', equipment:'cable', pattern:'vertical pull',
  primary:'back', secondary:['biceps'], direction:'Bar pulled from overhead down to the upper chest.',
  sets:3, lo:8, hi:12, restSec:120, anim:'pulldown',
  setup:['Thighs locked under the pad.','Grip a little wider than the shoulders.','Chest up, slight lean back, ribs down.'],
  execution:['Drive the elbows down toward the hips.','Bar to the upper chest, pause.','Return all the way to a full stretch overhead.'],
  breathing:'Out as you pull, in on the way back up.',
  mistakes:['Swinging the torso to generate the pull.','Stopping short of the full stretch at the top.','Pulling with the hands rather than driving the elbows.'],
  alternatives:['pull-up','assisted-pull-up'],
  note:'Split from the pull-up: different loading, different history.' },

{ id:'incline-db-press', name:'Incline dumbbell press', short:'Incline DB press', day:1, order:5,
  modality:'load_reps', equipment:'dumbbell', pattern:'incline push',
  primary:'upper chest', secondary:['front delt','triceps'], direction:'Dumbbells from a stretch at the chest pressed up and slightly together.',
  sets:3, lo:10, hi:12, restSec:120, anim:'incdb',
  setup:['Bench at about 30°. Steeper turns it into a shoulder press.','Blades set back, dumbbells at the lower chest.'],
  execution:['Press up and slightly in, stopping short of clashing.','Lower under control until you feel the chest stretch.'],
  breathing:'In on the way down, out on the press.',
  mistakes:['Bench too steep.','Bouncing out of the bottom.','Letting the elbows flare to 90°.'],
  alternatives:['incline-barbell-press','machine-chest-press'] },

{ id:'face-pull', name:'Face pull', short:'Face pull', day:1, order:6,
  modality:'load_reps', equipment:'cable', pattern:'horizontal pull',
  primary:'rear delt', secondary:['upper back'], direction:'Rope pulled to the forehead with the hands splitting apart.',
  sets:3, lo:15, hi:20, restSec:60, anim:'facepull',
  setup:['Rope at roughly eye height.','Overhand grip, thumbs pointing back.','Step back so there is tension at the start.'],
  execution:['Pull the rope to the forehead, hands separating.','Finish with the elbows high and wide.','Return under control.'],
  breathing:'Out as you pull.',
  mistakes:['Going too heavy and turning it into a high row.','Elbows dropping below the shoulders.','No pause at the back.'],
  alternatives:['band-pull-apart','reverse-fly'] },

{ id:'triceps-pushdown', name:'Triceps pushdown', short:'Pushdown', day:1, order:7,
  modality:'load_reps', equipment:'cable', pattern:'elbow extension',
  primary:'triceps', secondary:[], direction:'Forearms travel from bent to locked out at the hips.',
  sets:3, lo:12, hi:15, restSec:60, anim:'push',
  setup:['Elbows pinned to the sides.','Slight forward lean, ribs down.'],
  execution:['Extend to a full lockout.','Return slowly to about 90°.'],
  breathing:'Out on the extension.',
  mistakes:['Elbows drifting forward so the shoulders take over.','Leaning in to use bodyweight.','Short, partial reps.'],
  alternatives:['overhead-triceps-ext','close-grip-bench'] },

{ id:'barbell-curl', name:'Barbell curl', short:'Barbell curl', day:1, order:8,
  modality:'load_reps', equipment:'barbell', pattern:'elbow flexion',
  primary:'biceps', secondary:['forearm'], direction:'Bar curled from the thighs to the shoulders.',
  sets:3, lo:12, hi:15, restSec:60, anim:'curl1',
  setup:['Shoulder-width grip, elbows at the sides.','Stand tall, ribs down.'],
  execution:['Curl without letting the elbows travel forward.','Squeeze at the top, lower to a full stretch.'],
  breathing:'Out on the way up.',
  mistakes:['Swinging the hips to start the rep.','Cutting the bottom of the range.','Elbows drifting up into a front raise.'],
  alternatives:['incline-db-curl','cable-curl'] },

{ id:'cable-crunch', name:'Kneeling cable crunch', short:'Cable crunch', day:1, order:9, block:'core',
  modality:'load_reps', equipment:'cable', pattern:'spinal flexion',
  primary:'abs', secondary:[], direction:'Spine rounds down toward the knees against the cable.',
  sets:4, lo:6, hi:10, restSec:75, anim:'cablecrunch',
  setup:['Kneel under a high pulley, rope behind the head.','Hips fixed — they do not move during the set.'],
  execution:['Round the spine down, ribs toward the pelvis.','Return under control without losing tension.'],
  breathing:'Out hard as you crunch down.',
  mistakes:['Hinging at the hips, which makes it a hip-flexor exercise.','Pulling with the arms.','Going so heavy the range disappears.'],
  alternatives:['weighted-hanging-leg-raise','ab-wheel-kneeling'] },

{ id:'pallof-press', name:'Half-kneeling Pallof press', short:'Pallof press', day:1, order:10, block:'core',
  modality:'load_reps', equipment:'cable', pattern:'anti-rotation', perSide:true,
  primary:'obliques', secondary:['abs'], direction:'Hands press straight out while the cable tries to rotate you.',
  sets:3, lo:8, hi:10, restSec:60, anim:'pallof', holdSec:3,
  setup:['Half-kneeling, side-on to the cable.','Ribs down, glute of the down leg squeezed.'],
  execution:['Press straight out and hold for three seconds.','Resist any rotation, then return to the chest.'],
  breathing:'Breathe normally through the hold. Do not hold your breath.',
  mistakes:['Letting the torso twist toward the stack.','Rushing the press instead of holding.','Standing too close so there is no resistance.'],
  alternatives:['suitcase-carry','side-plank-weighted'] },

/* ------------------------------------------------------------- DAY 2: LOWER A */
{ id:'squat-barbell', name:'Barbell back squat', short:'Back squat', day:2, order:1,
  modality:'load_reps', equipment:'barbell', pattern:'squat',
  primary:'quads', secondary:['glutes','adductors','spinal erectors'], direction:'Hips and knees bend to at least parallel, then drive back up.',
  sets:4, lo:5, hi:8, restSec:180, anim:'squat',
  setup:['Bar on the rear delts, not the neck.','Feet about shoulder width, toes slightly out.','Big breath, brace the whole trunk before unracking the step out.'],
  execution:['Break at the hips and knees together.','Descend until the hip crease is at or below the knee.','Drive up through the mid-foot, knees tracking over the toes.'],
  breathing:'Breathe in and brace at the top of each rep, hold through the rep, out at the top.',
  mistakes:['Knees caving in on the way up.','Heels lifting — usually ankle range, see the calf-and-ankle mobility work.','Hips shooting up first so it becomes a good morning.'],
  alternatives:['front-squat','leg-press','goblet-squat'] },

{ id:'rdl-barbell', name:'Romanian deadlift', short:'RDL', day:2, order:2,
  modality:'load_reps', equipment:'barbell', pattern:'hinge',
  primary:'hamstrings', secondary:['glutes','spinal erectors'], direction:'Hips travel back, bar slides down the thighs, then hips drive forward.',
  sets:3, lo:8, hi:10, restSec:150, anim:'rdl',
  setup:['Bar at the hips, shoulder-width grip.','Soft knees, locked flat back.'],
  execution:['Push the hips back, bar staying in contact with the legs.','Stop where the hamstrings run out of stretch, not where the floor is.','Drive the hips forward to stand.'],
  breathing:'In at the top, brace, hinge, out at the top.',
  mistakes:['Turning it into a squat by bending the knees.','Letting the bar drift away from the legs.','Rounding the lower back to chase depth.'],
  alternatives:['db-rdl','good-morning','seated-leg-curl'] },

{ id:'leg-press', name:'Leg press', short:'Leg press', day:2, order:3,
  modality:'load_reps', equipment:'machine', pattern:'squat',
  primary:'quads', secondary:['glutes'], direction:'Platform pushed away until the knees are almost straight.',
  sets:3, lo:10, hi:12, restSec:120, anim:'legpress',
  setup:['Feet mid-platform, shoulder width.','Lower back flat against the pad.'],
  execution:['Lower until the knees are around 90° or just past.','Press back without snapping the knees straight.'],
  breathing:'In on the way down, out on the press.',
  mistakes:['Going so deep the pelvis tucks off the pad.','Locking the knees hard at the top.','Hands on the knees.'],
  alternatives:['squat-barbell','hack-squat','goblet-squat'] },

{ id:'seated-leg-curl', name:'Seated leg curl', short:'Seated leg curl', day:2, order:4,
  modality:'load_reps', equipment:'machine', pattern:'knee flexion',
  primary:'hamstrings', secondary:[], direction:'Heels pulled down and back under the seat.',
  sets:3, lo:10, hi:12, restSec:90, anim:'legcurl1',
  setup:['Knee joint lined up with the machine pivot.','Thigh pad snug.'],
  execution:['Curl to full flexion.','Return slowly, resisting the stretch.'],
  breathing:'Out on the curl.',
  mistakes:['Hips lifting off the seat.','Letting the weight slam back.','Half reps at the top.'],
  alternatives:['lying-leg-curl','rdl-barbell'] },

{ id:'standing-calf-raise', name:'Standing calf raise', short:'Standing calf', day:2, order:5,
  modality:'load_reps', equipment:'machine', pattern:'ankle extension',
  primary:'calves', secondary:[], direction:'Heels drop below the step, then press up onto the toes.',
  sets:4, lo:12, hi:15, restSec:60, anim:'calf1',
  setup:['Balls of the feet on the step, knees straight but not locked.'],
  execution:['Drop into a full stretch.','Press up as high as you can and pause.'],
  breathing:'Out on the way up.',
  mistakes:['Bouncing the stretch.','Tiny range at the top.','Bending the knees, which shifts it to the soleus.'],
  alternatives:['seated-calf-raise','smith-calf-raise'] },

{ id:'hanging-leg-raise', name:'Hanging leg raise', short:'Leg raise', day:2, order:6, block:'core',
  modality:'bodyweight_reps', equipment:'bodyweight', pattern:'spinal flexion',
  primary:'abs', secondary:['hip flexors'], direction:'Legs and pelvis curl up toward the ribs from a dead hang.',
  sets:4, lo:6, hi:12, restSec:75, anim:'legraise_bw',
  setup:['Dead hang, shoulders engaged, no swinging.'],
  execution:['Curl the pelvis toward the ribs, not just lift the legs.','Lower under control to a full hang.'],
  breathing:'Out as you curl up.',
  mistakes:['Swinging to generate momentum.','Only lifting the legs, leaving the pelvis still.','Dropping down and bouncing out of the hang.'],
  alternatives:['weighted-hanging-leg-raise','hanging-knee-raise','cable-crunch'],
  note:'Split from the weighted version: progresses by reps, not load.' },

{ id:'weighted-hanging-leg-raise', name:'Weighted hanging leg raise', short:'Weighted leg raise', day:2, order:6, block:'core',
  modality:'weighted_bodyweight', equipment:'bodyweight', pattern:'spinal flexion',
  primary:'abs', secondary:['hip flexors'], direction:'As the bodyweight version, with a dumbbell held between the feet.',
  sets:4, lo:6, hi:10, restSec:75, anim:'legraise',
  setup:['Dumbbell gripped between the feet before you hang.','Dead hang, shoulders engaged.'],
  execution:['Curl the pelvis toward the ribs.','Control the descent — this is where the load is felt.'],
  breathing:'Out as you curl up.',
  mistakes:['Adding load before 12 clean bodyweight reps.','Losing the pelvic curl once weighted.'],
  alternatives:['hanging-leg-raise','cable-crunch'],
  prerequisite:'hanging-leg-raise' },

{ id:'suitcase-carry', name:'Suitcase carry', short:'Suitcase carry', day:2, order:7, block:'core',
  modality:'carry', equipment:'dumbbell', pattern:'anti-lateral flexion', perSide:true,
  primary:'obliques', secondary:['traps','grip','quadratus lumborum'], direction:'Walk a set distance with load in one hand only.',
  sets:3, lo:40, hi:40, restSec:120, anim:'suitcase', unit:'m',
  setup:['One heavy dumbbell or kettlebell at one side.','Stand tall, shoulders level before the first step.'],
  execution:['Walk the distance without leaning toward the load.','The set ends the moment you lean, not when the distance does.'],
  breathing:'Steady breathing. Do not hold your breath through the walk.',
  mistakes:['Leaning away from the weight.','Shrugging the loaded shoulder.','Adding distance instead of load.'],
  alternatives:['farmers-walk','side-plank-weighted'],
  progressionNote:'Distance is fixed at 40 m. Load is the only thing that moves — past about 45 seconds a carry trains conditioning instead of strength.' },

{ id:'side-plank-weighted', name:'Weighted side plank', short:'Side plank', day:2, order:8, block:'core',
  modality:'timed_hold', equipment:'bodyweight', pattern:'anti-lateral flexion', perSide:true,
  primary:'obliques', secondary:['glute medius'], direction:'Hold a straight line on one elbow against gravity.',
  sets:3, lo:20, hi:30, restSec:60, anim:'sideplank', unit:'s',
  setup:['Elbow under the shoulder, feet stacked.','Plate on the top hip once bodyweight is easy.'],
  execution:['Lift into a straight line ankle to ear and hold.','Hips stay high the whole time.'],
  breathing:'Normal breathing throughout. Holding your breath defeats the point.',
  mistakes:['Hips sagging in the last few seconds.','Chasing minutes instead of adding load.','Rolling the chest toward the floor.'],
  alternatives:['pallof-press','suitcase-carry'],
  progressionNote:'Seconds climb to 30, then load is added and the time resets to 20.' },

/* ------------------------------------------------------------- DAY 3: UPPER B */
{ id:'incline-barbell-press', name:'Incline barbell press', short:'Incline press', day:3, order:1,
  modality:'load_reps', equipment:'barbell', pattern:'incline push',
  primary:'upper chest', secondary:['front delt','triceps'], direction:'Bar lowered to the upper chest on an inclined bench and pressed back up.',
  sets:4, lo:8, hi:12, restSec:150, anim:'incbar',
  setup:['Bench at about 30°.','Blades retracted, feet planted.'],
  execution:['Lower to the upper chest under control.','Press up and slightly back over the shoulders.'],
  breathing:'In on the way down, out on the press.',
  mistakes:['Bench too steep so the shoulders take over.','Bar drifting toward the throat.','Bouncing off the chest.'],
  alternatives:['incline-db-press','bench-barbell'] },

{ id:'pull-up', name:'Pull-up', short:'Pull-up', day:3, order:2,
  modality:'bodyweight_reps', equipment:'bodyweight', pattern:'vertical pull',
  primary:'back', secondary:['biceps','rear delt'], direction:'Body pulled from a dead hang until the chin clears the bar.',
  sets:4, lo:5, hi:12, restSec:150, anim:'pullup_bw',
  setup:['Grip slightly wider than the shoulders.','Start from a full dead hang, shoulders engaged.'],
  execution:['Pull the elbows down and back until the chin clears the bar.','Lower all the way to a full hang.'],
  breathing:'Out as you pull up.',
  mistakes:['Kipping or swinging.','Stopping short of a full hang.','Chin craning over the bar instead of the chest rising.'],
  alternatives:['assisted-pull-up','lat-pulldown','weighted-pull-up'],
  note:'Split from the pulldown and from the weighted version — three separate histories.' },

{ id:'assisted-pull-up', name:'Assisted pull-up', short:'Assisted pull-up', day:3, order:2,
  modality:'assisted', equipment:'assisted', pattern:'vertical pull',
  primary:'back', secondary:['biceps'], direction:'As the pull-up, with a machine or band carrying part of your bodyweight.',
  sets:4, lo:8, hi:12, restSec:150, anim:'pullup_assisted',
  setup:['Set the assistance so the last rep is hard but clean.','Full dead hang start.'],
  execution:['Pull until the chin clears the bar.','Lower to a full hang under control.'],
  breathing:'Out as you pull up.',
  mistakes:['Using so much assistance the set is easy throughout.','Not reaching a full hang.'],
  alternatives:['pull-up','lat-pulldown'],
  progressionNote:'Less assistance is progress. The engine reduces the assistance stack, it does not add to it.' },

{ id:'weighted-pull-up', name:'Weighted pull-up', short:'Weighted pull-up', day:3, order:2,
  modality:'weighted_bodyweight', equipment:'bodyweight', pattern:'vertical pull',
  primary:'back', secondary:['biceps'], direction:'Pull-up with load hung from a belt or held between the feet.',
  sets:4, lo:5, hi:8, restSec:180, anim:'pullup_weighted',
  setup:['Belt and plate, or a dumbbell between the feet.','Full dead hang start.'],
  execution:['Pull until the chin clears the bar, no swinging.','Control the descent.'],
  breathing:'Out as you pull up.',
  mistakes:['Adding load before 12 clean bodyweight reps.','Range shortening once loaded.'],
  alternatives:['pull-up','lat-pulldown'],
  prerequisite:'pull-up' },

{ id:'db-shoulder-press', name:'Seated dumbbell shoulder press', short:'DB shoulder press', day:3, order:3,
  modality:'load_reps', equipment:'dumbbell', pattern:'vertical push',
  primary:'shoulders', secondary:['triceps'], direction:'Dumbbells pressed from shoulder height to overhead.',
  sets:3, lo:10, hi:12, restSec:120, anim:'dbohp',
  setup:['Upright bench, back supported.','Dumbbells at shoulder height, neutral or slightly angled grip.'],
  execution:['Press up without shrugging.','Lower under control to shoulder height.'],
  breathing:'Out on the press.',
  mistakes:['Shrugging at the top.','Flaring the elbows straight out.','Arching the lower back off the bench.'],
  alternatives:['ohp-barbell','machine-shoulder-press'] },

{ id:'chest-supported-row', name:'Chest-supported row', short:'CS row', day:3, order:4,
  modality:'load_reps', equipment:'dumbbell', pattern:'horizontal pull',
  primary:'back', secondary:['rear delt','biceps'], direction:'Dumbbells pulled to the ribs with the chest braced on a bench.',
  sets:3, lo:10, hi:12, restSec:120, anim:'csrow',
  setup:['Chest on an inclined bench, feet planted.','Dumbbells hanging at full stretch.'],
  execution:['Pull to the lower ribs, elbows driving back.','Lower to a full stretch.'],
  breathing:'Out as you pull.',
  mistakes:['Chest coming off the pad to cheat the weight.','Shrugging instead of rowing.','Cutting the stretch.'],
  alternatives:['row-barbell','seated-cable-row'] },

{ id:'cable-fly', name:'Cable fly', short:'Cable fly', day:3, order:5,
  modality:'load_reps', equipment:'cable', pattern:'horizontal adduction',
  primary:'chest', secondary:['front delt'], direction:'Arms sweep from wide to together in front of the chest.',
  sets:3, lo:12, hi:15, restSec:60, anim:'fly',
  setup:['Cables at about chest height.','Slight fixed bend in the elbows.'],
  execution:['Sweep the hands together in front of the chest.','Return to a controlled stretch.'],
  breathing:'Out as you bring the hands together.',
  mistakes:['Bending and straightening the elbows, making it a press.','Letting the shoulders roll forward in the stretch.','Going too heavy to control the back half.'],
  alternatives:['pec-deck','incline-db-press'] },

{ id:'lateral-raise', name:'Lateral raise', short:'Lateral raise', day:3, order:6,
  modality:'load_reps', equipment:'dumbbell', pattern:'shoulder abduction',
  primary:'side delt', secondary:[], direction:'Arms raised out to the sides to shoulder height.',
  sets:3, lo:15, hi:20, restSec:45, anim:'lat',
  setup:['Dumbbells at the sides, slight forward lean.','Small fixed bend in the elbows.'],
  execution:['Lead with the elbows out to shoulder height.','Lower slowly.'],
  breathing:'Out on the way up.',
  mistakes:['Swinging with the hips.','Going above shoulder height so the traps take over.','Too heavy to control the lowering.'],
  alternatives:['cable-lateral-raise','machine-lateral-raise'] },

{ id:'incline-db-curl', name:'Incline dumbbell curl', short:'Incline curl', day:3, order:7,
  modality:'load_reps', equipment:'dumbbell', pattern:'elbow flexion',
  primary:'biceps', secondary:[], direction:'Dumbbells curled from a stretched position behind the torso.',
  sets:3, lo:12, hi:15, restSec:60, anim:'curl2',
  setup:['Bench at about 60°, arms hanging behind the torso.'],
  execution:['Curl without letting the elbows travel forward.','Lower to a full stretch.'],
  breathing:'Out on the way up.',
  mistakes:['Elbows swinging forward.','Cutting the stretch at the bottom — the stretch is the point of this one.'],
  alternatives:['barbell-curl','cable-curl'] },

{ id:'overhead-triceps-ext', name:'Overhead triceps extension', short:'Overhead ext', day:3, order:8,
  modality:'load_reps', equipment:'dumbbell', pattern:'elbow extension',
  primary:'triceps', secondary:[], direction:'Weight lowered behind the head and pressed back to lockout.',
  sets:3, lo:12, hi:15, restSec:60, anim:'oht',
  setup:['Single dumbbell or rope, elbows pointing up and in.'],
  execution:['Lower behind the head to a deep stretch.','Extend to lockout without the elbows flaring.'],
  breathing:'Out on the extension.',
  mistakes:['Elbows flaring wide.','Short range that skips the stretch.','Lower back arching under the load.'],
  alternatives:['triceps-pushdown','close-grip-bench'] },

/* ------------------------------------------------------------- DAY 4: LOWER B */
{ id:'deadlift-conventional', name:'Conventional deadlift', short:'Deadlift', day:4, order:1,
  modality:'load_reps', equipment:'barbell', pattern:'hinge',
  primary:'posterior chain', secondary:['back','glutes','hamstrings','grip'], direction:'Bar lifted from the floor to a standing lockout.',
  sets:3, lo:3, hi:6, restSec:210, anim:'dead',
  setup:['Bar over the mid-foot, shins close.','Grip just outside the knees, flat back, lats engaged.','Take the slack out of the bar before you pull.'],
  execution:['Push the floor away, bar dragging up the legs.','Hips and shoulders rise together.','Lock out hips and knees at the same time.'],
  breathing:'Big breath at the top of the setup, hold through the rep, reset the breath between reps.',
  mistakes:['Hips shooting up first, turning it into a stiff-leg pull.','Rounding the lower back.','Yanking the bar off the floor without taking the slack out.'],
  alternatives:['deadlift-trap-bar','rdl-barbell'],
  note:'Split from the trap-bar version — different bar path, different history.' },

{ id:'deadlift-trap-bar', name:'Trap-bar deadlift', short:'Trap-bar DL', day:4, order:1,
  modality:'load_reps', equipment:'barbell', pattern:'hinge',
  primary:'posterior chain', secondary:['quads','glutes','grip'], direction:'Load lifted from the floor inside a hex bar to a standing lockout.',
  sets:3, lo:3, hi:6, restSec:210, anim:'dead_trap',
  setup:['Stand in the centre of the bar, mid-foot under the handles.','Flat back, chest up, slack out.'],
  execution:['Push the floor away.','Lock hips and knees together.','Lower under control, not a drop.'],
  breathing:'Brace at the top of the setup, hold through the rep.',
  mistakes:['Letting the bar tip forward or back.','Squatting it so low the back rounds.','Dropping every rep from lockout.'],
  alternatives:['deadlift-conventional','rdl-barbell'] },

{ id:'bulgarian-split-squat', name:'Bulgarian split squat', short:'Split squat', day:4, order:2,
  modality:'load_reps', equipment:'dumbbell', pattern:'single-leg squat', perSide:true,
  primary:'quads', secondary:['glutes','adductors'], direction:'Rear foot elevated, front leg bends and drives back up.',
  sets:3, lo:8, hi:12, restSec:120, anim:'bss',
  setup:['Rear foot on a bench, front foot far enough forward that the shin stays near vertical.','Dumbbells at the sides.'],
  execution:['Lower until the back knee is just off the floor.','Drive up through the front mid-foot.'],
  breathing:'In on the way down, out on the drive up.',
  mistakes:['Front foot too close so the knee travels far past the toe.','Pushing off the back foot.','Torso collapsing forward.'],
  alternatives:['walking-lunge','leg-press','step-up'] },

{ id:'hip-thrust', name:'Barbell hip thrust', short:'Hip thrust', day:4, order:3,
  modality:'load_reps', equipment:'barbell', pattern:'hinge',
  primary:'glutes', secondary:['hamstrings'], direction:'Hips driven from the floor up to full extension against a bench.',
  sets:3, lo:10, hi:12, restSec:120, anim:'hip',
  setup:['Upper back on a bench, bar across the hips with a pad.','Feet flat, shins vertical at the top.'],
  execution:['Drive the hips up to full extension.','Chin tucked, ribs down.','Lower under control.'],
  breathing:'Out at the top of the thrust.',
  mistakes:['Arching the lower back instead of extending the hips.','Feet too close or too far so the hamstrings or quads take over.','Partial lockout.'],
  alternatives:['glute-bridge','rdl-barbell'] },

{ id:'leg-extension', name:'Leg extension', short:'Leg extension', day:4, order:4,
  modality:'load_reps', equipment:'machine', pattern:'knee extension',
  primary:'quads', secondary:[], direction:'Lower legs straighten against the pad.',
  sets:3, lo:12, hi:15, restSec:60, anim:'legext',
  setup:['Knee joint on the machine pivot, pad on the lower shin.'],
  execution:['Extend to straight, pause and squeeze.','Lower slowly.'],
  breathing:'Out on the extension.',
  mistakes:['Slamming into lockout.','Hips lifting off the seat.','Letting the stack rest at the bottom.'],
  alternatives:['leg-press','squat-barbell'] },

{ id:'lying-leg-curl', name:'Lying leg curl', short:'Lying leg curl', day:4, order:5,
  modality:'load_reps', equipment:'machine', pattern:'knee flexion',
  primary:'hamstrings', secondary:['calves'], direction:'Heels curled toward the glutes while lying face down.',
  sets:3, lo:12, hi:15, restSec:60, anim:'legcurl2',
  setup:['Hips flat on the pad, knee joint on the pivot.'],
  execution:['Curl to full flexion.','Lower slowly under tension.'],
  breathing:'Out on the curl.',
  mistakes:['Hips popping up to help.','Bouncing out of the bottom.','Partial range.'],
  alternatives:['seated-leg-curl','rdl-barbell'] },

{ id:'seated-calf-raise', name:'Seated calf raise', short:'Seated calf', day:4, order:6,
  modality:'load_reps', equipment:'machine', pattern:'ankle extension',
  primary:'calves', secondary:[], direction:'Heels drop then press up with the knees bent.',
  sets:4, lo:15, hi:20, restSec:45, anim:'calf2',
  setup:['Pad low on the thighs, balls of the feet on the step.'],
  execution:['Full stretch at the bottom, pause at the top.','Slow throughout.'],
  breathing:'Out on the way up.',
  mistakes:['Bouncing.','Tiny range.','Rushing — this one responds to time under tension.'],
  alternatives:['standing-calf-raise'] },

{ id:'ab-wheel-kneeling', name:'Ab wheel rollout (kneeling)', short:'Ab wheel', day:4, order:7, block:'core',
  modality:'bodyweight_reps', equipment:'bodyweight', pattern:'anti-extension',
  primary:'abs', secondary:['lats','spinal erectors'], direction:'Wheel rolls forward away from the knees and back.',
  sets:4, lo:6, hi:10, restSec:75, anim:'abwheel',
  setup:['Kneeling, wheel under the shoulders, pelvis tucked.'],
  execution:['Roll out only as far as the lower back stays flat.','Pull back with the abs, not the hip flexors.'],
  breathing:'In as you roll out, out as you pull back.',
  mistakes:['Rolling past the point where the back arches — that makes it a lower-back exercise.','Hinging at the hips instead of extending the body.','Chasing range before control.'],
  alternatives:['ab-wheel-standing','cable-crunch','plank'],
  progressionNote:'Range comes first. Reps climb to 10 at bodyweight, then range extends toward the standing version.' },

{ id:'ab-wheel-standing', name:'Ab wheel rollout (standing)', short:'Standing ab wheel', day:4, order:7, block:'core',
  modality:'weighted_bodyweight', equipment:'bodyweight', pattern:'anti-extension',
  primary:'abs', secondary:['lats'], direction:'Full standing rollout and return.',
  sets:3, lo:3, hi:8, restSec:120, anim:'abwheel_standing',
  setup:['Standing, feet hip width, wheel in front.'],
  execution:['Roll out keeping the back flat.','Pull back without piking the hips first.'],
  breathing:'In out, out back.',
  mistakes:['Attempting it before 10 clean kneeling reps.','Lower back arching at full extension.'],
  alternatives:['ab-wheel-kneeling'],
  prerequisite:'ab-wheel-kneeling' },

{ id:'landmine-rotation', name:'Landmine rotation', short:'Landmine rotation', day:4, order:8, block:'core',
  modality:'load_reps', equipment:'barbell', pattern:'rotation', perSide:true,
  primary:'obliques', secondary:['abs','shoulders'], direction:'Bar end swings in an arc across the body.',
  sets:3, lo:8, hi:10, restSec:75, anim:'landmine',
  setup:['Bar in a landmine or wedged in a corner.','Hold the end at chest height, feet shoulder width.'],
  execution:['Rotate through the hips and upper back, pivoting the back foot.','Control the arc both ways — no throwing.'],
  breathing:'Out as you rotate away from centre.',
  mistakes:['Rotating from the lower back instead of the hips and thoracic spine.','Starting far too heavy — the leverage is deceptive.','Throwing the bar and catching it.'],
  alternatives:['pallof-press','cable-woodchop'] },

{ id:'farmers-walk', name:"Farmer's walk", short:"Farmer's walk", day:4, order:9, block:'core',
  modality:'carry', equipment:'dumbbell', pattern:'loaded carry',
  primary:'trunk', secondary:['traps','grip','glutes'], direction:'Walk a set distance with heavy load in both hands.',
  sets:3, lo:40, hi:40, restSec:120, anim:'farmer', unit:'m',
  setup:['Two heavy dumbbells at the sides.','Stand tall, shoulders back before the first step.'],
  execution:['Walk the distance tall and controlled.','Set them down, do not drop them.'],
  breathing:'Steady breathing throughout.',
  mistakes:['Leaning forward.','Shrugging the whole way.','Adding distance instead of load.'],
  alternatives:['suitcase-carry','trap-bar-carry'],
  progressionNote:'Distance fixed at 40 m. Load is the only variable that moves.' }
];

/* Index and helpers ------------------------------------------------------- */
const EX_INDEX = {};
EXERCISES.forEach(e => { EX_INDEX[e.id] = e; });

function exercisesForDay(day) {
  return EXERCISES.filter(e => e.day === day).sort((a, b) => a.order - b.order);
}
function dayOfExerciseMap() {
  const m = {};
  EXERCISES.forEach(e => { m[e.id] = e.day; });
  // legacy v1 ids -> new variant ids, so migrated history lands on the right variant
  Object.entries(LEGACY_ID_MAP).forEach(([oldId, newId]) => {
    const ex = EX_INDEX[newId]; if (ex) m[oldId] = ex.day;
  });
  return m;
}

/* v1 used one id per row of the old table. These map onto the split variants.
   Where a v1 id covered two real exercises, it maps to the more conservative
   one and the migration notes record the ambiguity. */
const LEGACY_ID_MAP = {
  bench:'bench-barbell', row:'row-barbell', ohp:'ohp-barbell', pulldown:'lat-pulldown',
  incdb:'incline-db-press', facepull:'face-pull', push:'triceps-pushdown', curl1:'barbell-curl',
  cablecrunch:'cable-crunch', pallof:'pallof-press',
  squat:'squat-barbell', rdl:'rdl-barbell', legpress:'leg-press', legcurl1:'seated-leg-curl',
  calf1:'standing-calf-raise', legraise:'weighted-hanging-leg-raise',
  suitcase:'suitcase-carry', sideplank:'side-plank-weighted',
  incbar:'incline-barbell-press', wpull:'weighted-pull-up', dbohp:'db-shoulder-press',
  csrow:'chest-supported-row', fly:'cable-fly', lat:'lateral-raise', curl2:'incline-db-curl',
  oht:'overhead-triceps-ext',
  dead:'deadlift-conventional', bss:'bulgarian-split-squat', hip:'hip-thrust',
  legext:'leg-extension', legcurl2:'lying-leg-curl', calf2:'seated-calf-raise',
  abwheel:'ab-wheel-kneeling', landmine:'landmine-rotation', farmer:'farmers-walk'
};

/* ============================================================================
   ASSET MANIFEST
   Honest provenance. The animations are original vector work generated by the
   figure engine in this repo — they are NOT reviewed demonstration video and
   must not be presented as verified technique. See ASSETS.md for the gap list
   and production brief.
   ========================================================================== */
const ASSET_MANIFEST = {
  generatedBy: 'figure.js parametric pose engine (original work, no third-party assets)',
  licence: 'Original work created for this project. Owned by the app owner. No third-party media included.',
  reviewStatus: 'UNREVIEWED — not checked by a qualified strength coach or physiotherapist.',
  disclaimer: 'Animations indicate movement direction and rough joint positions only. They are a diagram, not a technique reference.',
  gaps: [
    'No filmed demonstration video for any exercise.',
    'Figures are 2D side-view stick figures: grip width, foot angle and bar path nuance are not represented.',
    'Several exercises share a pose family where the side view genuinely looks similar (lat raise vs front raise plane).',
    'No per-side views for rotation movements (landmine, Pallof).',
    'No qualified review of any cue text.'
  ],
  entries: []     // filled below
};
EXERCISES.forEach(e => {
  ASSET_MANIFEST.entries.push({
    exercise: e.id,
    animation: e.anim ? `lifts.js:${e.anim}` : null,
    type: e.anim ? 'original parametric SVG animation' : 'MISSING',
    licence: 'Original work',
    reviewed: false,
    reviewer: null,
    status: e.anim ? 'unreviewed-original' : 'gap-no-asset',
    textAlternative: !!e.direction,
    cueSource: 'Written by the app author from general training practice. Unreviewed.'
  });
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EXERCISES, EX_INDEX, exercisesForDay, LEGACY_ID_MAP, dayOfExerciseMap, ASSET_MANIFEST };
}
if (typeof window !== 'undefined') {
  window.EXERCISES = EXERCISES; window.EX_INDEX = EX_INDEX;
  window.LEGACY_ID_MAP = LEGACY_ID_MAP; window.ASSET_MANIFEST = ASSET_MANIFEST;
}
