# Consent model

Three different things, recorded separately, never bundled:

| Record | What it is | Legal character | Where stored | How it changes |
|---|---|---|---|---|
| Privacy notice acknowledgement | The person confirms they have read a version of the privacy policy | Notice (APP 5, GDPR Art 13). **Not consent** | `consents` row, kind `privacy_notice`, with the policy `version` | At sign-up (required). When the policy changes materially, the app should ask again (see gaps) |
| Health information consent | Explicit agreement to collect and use health and wellness information to run the plan | Consent to collect sensitive information (APP 3.3, GDPR Art 9(2)(a), Washington MHMDA) | `consents` row, kind `health_data`, `granted` 1 or 0 | Separate checkbox at sign-up (required to use the app, which is stated). Withdrawable in Settings, Your consent. Withdrawal stops new training data being saved and stops AI and coach reports; reading, export and deletion keep working |
| AI review consent | Agreement to send the weekly review details to the AI provider | Consent to a secondary use and overseas disclosure | `user_settings.ai_reviews` plus a `consents` row, kind `ai_review`, on each change | Off by default. Settings, AI-assisted weekly reviews |
| Reviewer sharing | Whether an assigned coach may read the member's records | A sharing choice within the service | `user_settings.share_with_reviewer` | On by default when a coach is assigned; Settings, Reviewer access and sharing |
| Terms of use acceptance | Agreement to terms | Contract | **Not implemented: there are no terms yet** | To be added as its own record when terms exist |

Accounts created before this model have no records. After sign-in they are asked once per
browser session to agree to health information use; the answer is recorded with source `app`.

Every row is append only, so the history of each choice is kept, and the latest row per kind is
the current state. Rows are included in the account export and deleted with the account.
