# Security pack

| File | What it is |
|---|---|
| `THREAT-MODEL.md` | Assets, trust boundaries, actors, threats and mitigations |
| `CONTROLS.md` | OWASP ASVS 5.0 Level 2 checklist: tested, implemented, external, config, outstanding |
| `REMAINING-RISKS.md` | What is left, in priority order |
| `INCIDENT-RESPONSE.md` | Draft runbook for the owner to adopt |
| `BACKUP-RESTORE.md` | D1 Time Travel restore drill and key rotation |
| `PENTEST-READINESS.md` | Brief for an independent tester |

This is the builders' own review. It is not an independent audit, a certification, or a
claim that the app cannot be broken into.

## Test evidence

Run with `cd gym/test && npm install && ./run-all.sh`. Every test uses synthetic accounts on
an in-memory database; no real data is involved. Result on 2026-10-10, branch
`claude/vibrant-davinci-6526f6`:

| Suite | Checks | Result |
|---|---|---|
| backend security (`backend/test/security.test.js`) | 52 | pass |
| backend api | 55 | pass |
| backend signup | 42 | pass |
| backend ai | 25 | pass |
| backend weekly | 18 | pass |
| app settings and public pages (`test/settings.ui.test.js`, runs the real backend) | 43 | pass |
| app sign-in and MFA (`test/auth.ui.test.js`) | 90 | pass |
| other app suites (training, plan, review, Garmin, coaching, library, regression) | 498 | pass |
| **Total** | **823** | **all pass** |

Checked by hand in Chromium on 2026-10-10 (screenshots in `gym/docs/screens/security/`):
public pages open from a direct link before sign-in; sign-out removes the IndexedDB copy;
the owner is asked for a code after the password; the admin setup checklist reflects real
configuration.

Two defects were found and fixed during that check: a direct link to `#privacy` showed the
sign-in screen on top of the policy, and sign-out left the training data in IndexedDB. Both
now have regression checks in `settings.ui.test.js`.

CI: `.github/workflows/security.yml` runs gitleaks, `npm audit` and the test suites on every
push. It has not run on GitHub yet; check the first run after pushing.
