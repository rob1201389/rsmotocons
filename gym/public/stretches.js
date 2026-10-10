/* Stretch library. Angles: 0=right, 90=down, 180=left, 270=up.
   Figure faces right. `*F` keys drive the far-side limb so the legs can differ.
   `ground` names the joints that touch the floor, so the figure sits correctly. */

const STRETCHES = [
  /* ---------------- PRE-LIFT: dynamic, about 5 minutes ---------------- */
  {
    id:'catcow', block:'warm', name:'Cat–cow', time:'8 slow reps',
    why:'Wakes the spine up before it has to brace under a bar.',
    how:'On hands and knees. Breathe out and round your back toward the ceiling, breathe in and let the belly drop as you lift the chest. Move with the breath.',
    ms:3200, ground:['near.hand','near.knee'],
    a:{hip:[128,70],spine:188,neck:196,armU:88,armF:92,armUF:84,armFF:88,
       thigh:90,shin:4,foot:352,thighF:92,shinF:6,footF:354,bend:13},
    b:{hip:[128,70],spine:184,neck:148,armU:88,armF:92,armUF:84,armFF:88,
       thigh:90,shin:4,foot:352,thighF:92,shinF:6,footF:354,bend:-17}
  },
  {
    id:'lungereach', block:'warm', name:'Deep lunge with reach', time:'5 each side',
    why:'Opens the hip and the mid-back in one move. Best single warm-up before squats.',
    how:'Long lunge, front foot flat, back leg straight behind. Inside hand to the floor, then reach the other arm up and turn your chest to follow it. Eyes on the top hand.',
    ms:3200, ground:['near.toe','far.knee','far.toe'],
    a:{hip:[100,74],spine:268,neck:272,armU:70,armF:85,armUF:95,armFF:92,
       thigh:28,shin:100,foot:0,thighF:148,shinF:176,footF:160,bend:-4},
    b:{hip:[100,72],spine:276,neck:284,armU:282,armF:288,armUF:95,armFF:92,
       thigh:28,shin:100,foot:0,thighF:148,shinF:176,footF:160,bend:-10}
  },
  {
    id:'legswing', block:'warm', name:'Leg swings', time:'12 each leg',
    why:'Loosens hips and hamstrings without killing the stiffness you need for lifting.',
    how:'Hold a rack for balance. Swing one leg forward and back, relaxed, letting the range build across the set. Stay tall rather than hinging to chase height.',
    ms:1800, ground:['far.toe'],
    a:{hip:[100,60],spine:270,neck:270,armU:2,armF:0,armUF:95,armFF:92,
       thigh:52,shin:74,foot:10,thighF:90,shinF:90,footF:0,bend:0},
    b:{hip:[100,60],spine:270,neck:270,armU:2,armF:0,armUF:95,armFF:92,
       thigh:126,shin:100,foot:20,thighF:90,shinF:90,footF:0,bend:0}
  },
  {
    id:'bandover', block:'warm', name:'Band pass-through', time:'15 reps',
    why:'Gets the shoulders ready to bench and press without forcing range you do not have.',
    how:'Light band, wide grip, arms straight. Take it from your thighs up and overhead as far as is comfortable, then back. Widen the grip if the shoulders pinch.',
    ms:2600, ground:['near.toe','far.toe'],
    a:{hip:[100,60],spine:270,neck:270,armU:52,armF:66,armUF:60,armFF:74,
       thigh:90,shin:90,foot:0,thighF:92,shinF:90,footF:0,bend:0},
    b:{hip:[100,60],spine:270,neck:270,armU:276,armF:282,armUF:264,armFF:270,
       thigh:90,shin:90,foot:0,thighF:92,shinF:90,footF:0,bend:0}
  },
  {
    id:'deepsquat', block:'warm', name:'Deep squat hold', time:'45 s',
    why:'Rehearses the bottom of your squat and opens ankles and hips at the same time.',
    how:'Feet about shoulder width, sink to the bottom and sit there. Elbows inside the knees, press them out gently, heels down. If the heels lift, hold a rack and let your weight hang back.',
    ms:3400, ground:['near.toe','near.ankle','far.toe'],
    a:{hip:[100,62],spine:276,neck:278,armU:60,armF:50,armUF:66,armFF:56,
       thigh:84,shin:92,foot:0,thighF:88,shinF:94,footF:0,bend:-2},
    b:{hip:[100,108],spine:296,neck:288,armU:96,armF:64,armUF:102,armFF:70,
       thigh:335,shin:110,foot:0,thighF:341,shinF:106,footF:0,bend:-8}
  },

  /* ---------------- POST-LIFT / REST DAY: hold each 45–60 s ---------------- */
  {
    id:'childs', block:'flow', name:"Child's pose", time:'60 s',
    why:'Settles the lower back after heavy squats or deadlifts.',
    how:'Knees wide, big toes together, sit back onto your heels and walk the hands forward. Let the head hang and breathe into the back of your ribs.',
    ms:3400, ground:['near.hand','near.knee','near.ankle'],
    a:{hip:[128,74],spine:192,neck:198,armU:196,armF:186,armUF:192,armFF:184,
       thigh:52,shin:6,foot:356,thighF:56,shinF:8,footF:358,bend:9},
    b:{hip:[132,80],spine:184,neck:190,armU:186,armF:181,armUF:184,armFF:180,
       thigh:40,shin:3,foot:353,thighF:44,shinF:5,footF:355,bend:16}
  },
  {
    id:'couch', block:'flow', name:'Couch stretch', time:'60 s each side',
    why:'The one that matters most for you. Heavy squatting shortens the hip flexors and quads, and that tilts the pelvis and loads the lower back.',
    how:'Back shin up a wall or bench, front foot flat and forward. Square the hips, squeeze the back glute and stand the torso tall. Back off until you can breathe normally.',
    ms:3400, ground:['near.toe','far.knee'],
    a:{hip:[100,70],spine:264,neck:268,armU:92,armF:88,armUF:95,armFF:90,
       thigh:26,shin:98,foot:0,thighF:120,shinF:244,footF:258,bend:-5},
    b:{hip:[100,66],spine:274,neck:278,armU:96,armF:90,armUF:98,armFF:92,
       thigh:30,shin:100,foot:0,thighF:104,shinF:250,footF:264,bend:-12}
  },
  {
    id:'pigeon', block:'flow', name:'Pigeon pose', time:'60 s each side',
    why:'Gets into the glute and deep hip rotators, which lock up from squats, lunges and carries.',
    how:'Front shin across in front of you, back leg long behind. Keep the hips level rather than collapsing to one side. Walk the hands forward to go deeper.',
    ms:3400, ground:['far.knee','far.toe','near.hand'],
    a:{hip:[112,76],spine:206,neck:214,armU:140,armF:112,armUF:136,armFF:108,
       thigh:14,shin:162,foot:176,thighF:170,shinF:177,footF:162,bend:7},
    b:{hip:[114,80],spine:188,neck:194,armU:176,armF:179,armUF:174,armFF:177,
       thigh:10,shin:164,foot:178,thighF:172,shinF:179,footF:164,bend:15}
  },
  {
    id:'halfsplit', block:'flow', name:'Half split', time:'45 s each side',
    why:'Hamstrings, without the lower-back rounding you get from bent-over toe touches.',
    how:'From a kneeling lunge, shift the hips back over the rear knee and straighten the front leg, toes up. Hinge from the hips with a flat back. You want it in the hamstring belly, not behind the knee.',
    ms:3400, ground:['far.knee','near.ankle','far.toe'],
    a:{hip:[112,66],spine:256,neck:262,armU:98,armF:94,armUF:100,armFF:96,
       thigh:4,shin:2,foot:300,thighF:112,shinF:184,footF:152,bend:-5},
    b:{hip:[112,64],spine:218,neck:226,armU:130,armF:116,armUF:132,armFF:118,
       thigh:6,shin:3,foot:298,thighF:114,shinF:186,footF:154,bend:5}
  },
  {
    id:'cobra', block:'flow', name:'Upward dog', time:'45 s',
    why:'Counters a day at a desk and the rounded-forward position bench and rows put you in.',
    how:'Face down, hands under the shoulders, press the chest up and forward. Shoulders down away from the ears, glutes relaxed. Stop where the lower back feels worked, not pinched.',
    ms:3400, ground:['near.hand','near.toe','far.toe'],
    a:{hip:[118,92],spine:184,neck:190,armU:84,armF:96,armUF:82,armFF:94,
       thigh:4,shin:2,foot:350,thighF:6,shinF:4,footF:352,bend:5},
    b:{hip:[118,92],spine:222,neck:250,armU:72,armF:94,armUF:70,armFF:92,
       thigh:4,shin:2,foot:350,thighF:6,shinF:4,footF:352,bend:-15}
  },
  {
    id:'twist', block:'flow', name:'Seated spinal twist', time:'45 s each side',
    why:'Thoracic rotation, which is the bit you actually want moving. Keeps the lower back out of it.',
    how:'Sit tall, one leg crossed over. Turn from the middle of your back, using the arm as a light lever rather than cranking on it. Sit taller on the breath in, turn a little more on the breath out.',
    ms:3400, ground:['hip','near.ankle','far.ankle'],
    a:{hip:[100,86],spine:270,neck:272,armU:118,armF:66,armUF:58,armFF:96,
       thigh:6,shin:32,foot:0,thighF:356,shinF:6,footF:350,bend:-3},
    b:{hip:[100,86],spine:274,neck:298,armU:144,armF:38,armUF:48,armFF:100,
       thigh:6,shin:32,foot:0,thighF:356,shinF:6,footF:350,bend:-7}
  },
  {
    id:'doorchest', block:'flow', name:'Doorway chest stretch', time:'45 s each side',
    why:'Opens the chest and front delt after pressing. Helps your bench setup as much as your posture.',
    how:'Forearm on a doorframe or rack upright, elbow about shoulder height. Step through and turn away from the arm. Chest stretch, not shoulder-joint pinch.',
    ms:3000, ground:['near.toe','far.toe'],
    a:{hip:[100,60],spine:270,neck:272,armU:196,armF:258,armUF:94,armFF:90,
       thigh:88,shin:90,foot:0,thighF:95,shinF:92,footF:0,bend:0},
    b:{hip:[106,60],spine:272,neck:280,armU:188,armF:252,armUF:94,armFF:90,
       thigh:86,shin:90,foot:0,thighF:98,shinF:94,footF:0,bend:-2}
  },
  {
    id:'butterfly', block:'flow', name:'Butterfly', time:'60 s',
    why:'Groin and inner thigh. These cop a hammering from squats and split squats and get ignored.',
    how:'Soles of the feet together, heels in toward you. Sit tall, then hinge forward from the hips. Let the knees fall rather than forcing them down.',
    ms:3400, ground:['hip','near.toe','far.toe'],
    a:{hip:[100,86],spine:270,neck:272,armU:108,armF:68,armUF:106,armFF:66,
       thigh:22,shin:152,foot:202,thighF:24,shinF:154,footF:204,bend:-3},
    b:{hip:[100,86],spine:238,neck:244,armU:118,armF:58,armUF:116,armFF:56,
       thigh:20,shin:154,foot:204,thighF:22,shinF:156,footF:206,bend:9}
  },
  {
    id:'calfwall', block:'flow', name:'Calf and ankle at a wall', time:'45 s each side',
    why:'Ankle range is usually what stops you hitting depth with your heels down.',
    how:'Toes a hand-width from a wall, drive the knee forward over the toes without letting the heel lift. Hold at end range, then ease off. Repeat with that knee straight to get the upper calf.',
    ms:2800, ground:['near.toe','near.ankle','far.toe'],
    a:{hip:[100,60],spine:270,neck:272,armU:356,armF:354,armUF:0,armFF:358,
       thigh:90,shin:90,foot:0,thighF:95,shinF:92,footF:0,bend:0},
    b:{hip:[92,66],spine:274,neck:276,armU:358,armF:356,armUF:2,armFF:0,
       thigh:112,shin:52,foot:0,thighF:98,shinF:94,footF:0,bend:0}
  }
];

if(typeof module!=='undefined') module.exports={STRETCHES};

if (typeof window !== 'undefined') window.STRETCHES = STRETCHES;
