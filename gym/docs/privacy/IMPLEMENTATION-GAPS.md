# Implementation gaps for legal review

What the draft policy says, compared with what exists. Items marked **Done** were implemented and
tested in this change; the rest need work, a decision, or confirmation on the live site.

| Area | Policy says | Status |
|---|---|---|
| Health consent | Collected with explicit consent, separate from the notice | **Done**: separate checkbox at sign-up, recorded, withdrawable, withdrawal enforced on the server. Existing accounts are asked once in the app; until they answer, processing continues on the basis of their earlier use, which a lawyer should review |
| AI | Off unless turned on; only review details sent; no name, email or id | **Done** and tested (no provider call when off; payload has no identifiers). Anthropic retention depends on the operator's account settings (unresolved fact 12) |
| Access, export | Download everything from Settings | **Done**. Administrator notes are excluded from the download; the policy says to ask for them |
| Correction | Edit in app or send a request | **Done**: requests reach administrators. There is no tracked response deadline in the app |
| Deletion | Immediate, backups expire within 30 days | **Done**: hard delete across every table, tested. Backups are Cloudflare Time Travel and cannot be selectively purged |
| Retention | Periods for inactive accounts and the security log "to be decided" | **Gap**: no automatic purge of inactive accounts or old audit rows exists |
| Policy changes | Users told in the app before a material change applies, and asked to read the new version | **Gap**: the app records which version was acknowledged but does not yet prompt again when the version changes |
| Minimum age | 18, not verified | **Gap**: no age question at sign-up. Administrator approval is the only check |
| Google Fonts | Disclosed: IP and browser details go to Google | **Gap**: self-hosting the fonts would remove this transfer and the need to disclose it |
| Overseas disclosure safeguards | Reliance on providers' published DPAs | **Unconfirmed**: whether each DPA is accepted (unresolved facts 12 to 14) |
| EU or UK users | Rights described conditionally | **Decision needed**: if EU or UK users are accepted, an Article 27 representative and a record of processing may be required |
| Washington MHMDA and similar US laws | Not specifically addressed | **Decision needed**: if US users are accepted, a separate consumer health data notice may be required |
| Breach response | NDB scheme notification promised | **Partly done**: runbook in `gym/docs/security/INCIDENT-RESPONSE.md`; a named contact is still needed |
| Encryption | Additional app encryption "once the operator sets a key" | **Configuration needed**: `DATA_ENC_KEY` is not set on the live site |
| Email | Account and security emails | **Configuration needed**: Resend not set up, so these emails are not sent today |
| Automated decisions | Plan suggestions are not decisions with legal effect | Review against the automated decision transparency obligations commencing 10 December 2026 (APPLICABILITY.md 2.4) |
| Terms of use | Not referenced | **Gap**: none exist |
