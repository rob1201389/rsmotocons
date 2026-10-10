# Which privacy laws are likely to apply

Internal working document for the operator and their lawyer. **This is not legal advice.**
It is a structured starting point prepared from public sources on 2026-10-10. Several
conclusions turn on facts only the operator can confirm (see `UNRESOLVED-FACTS.md`).
Before publishing the privacy policy, have an Australian privacy lawyer review this
document, the public policy and `IMPLEMENTATION-GAPS.md`.

All sources below were accessed on 2026-10-10 unless stated otherwise.

## 1. Assumed facts

| # | Assumption | Why it matters | Confirm |
|---|---|---|---|
| A1 | The operator is an Australian individual or entity (rsmotocons.com) | Privacy Act 1988 (Cth) jurisdiction | Legal name, ABN |
| A2 | Annual turnover is A$3 million or less | Small business exemption, if nothing else removes it | Turnover |
| A3 | Sign-up is open on the public web, with every account approved by an administrator | Who becomes a user; ability to refuse sign-ups from places the operator does not want to serve | Yes |
| A4 | No marketing aimed at any country; no payments; no prices in foreign currencies; English only | GDPR and UK GDPR "targeting" test | Whether EU, UK or US people are accepted or marketed to |
| A5 | Users are adults | Children's rules | Minimum age |
| A6 | The data includes bodyweight, food intake, sleep, heart rate, pain reports and free-text training updates | Health information is sensitive information | Verified in code (`DATA-FLOW-INVENTORY.md`) |
| A7 | Recomp is free and not sold to anyone; data is not sold or used for advertising | US state laws, Spam Act | Confirm business model |

## 2. Australia: Privacy Act 1988 and the Australian Privacy Principles

### 2.1 Is the operator covered at all?

Most businesses with turnover of A$3 million or less are exempt. The exemption does not
apply to an organisation that provides a health service and holds health information
(other than in an employee record), whether or not health is its main activity.

- OAIC, "What is a health service provider":
  <https://oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/covid-19/privacy/health-information/what-is-a-health-service-provider>
- OAIC, "Health and medical research" / "Who has rights under the Privacy Act":
  <https://www.oaic.gov.au/privacy/the-privacy-act/health-and-medical-research>,
  <https://oaic.gov.au/privacy-law/rights-and-responsibilities>

The OAIC Guide to health privacy (version 2.0, May 2025) defines a health service as an
activity intended or claimed to "assess, maintain or improve the individual's health" and
lists **"gyms and weight loss clinics"** among the health service providers it covers. It
also says personal information collected in the course of providing a health service is
health information.

- OAIC, Guide to health privacy, Introduction and key concepts:
  <https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/health-service-providers/guide-to-health-privacy/introduction-and-key-concepts>

**Assessment.** Recomp offers personalised training and nutrition targets intended to
maintain or improve the user's physical condition, and it holds bodyweight, pain reports,
sleep and heart rate. That is close to the activities the OAIC describes, and the OAIC
names gyms as an example. There is a real risk that Recomp is a "health service" and that
the small business exemption therefore does not apply. Counter-arguments exist (no
clinician, no diagnosis, a software tool, general fitness), but they are not settled. This
needs legal advice. **Until advised otherwise, the documents in this folder assume the
APPs apply**, which is also the safer position because an operator can opt in to coverage.

### 2.2 What the APPs require and where Recomp stands

APP guidelines index: <https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines>

| APP | Requirement (summary) | Recomp today |
|---|---|---|
| APP 1 | Open and transparent management; a clearly expressed, up-to-date privacy policy covering kinds of information, purposes, access and correction, complaints, and likely overseas disclosure and countries | Draft policy written (`privacy.json`). Countries depend on operator configuration. |
| APP 1.7 to 1.9 (from 10 December 2026) | Privacy policy must describe kinds of personal information used in, and kinds of decisions made by, computer programs that make or substantially and directly inform decisions that could significantly affect an individual's rights or interests | The plan engine computes training and nutrition changes automatically, but the user confirms changes and suggestions are not decisions about rights or interests in the usual sense. A short transparency section has been included anyway. Lawyer to confirm. Sources: OAIC APP 1.7 to 1.9 fact sheet <https://www.oaic.gov.au/__data/assets/pdf_file/0021/269013/APP-1.7-1.9-Transparency-Obligation-Fact-Sheet.PDF>; Allens summary <https://www.allens.com.au/insights-news/insights/2026/10/mandatory-automated-decision-making-disclosure-requirements-are-coming-key-takeaways-from-the-oaic-guidance/> |
| APP 3 | Collect only what is reasonably necessary; **sensitive information (health) only with consent** unless an exception applies | Collection is proportionate. Health consent is recorded at sign-up (required), asked once of existing accounts, and withdrawal stops further collection (`403 health_consent_withdrawn`). |
| APP 5 | Notify at or before collection: who, why, consequences, disclosures, overseas recipients, how to access and complain | Sign-up shows a collection notice with links to the policy and two separate checkboxes (notice acknowledgement, health consent). The policy itself is still a draft. |
| APP 6 | Use and disclose only for the primary purpose or a related secondary purpose the person would reasonably expect (directly related for sensitive information), or with consent | AI wording is a disclosure to Anthropic for a secondary purpose; it is opt-in (`aiReviews`, default off, enforced on the server). Reviewer access is a disclosure within the service; controlled by `shareWithReviewer` (default on). |
| APP 8 and s 16C | Before disclosing overseas, take reasonable steps so the recipient does not breach the APPs; the entity stays accountable. Giving data to a cloud provider can be a "use" rather than a disclosure if the entity keeps effective control under a binding contract limiting the provider to storage and access | Cloudflare (storage) may be a "use". Anthropic and Resend process data for their own service functions and are more likely disclosures. DPAs exist (see section 6) but acceptance is unconfirmed. Source: <https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-8-app-8-cross-border-disclosure-of-personal-information> |
| APP 10 | Reasonable steps to keep information accurate | Users edit their own records |
| APP 11 | Reasonable security steps; destroy or de-identify information no longer needed | Security controls are substantial (see policy). Retention periods are not defined; most tables are kept indefinitely. Gap. |
| APP 12 | Give access on request | Full server export in Settings; request form for anything else |
| APP 13 | Correct on request | Users edit training data and their name; correction requests go to admins from Settings |

### 2.3 Notifiable Data Breaches scheme

If the APPs apply, an eligible data breach (likely to result in serious harm, not prevented
by remedial action) must be notified to affected individuals and the OAIC as soon as
practicable. Suspected breaches must be assessed within 30 days at most. Health data raises
the likelihood of serious harm.

- OAIC, NDB scheme overview: <https://www.oaic.gov.au/__data/assets/pdf_file/0011/5213/the-ndb-scheme-an-overview.pdf>
- OAIC quick reference guide: <https://www.oaic.gov.au/privacy/notifiable-data-breaches/quick-reference-guide-for-responding-to-data-breaches>

Recomp has no written breach response plan or named contact. Gap.

### 2.4 Privacy and Other Legislation Amendment Act 2024

- **Statutory tort for serious invasions of privacy** applies to conduct after 10 June 2025.
  It applies regardless of the small business exemption. OAIC:
  <https://www.oaic.gov.au/privacy/your-privacy-rights/more-privacy-rights/statutory-tort-for-serious-invasions-of-privacy>
- **Automated decision transparency** in privacy policies commences 10 December 2026 (see APP 1.7 above).
- **Children's Online Privacy Code**: exposure draft published 31 March 2026; must be
  registered by 10 December 2026; commencement not yet clear. The draft excludes health
  services and applies to social media, relevant electronic and designated internet services
  likely to be accessed by children. OAIC:
  <https://www.oaic.gov.au/privacy/privacy-for-kids/official-exposure-draft-of-the-childrens-online-privacy-code>;
  Baker McKenzie summary <https://www.bakermckenzie.com/en/insight/publications/2026/05/australia-childrens-online-privacy-code-exposure-draft>
- Bills Digest (background): <https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/bd/bd2425/25bd016>

### 2.5 Children and capacity

The OAIC says capacity of under-18s is assessed case by case; where that is not practical an
entity may assume a person aged 15 or over has capacity unless unsure.
OAIC, Children and young people: <https://www.oaic.gov.au/privacy/your-privacy-rights/more-privacy-rights/children-and-young-people>

**Proposal for the owner:** set a minimum age of **18**. Reasons: health information,
training load recommendations for adults, no parental consent flow, and it avoids the
COPPA and children's code questions. The app does not verify age; the policy says so.

### 2.6 Spam Act 2003

Verification, password reset and security notices are service messages, not marketing.
Messages that contain only factual information can be "designated commercial electronic
messages" exempt from consent and unsubscribe rules, but ACMA actively enforces
misclassification. Reminder emails were not built. If they are added later they should
be opt-in and carry sender identification and an unsubscribe link if they ever contain
promotional content. Sources: LegalVision summary <https://legalvision.com.au/spam-act-exemptions>;
ACMA investigation report example
<https://acma.gov.au/sites/default/files/2024-10/Commonwealth%20Bank%20of%20Australia%20-%20Spam%20Investigation%20-%20Final%20Investigation%20Report%20-%2014%20August%202024%20%281%29_Redacted.pdf>.
Lawyer to confirm against the Act and current ACMA guidance.

## 3. European Union: GDPR

- **Territorial scope (Art 3(2))**: applies to a controller outside the EU that offers goods
  or services to people in the EU (free services count) or monitors their behaviour in the
  EU. Merely being reachable is not enough; indicators include EU languages, currencies,
  marketing to EU audiences. Recomp, with open sign-up but no targeting (A4), is probably
  outside Art 3(2) unless the operator markets to or knowingly serves EU users. If EU users
  are accepted on purpose, assume GDPR applies.
- **Monitoring**: tracking training, sleep and weight over time for the purpose of
  adapting a plan could be argued to be "monitoring behaviour" of a person in the EU. Another
  reason to decide deliberately whether to accept EU residents.
- **Lawful bases (Art 6)**: contract (providing the service), legitimate interests
  (security, abuse prevention, audit), legal obligation, consent (optional features).
- **Special category data (Art 9)**: health data needs an Art 9(2) condition; for an app
  like this that is **explicit consent** (Art 9(2)(a)), recorded, specific, and as easy to
  withdraw as to give.
- **Representative (Art 27)**: required for a non-EU controller within Art 3(2), unless the
  processing is occasional, does not include large-scale special category data and is low
  risk. All three conditions must hold. Text: <https://gdpr-info.eu/art-27-gdpr/>
- **Transfers (Art 44 onwards)**: the operator would be exporting from the EU only if GDPR
  applies; providers offer SCCs (section 6).
- **Rights**: access, rectification, erasure, restriction, portability, objection, withdrawal
  of consent, complaint to a supervisory authority.

## 4. United Kingdom: UK GDPR and Data Protection Act 2018

Same structure as the EU GDPR. A non-UK controller offering services to, or monitoring,
people in the UK may need a UK representative (Art 27 UK GDPR). Complaints go to the ICO.
Summary: <https://legalvision.co.uk/data-privacy-it/uk-gdpr-article-27-representatives/>.
Check the ICO's own guidance before relying on this.

## 5. Other jurisdictions

### 5.1 New Zealand: Privacy Act 2020

Section 4 extends the Act to an overseas agency "in the course of carrying on business in
New Zealand", which can include a free service with no NZ presence. If New Zealanders use
Recomp in any number, the Information Privacy Principles (including IPP 12 on cross-border
disclosure) and the NZ notifiable privacy breach regime may apply. Text:
<https://legislation.govt.nz/act/public/2020/31/en/latest/>

### 5.2 United States

| Law | Scope | Likely relevance |
|---|---|---|
| Washington My Health My Data Act (RCW 19.373) | "Consumer health data" broadly defined (physical health status, inferences, biometric data); no revenue threshold; consumers are Washington residents or people whose data is collected in Washington; requires separate consent for collection and for sharing, a consumer health data privacy policy, deletion rights, private right of action | Applies if the operator "conducts business in Washington" or targets Washington consumers. With open sign-up and US users, risk is real. Jones Day summary <https://www.jonesday.com/en/insights/2023/04/my-health-my-data-washington-enacts-first-state-comprehensive-health-privacy-law> |
| Nevada SB 370 (NRS 603A.500 to 603A.590) | Consumer health data; no thresholds; applies to entities that conduct business in Nevada or target Nevadans; separate and distinct consents; AG enforcement only | Same reasoning. Bass Berry summary <https://www.bassberry.com/news/nevada-consumer-health-data-law-takes-effect-on-march-31-2024/> |
| Connecticut (SB 3, 2023, amending CTDPA) | Consumer health data consent rules; some provisions apply to "any person" | Unresolved whether provisions reach entities below CTDPA thresholds. Hunton summary <https://www.hunton.com/privacy-and-cybersecurity-law-blog/connecticut-and-nevada-legislatures-pass-health-data-laws> |
| California CCPA/CPRA | Businesses with annual gross revenue over US$26,625,000 (2025 to 2026 figure), or 100,000+ California consumers, or 50%+ revenue from selling or sharing data | Very unlikely to apply. Jackson Lewis FAQ <https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126> |
| FTC Health Breach Notification Rule (16 CFR 318, amended 2024) | Vendors of personal health records not covered by HIPAA, expressly including fitness, sleep and diet apps drawing data from more than one source; "breach" includes unauthorised disclosure | A personal health record that draws from user input plus imported wearable files could fit. Applies to entities under FTC jurisdiction; reach to a foreign operator serving US users is uncertain. Hogan Lovells summary <https://hoganlovells.com/en/publications/ftc-finalizes-revised-health-breach-notification-rule-expanding-its-scope-and-updating-companies-obligations> |
| COPPA (amended rule, compliance from 22 April 2026) | Services directed to children under 13 or with actual knowledge of collecting from under-13s | Avoided by a minimum age of 18 and acting on any knowledge of under-age users. White & Case <https://www.whitecase.com/insight-alert/unpacking-ftcs-coppa-amendments-what-you-need-know> |

**Practical choice for the owner:** either (a) decline US, EU and UK residents at approval
time and say so, or (b) accept them and add the extra consents, notices and representatives.
Option (a) is simpler but relies on the admin approval step and self-declared location.

## 6. Service provider research (provider-published terms)

| Provider | Finding | Source |
|---|---|---|
| Anthropic API, retention | Commercial API inputs and outputs are deleted from Anthropic's backend within 30 days of receipt or generation, except: longer-retention services under the customer's control, a different agreement (for example zero data retention), Usage Policy enforcement, or law. If flagged by trust and safety systems: inputs and outputs up to 2 years, classification scores up to 7 years. | <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data> |
| Anthropic API, ZDR | Zero data retention is an arrangement enabled per organisation by Anthropic's account team; under it prompts and responses are not stored at rest after the response, except where law requires or content is flagged. Some models ("Covered Models") require 30-day retention. | <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention> |
| Anthropic API, training | Commercial Terms: Anthropic may not train models on Customer Content from the Services. Retention docs: retained data is never used for model training without the customer's express permission. | <https://www.anthropic.com/legal/commercial-terms>; retention docs above |
| Anthropic API, location | `inference_geo` defaults to `global` (any available geography) unless the workspace default is set to `us`. Workspace geo (data at rest) currently `us` only. Recomp's code does not send `inference_geo`. | <https://platform.claude.com/docs/en/manage-claude/data-residency> |
| Anthropic DPA | Data Processing Addendum incorporated into the Commercial Terms automatically; includes EU SCCs Module 2 and 3 (Decision 2021/914). | <https://www.anthropic.com/legal/data-processing-addendum>; <https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa> |
| Resend, location | "All account data, including email metadata, logs, and API records, is stored in the United States" regardless of the sending region (North Virginia, Ireland, São Paulo, Tokyo). | <https://resend.com/docs/dashboard/domains/regions> |
| Resend DPA | DPA incorporated into the Terms of Service and binding on acceptance; includes EU SCCs (Decision 2021/914), UK Addendum and Swiss modifications; page updated 2025-12-31. | <https://resend.com/legal/dpa> |
| Cloudflare D1, location | Without a hint or jurisdiction, the primary database is created close to where the create request came from. Hints: `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc` (Oceania). Jurisdictions: `eu`, `fedramp`, `us`, fixed at creation. Read replication, if enabled, places replicas in every region unless a jurisdiction is set. `wrangler.jsonc` sets neither, so the location depends on where the database was first created. | <https://developers.cloudflare.com/d1/configuration/data-location/> |
| Cloudflare D1, encryption | All D1 data, including metadata and inactive databases, is encrypted at rest with AES-256-GCM, keys managed by Cloudflare; traffic between Workers and D1 uses TLS. | <https://developers.cloudflare.com/d1/reference/data-security/> |
| Cloudflare D1, Time Travel | Always on; restore to any minute in the last 30 days (Workers Paid) or 7 days (Free). Cannot be disabled. | <https://developers.cloudflare.com/d1/reference/time-travel/> |
| Cloudflare Workers Logs | Enabled by default for newly created Workers; 3 days (Free) or 7 days (Paid); includes invocation logs with request and response metadata, and console output. | <https://developers.cloudflare.com/workers/observability/logs/workers-logs/> |
| Cloudflare DPA and transfers | Customer DPA (v6.3, 20 June 2025) incorporates EU SCCs; Cloudflare certifies to the EU-US DPF, UK extension and Swiss-US DPF. | <https://www.cloudflare.com/trust-hub/gdpr/>; <https://cf-assets.www.cloudflare.com/slt3lc6tev37/3LmXORq5FW5EuJ0OT1B871/f466268011407efbc07f4fadbd1af466/Cloudflare_Customer_DPA_v6.3_June_20__2025.pdf> |
| Google Fonts | Requests include IP address, requested URL and HTTP headers including user agent; the API sets no cookies; Google says it does not use the information to profile users or for targeted ads; self-hosting avoids the transfer. | <https://developers.google.com/fonts/faq/privacy> |
| Have I Been Pwned | Range API: only the first 5 hex characters of the SHA-1 hash are sent; optional `Add-Padding` header hides the response size. | Summary <https://orthogonal.info/check-breached-password-without-sending-hibp-k-anonymity/>; confirm against <https://haveibeenpwned.com/API/v3> |

## 7. Summary of obligations versus the app

| Obligation | Status |
|---|---|
| Public privacy policy (APP 1) | Draft ready, `status: draft` |
| Collection notice at sign-up (APP 5) | Implemented |
| Recorded consent for health information (APP 3, GDPR Art 9, MHMDA) | Implemented and tested; wording needs legal review |
| Opt-in for AI disclosure (APP 6, APP 8) | Implemented, default off, server-enforced |
| Reviewer sharing control | Implemented |
| Access and export (APP 12) | Implemented |
| Correction (APP 13) | Implemented (edit in app, request form) |
| Deletion and retention limits (APP 11.2) | Self-service deletion implemented; retention periods for inactive accounts and the audit log still undefined |
| Security (APP 11.1) | MFA, session management and field encryption implemented; see `gym/docs/security/` |
| Breach response (NDB) | Draft plan in `gym/docs/security/INCIDENT-RESPONSE.md`; owner to adopt and name contacts |
| Overseas recipients named with countries (APP 1.4(f), 5.2(i)) | Policy names US for Resend and Anthropic data at rest; D1 location to be confirmed |
| Google Fonts transfer | Disclosed in policy; recommend self-hosting fonts |
| Terms of use | None; recommend writing them |
| Minimum age | Proposed 18; not verified |
