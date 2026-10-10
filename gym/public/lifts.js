/* Movement animations for the training exercises.
   Same angle convention as stretches.js: 0=right, 90=down, 180=left, 270=up.
   Figure faces right. Keyed by the exercise id used in index.html.
   prop: 'bar' (plate seen end-on), 'db' (one dumbbell), 'db2' (two).
   anchor: a fixed point a cable or band runs to. bench: [[x1,y1],[x2,y2]]. */

const STAND = {hip:[100,60],spine:270,neck:270,thigh:90,shin:90,foot:0,thighF:92,shinF:92,footF:0,bend:0};
const SEATED = {hip:[100,86],spine:268,neck:268,thigh:2,shin:88,foot:0,thighF:4,shinF:90,footF:0,bend:0};
const SUPINE = {hip:[112,88],spine:180,neck:180,thigh:8,shin:88,foot:0,thighF:10,shinF:90,footF:0,bend:0};

const LIFTS = {
  /* ---- Day 1 ---- */
  bench:{ ms:2400, ground:['near.toe','far.toe'],
    a:{...SUPINE,prop:'bar',bench:[[60,96],[124,96]],armU:332,armF:232,armUF:330,armFF:234},
    b:{...SUPINE,prop:'bar',bench:[[60,96],[124,96]],armU:286,armF:280,armUF:288,armFF:282} },

  row:{ ms:2400, ground:['near.toe','far.toe'],
    a:{...STAND,hip:[100,64],spine:232,neck:228,prop:'bar',thigh:96,shin:84,thighF:98,shinF:86,
       armU:88,armF:90,armUF:86,armFF:88,bend:-3},
    b:{...STAND,hip:[100,64],spine:232,neck:228,prop:'bar',thigh:96,shin:84,thighF:98,shinF:86,
       armU:140,armF:40,armUF:138,armFF:42,bend:-3} },

  ohp:{ ms:2400, ground:['near.toe','far.toe'],
    a:{...STAND,prop:'bar',armU:340,armF:212,armUF:338,armFF:214},
    b:{...STAND,prop:'bar',armU:278,armF:274,armUF:276,armFF:272} },

  pulldown:{ ms:2400, ground:['near.toe','far.toe'], anchorNote:1,
    a:{...SEATED,anchor:[104,6],prop:'bar',armU:288,armF:284,armUF:286,armFF:282},
    b:{...SEATED,anchor:[104,6],prop:'bar',armU:346,armF:206,armUF:344,armFF:208} },

  incdb:{ ms:2400, ground:['near.toe','far.toe'],
    a:{...SUPINE,hip:[112,90],spine:196,neck:196,prop:'db2',bench:[[62,102],[122,100]],
       armU:338,armF:244,armUF:336,armFF:246},
    b:{...SUPINE,hip:[112,90],spine:196,neck:196,prop:'db2',bench:[[62,102],[122,100]],
       armU:292,armF:288,armUF:290,armFF:286} },

  facepull:{ ms:2200, ground:['near.toe','far.toe'],
    a:{...STAND,anchor:[168,34],armU:356,armF:354,armUF:0,armFF:358},
    b:{...STAND,anchor:[168,34],armU:330,armF:220,armUF:332,armFF:222} },

  push:{ ms:2000, ground:['near.toe','far.toe'],
    a:{...STAND,anchor:[104,12],armU:84,armF:306,armUF:86,armFF:308},
    b:{...STAND,anchor:[104,12],armU:88,armF:84,armUF:90,armFF:86} },

  curl1:{ ms:2200, ground:['near.toe','far.toe'],
    a:{...STAND,prop:'bar',armU:92,armF:88,armUF:94,armFF:90},
    b:{...STAND,prop:'bar',armU:96,armF:318,armUF:98,armFF:320} },

  cablecrunch:{ ms:2400, ground:['near.knee','near.toe'],
    a:{hip:[104,86],spine:272,neck:276,anchor:[112,8],thigh:92,shin:356,foot:346,
       thighF:94,shinF:358,footF:348,armU:310,armF:318,armUF:308,armFF:316,bend:-4},
    b:{hip:[104,86],spine:250,neck:238,anchor:[112,8],thigh:92,shin:356,foot:346,
       thighF:94,shinF:358,footF:348,armU:300,armF:330,armUF:298,armFF:328,bend:16} },

  pallof:{ ms:2400, ground:['near.toe','far.knee'],
    a:{hip:[100,70],spine:268,neck:268,anchor:[170,52],thigh:24,shin:96,foot:0,
       thighF:128,shinF:252,footF:268,armU:12,armF:170,armUF:14,armFF:172,bend:-4},
    b:{hip:[100,70],spine:268,neck:268,anchor:[170,52],thigh:24,shin:96,foot:0,
       thighF:128,shinF:252,footF:268,armU:4,armF:2,armUF:6,armFF:4,bend:-4} },

  /* ---- Day 2 ---- */
  squat:{ ms:2800, ground:['near.toe','near.ankle','far.toe'],
    a:{...STAND,hip:[100,60],prop:'barback',spine:272,armU:170,armF:206,armUF:172,armFF:208},
    b:{hip:[100,105],spine:300,neck:292,prop:'barback',thigh:336,shin:108,foot:0,
       thighF:340,shinF:104,footF:0,armU:176,armF:212,armUF:178,armFF:214,bend:-6} },

  rdl:{ ms:2600, ground:['near.toe','far.toe'],
    a:{...STAND,hip:[100,60],prop:'bar',armU:90,armF:90,armUF:92,armFF:92},
    b:{hip:[100,62],spine:216,neck:212,prop:'bar',thigh:98,shin:86,foot:0,
       thighF:100,shinF:88,footF:0,armU:88,armF:90,armUF:90,armFF:92,bend:-4} },

  legpress:{ ms:2400, ground:['hip'],
    a:{hip:[86,92],spine:200,neck:200,bench:[[60,100],[96,96]],thigh:318,shin:356,foot:316,
       thighF:322,shinF:358,footF:318,armU:40,armF:60,armUF:42,armFF:62,bend:0},
    b:{hip:[86,92],spine:200,neck:200,bench:[[60,100],[96,96]],thigh:300,shin:60,foot:330,
       thighF:304,shinF:62,footF:332,armU:40,armF:60,armUF:42,armFF:62,bend:0} },

  legcurl1:{ ms:2200, ground:['hip'],
    a:{...SEATED,hip:[96,84],bench:[[66,94],[112,94]],thigh:4,shin:6,foot:356,
       thighF:6,shinF:8,footF:358,armU:70,armF:30,armUF:72,armFF:32},
    b:{...SEATED,hip:[96,84],bench:[[66,94],[112,94]],thigh:4,shin:76,foot:40,
       thighF:6,shinF:78,footF:42,armU:70,armF:30,armUF:72,armFF:32} },

  calf1:{ ms:1800, ground:['near.toe','far.toe'],
    a:{...STAND,hip:[100,62],armU:88,armF:88,armUF:90,armFF:90,shin:90,shinF:92},
    b:{...STAND,hip:[100,52],armU:88,armF:88,armUF:90,armFF:90,foot:330,footF:332} },

  legraise:{ ms:2600, ground:[],
    a:{hip:[100,74],spine:272,neck:272,anchor:[100,6],thigh:92,shin:90,foot:0,
       thighF:94,shinF:92,footF:0,armU:276,armF:274,armUF:278,armFF:276,bend:0},
    b:{hip:[100,74],spine:276,neck:276,anchor:[100,6],thigh:0,shin:356,foot:330,
       thighF:2,shinF:358,footF:332,armU:276,armF:274,armUF:278,armFF:276,bend:6} },

  suitcase:{ ms:2000, ground:['near.toe','far.toe'],
    a:{...STAND,prop:'db',armU:90,armF:90,armUF:92,armFF:92,thigh:72,shin:104,thighF:108,shinF:78},
    b:{...STAND,prop:'db',armU:90,armF:90,armUF:92,armFF:92,thigh:108,shin:78,thighF:72,shinF:104} },

  sideplank:{ ms:2600, ground:['near.elbow','near.toe'],
    a:{hip:[100,84],spine:200,neck:200,thigh:4,shin:2,foot:350,thighF:6,shinF:4,footF:352,
       armU:120,armF:30,armUF:290,armFF:288,bend:4},
    b:{hip:[100,78],spine:196,neck:196,thigh:2,shin:0,foot:348,thighF:4,shinF:2,footF:350,
       armU:112,armF:36,armUF:288,armFF:286,bend:-2} },

  /* ---- Day 3 ---- */
  incbar:{ ms:2400, ground:['near.toe','far.toe'],
    a:{...SUPINE,hip:[112,90],spine:198,neck:198,prop:'bar',bench:[[62,102],[122,100]],
       armU:336,armF:242,armUF:334,armFF:244},
    b:{...SUPINE,hip:[112,90],spine:198,neck:198,prop:'bar',bench:[[62,102],[122,100]],
       armU:292,armF:288,armUF:290,armFF:286} },

  wpull:{ ms:2600, ground:[],
    a:{hip:[100,78],spine:272,neck:272,anchor:[100,6],thigh:96,shin:96,foot:0,
       thighF:98,shinF:98,footF:0,armU:272,armF:270,armUF:274,armFF:272,bend:0},
    b:{hip:[100,92],spine:272,neck:270,anchor:[100,6],thigh:96,shin:96,foot:0,
       thighF:98,shinF:98,footF:0,armU:296,armF:238,armUF:298,armFF:240,bend:-2} },

  dbohp:{ ms:2400, ground:['hip'],
    a:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],prop:'db2',thigh:88,shin:90,
       armU:306,armF:232,armUF:304,armFF:234},
    b:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],prop:'db2',thigh:88,shin:90,
       armU:282,armF:278,armUF:280,armFF:276} },

  csrow:{ ms:2400, ground:['hip'],
    a:{hip:[100,80],spine:236,neck:232,bench:[[86,92],[126,66]],prop:'db2',thigh:60,shin:96,foot:0,
       thighF:62,shinF:98,footF:0,armU:86,armF:88,armUF:88,armFF:90,bend:-3},
    b:{hip:[100,80],spine:236,neck:232,bench:[[86,92],[126,66]],prop:'db2',thigh:60,shin:96,foot:0,
       thighF:62,shinF:98,footF:0,armU:142,armF:36,armUF:144,armFF:38,bend:-3} },

  fly:{ ms:2400, ground:['near.toe','far.toe'],
    a:{...STAND,anchor:[164,40],armU:350,armF:348,armUF:352,armFF:350,bend:-2},
    b:{...STAND,anchor:[164,40],armU:16,armF:20,armUF:18,armFF:22,bend:-4} },

  lat:{ ms:2000, ground:['near.toe','far.toe'],
    a:{...STAND,prop:'db',armU:88,armF:86,armUF:90,armFF:88},
    b:{...STAND,prop:'db',armU:10,armF:6,armUF:12,armFF:8} },

  curl2:{ ms:2200, ground:['hip'],
    a:{hip:[100,84],spine:252,neck:252,bench:[[74,96],[122,70]],prop:'db2',thigh:30,shin:94,foot:0,
       thighF:32,shinF:96,footF:0,armU:104,armF:100,armUF:106,armFF:102,bend:0},
    b:{hip:[100,84],spine:252,neck:252,bench:[[74,96],[122,70]],prop:'db2',thigh:30,shin:94,foot:0,
       thighF:32,shinF:96,footF:0,armU:108,armF:330,armUF:110,armFF:332,bend:0} },

  oht:{ ms:2200, ground:['near.toe','far.toe'],
    a:{...STAND,prop:'db',armU:276,armF:168,armUF:278,armFF:170},
    b:{...STAND,prop:'db',armU:274,armF:272,armUF:276,armFF:274} },

  /* ---- Day 4 ---- */
  dead:{ ms:2800, ground:['near.toe','far.toe'],
    a:{hip:[100,76],spine:226,neck:220,prop:'bar',thigh:50,shin:104,foot:0,
       thighF:52,shinF:106,footF:0,armU:88,armF:90,armUF:90,armFF:92,bend:-5},
    b:{...STAND,hip:[100,60],prop:'bar',armU:88,armF:90,armUF:90,armFF:92} },

  bss:{ ms:2600, ground:['near.toe'],
    a:{hip:[100,66],spine:270,neck:270,prop:'db2',thigh:34,shin:96,foot:0,
       thighF:134,shinF:206,footF:230,armU:90,armF:90,armUF:92,armFF:92,bend:0},
    b:{hip:[100,92],spine:276,neck:276,prop:'db2',thigh:8,shin:104,foot:0,
       thighF:122,shinF:200,footF:224,armU:90,armF:90,armUF:92,armFF:92,bend:-2} },

  hip:{ ms:2400, ground:['near.toe','far.toe'],
    a:{hip:[100,96],spine:300,neck:296,prop:'bar',bench:[[72,66],[108,66]],thigh:340,shin:96,foot:0,
       thighF:342,shinF:98,footF:0,armU:150,armF:150,armUF:152,armFF:152,bend:-2},
    b:{hip:[100,74],spine:342,neck:338,prop:'bar',bench:[[72,66],[108,66]],thigh:12,shin:104,foot:0,
       thighF:14,shinF:106,footF:0,armU:150,armF:150,armUF:152,armFF:152,bend:-6} },

  legext:{ ms:2200, ground:['hip'],
    a:{...SEATED,hip:[96,84],bench:[[66,94],[112,94]],thigh:4,shin:92,foot:0,
       thighF:6,shinF:94,footF:2,armU:70,armF:30,armUF:72,armFF:32},
    b:{...SEATED,hip:[96,84],bench:[[66,94],[112,94]],thigh:4,shin:2,foot:330,
       thighF:6,shinF:4,footF:332,armU:70,armF:30,armUF:72,armFF:32} },

  legcurl2:{ ms:2200, ground:['hip','near.hand'],
    a:{hip:[108,92],spine:184,neck:184,bench:[[58,100],[126,100]],thigh:2,shin:0,foot:350,
       thighF:4,shinF:2,footF:352,armU:170,armF:176,armUF:172,armFF:178,bend:2},
    b:{hip:[108,92],spine:184,neck:184,bench:[[58,100],[126,100]],thigh:2,shin:290,foot:276,
       thighF:4,shinF:292,footF:278,armU:170,armF:176,armUF:172,armFF:178,bend:2} },

  calf2:{ ms:1800, ground:['hip'],
    a:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],thigh:4,shin:88,foot:0,
       thighF:6,shinF:90,footF:2,armU:76,armF:50,armUF:78,armFF:52},
    b:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],thigh:4,shin:88,foot:324,
       thighF:6,shinF:90,footF:326,armU:76,armF:50,armUF:78,armFF:52} },

  abwheel:{ ms:2800, ground:['near.knee','near.hand'],
    a:{hip:[120,74],spine:206,neck:212,thigh:88,shin:4,foot:352,thighF:90,shinF:6,footF:354,
       armU:110,armF:96,armUF:112,armFF:98,bend:8},
    b:{hip:[120,86],spine:190,neck:196,thigh:76,shin:2,foot:350,thighF:78,shinF:4,footF:352,
       armU:178,armF:182,armUF:180,armFF:184,bend:-6} },

  landmine:{ ms:2400, ground:['near.toe','far.toe'],
    a:{...STAND,hip:[100,62],anchor:[36,104],armU:330,armF:332,armUF:332,armFF:334,bend:-2},
    b:{...STAND,hip:[100,62],anchor:[36,104],armU:10,armF:12,armUF:12,armFF:14,bend:4} },

  farmer:{ ms:1600, ground:['near.toe','far.toe'],
    a:{...STAND,prop:'db2',armU:90,armF:90,armUF:92,armFF:92,thigh:70,shin:106,thighF:110,shinF:76},
    b:{...STAND,prop:'db2',armU:90,armF:90,armUF:92,armFF:92,thigh:110,shin:76,thighF:70,shinF:106} }
};

if(typeof module!=='undefined') module.exports={LIFTS};

/* ---------------------------------------------------------------------------
   Distinct poses for the split variants, so a pull-up and an assisted pull-up
   are not shown the same picture. Added after the variant split.
   ------------------------------------------------------------------------ */
Object.assign(LIFTS, {
  /* Unassisted pull-up: clean dead hang to chin over bar, no equipment on the body. */
  pullup_bw:{ ms:2600, ground:[],
    a:{hip:[100,78],spine:272,neck:272,anchor:[100,6],thigh:96,shin:96,foot:0,
       thighF:98,shinF:98,footF:0,armU:272,armF:270,armUF:274,armFF:272,bend:0},
    b:{hip:[100,94],spine:272,neck:270,anchor:[100,6],thigh:96,shin:96,foot:0,
       thighF:98,shinF:98,footF:0,armU:300,armF:234,armUF:302,armFF:236,bend:-2} },

  /* Assisted: a band runs from the bar to the feet, so the legs sit forward on it. */
  pullup_assisted:{ ms:2600, ground:[],
    a:{hip:[100,78],spine:272,neck:272,anchor:[100,6],thigh:62,shin:70,foot:0,
       thighF:64,shinF:72,footF:0,armU:272,armF:270,armUF:274,armFF:272,bend:0},
    b:{hip:[100,92],spine:272,neck:270,anchor:[100,6],thigh:58,shin:66,foot:0,
       thighF:60,shinF:68,footF:0,armU:300,armF:234,armUF:302,armFF:236,bend:-2} },

  /* Weighted: plate hanging between the feet, knees bent to hold it. */
  pullup_weighted:{ ms:2800, ground:[],
    a:{hip:[100,78],spine:272,neck:272,anchor:[100,6],prop:'bar',thigh:100,shin:40,foot:0,
       thighF:102,shinF:42,footF:0,armU:272,armF:270,armUF:274,armFF:272,bend:0},
    b:{hip:[100,92],spine:272,neck:270,anchor:[100,6],prop:'bar',thigh:100,shin:40,foot:0,
       thighF:102,shinF:42,footF:0,armU:300,armF:234,armUF:302,armFF:236,bend:-2} },

  /* Trap-bar: more upright torso and more knee bend than a conventional pull. */
  dead_trap:{ ms:2800, ground:['near.toe','far.toe'],
    a:{hip:[100,80],spine:250,neck:246,prop:'bar',thigh:40,shin:112,foot:0,
       thighF:42,shinF:114,footF:0,armU:90,armF:90,armUF:92,armFF:92,bend:-3},
    b:{hip:[100,60],spine:270,neck:270,prop:'bar',thigh:90,shin:90,foot:0,
       thighF:92,shinF:92,footF:0,armU:90,armF:90,armUF:92,armFF:92,bend:0} },

  /* Bodyweight hanging leg raise: no plate between the feet. */
  legraise_bw:{ ms:2600, ground:[],
    a:{hip:[100,74],spine:272,neck:272,anchor:[100,6],thigh:92,shin:90,foot:0,
       thighF:94,shinF:92,footF:0,armU:276,armF:274,armUF:278,armFF:276,bend:0},
    b:{hip:[100,74],spine:276,neck:276,anchor:[100,6],thigh:2,shin:0,foot:330,
       thighF:4,shinF:2,footF:332,armU:276,armF:274,armUF:278,armFF:276,bend:6} },

  /* Standing ab wheel: full standing rollout, far greater range than kneeling. */
  abwheel_standing:{ ms:3000, ground:['near.toe','near.hand'],
    a:{hip:[116,62],spine:250,neck:256,thigh:92,shin:90,foot:0,thighF:94,shinF:92,footF:0,
       armU:120,armF:100,armUF:122,armFF:102,bend:4},
    b:{hip:[116,88],spine:188,neck:194,thigh:70,shin:40,foot:0,thighF:72,shinF:42,footF:0,
       armU:180,armF:184,armUF:182,armFF:186,bend:-8} }
});

/* ---------------------------------------------------------------------------
   Front-view poses. These movements happen in the frontal plane: drawn from
   the side they read as a completely different exercise, which the independent
   review flagged as misleading. `front:true` gives the figure two shoulders
   and two hips so both limbs are visible doing their actual job.
   ------------------------------------------------------------------------ */
Object.assign(LIFTS, {
  /* Lateral raise: both arms sweep out and up to shoulder height. */
  lat_front:{ ms:2200, ground:['near.toe','far.toe'],
    a:{front:true,bodyWidth:13,hip:[100,62],spine:270,neck:270,prop:'db2',
       armU:80,armF:82,armUF:100,armFF:98,thigh:92,shin:90,foot:0,thighF:88,shinF:90,footF:0,bend:0},
    b:{front:true,bodyWidth:13,hip:[100,62],spine:270,neck:270,prop:'db2',
       armU:5,armF:2,armUF:175,armFF:178,thigh:92,shin:90,foot:0,thighF:88,shinF:90,footF:0,bend:0} },

  /* Face pull: rope to the forehead, hands separating wide. */
  facepull_front:{ ms:2200, ground:['near.toe','far.toe'],
    a:{front:true,bodyWidth:13,hip:[100,62],spine:270,neck:270,anchor:[100,20],
       armU:340,armF:338,armUF:200,armFF:202,thigh:92,shin:90,foot:0,thighF:88,shinF:90,footF:0,bend:0},
    b:{front:true,bodyWidth:16,hip:[100,62],spine:270,neck:270,anchor:[100,20],
       armU:5,armF:310,armUF:175,armFF:230,thigh:92,shin:90,foot:0,thighF:88,shinF:90,footF:0,bend:0} },

  /* Cable fly: arms sweep from wide to together in front of the chest. */
  fly_front:{ ms:2400, ground:['near.toe','far.toe'],
    a:{front:true,bodyWidth:13,hip:[100,64],spine:272,neck:272,
       armU:350,armF:348,armUF:190,armFF:192,thigh:92,shin:90,foot:0,thighF:88,shinF:90,footF:0,bend:0},
    b:{front:true,bodyWidth:13,hip:[100,64],spine:272,neck:272,
       armU:28,armF:30,armUF:152,armFF:150,thigh:92,shin:90,foot:0,thighF:88,shinF:90,footF:0,bend:0} },

  /* Pallof press: half-kneeling, hands press straight out from the chest. */
  pallof_front:{ ms:2400, ground:['near.toe','far.knee'],
    a:{front:true,bodyWidth:12,hip:[100,72],spine:268,neck:268,anchor:[170,60],
       armU:20,armF:18,armUF:160,armFF:162,
       thigh:28,shin:96,foot:0,thighF:128,shinF:252,footF:268,bend:0},
    b:{front:true,bodyWidth:12,hip:[100,72],spine:268,neck:268,anchor:[170,60],
       armU:2,armF:0,armUF:178,armFF:180,
       thigh:28,shin:96,foot:0,thighF:128,shinF:252,footF:268,bend:0} },

  /* Landmine rotation: bar end swings in an arc across the body. */
  landmine_front:{ ms:2400, ground:['near.toe','far.toe'],
    a:{front:true,bodyWidth:13,hip:[100,64],spine:272,neck:272,anchor:[40,106],prop:'bar',
       armU:330,armF:328,armUF:200,armFF:198,thigh:94,shin:90,foot:0,thighF:86,shinF:90,footF:0,bend:0},
    b:{front:true,bodyWidth:13,hip:[100,64],spine:272,neck:272,anchor:[40,106],prop:'bar',
       armU:300,armF:298,armUF:238,armFF:236,thigh:94,shin:90,foot:0,thighF:86,shinF:90,footF:0,bend:0} },

  /* Farmer's walk seen from the front: load either side, body stays level. */
  farmer_front:{ ms:1600, ground:['near.toe','far.toe'],
    a:{front:true,bodyWidth:13,hip:[100,62],spine:270,neck:270,prop:'db2',
       armU:88,armF:88,armUF:92,armFF:92,thigh:84,shin:92,foot:0,thighF:96,shinF:88,footF:0,bend:0},
    b:{front:true,bodyWidth:13,hip:[100,60],spine:270,neck:270,prop:'db2',
       armU:88,armF:88,armUF:92,armFF:92,thigh:96,shin:88,foot:0,thighF:84,shinF:92,footF:0,bend:0} }
});
