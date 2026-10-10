# Remaining risks

Ordered by what I would fix first. Confidence in each rating is moderate: it is the builders'
judgement, not a measured result.

| # | Risk | Likelihood | Impact | Recommendation |
|---|---|---|---|---|
| 1 | `DATA_ENC_KEY` not set, so application-level encryption is inactive | Certain until set | Medium (D1 still encrypts at rest) | Set it now (`openssl rand -base64 32`, then `wrangler secret put DATA_ENC_KEY`). Store a copy offline: losing it loses that data |
| 2 | Email not configured: no verification, reset, email change or owner alerts | Certain until set | Medium | Configure Resend. Until then approve sign-ups by hand and reset passwords from Administration |
| 3 | No independent test | n/a | Unknown | Commission one using `PENTEST-READINESS.md` before inviting people outside a known group |
| 4 | XSS through an unescaped string in a view that builds HTML | Low | High (acts inside the session) | Pentest focus; longer term move views to DOM building with `textContent` and drop `style-src 'unsafe-inline'` |
| 5 | PBKDF2 at 100,000 iterations (Workers limit) | Low | Medium if the database leaks | Accept for now; HIBP screening and MFA reduce the value of cracked hashes. Revisit if Workers raise the cap or offer Argon2 |
| 6 | Account lockout abuse: 30 failures from any address lock a login for 15 minutes | Medium | Low (availability) | Accept; passkey sign-in is a separate route with its own limit |
| 7 | TOTP can be phished in real time | Low | High for owner | Owner and admins should register a passkey and treat TOTP as backup |
| 8 | Owners are fully trusted and can assign themselves to any member | Low | High | Keep owners to one or two people; the assignment and every read are logged |
| 9 | Someone with Cloudflare dashboard access can read D1 or drop the audit triggers | Low | High | Protect the Cloudflare account with MFA and few members. Out of the app's reach |
| 10 | No retention limit for inactive accounts or the audit log | Certain | Medium (APP 11.2) | Decide a period with legal advice, then add a scheduled purge |
| 11 | No re-prompt when the privacy policy version changes | Certain | Low to medium | Add a version check after the policy is finalised |
| 12 | No age check, no terms of use | Certain | Legal, not technical | See `gym/docs/privacy/UNRESOLVED-FACTS.md` |
| 13 | Google Fonts sends IP and user agent to Google on first load | Certain | Low | Self-host the three font families |
| 14 | Data left on a device when the browser is closed without signing out | Medium | Medium | Expected for an offline app; Settings explains it |
| 15 | GitHub Actions pinned by tag | Low | High (supply chain) | Pin to commit SHAs |
| 16 | Service worker and cached app shell could serve an old version for one load after deploy | Medium | Low | Already versioned (`sw.js` v11); no action |
