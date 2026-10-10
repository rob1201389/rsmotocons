# Recomp

Adaptive strength training that explains every change it makes. Offline-first PWA, no
backend, no account, no tracking.

## Files

| File | What it is |
|---|---|
| `index.html` | App shell, design system, all seven screens |
| `app.js` | UI logic, storage, rendering, timer, backup |
| `core.js` | Schema v3, migration, sessions, records, nutrition, backup validation |
| `engine.js` | The adaptive engine and its declared coaching assumptions |
| `exercises.js` | 40 exercise variants with full guidance, plus the asset manifest |
| `figure.js` | Parametric figure engine that draws and animates the demonstrations |
| `lifts.js` / `stretches.js` | Pose definitions: 41 exercise animations, 14 mobility |
| `sw.js` | Service worker (offline) |
| `tests.js` / `uitest.js` / `regression.js` | Logic, UI and regression suites |
| `DOUBLE-PROGRESSION.md` | How double progression works and where each rule lives |
| `DOUBLE-PROGRESSION-EXAMPLES.md` | Worked examples generated from the real engine |
| `../test/` | Double progression suites and `run-all.sh` |
| `BENCHMARK.md` | Competitive matrix and prioritised gap analysis |
| `MIGRATION.md` | Schema v1 → v3 migration notes |
| `ASSETS.md` | Coverage checklist, asset manifest, production brief |
| `TESTING.md` | Test results and what is not tested |

## Deploying

Static files, no build step. Push to a repo and point Cloudflare Pages at it:
no build command, output directory `/`. Must be served over HTTPS or the service worker
will not register.

Running the tests needs `npm install jsdom` (dev only — the app itself has no dependencies).

## On the phone

Open the URL in Safari, Share, Add to Home Screen. Launch from the icon rather than a tab:
iOS treats installed PWAs as durable storage.

## Where your data lives

On the device, written to IndexedDB and localStorage at the same time; reads take whichever
is newer and heal the other. Nothing leaves the device. Consequence: a lost phone loses
everything not backed up, so Profile → Back up my data matters. Backups are checksummed and
validated on the way back in.

## Updating

Edit, bump `CACHE` in `sw.js`, redeploy. Without the bump, phones keep serving the cached copy.

## What this app does not do

It does not diagnose injuries and it does not prescribe rehabilitation. The coaching
parameters are judgement calls, listed in the app under Profile → Coaching assumptions, and
should be reviewed by a qualified coach. The exercise animations are diagrams, not reviewed
technique references.
