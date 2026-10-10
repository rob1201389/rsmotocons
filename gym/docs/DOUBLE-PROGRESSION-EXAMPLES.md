# Double progression: worked examples

Every block below is produced by running the real engine (`gym/test/examples.js`). Nothing here is hand-written output. Exercise: lat pulldown, cable, 3 × 8–12, smallest increment 2.5 kg, progression limit 5%, effort and technique recorded as "manageable, 3 in reserve, controlled" unless stated.

## 1. Building reps at one weight

### Last time 12 / 12 / 10 at 60 kg

*Setup:* previous session 60 kg × 12, 12, 10.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 10
Today: 12 / 12 / 11
Status: building   Action: hold   Flags: building_reps
What changed: Staying at 60 kg and building reps.
Why: Not every set reached 12 reps yet (12 / 12 / 10). The load stays put and each set adds a rep, and that is progress at the same weight.
Next: Reach 12 reps on all 3 sets at 60 kg with the effort and technique you set, and the load moves up.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

### Last time 9 / 8 / 8: every set moves up one rep, not straight to 12

*Setup:* previous session 60 kg × 9, 8, 8.

```
60 kg · 3 × 8–12
Last time: 9 / 8 / 8
Today: 10 / 9 / 9
Status: building   Action: hold   Flags: building_reps
What changed: Staying at 60 kg and building reps.
Why: Not every set reached 12 reps yet (9 / 8 / 8). The load stays put and each set adds a rep, and that is progress at the same weight.
Next: Reach 12 reps on all 3 sets at 60 kg with the effort and technique you set, and the load moves up.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

## 2. Every set reaches the top

### All three sets at 12

*Setup:* previous session 60 kg × 12, 12, 12 with good effort and technique.

```
62.5 kg · 3 × 8–12
Last time: 12 / 12 / 12 at 60 kg
Today: 8 / 8 / 8
Status: earned   Action: progress   Flags: progress_load
What changed: Load up 2.5 kg to 62.5 kg; reps reset to 8.
Why: You completed all 3 working sets at 12 reps at 60 kg. It came back manageable with 3 clean reps in reserve, and technique stayed controlled. That combination, not the reps on their own, is what earns the increase.
Next: Build from 8 back towards 12 on every set at 62.5 kg. Sets stay at 3: load and sets never go up together.
Next weight increase: Reps reset to 8 on all 3 sets. The next increase after that needs all 3 sets at 12 reps again.
```

A full cycle, prescribed and logged by the engine session by session:

```
day  3  prescribed 60 kg  targets 9/9/9   logged 9/9/9
day  6  prescribed 60 kg  targets 10/10/10   logged 10/10/10
day  9  prescribed 60 kg  targets 11/11/11   logged 11/11/11
day 12  prescribed 60 kg  targets 12/12/12   logged 12/12/12
day 15  prescribed 62.5 kg  targets 8/8/8   (weight earned, reps reset, still 3 sets)
```

## 3. Mixed loads and back-off sets

### A heavy first set then lighter sets

*Setup:* prescribed 60 kg; logged 65 × 12, then 55 × 12, 55 × 12.

```
57.5 kg · 3 × 8–12
Last time: 12 × 65 kg / 12 × 55 kg / 12 × 55 kg
Today: 8 / 8 / 8
Status: earned   Action: progress   Flags: progress_load
What changed: Load up 2.5 kg to 57.5 kg; reps reset to 8.
Why: You completed all 3 working sets at 12 reps at 55 kg. It came back manageable with 3 clean reps in reserve, and technique stayed controlled. That combination, not the reps on their own, is what earns the increase.
Next: Build from 8 back towards 12 on every set at 57.5 kg. Sets stay at 3: load and sets never go up together.
Next weight increase: Reps reset to 8 on all 3 sets. The next increase after that needs all 3 sets at 12 reps again.
```

A deliberate back-off prescription (2 sets at 85%) is created as its own role:

```
set 1  working   60 kg × 11
set 2  working   60 kg × 11
set 3  working   60 kg × 11
set 4  back-off  50 kg × 12
set 5  back-off  50 kg × 12
```

### Next session after those: back-off sets never set the working load

*Setup:* working 60 kg × 11, 11, 11; back-off 50 kg × 15, 15.

```
60 kg · 3 × 8–12
Last time: 11 / 11 / 11
Today: 12 / 12 / 12
Status: building   Action: hold   Flags: building_reps
What changed: Staying at 60 kg and building reps.
Why: Not every set reached 12 reps yet (11 / 11 / 11). The load stays put and each set adds a rep, and that is progress at the same weight.
Next: Reach 12 reps on all 3 sets at 60 kg with the effort and technique you set, and the load moves up.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

## 4. What blocks an earned increase

### Maximum effort

*Setup:* previous session 60 kg × 12, 12, 12.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 12
Today: 12 / 12 / 12
Status: held   Action: hold   Flags: maximal_effort
What changed: Holding 60 kg.
Why: You finished the reps, but at maximum effort with nothing left in reserve. Completing reps on its own does not earn more load — repeating this load with a rep or two to spare does.
Next: Same 60 kg. When it comes back as "challenging" with two clean reps left, the load goes up.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

### Technique deteriorating

*Setup:* previous session 60 kg × 12, 12, 12.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 12
Today: 12 / 12 / 12
Status: held   Action: hold   Flags: technique
What changed: Staying at 60 kg and dropping to the middle of the rep range.
Why: You logged technique as deteriorating. Adding load to a movement that is already breaking down buys a worse rep, not a stronger one.
Next: Earn 12 clean reps with control at this load and the load moves up next time.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

### "Needed less"

*Setup:* previous session 60 kg × 12, 12, 12.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 12
Today: 12 / 12 / 12
Status: held   Action: hold   Flags: needed_less
What changed: Holding 60 kg.
Why: You finished the reps but said you needed less work than this. That is a signal the dose was too high, so it is treated as a reason to back off, never as permission to add load — whatever the reps said.
Next: Repeat 60 kg and see how it lands. It moves up only when it comes back manageable with reps to spare.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

### Mild pain

*Setup:* previous session 60 kg × 12, 12, 12.

```
47.5 kg · 3 × 8–12
Last time: 12 / 12 / 12 at 60 kg
Today: 8 / 8 / 8
Status: reduced   Action: reduce   Flags: pain
What changed: Load cut to about 80% and reps kept to the lower end.
Why: You reported pain at the Shoulder without any of the signs that would pause it outright. Pain is handled on its own pathway and is never mixed into effort or readiness.
Next: If it is pain-free at this load, the normal rules resume next session. If it sharpens, spreads, or you notice numbness or swelling, it pauses for review. This app does not diagnose injuries and does not prescribe rehabilitation.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. The increase would not be possible yet: the smallest increment (2.5 kg) is over your 5% progression limit.
```

### Concerning pain (sharp)

*Setup:* previous session 60 kg × 12, 12, 12.

```
Pulldown paused

Status: paused   Action: review   Flags: pain, paused
What changed: Lat pulldown is paused. No sets are prescribed.
Why: You reported pain at the Shoulder and you described it as sharp. That is handled on its own pathway — it is never mixed into effort or readiness, and a low rating does not override it.
Next: It stays paused until you mark the concern resolved or choose a substitute. This app does not diagnose injuries and does not prescribe rehabilitation — a qualified clinician should look at it.
```

### No feedback recorded

*Setup:* previous session 60 kg × 12, 12, 12.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 12
Today: 12 / 12 / 12
Status: held   Action: hold   Flags: unknown_feedback
What changed: Holding 60 kg.
Why: You hit the reps, but there is no effort or technique feedback from last time. The app will not guess how hard it was, so it holds rather than risk a jump you had not earned.
Next: Log how the sets felt this session and the engine can move the load next time.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

## 5. The progression limit

### Smallest increase (2.5 kg) is 8.3% of 30 kg, limit 5%

*Setup:* previous session 30 kg × 12, 12, 12.

```
30 kg · 3 × 8–12
Last time: 12 / 12 / 12
Today: 12 / 12 / 12
Status: blocked   Action: hold   Flags: increment_blocked
What changed: Staying at 30 kg: the load cannot move yet.
Why: You completed all 3 working sets at 12 reps, which earns an increase, but the smallest increment you have for this exercise is 2.5 kg, which is 8% of 30 kg and over your 5% progression limit. Rather than quietly making a jump that big, the load holds.
Next: To move the load you need a smaller increment (micro-plates, a lighter implement) or a higher limit. Change either in this exercise's progression settings. Until then repeat 30 kg to the same standard.
Next weight increase: Weight increase earned but not possible: the smallest increment (2.5 kg) is over your 5% progression limit. The load holds.
```

### A 1 kg increment is available and fits

*Setup:* same session, increments 1, 2.5.

```
31 kg · 3 × 8–12
Last time: 12 / 12 / 12 at 30 kg
Today: 8 / 8 / 8
Status: earned   Action: progress   Flags: progress_load
What changed: Load up 1 kg to 31 kg; reps reset to 8.
Why: You completed all 3 working sets at 12 reps at 30 kg. It came back manageable with 3 clean reps in reserve, and technique stayed controlled. That combination, not the reps on their own, is what earns the increase.
Next: Build from 8 back towards 12 on every set at 31 kg. Sets stay at 3: load and sets never go up together.
Next weight increase: Reps reset to 8 on all 3 sets. The next increase after that needs all 3 sets at 12 reps again.
```

## 6. Qualifying sessions

### Two qualifying sessions required: the first is recorded, not rewarded

*Setup:* one clean session at the top.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 12
Today: 12 / 12 / 12
Status: held   Action: hold   Flags: qualifying_wait
What changed: Holding 60 kg: qualifying session 1 of 2.
Why: That session met the standard (all 3 sets at 12 reps with the effort and technique you set). This exercise needs 2 in a row before the load goes up, so one good session is recorded, not rewarded yet.
Next: Repeat 60 kg to the same standard. 1 more qualifying session and it moves up.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Needed on 2 sessions in a row (1 so far). Then 62.5 kg × 8–12, reps reset to 8.
```

### After the second clean session

*Setup:* two clean sessions in a row.

```
62.5 kg · 3 × 8–12
Last time: 12 / 12 / 12 at 60 kg
Today: 8 / 8 / 8
Status: earned   Action: progress   Flags: progress_load
What changed: Load up 2.5 kg to 62.5 kg; reps reset to 8.
Why: You completed all 3 working sets at 12 reps at 60 kg. It came back manageable with 3 clean reps in reserve, and technique stayed controlled. That combination, not the reps on their own, is what earns the increase.
Next: Build from 8 back towards 12 on every set at 62.5 kg. Sets stay at 3: load and sets never go up together.
Next weight increase: Reps reset to 8 on all 3 sets. The next increase after that needs all 3 sets at 12 reps again.
```

## 7. Deload and returning from a break

### Deload week overrides an earned increase

*Setup:* last session 12, 12, 12 at 60 kg, deload accepted.

```
35 kg · 3 × 8–12
Last time: 12 / 12 / 12 at 60 kg
Today: 10 / 10 / 10
Status: deload   Action: deload   Flags: deload
What changed: Easy week: 35 kg, about 60% of your working load.
Why: You accepted a deload running 2026-09-03 to 2026-09-09. Every set this week is deliberately light — the point is to shed fatigue, so stopping well short on each set is the instruction, not a failure.
Next: Normal progression resumes automatically after 2026-09-09. Nothing you do this week counts against you.
```

### First session after the deload returns to the old load, no increase

*Setup:* pre-deload 60 kg × 11, 11, 11; deload week done.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 12 at 35 kg
Today: 11 / 11 / 11
Status: held   Action: hold   Flags: post_deload
What changed: Back to 60 kg, the load you were using before the deload.
Why: The deload week was deliberately light, so it is not a starting point. The first session back repeats the reps from before it and does not add load.
Next: Normal progression resumes after this session, from the load you were actually working at.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 62.5 kg × 8–12, reps reset to 8.
```

### Return after a 30 day break

*Setup:* last session 12, 12, 12 at 60 kg, thirty days ago.

```
52.5 kg · 3 × 8–12
Last time: 12 / 12 / 12 at 60 kg
Today: 10 / 10 / 10
Status: reduced   Action: reduce   Flags: returning
What changed: Load eased back 12% to 52.5 kg.
Why: It has been 30 days since you last did this. Picking up at the old load after a break is where people get hurt, so the first session back is deliberately conservative.
Next: Clear this comfortably and the normal rules take over next session — you should be back to where you were within two or three sessions.
Next weight increase: complete all 3 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 55 kg × 8–12, reps reset to 8.
```

## 8. Reps are progress; a stall is not just an unchanged weight

Four sessions at 60 kg with reps 8, 9, 10, 11: plateau detector says `null`.

Four sessions at 60 kg, always 9 / 9 / 9, feedback recorded, 21 days: plateau detector says `{"sessions":4,"spanDays":21,"feedbackKnown":4}`.

### ...and the engine then suggests a change of approach

*Setup:* that flat history.

```
55 kg · 3 × 8–12
Last time: 9 / 9 / 9 at 60 kg
Today: 12 / 12 / 12
Status: plateau   Action: substitute   Flags: plateau
What changed: Suggesting a swap to pull-up, or a 10% back-off at Lat pulldown.
Why: Across the last 4 comparable sessions (21 days) neither the load nor the reps at that load have improved, and feedback was recorded on 4 of them. A stall this long is usually the movement, the fatigue or the setup rather than effort — and grinding the same load a fourth time rarely breaks it.
Next: Swapping keeps the muscle working while the pattern gets a break. Your history for this exercise is kept separately, so you can come back to it and compare like with like.
```

The same flat history with **no feedback recorded**: plateau detector says `null` (unknown stays unknown).

## 9. Accept, hold, edit

Recommendation: 62.5 kg, targets 8/8/8.

```
HOLD   -> planned 60 × 12, 60 × 12, 60 × 12   | recorded: held | recommendation kept: 62.5 kg
EDIT   -> planned 61 × 9, 61 × 9, 61 × 8   | recorded: edited | recommendation kept: 62.5 kg
EDIT 65 kg + 4 sets -> refused: Do not raise the load and add sets in the same step. Change one, then the other next time.
```

## 10. Other exercise types keep their own rules

### Assisted pull-up, 10 of 12 reps

*Setup:* assistance 30 kg × 10, 10, 10, 10.

```
30 kg assistance · 4 × 8–12
Last time: 10 / 10 / 10 / 10
Today: 11 / 11 / 11 / 11
Status: building   Action: hold   Flags: building_reps
What changed: Staying at 30 kg assistance and building reps.
Why: Not every set reached 12 reps yet (10 / 10 / 10 / 10). The load stays put and each set adds a rep, and that is progress at the same weight.
Next: Reach 12 reps on all 4 sets at 30 kg assistance with the effort and technique you set, and the load moves up.
Next weight increase: complete all 4 sets at 12 reps with controlled technique, at least 2 clean reps in reserve and effort no higher than near limit. Then 25 kg assistance × 8–12, reps reset to 8.
```

### Assisted pull-up, all sets at 12: LESS assistance is the increase

*Setup:* assistance 30 kg × 12 on all four sets.

```
25 kg assistance · 4 × 8–12
Last time: 12 / 12 / 12 / 12 at 30 kg assistance
Today: 8 / 8 / 8 / 8
Status: earned   Action: progress   Flags: progress_assist
What changed: Assistance down from 30 kg to 25 kg; reps reset to 8.
Why: You completed all 4 working sets at 12 reps with 30 kg of assistance. It came back manageable with 3 clean reps in reserve, and technique stayed controlled. On an assisted movement, less help is the progression.
Next: Build back up to 12 reps at 25 kg of assistance, then it drops again.
Next weight increase: Reps reset to 8 on all 4 sets. The next increase after that needs all 4 sets at 12 reps again.
```

### Timed hold at the top of its range: load is added and the time resets

*Setup:* weighted side plank, 5 kg × 30 s.

```
7.5 kg · 3 × 20–30 s
Last time: 30 / 30 / 30 at 5 kg
Today: 20 / 20 / 20
Status: earned   Action: progress   Flags: progress_load
What changed: Add load to 7.5 kg and reset the hold to 20 seconds.
Why: You are holding the full 30 seconds and it still came back manageable. Past about 30 seconds a hold trains endurance rather than strength, so load takes over.
Next: Build the time back to 30 seconds at 7.5 kg.
```

### Carry: distance is fixed, so load moves (the one flagged exception to the limit)

*Setup:* farmer's walk 32 kg × 40 m.

```
34 kg · 3 × 40 m
Last time: 40 / 40 / 40 at 32 kg
Today: 40 / 40 / 40
Status: earned   Action: progress   Flags: progress_load, increment_over_cap
What changed: Load up 2 kg to 34 kg.
Why: You earned the increase. This is a 6% jump, slightly over your 5% cap, but the distance on a carry is fixed and 2 kg is the smallest load you have — holding would stall it indefinitely, so the jump is taken and flagged rather than hidden.
Next: Carry 34 kg for the full 40 m walking tall. Distance stays fixed; load is the only thing that moves. If it is a step too far, log what you actually managed and it will come back down.
```

### Manual method: the app never changes the load

*Setup:* same perfect session, method set to manual.

```
60 kg · 3 × 8–12
Last time: 12 / 12 / 12
Today: 12 / 12 / 12
Status: manual   Action: hold   Flags: manual
What changed: Manual progression: 60 kg, 3 × 8–12.
Why: You set this exercise to manual, so the app does not raise, lower or reset the load for you. It repeats what you did last time.
Next: Change the load or reps yourself when you are ready. Your change is recorded as yours, separate from anything the app would have suggested.
Next weight increase: Manual progression: the app does not change this load. You set it.
```

