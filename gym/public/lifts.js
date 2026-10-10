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

/* ---------------------------------------------------------------------------
   Library additions (home, travel, bodyweight, machine and kettlebell
   variants). Same angle conventions as above. Several are derived from an
   existing pose pair with one thing changed (the prop), where the side view is
   genuinely the same movement. Poses that rest on the floor were balanced so
   the ground contacts line up in both key poses (checked in library.test.js).
   Diagrams only: not reviewed technique references.
   ------------------------------------------------------------------------ */
const _FWD = {armU:2,armF:0,armUF:4,armFF:2};
Object.assign(LIFTS, {
  /* ---- derived from existing pairs ---- */
  dbbench:{ ms:2400, ground:LIFTS.bench.ground,
    a:{...LIFTS.bench.a,prop:'db2'}, b:{...LIFTS.bench.b,prop:'db2'} },
  dbrow:{ ms:2400, ground:LIFTS.row.ground,
    a:{...LIFTS.row.a,prop:'db'}, b:{...LIFTS.row.b,prop:'db'} },
  rdl_db:{ ms:2600, ground:LIFTS.rdl.ground,
    a:{...LIFTS.rdl.a,prop:'db2'}, b:{...LIFTS.rdl.b,prop:'db2'} },
  curl_db:{ ms:2200, ground:LIFTS.curl1.ground,
    a:{...LIFTS.curl1.a,prop:'db2'}, b:{...LIFTS.curl1.b,prop:'db2'} },
  machohp:{ ms:2400, ground:LIFTS.dbohp.ground,
    a:{...LIFTS.dbohp.a,prop:null}, b:{...LIFTS.dbohp.b,prop:null} },

  /* ---- machine / cable seated ---- */
  machpress:{ ms:2400, ground:['hip'],
    a:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],thigh:88,shin:90,armU:120,armF:0,armUF:122,armFF:2},
    b:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],thigh:88,shin:90,armU:2,armF:0,armUF:4,armFF:2} },
  cablerow:{ ms:2400, ground:['hip'],
    a:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],anchor:[176,80],thigh:352,shin:8,foot:330,
       thighF:354,shinF:10,footF:332,armU:8,armF:6,armUF:10,armFF:8},
    b:{...SEATED,hip:[100,84],bench:[[78,94],[118,94]],anchor:[176,80],spine:264,thigh:352,shin:8,foot:330,
       thighF:354,shinF:10,footF:332,armU:130,armF:8,armUF:132,armFF:10} },
  woodchop:{ ms:2400, ground:['near.toe','far.toe'],
    a:{front:true,bodyWidth:13,hip:[100,64],spine:272,neck:272,anchor:[165,8],
       armU:300,armF:296,armUF:284,armFF:292,thigh:94,shin:90,foot:0,thighF:86,shinF:90,footF:0,bend:0},
    b:{front:true,bodyWidth:13,hip:[100,64],spine:272,neck:272,anchor:[165,8],
       armU:130,armF:116,armUF:112,armFF:104,thigh:94,shin:90,foot:0,thighF:86,shinF:90,footF:0,bend:0} },

  /* ---- bodyweight standing ---- */
  squat_bw:{ ms:2800, ground:['near.toe','near.ankle','far.toe'],
    a:{...STAND,..._FWD},
    b:{...LIFTS.squat.b,prop:null,armU:354,armF:350,armUF:356,armFF:352} },
  goblet:{ ms:2800, ground:['near.toe','near.ankle','far.toe'],
    a:{...STAND,prop:'db',armU:70,armF:295,armUF:72,armFF:297},
    b:{...LIFTS.squat.b,prop:'db',spine:292,neck:288,armU:70,armF:295,armUF:72,armFF:297} },
  thruster:{ ms:2800, ground:['near.toe','near.ankle','far.toe'],
    a:{...LIFTS.squat.b,prop:'db2',spine:292,neck:288,armU:70,armF:295,armUF:72,armFF:297},
    b:{...STAND,prop:'db2',armU:276,armF:272,armUF:278,armFF:274} },
  kbswing:{ ms:2000, ground:['near.toe','far.toe'],
    a:{hip:[94,62],spine:225,neck:225,prop:'db',thigh:71,shin:98,foot:0,thighF:73,shinF:100,footF:0,
       armU:80,armF:75,armUF:82,armFF:77,bend:-3},
    b:{...STAND,prop:'db',armU:355,armF:352,armUF:357,armFF:354} },
  lunge:{ ms:2600, ground:['near.toe'],
    a:{...STAND,armU:90,armF:90,armUF:92,armFF:92},
    b:{hip:[100,89],spine:270,neck:270,thigh:6,shin:108,foot:0,thighF:99,shinF:201,footF:85,
       armU:90,armF:90,armUF:92,armFF:92,bend:0} },
  lunge_db:{ ms:2600, ground:['near.toe'],
    a:{...STAND,prop:'db2',armU:90,armF:90,armUF:92,armFF:92},
    b:{hip:[100,89],spine:270,neck:270,prop:'db2',thigh:6,shin:108,foot:0,thighF:99,shinF:201,footF:85,
       armU:90,armF:90,armUF:92,armFF:92,bend:0} },
  stepup:{ ms:2400, ground:['far.toe'],
    a:{hip:[116,64],spine:262,neck:262,bench:[[124,92],[160,92]],thigh:356,shin:104,foot:0,
       thighF:85,shinF:120,footF:0,armU:100,armF:60,armUF:80,armFF:40,bend:0},
    b:{hip:[140,32],spine:270,neck:270,bench:[[124,92],[160,92]],thigh:76,shin:105,foot:0,
       thighF:10,shinF:92,footF:0,armU:80,armF:40,armUF:100,armFF:60,bend:0} },
  jumpsq:{ ms:1600, ground:['near.toe','far.toe'],
    a:{hip:[100,92],spine:295,neck:290,thigh:31,shin:156,foot:0,thighF:33,shinF:158,footF:0,
       armU:130,armF:60,armUF:132,armFF:62,bend:-3},
    b:{...STAND,hip:[100,46],foot:60,footF:60,armU:275,armF:272,armUF:277,armFF:274} },
  highknees:{ ms:1200, ground:['far.toe'],
    a:{...STAND,armU:70,armF:330,armUF:110,armFF:40},
    b:{...STAND,thigh:15,shin:98,foot:10,armU:120,armF:50,armUF:40,armFF:300} },
  jackfront:{ ms:1400, ground:['near.toe','far.toe'],
    a:{front:true,bodyWidth:10,hip:[100,60],spine:270,neck:270,armU:80,armF:84,armUF:100,armFF:96,
       thigh:92,shin:90,foot:0,thighF:88,shinF:90,footF:0,bend:0},
    b:{front:true,bodyWidth:12,hip:[100,66],spine:270,neck:270,armU:292,armF:300,armUF:248,armFF:240,
       thigh:62,shin:68,foot:0,thighF:118,shinF:112,footF:0,bend:0} },
  wallsit:{ ms:3000, ground:['near.toe','far.toe'],
    a:{hip:[92,91],spine:270,neck:270,bench:[[84,16],[84,112]],thigh:0,shin:92,foot:0,thighF:2,shinF:92,footF:0,
       armU:60,armF:20,armUF:62,armFF:22,bend:0},
    b:{hip:[92,91],spine:270,neck:272,bench:[[84,16],[84,112]],thigh:0,shin:92,foot:0,thighF:2,shinF:92,footF:0,
       armU:300,armF:340,armUF:302,armFF:342,bend:0} },

  /* ---- floor: push-up family, plank, pike ---- */
  pushup:{ ms:2000, ground:['near.toe','near.hand'],
    a:{hip:[60,76],spine:341,neck:338,thigh:161,shin:161,foot:70,thighF:163,shinF:163,footF:70,
       armU:90,armF:90,armUF:92,armFF:92,bend:0},
    b:{hip:[59,86],spine:350,neck:346,thigh:170,shin:170,foot:70,thighF:172,shinF:172,footF:70,
       armU:140,armF:40,armUF:142,armFF:42,bend:0} },
  pushup_incline:{ ms:2000, ground:['near.toe'],
    a:{hip:[62,59],spine:322,neck:320,bench:[[88,84],[124,84]],thigh:142,shin:142,foot:70,thighF:144,shinF:144,footF:70,
       armU:90,armF:90,armUF:92,armFF:92,bend:0},
    b:{hip:[58,69],spine:333,neck:330,bench:[[88,84],[124,84]],thigh:153,shin:153,foot:70,thighF:155,shinF:155,footF:70,
       armU:140,armF:40,armUF:142,armFF:42,bend:0} },
  plank:{ ms:3200, ground:['near.toe','near.elbow'],
    a:{hip:[40,90],spine:355,neck:352,thigh:175,shin:175,foot:70,thighF:177,shinF:177,footF:70,
       armU:90,armF:355,armUF:92,armFF:357,bend:0},
    b:{hip:[40,90],spine:355,neck:356,thigh:175,shin:175,foot:70,thighF:177,shinF:177,footF:70,
       armU:90,armF:355,armUF:92,armFF:357,bend:-3} },
  pike:{ ms:2400, ground:['near.toe','near.hand'],
    a:{hip:[100,50],spine:41,neck:51,thigh:118,shin:118,foot:70,thighF:120,shinF:120,footF:70,
       armU:48,armF:48,armUF:50,armFF:50,bend:0},
    b:{hip:[120.4,67.7],spine:33,neck:43,thigh:144,shin:144,foot:70,thighF:146,shinF:146,footF:70,
       armU:130,armF:10,armUF:132,armFF:12,bend:0} },
  invrow:{ ms:2600, ground:['near.ankle'],
    a:{hip:[100,106],spine:358,neck:358,anchor:[129,60],thigh:178,shin:178,foot:0,thighF:178,shinF:178,footF:0,
       armU:250,armF:250,armUF:252,armFF:252,bend:0},
    b:{hip:[95.6,85.5],spine:338,neck:336,anchor:[129,60],thigh:158,shin:158,foot:0,thighF:158,shinF:158,footF:0,
       armU:150,armF:300,armUF:152,armFF:302,bend:0} },
  mtnclimb:{ ms:1200, ground:['near.hand','far.toe'],
    a:{hip:[60,76],spine:341,neck:338,thigh:161,shin:161,foot:70,thighF:163,shinF:163,footF:70,
       armU:90,armF:90,armUF:92,armFF:92,bend:0},
    b:{hip:[60,76],spine:341,neck:338,thigh:25,shin:150,foot:10,thighF:163,shinF:163,footF:70,
       armU:90,armF:90,armUF:92,armFF:92,bend:0} },
  burpee:{ ms:2000, ground:['near.toe','far.toe'],
    a:{hip:[90,86],spine:330,neck:326,thigh:11,shin:115,foot:0,thighF:13,shinF:117,footF:0,
       armU:85,armF:85,armUF:87,armFF:87,bend:-3},
    b:{hip:[60,87],spine:341,neck:338,thigh:161,shin:161,foot:70,thighF:163,shinF:163,footF:70,
       armU:90,armF:90,armUF:92,armFF:92,bend:0} },

  /* ---- floor: lying and kneeling ---- */
  bridge:{ ms:2400, ground:['near.toe','far.toe'],
    a:{hip:[112,103],spine:180,neck:180,thigh:321,shin:57,foot:0,thighF:323,shinF:59,footF:0,
       armU:8,armF:6,armUF:10,armFF:8,bend:0},
    b:{hip:[112,83],spine:154,neck:160,thigh:355,shin:72,foot:0,thighF:357,shinF:74,footF:0,
       armU:8,armF:6,armUF:10,armFF:8,bend:-4} },
  crunch:{ ms:2200, ground:['near.toe','far.toe'],
    a:{hip:[112,103],spine:180,neck:180,thigh:321,shin:57,foot:0,thighF:323,shinF:59,footF:0,
       armU:250,armF:110,armUF:252,armFF:112,bend:0},
    b:{hip:[112,103],spine:200,neck:212,thigh:321,shin:57,foot:0,thighF:323,shinF:59,footF:0,
       armU:250,armF:110,armUF:252,armFF:112,bend:7} },
  deadbug:{ ms:2800, ground:['hip'],
    a:{hip:[112,100],spine:180,neck:180,thigh:270,shin:0,foot:0,thighF:272,shinF:2,footF:0,
       armU:270,armF:270,armUF:272,armFF:272,bend:0},
    b:{hip:[112,100],spine:180,neck:180,thigh:350,shin:352,foot:340,thighF:272,shinF:2,footF:0,
       armU:270,armF:270,armUF:182,armFF:180,bend:0} },
  superman:{ ms:2600, ground:['hip'],
    a:{hip:[70,100],spine:358,neck:358,thigh:180,shin:180,foot:170,thighF:182,shinF:182,footF:170,
       armU:358,armF:358,armUF:2,armFF:2,bend:0},
    b:{hip:[70,100],spine:338,neck:332,thigh:192,shin:192,foot:185,thighF:194,shinF:194,footF:185,
       armU:340,armF:340,armUF:342,armFF:342,bend:-4} },
  birddog:{ ms:3000, ground:['near.hand','far.knee'],
    a:{hip:[100,76],spine:342,neck:345,thigh:90,shin:176,foot:186,thighF:92,shinF:178,footF:188,
       armU:90,armF:90,armUF:92,armFF:92,bend:0},
    b:{hip:[100,76],spine:342,neck:345,thigh:183,shin:183,foot:190,thighF:92,shinF:178,footF:188,
       armU:90,armF:90,armUF:345,armFF:345,bend:0} }
});
