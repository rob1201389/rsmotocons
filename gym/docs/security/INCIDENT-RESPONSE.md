# Incident response (draft)

Draft for the owner to adopt. Names and contact details are not filled in because they have
not been supplied. Legal obligations need confirming with a lawyer; the Notifiable Data
Breaches summary below is general information, not advice.

## Who does what

| Role | Person | Contact |
|---|---|---|
| Incident lead (decides, communicates) | [owner to fill in] | [owner to fill in] |
| Technical responder (Cloudflare, code) | [owner to fill in] | [owner to fill in] |
| Legal or privacy adviser | [owner to fill in] | [owner to fill in] |

## Signs that start this process

A security alert email (new device, owner or admin granted); unexpected entries under
Administration, Site, privacy and security, Security events (many `auth.rate_limited`,
`auth.login_failed`, role changes nobody made); a report from a member; a leaked secret found
by gitleaks; unexpected Anthropic or Resend usage; a provider breach notice.

## First hour: contain

1. Write down the time and what was seen. Keep notes for the whole incident.
2. If an account is compromised: Administration, suspend it (ends its sessions on the next
   request). For your own account: Settings, Account, Log out all devices, then change password.
3. If an owner or admin account is compromised: suspend it from another owner account; if none,
   rotate in Cloudflare (step 4) and remove the role directly in D1.
4. If a secret leaked: in Cloudflare, Workers, `rsmotocons-gym`, Settings, Variables and
   secrets, replace it. Resend and Anthropic keys: revoke in their dashboards first.
   `DATA_ENC_KEY`: follow key rotation in `BACKUP-RESTORE.md`; do not delete the old key.
5. To end every session for everyone: run in D1
   `UPDATE sessions SET revoked_at = <now ms> WHERE revoked_at IS NULL;`
6. If code was tampered with: revert on `main`; the deploy workflow redeploys.

## First day: assess

- Export the audit log (Administration, audit) and the security events for the window.
- Decide what data was reachable: which accounts, which tables, whether encrypted fields were
  exposed with or without the key.
- If data was changed or destroyed, restore with D1 Time Travel (`BACKUP-RESTORE.md`) to a
  point before the incident, after taking a bookmark of the current state.

## Notify

Under the Notifiable Data Breaches scheme, an eligible data breach (unauthorised access or
disclosure likely to cause serious harm, not prevented by remedial action) must be assessed
within 30 days and notified to the OAIC and affected people as soon as practicable. Health
information raises the likelihood of serious harm. Whether the scheme applies depends on
the operator's coverage under the Privacy Act (see `gym/docs/privacy/APPLICABILITY.md`).
Members outside Australia may trigger other regimes (GDPR 72 hours to the supervisory
authority). Get advice before deciding not to notify.

## Afterwards

Write a short review: cause, what worked, what to change. Add a test that would have caught
it. Update `REMAINING-RISKS.md`.
