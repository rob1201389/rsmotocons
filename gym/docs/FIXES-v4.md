# v4 — what the independent review found, and what now changes in the workout

Every defect below was reproduced by a failing test before being fixed.
`node regression.js` → **39 tests, all previously failing, now passing.**
`node tests.js` → 73. `node uitest.js` → 58. Total 170.

---

## 1. "Needed less" could raise the load

**Was:** the low-reserve guard read `reserve < 2 && !neededLess`. Saying the session
*needed less work* was an exemption from the safeguard, so with one rep in reserve
"Needed less" went 60 → 62.5 kg while "Enough today" correctly held at 60.

**Now:** `needed_less` is evaluated *before* anything that can raise the load, and it
can only hold or reduce. With a hard session behind it, it backs off 5%.

| Feedback (identical 4×8 @ 60 kg) | Before | After |
|---|---|---|
| near limit, 1 in reserve, needed less | **progress 62.5** | reduce 57.5 |
| near limit, 1 in reserve, enough today | hold 60 | hold 60 |
| manageable, 3 in reserve, needed less | progress 62.5 | hold 60 |
| manageable, 3 in reserve, could do another | progress 62.5 | progress 62.5 |

**In the gym:** telling the app it was too much can no longer make next week heavier.

## 2. The 5% jump cap did nothing

**Was:** `Math.max(increment, cap)` then `Math.min(increment, that)` — always the
increment. The cap had no effect at any load. The original test only passed because
5% of 200 kg happens to exceed 2.5 kg.

**Now:** the cap is enforced. When the smallest increment you own is larger than the
cap, the engine does not take the jump silently. It holds the load, chases reps to
the top of the range, and says why.

**In the gym:** a 10 kg lateral raise with only 2.5 kg dumbbells no longer jumps 25%
to 12.5. It holds 10 kg and pushes reps to 20, and tells you that a smaller increment
(micro-plates) or a higher cap in Profile is what unlocks the load.

**One deliberate exception:** a carry has a fixed distance, so there is no other
dimension to progress. Blocking it would stall it forever. There the increment is
taken, flagged `increment_over_cap`, and the overshoot is stated in the explanation
rather than hidden.

## 3. "Session shortened" shortened nothing

**Was:** `sessionPlanAdvice` announced "trimmed to the first 4 exercises" and then
handed back the full roster. The banner described a workout that never happened.

**Now:** `applySessionPlan()` actually splits the roster, ranked by tier — main
compounds first, accessories next, core last — so 20 minutes keeps bench and row and
drops the curls, rather than keeping whatever happened to be first. The banner names
the exercises that remain and the ones that were dropped, and the dropped ones are
stored in `S.deferred[day]` and come back first next time that day runs.

**In the gym:** a 20-minute check-in against a 60-minute session gives you a session
with fewer exercises in it, and the explanation lists exactly which.

## 4. Accepting a deload did nothing

**Was:** `S.deloadAccepted = { at, plan }` was written to state and never read by
anything. Every prescription that week was unchanged.

**Now:** `acceptDeload()` creates a dated block (start, end = start + 6 days, factor
0.6). `decide()` checks the window before the normal rules and returns a `deload`
decision at ~60% of your working load. `closeDeloadIfDue()` retires it on the first
session after the end date and writes it to `deloadHistory`, which restarts the clock.
`dismissDeload()` suppresses the prompt for 7 days.

**In the gym:** accept the deload and every load that week is about 60% of normal,
labelled as an easy week, and it ends by itself on the stated date.

## 5. Goal, experience and availability only changed labels

**Was:** the roster came from `exercisesForDay()`, a fixed four-day table.
`trainingDaysPerWeek` appeared only in the week-strip caption. Goal and experience
were stored and never read.

**Now:** `buildProgram()` generates the programme from your settings and the roster
comes from it:

| Setting | What it changes |
|---|---|
| Days per week (2–6) | The split itself: 3 → full body ×3, 4 → upper/lower ×2, 5 → +push/pull, 6 → PPL ×2 |
| Goal | Rep ranges and set bias — strength 3–6, recomp 6–10, hypertrophy 8–12, fat loss 10–15 |
| Experience | Base sets per exercise — novice 2, intermediate 3, advanced 4 |
| Session minutes | Exercises per day: 30 min → 3, 60 min → 6, 90 min → 9 |
| Equipment | Unavailable equipment is substituted from the same movement group, with a note naming the swap |

The programme is regenerated when the settings signature changes, and Profile now
shows a sentence describing what it built and why.

**In the gym:** switching to 3 days gives you three full-body days, not three of the
four old ones. Switching to strength gives 3–6 rep prescriptions.

## 6. Pain

**Was:** severity < 5 reduced the load and carried on, whatever else was reported.
There were no descriptive flags at all. A concern vanished the moment the next
session was quiet. A "paused" exercise still rendered its sets and its tick, so you
could log it as normal.

**Now, three separate changes:**

- **Descriptive flags.** `sharp`, `swelling`, `numbness`, `givingWay`, `night`,
  `worsening`. Any one of them routes to review **regardless of the number**. Sharp
  pain rated 2/10 now pauses the exercise; it previously reduced the load by 20% and
  kept going.
- **Concerns persist.** A concerning report opens a `painConcern` that stays `open`
  until you explicitly resolve it. A later quiet session does not clear it —
  `syncPainConcerns()` rebuilds them from history on every decision.
- **Paused means paused.** A paused exercise renders no set rows, no tick and no rest
  timer. It shows the explanation and three choices: train something else, skip, or
  mark the concern resolved — the last behind a confirmation that names what clearing
  it means.

Readiness still excludes pain entirely; that invariant is tested in both suites.

## 7. Misleading diagrams

**Was:** every figure was a 2D side view, including movements that happen in the
frontal plane. A lateral raise drawn from the side is indistinguishable from a front
raise. The review was right that this is misleading rather than merely limited.

**Now:** the figure engine supports a front view (`front: true` gives the body two
shoulders and two hips, so both limbs are drawn doing their real job), and every
exercise declares its `viewAngle`:

- **front (4):** lateral raise, face pull, cable fly, farmer's walk
- **side-limited (2):** Pallof press, landmine rotation — anti-rotation is not
  representable from *any* single 2D angle, so these keep the side view and say so
  rather than swapping one wrong angle for another
- **side (34):** everything else

47 animations, still one per variant, none shared. Every manifest entry now carries
`viewAngle`, a `viewNote` stating that view's limitation, and
`status: 'provisional-unreviewed-original'`. Nothing claims review it has not had.

## 8. Service worker

| Defect | Fix |
|---|---|
| `activate()` deleted **every** cache on the origin, including other apps' | Deletion is scoped to `recomp-` prefixed caches |
| Any failed same-origin GET fell back to `index.html`, so a missing `.js` returned HTML | Navigations fall back to the page; scripts, styles, images, fonts and JSON each get a correct-type 503 |
| `skipWaiting()` ran unconditionally, so a deploy could swap code mid-workout | The worker waits. The page posts `SKIP_WAITING` only when no session is running; mid-workout it defers and offers the update after you finish |
| No way for the page to control the update | `message` channel added, plus a single-shot `controllerchange` reload |

---

## Data preservation

No schema change. v3 data loads unchanged; new fields (`activeDeload`, `painConcerns`,
`deferred`, `program`) default in via `migrate()`'s existing merge. The v1 → v3
migration path is untouched and still tested. Nothing was rebuilt.

## Still not verified

Unchanged from v3 and worth repeating: **no real browser, no screenshots, no iPhone.**
`apt` has no chromium package and Playwright's download is blocked by the proxy, so
the UI suite remains jsdom-only — it exercises real DOM and real events but never
lays out or paints. Everything under "NOT TESTED" in TESTING.md still stands.
