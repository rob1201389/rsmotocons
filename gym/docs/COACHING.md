# Goal-driven coaching: how it works

This describes the planning engine (`public/plan.js`), the weekly review (`public/review.js`),
the wearable importer (`public/garmin.js`) and the content library (`public/library.js`). The
screens are in `public/views-*.js`. Run everything with `gym/test/run-all.sh`.

## The rule that holds it together

Every "plan adjusted" message is produced by a function that has already changed the saved plan,
and the tests read the plan back to check it. Nothing is described that was not done.

## Where things live

| Thing | Where | Notes |
|---|---|---|
| Goals, availability, equipment, limitations, milestones, review day | `state.goals` | Everything the user chose, with an explanation of each setting's effect |
| Plan versions | `state.plan.versions` | Immutable and dated. Each has the template, its reason and a readable diff |
| Weeks and slots | `state.plan.weeks` | A week is frozen when it starts. Slots can be completed, moved, shortened or skipped, never deleted |
| Change log | `state.plan.log`, `state.plan.adjustLog` | Versions, moves, skips, misses, daily changes, extras, with reasons |
| Prescriptions | `state.planOverrides` | Per-exercise sets and rep range from the version governing the current week, read by the double progression engine |
| Weekly reviews | `state.reviews` | Draft, final or missed. Each stores its period, source-data checksum and generation time |
| Written updates | `state.notes`, `state.noteDrafts`, `state.noteSuggestions` | Original text, author, date, category, optional link to a session or exercise |
| Wearable data | `state.wellness` | Rows with coverage dates. Strength sessions are excluded from conditioning load by default |
| Food eaten | `state.intake` | Entered by the user. Planned meals are never counted |

## How goals change the plan

`generateTemplate(goals)` chooses the split from days per week (full body at 3 or fewer, upper and
lower at 4, push/pull/legs style above), rep ranges and sets from the goal and experience, weekly
conditioning and stretch time from the goal, and drops exercises that need equipment you turned off
or that you chose to avoid. Main lifts are chosen once and stay consistent. Accessories rotate only
when a review changes them. Sessions are trimmed to the time you have by removing accessories, then
extra sets, then lower-priority main lifts, keeping the first two main lifts so progress stays
measurable.

Changing a goal creates a new version from next week. Where the rep range moves by two or more, the
start load for the new range is re-estimated once from your recent best. History is untouched.

## The weekly review

1. **Numbers first**, all computed in code: planned, completed, partial, missed or skipped (split
   into time and capacity), moved, extra workouts, unique training days, rep gains and load gains
   from the logged sets, stretch and recovery sessions, pain and technique flags, data gaps.
   Planned completion is measured against the sessions agreed for the week and is capped at 100
   per cent. Extras are counted separately.
2. **A short conversation**, prefilled from what is already known.
3. **The report**: recorded facts, what you reported, tentative interpretations (labelled), where
   records disagree, data gaps, proposals with reasons, what stays the same, and the complete
   next-week schedule produced by applying the selected proposals to a copy of the plan.

The decision is Accept, Edit (choose which proposals), or Keep current plan. Accepting saves a new
dated plan version and shows exactly the changes that were saved. A review that never happens is
recorded as missed, nothing is invented, and the plan carries on unchanged with no automatic
increases.

### What the engine can decide

Progress, hold, reduce, deload, change an exercise, reschedule or shorten, adjust conditioning, add
stretch or recovery. It separates missing a session for time from missing it for capacity, never
squeezes missed sessions into other days, does not call reps-up-at-the-same-weight a plateau, makes
at most one volume increase and never together with a load gain on the same exercise, and puts pain
and technique ahead of progression. Pain goes to a separate review pathway: loads on the linked
exercise are held, nothing is diagnosed and no rehabilitation is prescribed. Nutrition changes are
proposed only with at least five days of food logged and three weigh-ins over ten or more days.

## AI feedback

The app computes every number. The server's `/api/ai/weekly-review` receives only a minimal payload
(statistics, fact sentences, the week's notes, feedback counts and proposals; no name, email or
other users' data), asks the model for wording only, and rejects any answer containing a number the
app did not supply. The app applies the same check again. If the service is not configured, is slow,
fails, or returns something that does not verify, the report shows a statistics summary labelled as
not written by AI. There is no endless loading: the request times out after 25 seconds.

Notes can be processed by the configured AI service, and the interface says so where notes are
written and next to the generated feedback.

## Wearable data

Garmin Connect CSV exports (activities, sleep), TCX activities and the sleep JSON from a Garmin
data export are read on the device. **FIT files are not supported** and are refused with a clear
message. Data is always shown with its coverage dates. Sleep older than last night is never shown
as today's readiness, and data more than three days old is ignored for readiness.

## Notifications

The weekly review is announced in the app: a card on Today when it is due or overdue. There are no
push notifications, because they need a push service this deployment does not have.

## Scenarios

`gym/test/plan.test.js` runs the nine scenarios end to end against the engines, and
`gym/test/coaching.ui.test.js` drives the same flows through the real screens. Example reports
(clearly marked as demonstration data) are in `EXAMPLE-REPORTS.md`; regenerate them with
`node gym/test/example-reports.js`.
