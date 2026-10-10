# Test results, and an honest list of what is not tested

Run them yourself:

```
node tests.js     # 73 logic tests
node uitest.js    # 49 UI integration tests in a simulated browser (needs jsdom)
```

## What passes

**`tests.js` — 73 passed, 0 failed.** Pure logic against core.js, engine.js and exercises.js.

| Group | Covers |
|---|---|
| Working sets | Modal working weight vs heaviest set, tie resolution, warm-up exclusion |
| Sessions | Same day trained twice in one week, unique ids, latest-by-date lookup |
| Confirmation | Pending sets contribute nothing, confirm copies the plan, blank edits record null, unlog |
| Records | Correcting a typo lowers the record, deleting a session clears it, assisted records least assistance, holds and carries use their own record types |
| Averages | Same-day duplicates collapse, 60-day-old entries excluded, empty windows return null, weekly rate from two calendar windows |
| Nutrition | Plan tracks a changed deficit, lands within 15 g protein and 250 kcal, follows bodyweight down, enforces the 1,200 kcal floor |
| Timers | Wall-clock remaining time across a backgrounded gap, stable across repeated renders |
| Backup | Round trip, checksum rejection, random JSON rejected, future schema refused, count mismatch warned |
| Migration | v1 detected, week-keyed logs become dated sessions, legacy ids mapped to variants, undone sets not promoted, phantom records discarded, duplicate weigh-ins collapsed, settings carried, audit written, idempotent, future version refused |
| Engine — easy | Progresses with reps met and reserve in hand; jump capped at 5% |
| Engine — maximum effort | Reps met at maximum effort **holds**; near limit with 0 reserve holds; 1 reserve rep holds; deteriorating technique blocks progression |
| Engine — pain | Mild pain reduces load on a separate pathway; severe pain pauses and prescribes nothing; readiness is numerically identical with and without pain; check-in pain flags the session |
| Engine — incomplete | Missed reps hold; well short reduces; skipped sets not counted |
| Engine — missing feedback | No feedback holds; "unsure" is null not zero; first time ever calibrates and suggests no load |
| Engine — missed weeks | 25 days away trims and flags returning; 9 months capped at 15%; 6 days is normal |
| Engine — other | Low readiness holds; three holds trigger substitution; deload proposed and requires confirmation |
| Modalities | Bodyweight adds reps then load; assisted reduces assistance; timed hold adds seconds then load and resets; carry fixes distance and moves load |
| Explainability | Every decision carries what/why/next and a rule trace; load and volume never rise together; all 40 variants complete; split variants keep separate histories; every coaching assumption declares a basis and a reviewer |

**`uitest.js` — 49 passed, 0 failed.** Real DOM, real event dispatch, served over loopback HTTP
so storage behaves as it does in a browser.

| Group | Covers |
|---|---|
| Boot and migration | v1 data found and migrated, banner shown, phantom record rebuilt, v3 persisted |
| Today | Week strip renders, two taps from Today to a running session, check-in offers all five inputs |
| Train | Figures render, previous/target/actual present, numeric keypad requested, pending sets contribute nothing, one-tap confirm, tap again to clear, rest timer opens full screen, **timer survives a full re-render without drift** |
| Feedback | All four groups present, four taps to complete, effect on the next recommendation shown immediately, pain reachable directly and carries the no-diagnosis statement |
| Completion | Achievements and next-session adjustment shown, live session cleared, feedback changed the next prescription |
| Progress | Stats render, honest empty state with one weigh-in, dated trend after logging, 7-day note states the sample size |
| Library | All 40 variants listed, search filters, detail shows every guidance section and the unreviewed label, mobility retained |
| Profile | Goals, equipment, increments and nutrition editable; increments change what the engine prescribes; assumptions surfaced with reviewers named; backup round trip; tampered backup refused |
| Accessibility | Tablist pattern with one selected tab, all sheets are labelled modal dialogs, every input has a label, skip link and live region present, reduced motion renders a still, light theme applies |
| Resilience | Undo restores a cleared weigh-in; no script errors across the whole journey |

## Usability targets — measured where measurable

| Target | Result |
|---|---|
| Start a workout in two taps | **Met.** Tap 1 "Start workout", tap 2 "Start workout" in the check-in sheet. Verified by test |
| Confirm an unchanged prescribed set in one clearly labelled action | **Met.** One tap on the tick. Its accessible name reads "Confirm set 1 as prescribed: 60 for 8 reps". Verified by test |
| Ordinary feedback in about ten seconds | **Partly verified.** Four taps plus a save, verified by test. Four taps in ten seconds is reasonable, but I have not timed a human doing it |

## NOT TESTED — read this before trusting any of it

**Nothing has been run on a real iPhone, or in any real browser.** The UI suite runs in jsdom,
which simulates the DOM but does not lay out, paint, or run a real rendering engine. I could
not install a headless browser: the environment's proxy blocks the Chrome download.

Specifically untested:

1. **Any visual rendering.** No screenshots exist. Layout, spacing, the light theme, real
   contrast, and whether the figures read correctly at 66 px have not been seen by anyone.
2. **iOS Safari specifics** — safe-area insets around the notch and home indicator, the fixed
   bottom bar with the keyboard open, rubber-band scrolling, and the input focus-zoom.
3. **Add to Home Screen**, standalone launch, and whether iOS keeps IndexedDB and localStorage
   data over weeks in practice.
4. **The service worker** — registration, offline replay, and the cache bump on redeploy. The
   file is syntax-checked only.
5. **Real backgrounding.** The timer is wall-clock by construction and the arithmetic is
   tested, but an actual locked iPhone for 90 seconds has not been tried.
6. **Wake Lock**, the Web Share file path, and `navigator.vibrate` — feature-detected and
   wrapped, none exercised on a device.
7. **VoiceOver and TalkBack.** The semantics are right by inspection — roles, labels, live
   regions, focus management — but no screen reader has been run against it. The AppleVis
   review of Hevy found exactly this gap in a shipped product, so assume it needs real testing
   before it can be claimed.
8. **Contrast ratios** have not been measured with a tool. The light-mode accent was darkened
   to #1E7A3C for text contrast, but that is reasoning, not measurement.
9. **Performance** with hundreds of sessions. Records are recomputed from scratch on every
   change — correct, fine at this scale, not profiled at a year of data.
10. **Tablet and desktop layouts.** The sidebar breakpoint at 900 px is written but unseen.

## Coaching assumptions needing qualified review

Listed in the app under Profile → Coaching assumptions, and in `engine.js` as
`COACHING_ASSUMPTIONS`. The ones that matter most:

- **Pain rated 5 or above pauses the exercise.** A developer's safety-biased cut-off, not a
  clinical threshold. **This is the assumption most in need of review by a physiotherapist.**
- Two clean reps in reserve before load increases.
- Load jumps capped at 5% of the working load.
- 3% decondition per week away, capped at 15%.
- 22 working sets per muscle per week as the ceiling.
- Three consecutive holds triggers substitution.
- Epley for estimated 1RM; accuracy degrades above about 10 reps.
- Maintenance as bodyweight × 33 and protein at 2.0 g/kg — population formulas, not
  measurements, and worth a dietitian's eye.
- The readiness formula (mean of energy, sleep and inverted soreness) is invented for this app
  and has no validation. Pain is deliberately excluded from it.

This app does not diagnose injuries and does not prescribe rehabilitation.
