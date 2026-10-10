# Working contract: security, settings, privacy and public pages

Shared by the three work streams (backend, frontend, privacy and copy). It is the
agreed interface, not public documentation. Every mutating request keeps the existing
`X-Recomp-Request: 1` header. Errors stay `{ error: string, code?: string, ... }`.

## Ownership

| Stream | Owns | Must not edit |
|---|---|---|
| Backend | `gym/backend/**`, `gym/public/_headers`, `gym/wrangler.jsonc`, `gym/docs/security/*` (backend parts) | `gym/public/*.js`, `index.html` |
| Frontend | `gym/public/*.js`, `gym/public/*.css`, `gym/public/index.html`, `gym/public/sw.js`, new `gym/test/*.ui.test.js` | `gym/backend/**`, `gym/public/content/**` |
| Privacy and copy | `gym/public/content/**`, `gym/docs/privacy/**` | code |

## Safe content format (About, Why us, Privacy)

Files: `gym/public/content/about.json`, `why.json`, `privacy.json`. Shape:

```json
{ "key": "about", "title": "About Recomp", "version": "2026-10-11.1", "updated": "2026-10-11",
  "status": "draft" | "published",
  "summary": "One paragraph shown at the top",
  "blocks": [
    { "t": "h2", "id": "who-we-are", "text": "..." },
    { "t": "p", "text": "..." },
    { "t": "ul", "items": ["...", "..."] },
    { "t": "ol", "items": ["..."] },
    { "t": "table", "head": ["...", "..."], "rows": [["...", "..."]] },
    { "t": "note", "text": "..." },
    { "t": "steps", "items": [{ "title": "...", "text": "..." }] },
    { "t": "cards", "items": [{ "title": "...", "text": "...", "badge": "Available now" | "Planned" }] }
  ] }
```

Inline markup inside any `text` or item string: `**bold**` and `[label](url)` where url is
`https://...`, `mailto:...` or `#anchor` only. Operator facts are tokens replaced at render
time: `{{operator.name}}`, `{{operator.legalName}}`, `{{operator.abn}}`,
`{{operator.privacyEmail}}`, `{{operator.address}}`, `{{operator.country}}`,
`{{policy.effectiveDate}}`. A missing value renders as a visible "[not yet supplied]" marker
and the page shows a draft banner. The renderer builds DOM with `textContent` only: no
`innerHTML` of content, no HTML passthrough, no other URL schemes.

Privacy JSON may also carry `"overview": [...]` (blocks for the short summary) and
`"history": [{ "version", "date", "summary" }]`.

## Backend endpoints

### Public (no session)
- `GET /api/content/:key` (`about`, `why`) → `{ content | null, updatedAt, updatedBy }`. Admin
  overrides of the repo copy. `null` means use the file in `public/content`.
- `GET /api/operator` → `{ operator: { name, legalName, abn, privacyEmail, address, country },
  policy: { effectiveDate, version }, complete: bool }`. Only fields an admin has entered. No
  invented defaults.

### Login and MFA
- `POST /api/auth/login` `{ email, password }` →
  - no MFA: `200 { ok, user }` as today;
  - MFA enrolled: `200 { ok:true, mfaRequired:true, methods:['totp','recovery','passkey'?] }`
    with a short-lived (5 min) MFA-pending cookie only; no session until verified;
  - wrong credentials: `401 { error: 'Login or password is incorrect.' }` (same text and timing
    for unknown accounts).
- `POST /api/auth/mfa/verify` `{ code }` or `{ recoveryCode }` → `200 { ok, user }` and a fresh
  session cookie. 5 tries per pending login, then the pending login is dropped.
- Owner and admin accounts without MFA get a session flagged `mfaSetupRequired:true` in
  `user`; every route except MFA enrolment, `/api/auth/me`, `/api/auth/session`, logout and
  content returns `403 { code:'mfa_setup_required' }`.
- `POST /api/auth/mfa/totp/begin` (recent auth) → `{ secret, otpauthUri }`.
- `POST /api/auth/mfa/totp/confirm` `{ code }` → `{ ok, recoveryCodes: [10 strings] }` (shown once).
- `POST /api/auth/mfa/recovery/regenerate` (recent auth) → `{ recoveryCodes }`.
- `POST /api/auth/mfa/disable` (recent auth, refused for owner/admin) → `{ ok }`.
- Passkeys (WebAuthn, if delivered): `POST /api/auth/passkey/register/begin|finish`,
  `POST /api/auth/passkey/login/begin|finish`, `GET /api/auth/passkeys`,
  `DELETE /api/auth/passkeys/:id` (recent auth). If not delivered, `GET /api/auth/passkeys`
  returns `{ supported:false }`.
- `GET /api/auth/me` and `/api/auth/session` `user` gain `mfa: { totp: bool, passkeys: n,
  recoveryCodesLeft: n, required: bool }`.

### Recent authentication
- `POST /api/auth/reauth` `{ password, code? }` → `{ ok, until }`. Valid 10 minutes on this
  session. Routes that need it answer `403 { code:'reauth_required' }`. Needed for: password
  change, email change, MFA changes, passkey removal, data export, account deletion, admin
  role/permission/status changes, admin content edits.

### Sessions
- `GET /api/auth/sessions` → `{ sessions: [{ id, current, createdAt, lastSeenAt, expiresAt,
  device }] }` (`id` is an opaque handle, never the token; `device` is a short label from the
  user agent).
- `POST /api/auth/sessions/:id/revoke` → `{ ok }`.
- `POST /api/auth/logout-all` `{ keepCurrent: bool }` → `{ ok, revoked }`.
- Sessions rotate on login, MFA verify, password change, role change. Password reset,
  suspension, rejection and deletion revoke all sessions.

### Email change
- `POST /api/auth/email` `{ newEmail }` (recent auth) → sends a confirmation link to the new
  address and a notice to the old one. Refused with `409 { code:'mail_not_configured' }` when
  mail is off. `POST /api/auth/email/confirm` `{ token }` completes it and revokes other sessions.

### Settings (server-enforced)
- `GET /api/settings` → `{ settings: { aiReviews: bool, shareWithReviewer: bool }, updatedAt }`.
  Defaults: `aiReviews:false` until the user turns it on, `shareWithReviewer:true`. (Email
  reminders were dropped: nothing would send them, and an option must have a real effect.)
- `PUT /api/settings` `{ aiReviews?, shareWithReviewer? }` → `{ settings }`.
  Unknown keys are 400.
- Effects: `aiReviews:false` → `POST /api/ai/weekly-review` returns `403 { code:'ai_disabled' }`
  and nothing is sent to the provider. `shareWithReviewer:false` → assigned coaches and admins
  cannot list or read this user's weekly submissions or state, and new submissions return
  `409 { code:'sharing_off' }`.
- Everything else (goals, units, theme, timezone, week start, review day, nutrition
  exclusions, reminders shown in the app) stays in the user's synced state document, which
  is already per user.

### Account data
- `GET /api/account/export` (recent auth) → JSON download of everything held about the user:
  account row without hashes, state document, settings, weekly submissions, reviews and
  messages, proposals, sign-up request, MFA summary (no secrets), session list, audit entries
  where they are the target or actor (detail redacted).
- `PUT /api/account/profile` `{ name }` → `{ ok }`.
- `POST /api/account/requests` `{ type: 'correction'|'privacy'|'other', message }` → stored for
  admins, `GET /api/admin/account-requests` lists them.
- `POST /api/account/delete` `{ confirm:'DELETE MY ACCOUNT' }` (recent auth) → immediate hard
  delete, then `200 { ok, deleted:[...], retained:[...], backups: '...' }`. The last owner
  cannot delete. Audit rows are retained without personal content.

### Admin additions
- `PUT /api/admin/content/:key` (recent auth) — validated against the safe content format.
- `PUT /api/admin/operator` (recent auth) — operator facts.
- `GET /api/admin/privacy-checklist` → `{ items: [{ id, label, done, detail }] }` computed from
  real configuration (mail configured, AI configured, operator facts entered, encryption key
  set, owner MFA on, etc.) plus manual items the owner ticks via
  `PUT /api/admin/privacy-checklist/:id { done }`.
- `GET /api/admin/security-events` → recent security-relevant audit entries.

### Consent records (implemented)
- Table `consents (id, user_id, kind, version, granted, at, source)`, append only. Kinds:
  `privacy_notice` (acknowledgement of a policy version, not consent), `health_data`
  (explicit consent), `ai_review` (written whenever `aiReviews` changes).
- `POST /api/auth/signup` requires `privacyNoticeVersion` and `healthConsent: true`.
  `/api/auth/setup` accepts them optionally; existing accounts are asked once in the app.
- `user.consents: { privacyNotice: {version, at} | null, healthData: {granted, at} | null }`.
- `POST /api/account/consents` `{ kind:'privacy_notice', version }` or `{ kind:'health_data', granted }`.
  Withdrawn health consent: `PUT /api/state`, `/api/import/commit`, `/api/ai/weekly-review` and
  `POST /api/weekly-submissions` answer `403 { code:'health_consent_withdrawn' }`.

### Implementation notes
- Passkeys were delivered (`gym/backend/src/webauthn.js`).
- The audit log triggers are created from code (`src/protect.js`), not `schema.sql`.
- Sessions list `device` is derived from the user agent server-side.
- `PUT /api/admin/content/:key` with `{ content: null }` removes the override.
