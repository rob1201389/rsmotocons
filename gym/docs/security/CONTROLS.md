# Control checklist (OWASP ASVS 5.0, Level 2)

Self-assessment by the builders, 2026-10-10. Not an audit or certification. ASVS 5.0.0 was
published in May 2025; requirement numbers quoted here should be re-checked against the
published text by whoever runs the independent test.

**Status key**

- **Tested**: implemented, and an automated test in this repository proves the behaviour.
- **Implemented**: in the code, checked by reading or by hand, no automated test.
- **External**: provided by Cloudflare, Anthropic, Resend or GitHub; we rely on their documentation.
- **Config**: built, but only active once the operator sets something (see `UNRESOLVED-FACTS.md`).
- **Outstanding**: not done.

Test file shorthand: `sec` = `gym/backend/test/security.test.js`, `api` = `api.test.js`,
`sgn` = `signup.test.js`, `ai` = `ai.test.js`, `wk` = `weekly.test.js`,
`set` = `gym/test/settings.ui.test.js`, `aui` = `gym/test/auth.ui.test.js`.

## V6 Authentication

| Control | Status | Evidence |
|---|---|---|
| Password at least 12 characters, up to 256; no composition rules (6.2.5) | Tested | sec "any composition of 12 or more" |
| Common, context and app-name passwords refused | Tested | sec, sgn |
| Breached-password check (6.2.12) via HIBP k-anonymity; only a 5 character SHA-1 prefix leaves | Tested | sec "breached passwords are refused" |
| PBKDF2-HMAC-SHA256, 100,000 iterations, per-user salt | Implemented | `crypto.js`. Below OWASP's 600,000 because Workers cap PBKDF2 at 100,000. See risks |
| Generic login failure, same text for unknown accounts | Tested | sec "login errors do not reveal" |
| Throttling per login and address, and per login across addresses | Tested | sec "throttled per login across many addresses" |
| Throttling on sign-up, verify, forgot, reset, MFA, reauth, email change, passkey login | Implemented | `signup.js`, `security.js`, `webauthn.js` |
| MFA required for owner and admin (6.3.3) | Tested | sec "an administrator without a second step can do nothing but set one up" |
| MFA available to every member (TOTP, passkeys) | Tested | sec, set |
| TOTP single use per time step (6.5.1) | Tested | sec "a code works once" |
| Recovery codes hashed, single use (6.5.2) | Tested | sec "recovery codes are single use and are stored hashed" |
| Password reset does not bypass MFA (6.4.3) | Tested | sec "password reset does not bypass" |
| Owner and admin cannot turn MFA off; others need recent sign-in | Tested | sec |
| Passkeys: origin, RP ID, challenge single use, signature, counter | Tested | sec passkey checks (software authenticator) |
| No default admin password; bootstrap password must pass policy and forces change | Tested | api "weak bootstrap" |
| Recent authentication (10 minutes) for password, email, MFA, passkeys, export, deletion, admin role and status changes | Tested | sec "changing a password needs a recent sign-in", "admin changes need a recent sign-in" |
| Email change confirmed by new address, old address notified | Tested | sec "the new address must confirm" |
| New-device and privilege-grant alerts to owners | Config | needs Resend; `alertOwners` |
| CAPTCHA or bot challenge | Outstanding | not built |

## V7 Session management

| Control | Status | Evidence |
|---|---|---|
| Random 256-bit token; only SHA-256 stored | Implemented | `auth.js` |
| Cookie HttpOnly, SameSite=Lax, Secure on HTTPS, Path=/ | Implemented | `auth.js` `sessionCookie` |
| Rotation on login, MFA verify, password change | Tested | sec "sessions rotate" |
| Idle 7 days, absolute 30 days | Tested | sec "sessions expire" |
| List sessions with device label, revoke one, log out all | Tested | sec, set |
| Cannot revoke another account's session | Tested | sec "a session handle of another account" |
| Suspension, role change, password reset and deletion end sessions | Tested | sec "suspension", "a role change" |
| Local data cleared on sign-out (localStorage, IndexedDB, caches) | Tested | set "sign-out removes this account's offline copy"; Chromium check |

## V8 Authorisation

| Control | Status | Evidence |
|---|---|---|
| Deny by default; permissions in `rbac.js` | Tested | api, sec |
| Object ownership on every id route | Tested | sec "changing any id in the URL never reaches another account" |
| Admin rank alone cannot read member training data | Tested | sec "an administrator cannot read" |
| Assigned coach access logged | Tested | sec "the assigned coach can read, and the read is logged" |
| Member can turn reviewer sharing off | Tested | sec "with sharing off" |
| Last owner cannot be removed, demoted, suspended or deleted | Tested | sec "the last owner cannot be removed in any way" |
| No self-promotion to owner or admin | Tested | sec |
| Admins cannot change owners or other admins | Tested | sec |

## V3, V4, V12, V13 Frontend, API, transport, configuration

| Control | Status | Evidence |
|---|---|---|
| CSP on the app: `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` | Implemented | `public/_headers` |
| API responses: `no-store`, `nosniff`, CSP `default-src 'none'`, `frame-ancestors 'none'` | Tested | sec "API responses are uncacheable" |
| HSTS with preload, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP | Implemented | `public/_headers` |
| CSRF: Origin check and custom header on every mutation | Tested | sec "cross-site requests are refused" |
| Body size limits (64 KB default, 4 MB state and import) | Tested | sec "oversized bodies are refused" |
| Unknown settings keys and content fields refused | Tested | sec |
| TLS | External | Cloudflare |
| `style-src 'unsafe-inline'` removed | Outstanding | inline styles in the app |
| Google Fonts self-hosted | Outstanding | still loaded from Google |

## V1, V2, V5 Encoding, validation, files

| Control | Status | Evidence |
|---|---|---|
| Public page content rendered with `textContent`; links limited to https, mailto, # | Tested | set renderer checks |
| Admin page editor rejects HTML and script links | Tested | sec "page content rejects HTML" |
| Garmin import parsed in the browser; only derived rows stored; size limit | Tested | garmin.test.js, sec size limit |
| All SQL parameterised | Implemented | every `db.run/get/all` uses `?` placeholders; reviewed by grep |

## V11, V14 Cryptography and data protection

| Control | Status | Evidence |
|---|---|---|
| Encryption at rest of the whole database | External | Cloudflare D1, AES-256 |
| Application-level AES-256-GCM on state, reports, messages, notes, request messages, TOTP secrets | Config | Tested in sec "encrypted in the database"; inactive until `DATA_ENC_KEY` is set |
| Key rotation with a previous key | Tested | sec "rows written before the key existed" covers plain to sealed; rotation path implemented in `openText` |
| No end-to-end encryption claim | Implemented | privacy policy and Settings copy say the server can read the data |
| Data export, correction requests, deletion with disclosure of what stays | Tested | sec "export", "deleting an account"; set |
| AI off by default, server-enforced, minimal payload, no account identifiers | Tested | sec, ai, set |
| Health consent recorded and enforced on withdrawal | Tested | sec "withdrawing health consent" |

## V15, V16 Architecture, logging, errors

| Control | Status | Evidence |
|---|---|---|
| Audit log append-only (triggers block delete and rewrite) | Tested | sec "audit entries cannot be rewritten or deleted" |
| No passwords, codes or tokens in the audit log | Tested | sec |
| Security events view for admins with content fields hidden | Tested | sec "security events hide content fields" |
| Generic 500 with no stack trace | Tested | sec "a failure returns a plain error" |
| Alerts to owners on new devices and privilege grants | Config | needs Resend |
| Off-site log shipping or alerting on rate-limit spikes | Outstanding | |

## Operations

| Control | Status | Evidence |
|---|---|---|
| Secret scanning (gitleaks) on push, pull request and weekly | Implemented | `.github/workflows/security.yml`; first CI run pending |
| Dependency audit (`npm audit`, test tools only; app and Worker have no runtime dependencies) | Implemented | same workflow |
| Backups and point-in-time restore | External | D1 Time Travel; restore drill in `BACKUP-RESTORE.md` |
| Restore verified | Tested locally | sec "a database copy can be restored and the data verified". Not yet run against production |
| Incident response plan | Implemented (draft) | `INCIDENT-RESPONSE.md`; owner to adopt |
| Independent penetration test | Outstanding | scope in `PENTEST-READINESS.md` |
| Actions pinned to commit SHAs | Outstanding | pinned by tag |
