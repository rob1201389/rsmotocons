# Threat model

Internal working document, 2026-10-10. Scope: the Recomp PWA (`gym/public`), the Cloudflare
Worker and D1 database (`gym/backend`), and the services it calls (Resend, Anthropic, Have I
Been Pwned, Google Fonts). Framework for controls: OWASP ASVS 5.0, Level 2 (see `CONTROLS.md`).

This is an internal review by the people who built the app. It is not an independent audit
or a certification.

## What is being protected

| Asset | Why it matters | Where it lives |
|---|---|---|
| Health and fitness records (training, bodyweight, food, pain flags, sleep and heart rate imports, notes) | Sensitive information under the Privacy Act; harm if exposed | D1 `user_state` (encrypted field when `DATA_ENC_KEY` is set); browser localStorage and IndexedDB while signed in |
| Weekly reports and review messages | Health detail plus coach commentary | D1 `weekly_submissions`, `review_messages` (encrypted field) |
| Account credentials and second factors | Account takeover | D1 `users` (PBKDF2 hash), `mfa_totp` (encrypted secret), `mfa_recovery` (hashed), `passkeys` (public keys only) |
| Session tokens | Account takeover without the password | HttpOnly cookie; D1 stores only the SHA-256 |
| Owner and admin privileges | Access to every account's metadata and the ability to assign reviewers | `users.role` |
| Audit log | Investigation after an incident | D1 `audit_log`, append only |
| Secrets (Resend, Anthropic, `DATA_ENC_KEY`) | Abuse of paid services; decryption of data | Cloudflare Worker secrets only |

## Trust boundaries

1. Browser to Worker (HTTPS, same origin). Everything from the browser is untrusted.
2. Worker to D1 (Cloudflare internal).
3. Worker to Anthropic, Resend and HIBP (outbound HTTPS with secrets held by the Worker).
4. Between accounts on the same server: member, coach, admin, owner.
5. Between people on the same device (shared phone or computer).
6. Repository and CI to production (GitHub Actions deploy with a Cloudflare token).

## Actors

| Actor | Capability assumed |
|---|---|
| Anonymous internet user | Can call every public endpoint, script requests, use many IP addresses |
| Signed-in member | Can tamper with any request, ids and body fields |
| Coach | Legitimately reads assigned members; may try to reach others |
| Admin | Manages accounts; must not read training data without assignment or affect owners |
| Owner whose password leaked | Attacker has the password, not the second factor |
| Someone with the device after sign-out | Can open the browser and its storage |
| Compromised dependency or CI | Can change code before deploy |
| Cloudflare, Anthropic, Resend staff or breach | Outside our control; contracts and minimisation only |

## Threats and mitigations (STRIDE)

| # | Threat | Mitigation in place | Test evidence | Residual |
|---|---|---|---|---|
| S1 | Credential stuffing and guessing | 12 character minimum, common and app-name list, HIBP screening; throttle 10 failures per login and address, and 30 per login from any address, per 15 minutes; generic error text | security.test.js "breached passwords", "throttled per login", "login errors do not reveal" | Slow attacks under the limits; an attacker can lock a known login out for 15 minutes; no CAPTCHA |
| S2 | Stolen owner or admin password | MFA required for owner and admin (TOTP or passkey); the password alone gives only a 5 minute pending cookie; reset does not bypass MFA | "administrator without a second step", "password alone gives no session", "reset does not bypass" | Phishing of a TOTP code in real time (passkeys resist this; TOTP does not) |
| S3 | TOTP replay or brute force | Single use per step (`last_step`); 5 tries per pending login | "a code works once", "five wrong codes" | none known |
| S4 | Session theft | HttpOnly, SameSite=Lax, Secure cookie; only a hash stored; rotation on login, MFA and password change; idle 7 days, absolute 30; revoke one or all | session checks in security.test.js | XSS would still act within the session (see T1) |
| S5 | Email change takeover | Needs recent sign-in; new address must confirm; old address is told; other sessions end | "the new address must confirm" | Needs mail configured; until then email change is refused |
| T1 | Cross-site scripting | CSP `script-src 'self'`, no inline script; content rendered with `textContent`; safe link schemes only; admin page editor rejects HTML | settings.ui.test.js renderer checks; "page content rejects HTML" | Some app views build HTML strings with `esc()`; a missed escape is possible. `style-src 'unsafe-inline'` remains |
| T2 | CSRF | Origin check plus `X-Recomp-Request` header on every mutation; SameSite cookie | "cross-site requests are refused" | none known |
| T3 | Tampering with ids (IDOR) | Server derives the user from the session; every `:id` route checks ownership or assignment; body ids ignored | "changing any id in the URL never reaches another account" | New routes must keep the pattern; covered by review only |
| T4 | Privilege escalation | Deny by default in `rbac.js`; nobody grants themselves owner or admin; admins cannot modify owners or other admins; last owner protected; role changes end sessions | "nobody can make themselves", "cannot change the owner", "last owner" | Owner accounts are fully trusted |
| R1 | Denying or hiding actions | Audit log for auth, admin and data-access events; SQLite triggers block delete and rewrite | "audit entries cannot be rewritten" | A person with D1 console access can drop the triggers |
| I1 | Admin reading health data | Admin rank alone cannot read state or reports; assignment required and logged; member can turn sharing off | "an administrator cannot read", "with sharing off" | Owners can assign themselves; the assignment is logged |
| I2 | Data sent to AI provider | Off by default per user; server rebuilds the payload from known keys; no name, email or id; refused after consent withdrawal | "with AI reviews off, nothing is sent", "an id in the body is refused" | Anthropic receives health detail when on |
| I3 | Database copy leaks | D1 encrypts at rest (Cloudflare-managed); application-level AES-256-GCM on sensitive fields when `DATA_ENC_KEY` is set | "encrypted in the database" | Key is held by the same Worker; not end-to-end. Inactive until the key is set |
| I4 | Secrets or personal data in logs | Audit detail never holds passwords, codes or tokens; failed logins no longer store the typed login; mail body not logged; errors are generic | "no password, code or token", "a failure returns a plain error" | Cloudflare request logs (IP, URL) are outside the app |
| I5 | Shared device after sign-out | Sign-out removes localStorage keys, the IndexedDB copy and the service worker caches for that account | Chromium check on 2026-10-10 (see `TEST-EVIDENCE.md`) | Data remains if the browser is closed without signing out |
| D1 | Request floods and storage abuse | Body limit 64 KB by default, 4 MB for state and import; rate limits on auth, sign-up, reset, MFA and passkeys | "oversized bodies are refused" | No global rate limit in the app; relies on Cloudflare |
| E1 | Compromised dependency or leaked secret in git | No runtime dependencies in app or Worker; gitleaks and `npm audit` on every push and weekly | `.github/workflows/security.yml` | GitHub Actions pinned by tag, not SHA |

## Out of scope for this model

Physical security of Cloudflare, Anthropic and Resend; the operator's own devices and email
account; social engineering of the operator; denial of service beyond what Cloudflare absorbs.
