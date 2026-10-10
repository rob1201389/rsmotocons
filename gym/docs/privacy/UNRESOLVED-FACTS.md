# Unresolved facts and decisions (administrator setup checklist)

The public privacy policy (`gym/public/content/privacy.json`) is a **draft**. It describes how
the app works today, but it cannot be published as final until the items below are supplied or
decided. In the app, Administration, Site, privacy and security, Setup checklist shows the live
state of the items the server can check, and lets the owner tick the manual ones.

Nothing in this list has been guessed or filled in. Each missing fact appears in the policy as
"[not yet supplied]" or "[to be confirmed by the operator]".

## Facts only the operator can supply

| # | Fact | Where it is used | How to supply it |
|---|---|---|---|
| 1 | Trading name and legal name of the operator (a person or a company) | Policy "Who we are", About "Who runs Recomp" | Admin, Operator details |
| 2 | ABN, if one exists | Same | Admin, Operator details (11 digits) |
| 3 | A privacy contact email that someone monitors | Policy throughout, complaints | Admin, Operator details, then tick "privacy contact monitored" |
| 4 | Postal address for privacy requests | Policy "Who we are" | Admin, Operator details |
| 5 | Country the operator is based in | Policy, About | Admin, Operator details |
| 6 | Policy effective date | Policy "Changes" | Admin, Operator details |
| 7 | Annual turnover, and whether the operator provides a "health service" | Whether the Privacy Act small business exemption could apply (see APPLICABILITY.md 2.1). Treat the APPs as applying until a lawyer says otherwise | Legal review |
| 8 | Which countries users are accepted from, and whether EU or UK users are accepted or marketed to | Whether GDPR or UK GDPR apply, and whether an EU or UK representative is needed | Decision, then tick "markets decided" |
| 9 | Location of the D1 database (`wrangler d1 info recomp` shows it) | Policy "Service providers" table | Run the command, then update the policy text |
| 10 | Cloudflare plan (Free or Paid) | Backup window is 7 days on Free, 30 on Paid. The policy currently says "up to 30 days (7 on the free plan)" | Check the Cloudflare dashboard |
| 11 | Whether Cloudflare Workers Logs are on for the gym worker, and their retention | Logs keep request metadata for 3 or 7 days | Cloudflare dashboard, Workers, rsmotocons-gym, Logs |
| 12 | Anthropic account: data retention arrangement (standard 30 days or zero data retention), and whether the Data Processing Addendum is accepted | Policy "AI-assisted weekly reviews" | Anthropic Console, then tick "AI retention checked" |
| 13 | Resend: DPA accepted, sending region | Policy "Service providers" | Resend dashboard |
| 14 | Cloudflare: DPA accepted | Policy "Sending information overseas" | Cloudflare dashboard, then tick "provider terms" |
| 15 | Minimum age (the draft proposes 18) | Policy "Children" | Decision, then tick "minimum age decided" |
| 16 | Retention period for inactive accounts | Policy "How long we keep information" | Decision; an automatic purge would then need building |
| 17 | Retention period for the security log | Same | Decision; a purge would need a narrowly scoped database job, because the app cannot delete audit rows |
| 18 | A named person and phone number for security incidents and breach notification | Incident response runbook | Decision, then tick "incident contact" |
| 19 | Terms of use | Not written yet. Acceptance of terms must stay separate from privacy acknowledgement and consent | Write them, then add a separate acceptance record |

## Configuration still to do on the live site

| Item | Why | How |
|---|---|---|
| Email (Resend) | Verification, password reset, email change and security alerts are not sent until it is set | `RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_URL` on the gym worker |
| Application encryption key | Adds a second layer of encryption to training data, reports, messages, notes and two-step secrets | Secret `DATA_ENC_KEY` = 32 random bytes in base64 (`openssl rand -base64 32`). Keep a copy somewhere safe: without it, encrypted rows cannot be read |
| Remove `BOOTSTRAP_OWNER_PASSWORD` if it is set | Only needed before the first owner exists | Delete the secret |
| Owner two-step verification | Required: the owner's next sign-in asks for it before anything else | Sign in and follow the prompt |

## Verify after deploy

These controls are implemented and tested locally. Confirm on the live site after the next deploy:

1. Signing in as the owner asks for two-step verification set-up, then a code at each sign-in.
2. Settings, Account and security lists sessions, and "Log out all other devices" works.
3. Settings, Your data, Download my data asks for the password again and downloads a file.
4. Settings, AI-assisted weekly reviews is off for every existing member until they turn it on.
5. The privacy policy, About and Why open from the welcome page without signing in.
6. Administration, Site, privacy and security, Setup checklist reflects the real configuration.
7. `curl -I https://gym.rsmotocons.com/api/auth/session` shows `Cache-Control: no-store` and a `Content-Security-Policy` of `default-src 'none'`.
