# Double progression in Recomp

Double progression is a working prescription system inside the adaptive engine, not a label on the screen. This note covers what it does, where each rule lives, and what it deliberately does not do. The worked examples are in [DOUBLE-PROGRESSION-EXAMPLES.md](DOUBLE-PROGRESSION-EXAMPLES.md), generated from the real engine.

## The rule in one paragraph

For a prescription such as 3 × 8–12, the weight stays put while each set builds reps. Today's target for each set is what that set did last time at this load, plus one rep, capped at 12. Weight goes up only when every required working set reached 12 at the prescribed load, with acceptable effort and technique, no pain concern and enough feedback. The increase is the smallest equipment increment that fits the progression limit. After it, reps reset to 8 on every set and the sets stay at 3.

## Settings, stored per exercise variant

Settings are keyed by variant id, so the barbell and dumbbell versions of a movement never share settings or history. With nothing stored, an exercise resolves to defaults from its definition and your profile, so everything behaves as before until you change it. Edit them from the exercise sheet: Library, the exercise, "Progression settings for this exercise".

| Setting | Default | What it does |
|---|---|---|
| Method | double (reps for bodyweight, duration for holds, distance for carries) | Double progression, reps only, duration, distance or manual |
| Working sets | the exercise's own | Sets required to qualify |
| Minimum and maximum | the exercise's own range | The range. Reps, seconds or metres depending on the exercise |
| Available weight increases | the profile increment for that equipment | The only weights the app will ever add. Several allowed, for example 1.25, 2.5, 5 |
| Progression limit | profile limit, 5% | Largest single jump as a % of the load |
| Clean reps in reserve | 2 | Needed before the load goes up |
| Highest acceptable effort | near limit | Effort above this blocks an increase |
| Qualifying sessions | 1 | Sessions in a row that must qualify before the load goes up |
| Back-off sets and percentage | none | A deliberate lighter prescription after the working sets |
| Require technique feedback | off | Technique must be recorded, not just not-deteriorating |
| Add load after the top of the range | on | Reps, duration and distance methods only |
| Never exceed the limit for carries | off | Switches off the one flagged exception below |

Saving validates everything and refuses with reasons rather than storing something half-valid. Changing a setting that changes what "qualifies" (method, sets, range, reserve, effort, qualifying sessions, technique) restarts the qualifying count from that day. Changing increments or the limit does not.

## What counts as performance

- Warm-up sets, skipped sets and unconfirmed sets never count.
- Back-off sets count as volume but never as evidence that the top load was completed, and they never set the next working load.
- The comparable load is the prescribed load when most sets were done at or beyond it. Otherwise it is what was actually done (the most common weight, ties to the lighter). A heavy opener followed by lighter sets therefore never qualifies at the heavier load.
- On an assisted machine "at or beyond" means the same or less assistance.
- Older sets without a role are working sets.

## Order of decisions

Safety and recovery come first and cannot be overridden by a good-looking session.

1. Pain: concerning pain or an open concern pauses the exercise. Mild pain reduces the load.
2. First time: calibrate. No guessed load.
3. Manual method: repeat, never change.
4. Return after a break: ease back, no progression.
5. Readiness is read (low readiness caps today).
6. Active deload: light week, no progression.
7. First session after a deload: back to the pre-deload load, last time's reps, no increase.
8. Plateau (from comparable performance, see below).
9. Technique deteriorating, then short sets or reps: hold and build reps, or reduce if well below range.
10. "Needed less", maximum effort or zero reps in reserve, effort above your limit, missing feedback, low readiness, very high weekly volume, too few reps in reserve: hold.
11. Qualifying sessions still owed: hold.
12. Earned: add the smallest increment that fits the limit, reset reps to the minimum. If none fits, hold and say why.

Load and sets never move in the same step. Missing feedback stays unknown and never unlocks an increase.

## Plateaus

An unchanged weight is not a stall, because adding reps at the same weight is the point. A plateau needs all of: four comparable sessions (deload weeks excluded), at least 14 days between the first and last, no improvement in estimated strength (load or reps at that load) beyond 1%, and feedback recorded on at least three of the four. Without feedback the answer is unknown, not stalled. The thresholds are in `TUNING` and are listed under Profile, Coaching assumptions, for review.

## The workout screen

Each exercise card shows the current load and range, last time per set, today's per-set targets, a meter of how many sets reached the top, a checklist of what is still required (done, not yet, or unknown), and the text of the next weight increase. When an increase is earned it is previewed with the new load and reset reps, and you can Accept, Hold at the old load, or Edit.

Your choice is stored in `entry.progressionChoice`, next to the engine's recommendation. `entry.decision` is never rewritten. Only sets you have not logged are changed. An edit that raises the load and adds sets is refused. A jump over your limit is allowed but warned about and recorded as yours.

## Other exercise types

Not forced into rep ranges:

- Assisted: less assistance is the increase, once every set reaches the top.
- Bodyweight reps: reps climb, then load is added at the cap (or not, with the switch off).
- Timed holds: seconds climb, then load is added and time resets.
- Carries: distance is fixed, so load moves. This is the one place the limit can be exceeded, and it is flagged in the explanation. A switch turns it off.
- Manual: the app reports, you decide.

## Data and migration

Schema v4 adds `exerciseSettings` (empty by default) and a `role` on sets. The v3 to v4 migration is additive: sessions, sets, feedback, decisions, pain concerns and records pass through unchanged, the audit entry records the session and set counts, and the profile increments become each exercise's available increments. v1 backups migrate through v3 to v4 in one pass.

## Changes to older behaviour

- "Three holds in a row" no longer means a plateau. It is replaced by the comparable-performance test above. The old test was rewritten, and a new one asserts three holds is not a plateau.
- Increase now needs every prescribed set, not just the sets at the most common weight. The old "mixed loads" test encoded progressing on three of four sets and was rewritten.
- After a deload the first session returns to the pre-deload load instead of progressing from the light week.
- Schema version assertions in the older tests moved from 3 to 4.

## Not done, and why

- Per-set targets are not yet adjusted for rest time or fatigue within a session. They come from last time only.
- Back-off reps default to the top of the range at the lighter load. There is no separate back-off rep setting.
- The thresholds are judgement calls. They are listed for a qualified coach to review. This app does not diagnose injuries or prescribe rehabilitation.
