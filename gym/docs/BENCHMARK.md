# Recomp — competitive benchmark and gap analysis

Research date: 10 October 2026. Every competitor claim below was read from an official
source (company site, help centre, App Store / Google Play listing) and carries its URL.
**VERIFIED** = read from the cited page. **NOT FOUND** = searched official sources and could
not confirm; that is an absence of evidence, not proof of absence. **OPINION** = my design
judgement, not a sourced fact.

A note on comparability: only Fitbod and Hevy are real comparators. Freeletics is a coached
plan product whose weights progression is, by its own documentation, mostly manual. Nike
Training Club has no set/weight logging at all. MacroFactor is a nutrition product and is
benchmarked only on the nutrition and adaptation columns.

---

## 1. Capability matrix

| Capability | Fitbod | Hevy | Freeletics | NTC | MacroFactor | **Recomp (this build)** |
|---|---|---|---|---|---|---|
| Set/rep/weight logging | Core | Core | Not a logging product | **None** | n/a | Yes, planned vs actual separated |
| Effort capture | RiR 0–4+ | RPE column | Binary "couldn't finish" | None | n/a | Effort 5-point + reserve 0–4+ + technique + capacity |
| Warm-up vs working sets | Auto-generated | 4 set types | 3–5 ramped warm-ups | n/a | n/a | Warm-up flag, excluded from working load |
| Rest timer backgrounded | Push notification | Timer present | **No timer** | n/a | n/a | Wall-clock, survives background + re-render |
| Edit past sessions | Full | Full | **Delete only** | n/a | n/a | Full, with records recalculated |
| Prescribes next load | Yes | Pro tier only | Mostly manual | No | n/a | Yes, free, on-device |
| Progression mechanism published | **Yes, in detail** | **No** | No | n/a | **Yes, in detail** | Yes — every rule visible in-app |
| Per-muscle recovery model | Yes, 0–100% | No | Not found | No | n/a | Weekly set ceiling per muscle (simpler) |
| Pain captured separately | **Not found** | **Not found** | Soreness → bodyweight session | No | n/a | **Yes, separate pathway** |
| Explains each change | Partly (help centre) | n/a | No | No | Yes (check-in) | **Yes, per exercise, in the UI** |
| Exercise variants split | Equipment-filtered | 400+ exercises, 7 types | Difficulty tiers | n/a | n/a | 40 variants, separate histories |
| Offline use | **Yes, on-device generation** | **Not documented for phone** | **Not found** | **Not found** | Not found | **Yes, full app offline** |
| Web / PWA | Not found | Web app (plan + analyse) | Not found | No | Not found | **PWA is the whole product** |
| Nutrition | **None** | None | Separate app, no numbers | Recipes only | Core | Targets + generated meal plan |
| Adaptive calorie targets | n/a | n/a | Portion size only | n/a | **Yes, documented** | Formula-based (honest about it) |
| Declared accessibility support | **None** | **None** | **None** | **None** | No section shown | Documented; see ACCESSIBILITY in TESTING.md |
| Data export | Not found | CSV export | Not found | n/a | n/a | Validated JSON, checksummed |

### Source notes for the contested cells

- Fitbod publishes its mechanism unusually openly: estimated 1RM via prediction equations
  "such as the Epley formula", RiR driving how aggressively it loads the next session, an
  mStrength™ undulating scheme, Max Effort recalibration days, and per-muscle recovery
  percentages. [VERIFIED: https://fitbod.me/blog/fitbod-algorithm,
  https://help.fitbod.me/hc/en-us/articles/43489869175063,
  https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery]
- Fitbod's own pages disagree on the full-recovery constant — six days in one article, up to
  seven in another, 48–72 hours on the blog. I would not treat any single number as theirs.
- Fitbod explicitly does **not** model fatigue carried between exercises in a superset: RiR is
  processed as if each exercise were performed fresh. [VERIFIED:
  https://help.fitbod.me/hc/en-us/articles/360033133174]
- Hevy free is a pure logger: it "organizes training and tracks results without prescribing a
  specific way to work out." Prescription is Hevy Trainer, a Pro feature, and **the actual
  progression rule — increment size, trigger, deload logic — is not published anywhere I could
  find.** [VERIFIED: https://www.hevyapp.com/product/,
  https://help.hevyapp.com/hc/en-us/articles/38385724273047]
- Hevy stores to its servers, not the device: "Your information on Hevy is stored to your
  profile on our servers, not to your device." Phone offline logging is undocumented; offline
  is documented only for Apple Watch and WearOS. [VERIFIED:
  https://help.hevyapp.com/hc/en-us/articles/38223672272791, https://www.hevyapp.com/]
- Freeletics states weights progression is mostly manual, in-workout feedback can only *lower*
  the next set, and the articles do not describe how weights increase across weeks. [VERIFIED:
  https://help.freeletics.com/hc/en-us/articles/360001995859]
- NTC: six independent official surfaces describe the product and none mentions logging sets,
  reps or weight. The unit of record is "a workout was done". [VERIFIED:
  https://apps.apple.com/au/app/id301521403, https://play.google.com/store/apps/details?id=com.nike.ntc,
  https://www.nike.com/ntc, https://www.nike.com/au/help/a/ntc-info]
- MacroFactor's expenditure model is the clearest published adaptation logic in the set:
  expenditure = intake − change in stored energy; three inputs (logged intake, rate of change
  of **trend** weight, tissue energy density); a 20-day window; expenditure updates
  continuously but **targets change weekly**; updates pause when more than three days of
  nutrition are missing in a seven-day period, and the status flips from "updating" to
  "holding". [VERIFIED: https://help.macrofactorapp.com/en/articles/20-expenditure,
  https://macrofactor.com/expenditure-v3/,
  https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition]
- Accessibility: four of the five App Store listings carry Apple's identical notice, "The
  developer has not yet indicated which accessibility features this app supports." The
  MacroFactor US listing rendered no accessibility section at all, which I report as exactly
  that rather than inferring absence. [VERIFIED: https://apps.apple.com/gb/app/id1041517543,
  https://apps.apple.com/gb/app/id1458862350, https://apps.apple.com/us/app/id654810212,
  https://apps.apple.com/gb/app/id301521403, https://apps.apple.com/us/app/id1553503471]
- Community evidence, not the developer: AppleVis reports that on Hevy 2.0.18 few buttons are
  clearly labelled under VoiceOver and that core functions are near-impossible. For a logging
  app this is a functional blocker, not a cosmetic one. [SECONDARY:
  https://www.applevis.com/apps/ios/sports-activities/hevy-workout-tracker-planner]

---

## 2. Prioritised gap analysis

Priority is impact on your use of the app, not market size.

### P0 — fixed in this build

| Gap | Evidence it mattered | What shipped |
|---|---|---|
| Progression keyed off the heaviest set | Your own code used `Math.max` over all sets, so one heavy single pulled every future prescription up with it | Working load is now the modal weight across comparable working sets; the top set is still recorded but does not drive the plan |
| Logs keyed by week and exercise | `logs['3:bench']` could hold exactly one bench session in week 3 | Dated sessions with stable ids; the same day can be repeated indefinitely |
| Suggestions recorded as performance | Ticking a blank set copied the suggestion into history | Sets are `pending` until `confirmed` or `edited`; pending sets contribute nothing |
| Records never recalculated | `if (one > b.e1rm)` meant a mistyped 200 kg was permanent | Records are recomputed from scratch after every change |
| "7-day average" over the last 7 entries | Three weigh-ins in one morning counted as three days | Calendar-window averages; one entry per calendar day |
| Fixed meal template | Changing the deficit left the meal plan unchanged | Plan is generated from the targets and solves for the protein overshoot |
| Timer drift | Interval ticks stopped when backgrounded; re-render reset the button | Wall-clock `end − now`, persisted, restored on relaunch |
| Weak backup validation | `if (!d.logs) throw 0`, and `lastBackup` was set before the share completed | Format check, schema check, checksum, count cross-check; `lastBackupVerified` only on a completed write |

### P1 — built because the category does not do it

| Gap in the category | Verified basis | What shipped |
|---|---|---|
| Nobody separates pain from effort | Not found in any of the five | Pain has its own capture, its own pathway, and is excluded from readiness by construction |
| Progression rules are opaque (Hevy Trainer publishes nothing) | VERIFIED absence | Every decision carries what changed / why / next target, plus a rule trace |
| Rep completion treated as licence to add load | Implied by Fitbod's RiR gating; not stated by Hevy | Completion is necessary but never sufficient; effort, reserve, technique, readiness and weekly workload all gate it |
| Combined exercise entries | Hevy's own docs flag false-positive PRs from exercise-type confusion | 40 variants, each with its own history, records and animation |
| Accessibility declared by nobody | VERIFIED across five listings | Semantic roles, labelled controls, 44 px targets, reduced motion, light/dark, live regions |

### P2 — deliberately not built, with reasons

- **Per-muscle recovery percentages (Fitbod).** OPINION: a recovery model is only as good as its
  inputs, and inventing a decay curve would add a number that looks precise and is not. The
  weekly set ceiling does most of the work with none of the false precision.
- **Adaptive TDEE (MacroFactor).** It needs 20 days of consistent intake logging. This app does
  not log food, so the honest option is a formula clearly labelled as a formula.
- **Social, leaderboards, percentile ranks.** Not useful to a single user.
- **Supersets.** Worth adding later; the data model supports it, the UI does not yet.

---

## 3. Where this build is genuinely weaker

Stated plainly so the matrix is not self-serving.

- **Exercise media.** Hevy has 400+ exercises with demonstration animations; Fitbod has video.
  This app has 40 original stick-figure animations, **unreviewed by any qualified coach**. On
  guidance quality, both beat this app. See ASSETS.md.
- **Exercise count.** 40 variants against Hevy's 400+ and Freeletics' 700+.
- **No cross-device sync.** Hevy's server model means a lost phone costs nothing. Here, a lost
  phone costs everything that is not backed up.
- **No wearable, no heart rate, no Health integration.**
- **Single-user, untested at scale.** The competitors' engines are tuned against millions of
  logged sessions; Fitbod cites a corpus of over 87 million workouts. This engine is tuned
  against reasoning and a test suite.
- **The coaching numbers are judgement calls.** They are listed in the app and in engine.js
  under COACHING_ASSUMPTIONS, flagged for review by a qualified coach or clinician.
