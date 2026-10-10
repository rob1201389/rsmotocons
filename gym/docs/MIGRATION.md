# Migration notes — schema v1 → v3

## What the old data looked like

```js
{ week: 3,
  settings: { weight, deficit, ppk },
  logs: { '3:bench': { sets:[{weight:'60',reps:'8',done:true}], ts } },
  bests: { bench: { e1rm, weight, reps, week } },
  bw: [{ d: <epoch ms>, kg }] }
```

Three structural problems carried into the migration:

1. **`logs` is keyed `week:exerciseId`.** One bench session per week, full stop. Train a day
   twice and the second overwrote the first.
2. **No dates.** Only an optional `ts` on the log object.
3. **A set had `done` but no provenance.** A confirmed suggestion and a typed number were
   indistinguishable after the fact.

## What the migration does

| Step | Behaviour |
|---|---|
| Detect | `schemaVersion` if present, else the presence of `logs` implies v1 |
| Bucket | Each `week:exerciseId` is grouped into a `(week, day)` bucket — one session per training day per week |
| Date | The bucket's earliest `ts` becomes the session date. With no `ts`, the date is derived from the program start plus week and day offsets, and the session is flagged `dateEstimated: true` |
| Identify | Every session gets a stable `id`; the original week is retained as `migratedFromWeek` |
| Map ids | Legacy ids are mapped onto the new variants via `LEGACY_ID_MAP` (`bench` → `bench-barbell`, `dead` → `deadlift-conventional`, and so on). Where an id covered two real exercises the mapping picks the more conservative one and records `migratedFromId` on the entry |
| Sets | Only `done: true` sets become performance, marked `status: 'edited'` with `migrated: true`. Blank, undone sets are dropped, not promoted |
| Records | v1's `bests` are **discarded entirely** and rebuilt from the surviving sets. A v1 record could only ever go up, so any typo was permanent |
| Bodyweight | Epoch timestamps become local calendar dates, de-duplicated to one entry per day, keeping the last value |
| Settings | `weight` → `profile.bodyweightKg`; `deficit` and `ppk` → `nutrition` |
| Audit | A `migrations[]` entry records from, to, timestamp, session count and a note |

## Ambiguities, and how they are handled

- **`legraise`** in v1 covered what are now two variants (bodyweight and weighted hanging leg
  raise). It maps to **weighted**, because the later version of the old app had upgraded that
  row to a weighted exercise. If your history is actually bodyweight, re-point it in the app
  and the records recompute.
- **`wpull`** was labelled "weighted pull-up / pulldown". It maps to **weighted-pull-up**.
- **`pulldown`** was "lat pulldown / pull-up". It maps to **lat-pulldown**.
- **Estimated dates.** Sessions without a `ts` get a date derived from the program start. They
  are flagged, and the app says so in the upgrade banner rather than presenting them as fact.

## Safety properties

- **Non-destructive.** v1 data is read from its original key and never deleted. The v3 state is
  written to a new key (`recomp.v3`).
- **Idempotent.** Running the migration on already-migrated v3 data returns it unchanged
  (`migrated: false`). Covered by a test.
- **Refuses the future.** A `schemaVersion` higher than this build's is refused with a message,
  not silently coerced. The app shows a dead-end screen telling you to update rather than
  mangling the file.
- **A restore is a migration.** Importing a backup runs the same path, so an old backup
  restores correctly into the new schema.

## Verifying your own migration

1. Open the app. If v1 data is found you get a green banner naming the number of sessions.
2. Profile → Your data shows the schema version, session count and the migration note.
3. Progress → Records should show plausible numbers. If a record looks wrong it came from a
   mistyped set — fix the set and the record follows, which was not possible before.
4. Back up immediately after migrating.
