# Data flow inventory

Internal working document for the operator and for legal review. It is not the public
privacy policy (that is `gym/public/content/privacy.json`). It maps what Recomp collects,
where it goes and how long it stays, based on reading the code on 2026-10-10.

**How to read the evidence column**

- **Verified in code (file:line)**: read in the repository on 2026-10-10. Line numbers are
  as read on that day; other work streams are editing these files, so re-check after merge.
- **Implemented (2026-10-10)**: items first marked pending were built and tested on branch
  `claude/vibrant-davinci-6526f6`; the evidence is the test named in that row (backend
  `test/security.test.js`, app `test/settings.ui.test.js`). Re-check on the live site after deploy
  (see `UNRESOLVED-FACTS.md`, "Verify after deploy").
- **Operator configuration**: depends on how the operator has set up Cloudflare, Resend and
  Anthropic. The code cannot tell us.

## 1. The two ways the app runs

| Mode | What happens | Evidence |
|---|---|---|
| Local only (no account, or no backend at the origin) | Everything stays in the browser on that device. Nothing is sent to the server. | `public/authclient.js` comments at the top; `public/app.js:15-58` (storage layer) |
| Signed in | The browser keeps a working copy and syncs one "state document" per account to Cloudflare D1. Account, review, weekly submission and audit records live only in D1. | `public/app.js:59-85` (push to `/api/state`); `backend/src/api.js:124-144` |

## 2. Data flow diagram

```
 Person's device (browser / installed PWA)
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ localStorage  recomp.u.<userId>.state   (state document, JSON)              │
 │               recomp.u.<userId>.user    (cached account summary)            │
 │               recomp.lastUser, recomp.lastVerified                          │
 │               recomp.v3 / recomp        (local-only mode and legacy v1)     │
 │ IndexedDB     database "recompDB", store "kv", same keys as above           │
 │ Cache Storage recomp-<version>  app shell files, Google Fonts files         │
 │ Garmin files  read in the browser only (CSV, TCX, sleep JSON); FIT refused  │
 └───────────────┬───────────────────────────────┬────────────────────────────┘
                 │ HTTPS, same origin             │ HTTPS on page load
                 │ cookie recomp_session          │ (reveals IP address and
                 ▼                                │  user agent to Google)
 Cloudflare (Worker "rsmotocons-gym", static assets, D1 database "recomp")
 ┌────────────────────────────────────────────┐   ▼
 │ /api/*  backend/worker.js -> src/api.js     │   fonts.googleapis.com
 │ D1 tables: users, sessions, login_attempts, │   fonts.gstatic.com
 │  user_state, coach_assignments, reviews,    │
 │  review_messages, plan_proposals,           │
 │  weekly_submissions, signup_requests,       │
 │  email_tokens, admin_notes, rate_events,    │
 │  audit_log, meta                            │
 └──────┬──────────────────────────┬──────────┘
        │ only if RESEND_API_KEY   │ only if ANTHROPIC_API_KEY is set
        │ and MAIL_FROM are set    │ (and, once delivered, aiReviews is on)
        ▼                          ▼
  api.resend.com/emails       api.anthropic.com/v1/messages
  (recipient email, name,     (weekly statistics, fact sentences, written
   subject, one-time link)     updates for the week, feedback counts,
                               proposed changes; no name, email or user id)

 Implemented: api.pwnedpasswords.com/range/<first 5 hex chars of SHA-1> (off when HIBP_CHECK=off)
```

## 3. Inventory by data category

Abbreviations: **LS** localStorage, **IDB** IndexedDB, **D1** Cloudflare D1.

### 3.1 Account and authentication

| Item | Collected where | Stored | Who can access | Third parties | Retention today | Deletion path today | Evidence |
|---|---|---|---|---|---|---|---|
| Name, email (login), password hash (PBKDF2-SHA256, 100,000 iterations), role, status, created/approved timestamps and who approved | Sign-up form, admin "create user", owner first-run setup | D1 `users` | The user (own summary); owners and admins (user list shows email, name, role, status, last login) | Resend receives email and name for verification and reset mail, if configured | Indefinite. No automatic purge. | None for members today. Admin can change status (suspend, revoke, reject) but no delete endpoint exists. | `backend/schema.sql:4`; `backend/src/signup.js` sign-up (around lines 60-125); `backend/src/crypto.js` (PBKDF2 100000); `backend/src/api.js:336-344` |
| Last login time and **last login IP address** | Every login | D1 `users.last_login_at`, `last_login_ip` | Not returned by the user list; readable by anyone with database access | None | Overwritten on each login; otherwise indefinite | None | `backend/src/auth.js:188` |
| Sessions: SHA-256 of the session token, created, last seen, expiry, **IP address, user agent (first 200 characters)** | Login, sign-up, setup, password change | D1 `sessions`; cookie `recomp_session` (HttpOnly, SameSite=Lax, Secure on HTTPS) | The user, through Settings, Sessions (`GET /api/auth/sessions`; opaque handle, never the token) | None | Idle timeout 7 days, absolute 30 days; expired or revoked rows are purged 7 days later (`housekeeping` in `backend/src/api.js`) | Deleted with the account (`DELETION_TABLES`, `backend/src/account.js`) | `backend/schema.sql:24`; `backend/src/auth.js:4-5,37` |
| Login attempts: key `login|IP`, time, success flag | Every login attempt | D1 `login_attempts` | Server only | None | Rows older than about 30 minutes are deleted on the next attempt | Automatic | `backend/schema.sql:36`; `backend/src/auth.js:24` |
| Rate limit events: keys include IP addresses, email addresses (`signup|email|...`) and user ids | Sign-up, resend, verify, forgot, reset, AI review | D1 `rate_events` | Server only | None | Rows older than 2 days are deleted whenever a new event is recorded | Automatic | `backend/schema.sql:159`; `backend/src/limits.js:5` |
| Sign-up request: name, email, status, verification time, decision, decision note | Sign-up | D1 `signup_requests` | Owners and admins | None | Indefinite | `ON DELETE CASCADE` from `users` once deletion exists | `backend/schema.sql:124` |
| One-time email tokens (SHA-256 only), purpose, expiry, used time | Verification (48 hours) and reset (1 hour) emails | D1 `email_tokens` | Server only | The raw token travels inside the email via Resend | Expired and used rows are never deleted | Cascade on user deletion | `backend/schema.sql:140`; `backend/src/signup.js:11-12` |
| Admin private notes about a person | Admin screen | D1 `admin_notes` | Owners and admins only; never returned to the member | None | Until an admin clears it | Admin clears; cascade on user deletion | `backend/schema.sql:151`; `backend/src/signup.js:320-337` |
| Cached account summary and last user id | Browser after sign-in | LS `recomp.u.<id>.user`, `recomp.lastUser`, `recomp.lastVerified` | Anyone using that browser profile | None | Until sign-out | Sign-out removes these LS keys | `public/authclient.js:41-46,154-165` |
| MFA (TOTP secret, recovery codes), passkeys, session list, reauthentication, email change | Settings | D1 (new tables) | The user; secrets never returned | None | While the account exists; pending logins 5 minutes, reauthentication 10 minutes | Deleted with the account | **Implemented**: `backend/src/security.js`, `backend/src/webauthn.js`; TOTP secret encrypted with `sealText`; recovery codes stored as PBKDF2 hashes. Tests: security.test.js MFA, recovery, passkey and session checks. `users.mfa_secret` is still unused. |
| Password screening against breached passwords | Sign-up, password change, reset | Not stored | n/a | Have I Been Pwned range API receives only the first 5 hexadecimal characters of the SHA-1 hash of the password | n/a | n/a | **Implemented**: `screenPassword`, `backend/src/crypto.js`; on by default, fails open if the API is unreachable |

### 3.2 Training, goals, plan and nutrition (the state document)

One JSON document per account. In the browser it lives in LS and IDB; when signed in it
is synced whole to D1 `user_state.doc`. Fields are defined in `public/core.js:56-80`
(`blankState`).

| Field | What it holds | Sensitive? | Evidence |
|---|---|---|---|
| `profile` | Name (optional), goal, experience, units, height, bodyweight, training days, session length, equipment, load increments, guardrails | Height and bodyweight: likely health information | `public/core.js:21-38` |
| `nutrition` | Calorie deficit, protein and fat per kg, maintenance factor | Likely health information | `public/core.js:40-46` |
| `intake` | Per day `{ kcal, protein }` typed by the user | Likely health information | `public/core.js:71` |
| `bodyweight` | `[{ date, kg }]` weigh-ins | Health information | `public/core.js:74,316-322` |
| `goals` | Goals, availability, preferences, milestones, review day, timezone | Goal may imply health status | `public/core.js:65` |
| `plan`, `planOverrides`, `exerciseSettings`, `program` | Versioned plan, weekly slots, change log with reasons | Indirectly | `public/core.js:62-67`; `public/plan.js` |
| `sessions` | Dated workouts: sets, loads, reps, effort feedback, decisions, pre-session check-in (energy, sleep, soreness 1-5, time available, pain) | Check-in and pain: health information | `public/core.js:106-131`; `public/engine.js:130-133` |
| `painConcerns`, `painReviews` | Pain or discomfort reports by exercise and location, severity, status | Health information | `public/engine.js:83-111`; `public/core.js:68` |
| `notes`, `noteDrafts`, `noteSuggestions` | Free-text written training updates, category (`progress`, `energy`, `technique`, `schedule`, `recovery`, `preferences`, `pain`) | Can contain health information | `public/review.js:72-147` |
| `reviews` | Weekly review reports: statistics, facts, check-in answers (overall, energy, sleep, soreness, pain areas, enjoyed, disliked), decisions, AI wording if any | Health information | `public/review.js:433-500` |
| `wellness` | Imported sleep, activities and an import log (see 3.3) | Health information | `public/garmin.js:137-158` |
| `stretchLog` | Completed stretch and recovery sessions | Low | `public/core.js:72` |
| `prefs`, `bests`, `migrations`, `lastBackup` | Theme, motion, derived records, schema upgrade log | No | `public/core.js:49-54,75-79` |

| Aspect | Today | Evidence |
|---|---|---|
| Where collected | In the app, typed or tapped by the user | n/a |
| Where stored | LS key `recomp.u.<id>.state` and IDB `recompDB` / `kv` (same key); D1 `user_state` when signed in | `public/app.js:18-21,27,100-108`; `backend/src/api.js:130-144` |
| Who can access | The user. Assigned reviewers (coach, or an owner/admin who is explicitly assigned) can read the whole document through `GET /api/users/:id/state`; each such read is logged as `access.read_member_records`. Admin rank alone is not enough. | `backend/src/rbac.js:50-62`; `backend/src/api.js:147-161` |
| Sharing control | `shareWithReviewer` setting (default on). When off, assigned reviewers and admins get `403 sharing_off` on state and weekly reports, and new submissions are refused | **Implemented**: `backend/src/rbac.js` `mayAccessUserData`; security.test.js sharing checks |
| Third parties | Cloudflare (hosting). Parts reach Anthropic only through the AI weekly review (3.5). | `backend/src/ai.js:204-225` |
| Retention | Indefinite while the account exists. Browser copy until sign-out or until the browser data is cleared. | n/a |
| Deletion today | Garmin imports can be deleted one by one or all at once. Account deletion from Settings removes the server copy immediately. On sign-out the localStorage copy and (fixed 2026-10-10) the IndexedDB key `recomp.u.<userId>.state` are removed, checked in Chromium. | `public/authclient.js` `wipeAccount`; `backend/src/account.js` |
| Export today | In-app "backup" downloads the state document as JSON with a checksum (`public/core.js:630-646`; `public/app.js:1665`). Full server export `GET /api/account/export` (needs recent sign-in) from Settings, Your data. Tested in security.test.js and settings.ui.test.js. | as cited |

### 3.3 Garmin and wearable files

| Aspect | Today | Evidence |
|---|---|---|
| Formats | Garmin Connect CSV (activities, sleep), TCX activity files, Garmin data export sleep JSON. FIT files are detected and refused. No connection to any Garmin service; no automatic sync. | `public/garmin.js:1-11,116-134` |
| Parsing | In the browser. The raw file is not uploaded and not kept. | `public/garmin.js:116-134` |
| Sleep fields kept | `date`, `hours`, `score` (sleep score if present), `source` | `public/garmin.js:64,93` |
| Activity fields kept | `date`, `type` (activity type label), derived `kind` and `intensity`, `minutes`, `distanceKm`, `calories`, `avgHr`, `maxHr` (CSV only; TCX gives no max), `source`, plus `id`, `excluded`, `linkedSessionId`. The CSV "Title" column is read only to classify the activity and is not stored. | `public/garmin.js:69-75,110,148` |
| Import log kept | `id`, kind, format, **original file name**, row counts, date coverage, import time | `public/garmin.js:151` |
| Not imported | HRV, sleep stages (only their sum is used for duration), resting heart rate, stress, body battery, GPS tracks, heart-rate time series, steps | `public/garmin.js` (no such fields read) |
| Where stored | Inside the state document (`wellness`), so it syncs to D1 when signed in. The module comment "Nothing is sent anywhere" is true of the file itself, not of the extracted rows once synced. | `public/garmin.js:137`; `public/app.js:100-108` |
| Deletion | "Clear all" empties `wellness`; removing a single import keeps its rows | `public/garmin.js:154-158` |

### 3.4 Workout reviews, weekly submissions and coach feedback

| Item | Stored | Who can access | Retention | Evidence |
|---|---|---|---|---|
| Workout review: session reference and date, difficulty, satisfaction, effective and unsuitable exercises, technique question, **pain note**, wanted change, comment, wants-review flag, status, assigned reviewer | D1 `reviews` | The user; reviewers assigned to that user | Indefinite | `backend/schema.sql:60`; `backend/src/api.js:219-265` |
| Review messages between user and reviewer | D1 `review_messages` | The user; assigned reviewers | Indefinite | `backend/schema.sql:82`; `backend/src/api.js:266-287` |
| Plan proposals from a reviewer (change JSON, reason, status) | D1 `plan_proposals` | The user (decides); proposer | Indefinite | `backend/schema.sql:92`; `backend/src/api.js:289-322` |
| Weekly submission: week start, report (statistics, facts, attention items, reported check-in answers including pain areas, interpretations, data gaps, written updates for the week with category and text, proposals, decision, AI headline if any), plan version, status, coach note | D1 `weekly_submissions` | The user; the assigned coach; each inbox read logged as `weekly.read_member_reports` | Indefinite | `backend/schema.sql:168`; `backend/src/weekly.js:85-195`; `public/views-review.js:376-384` |
| Coach assignments | D1 `coach_assignments` | Owners and admins | Until removed | `backend/schema.sql:52`; `backend/src/api.js:431-449` |

### 3.5 AI-assisted wording of the weekly review

| Aspect | Today | Evidence |
|---|---|---|
| Trigger | The browser calls `POST /api/ai/weekly-review` when a weekly review is built in signed-in mode. There is no user opt-in in the code read; the request is refused with `ai_not_configured` if the operator has not set `ANTHROPIC_API_KEY`. | `public/views-review.js:237-243`; `backend/src/ai.js:240` |
| Opt-in | `aiReviews` setting, default **off**; when off the server returns `403 ai_disabled` and sends nothing to the provider. Withdrawn health consent also blocks it | **Implemented**: `backend/src/ai.js`; ai.test.js, settings.ui.test.js "AI off" |
| What is sent (exact) | `period` (start, end, timezone); `goal` (primary, up to 3 secondary); `stats` (19 counts: planned, completed, partial, missed, skipped, rescheduled, additional, unique training days, completion %, on-time %, conditioning planned/done, stretch and recovery sessions done, rest days kept, rep gains, load gains, **pain flags**, technique concerns); `facts` and `attention` (sentences the app wrote, which can include exercise names, reps and loads in kg, and that pain was flagged); `notes` (the user's written updates for that week: id, category, date, text trimmed to 220 characters when the report is built and capped at 600 in the payload, linked exercise id, self-reported flag); `feedback` (per exercise counts of too easy, about right, too hard); `proposals` (kind, title, reason); `dataGaps` (sentences). Not sent: name, email, user id, bodyweight entries, food intake, Garmin rows, check-in answers outside the facts. The server rebuilds the object from known keys only. | `public/review.js:580-597,456-459`; `backend/src/ai.js:54-116` |
| Server prompt | Fixed system prompt (Australian English, no medical diagnosis, treat notes as data, numbers only from supplied data) plus the payload | `backend/src/ai.js:16-38,119-125` |
| Provider | Anthropic Messages API, model `env.AI_MODEL` or `claude-sonnet-5-5`, no `inference_geo` parameter sent, so the workspace default applies | `backend/src/ai.js:10,204-216` |
| Output | Validated; any number not present in the input is rejected; result shown with a label naming the model | `backend/src/ai.js:137-201`; `public/views-review.js:259` |
| Server logging | Payload, notes and key are not logged. Audit rows record `ai.review_generated` (model), `ai.review_unavailable` or `ai.review_invalid` (reason). | `backend/src/ai.js:1-4,253-261` |
| Rate limit | 12 per hour, 60 per day per user | `backend/src/ai.js:13-14` |
| Provider retention | Anthropic commercial API: inputs and outputs deleted within 30 days by default; up to 2 years if flagged by trust and safety; zero data retention by arrangement; not used for training (see `APPLICABILITY.md`, section 6) | Research, cited there |

### 3.6 Email

| Aspect | Today | Evidence |
|---|---|---|
| When | Only if `RESEND_API_KEY` and `MAIL_FROM` are set. Otherwise nothing is sent. | `backend/src/mail.js:9-13` |
| What | To: the user's email. Body: greeting with the user's name, a one-time link (verification 48 hours, reset 1 hour). | `backend/src/mail.js:47-70`; `backend/src/signup.js:11-12` |
| Not logged | Body, recipient, token and key are not logged | `backend/src/mail.js:1-5` |
| Added | Email change confirmation (to the new address) and notice (to the old one); new-device and owner/admin grant alerts to owners. All need mail configured. Reminder emails were dropped: nothing would send them | `backend/src/security.js` (`emailChangeStart`, `alertOwners`) |

### 3.7 Audit log

| Aspect | Today | Evidence |
|---|---|---|
| Fields | Time, actor id, **actor email**, action, target id, detail JSON, **IP address** | `backend/schema.sql:105`; `backend/src/auth.js:15-20` |
| Notable details | Failed logins no longer store the typed login (changed 2026-10-10); sign-up creation, approvals, role and status changes, reads of member records, weekly report reads, AI review outcomes | `backend/src/auth.js:178`; `backend/src/api.js:157`; `backend/src/weekly.js:90` |
| Who can read | Owners and admins (`GET /api/admin/audit`, up to 500 rows) | `backend/src/api.js:450-453` |
| Retention | Indefinite. No purge. Rows cannot be deleted or rewritten (SQLite triggers, `backend/src/protect.js`) | security.test.js audit log checks |
| On deletion | Actor email and IP are blanked on that person's rows; the event stays | `deleteAccount`, `backend/src/account.js` |

### 3.8 Browser storage, service worker and external requests

| Item | Detail | Evidence |
|---|---|---|
| Cookie | One cookie, `recomp_session`, HttpOnly, SameSite=Lax, Secure on HTTPS, 30 days. Strictly necessary for sign-in. No other cookies set by the app. | `backend/src/auth.js` `sessionCookie` |
| localStorage | Keys listed in the diagram above | `public/app.js:18-21,45-58`; `public/authclient.js:41-50,87-124` |
| IndexedDB | `recompDB`, object store `kv` | `public/app.js:27-28` |
| Service worker caches | `recomp-<version>`: app files, navigations, Google Fonts files. Never caches `/api/*` responses. Sign-out deletes `recomp-*` caches. | `public/sw.js:11-117`; `public/authclient.js:53-58` |
| Google Fonts | `index.html` loads a stylesheet from `fonts.googleapis.com` and font files from `fonts.gstatic.com` on every first load (afterwards from cache). Google receives the IP address, the requested URL and HTTP headers including user agent. `Referrer-Policy: no-referrer` limits the referrer. | `public/index.html:19-21`; `public/_headers` (CSP allows these hosts) |
| Analytics, advertising, tracking pixels | None found. CSP `script-src 'self'`; no third-party scripts; no `sendBeacon`; the only cross-origin hosts allowed by CSP are the two Google Fonts hosts. | `public/_headers`; `public/index.html:952-970` |
| Permissions | Camera, microphone, geolocation, payment and USB are disabled by Permissions-Policy | `public/_headers` |

### 3.9 Infrastructure logs (outside the code)

| Item | Detail |
|---|---|
| Cloudflare Workers Logs | `wrangler.jsonc` has no `observability` block. Cloudflare says Workers Logs are on by default for newly created Workers and keep invocation logs (request and response metadata) and `console` output for 3 days (Free) or 7 days (Paid). The Worker only logs `api error: <message>`. **Operator configuration: confirm in the dashboard.** |
| D1 Time Travel | Always on; point-in-time restore for 30 days (Workers Paid) or 7 days (Free). Deleted rows remain restorable for that window. |
| Cloudflare request handling | Every request passes through Cloudflare's network, which processes the IP address and request metadata under Cloudflare's own terms. |

## 4. Service providers

| Provider | Role | Data | Status | Location | Contract terms |
|---|---|---|---|---|---|
| Cloudflare, Inc. | Hosting: Worker, static assets, D1 database, network | Everything sent to the server | In use (verified: `wrangler.jsonc`) | D1 primary chosen at creation near where it was created unless a location hint or jurisdiction was set; Worker runs at Cloudflare's global edge. **Operator configuration.** | Customer DPA incorporates EU SCCs; Cloudflare relies on EU-US, UK and Swiss Data Privacy Framework certification. Operator to confirm acceptance. |
| Plus Five Five, Inc. (Resend) | Transactional email | Email address, name, email content including one-time links | Only if configured | Account data, email metadata and logs stored in the United States whatever sending region is chosen | DPA incorporated in the Terms of Service; includes EU SCCs and UK Addendum |
| Anthropic | AI wording of weekly review | AI payload above | Only if configured (and, once delivered, turned on by the user) | Inference `global` by default unless the workspace default is `us`; workspace data at rest `us` only | Commercial Terms: no training on customer content; DPA incorporated with EU SCCs |
| Google | Web fonts | IP address, user agent, requested URL | In use on every first load | Google's network | Google Fonts terms; Google states it does not use the data to build profiles or for ads |
| Have I Been Pwned (Troy Hunt) | Breached password screening | First 5 hex characters of a SHA-1 hash only | In use unless `HIBP_CHECK=off` | n/a | No personal information is disclosed by design |
| GitHub | Source code hosting only | No user data | In use for code | n/a | n/a |

## 5. What is not implemented (so the public copy must not claim it)

- **Recipes.** There is a `recipes` permission flag (`backend/src/rbac.js:13`) but no recipe
  library. Nutrition is: macro targets from bodyweight (`public/core.js:351-362`), one
  generated meal plan suggestion built from 13 fixed foods (`public/core.js:370-443`,
  `FOOD`), and a manual daily intake log of calories (kcal) and protein (`intake`).
- **Automatic wearable sync.** Only manual file import.
- **FIT files, HRV.** Not supported.
- **Push notifications or reminders by email.** Not built. Settings offers an in-app review reminder only.
- **Account deletion and server export.** Implemented 2026-10-10 (see 3.2 and `backend/src/account.js`).
- **Recorded consent.** Implemented 2026-10-10: append-only `consents` table, required at
  sign-up, asked once of existing accounts, withdrawable in Settings. See `CONSENT-MODEL.md`.
- **Age checks.** None.
- **Terms of use.** None exist.
- **Field encryption of sensitive columns.** Implemented 2026-10-10 for the state document,
  weekly reports, review messages, admin notes, account request messages and TOTP secrets
  (AES-256-GCM, `DATA_ENC_KEY`). Not active until the operator sets that secret. D1 itself
  encrypts all stored data at rest with AES-256 (Cloudflare docs). The server can read the data:
  this is not end-to-end encryption.
- **Video, qualified-professional review of exercise content.** Exercise guidance is written
  cues and simplified diagrams (`public/figure.js`, `public/library.js`).
