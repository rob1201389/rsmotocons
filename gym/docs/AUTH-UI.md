# Authentication pop-up and administrator approval (front end)

The server decides everything. This is presentation: it never grants access and
hiding something here is not a control. The endpoints and rules are in
`BACKEND-AUTH.md`.

## Files

| File | What it does |
|---|---|
| `public/index.html` | `#authGate` markup (welcome page, dialog, account-status page) and its CSS, using the existing colour tokens. |
| `public/authui.js` | `AuthUI`: all gate behaviour. `app.js` calls `AuthUI.init({signedIn})`, `show`, `hide`, `consumeUrl`. |
| `public/authclient.js` | `AUTH` gains `signup`, `verify`, `resendVerification`, `accountStatus`, `forgot`, `reset`, `adminRequests`, `adminDecision`, `adminVerifyEmail`, `adminNoteGet`, `adminNotePut`, `adminUpdateUser`, `pending`. Existing names are unchanged. Every call sends `X-Recomp-Request: 1`. |
| `public/admin.js` | `Admin`: the "User requests" screen. Opened by the Administration button on the Profile tab (administrators only). |
| `public/app.js` | Small edits only: gate functions delegate to `AuthUI`, `afterSignIn` and `resolveSession` handle pending accounts and email links, `renderProfile` adds the button. |

`sw.js` was not edited. Its `SHELL` list needs `./authui.js` and `./admin.js`.

## Flows

- **Signed out.** A public welcome page (name, one line, Log in and Sign up). The
  app (header, tabs, content, sheets) is `hidden`, `inert` and `aria-hidden`, and
  no account data is requested. The log in dialog opens on load. Closing it
  (Escape, close button, backdrop) leaves the welcome page; the app is never shown.
- **Log in / Sign up** are tabs in one dialog. **Forgot password?** opens a
  request screen, then a "Check your email" state. `/?reset=TOKEN` opens the
  reset screen (new password and repeat); the token is removed from the address
  bar straight away.
- **Sign up** takes name, email and password (with a live checklist that matches
  the server rules). The hidden `website` field is the honeypot. Then
  "Check your email" with Resend (a 429 shows the server's message and a
  cooldown). If the server reports `emailSent: false` the screen says the email
  could not be sent and the administrator may verify the account manually.
- **`/?verify=TOKEN`** posts the token, shows "Email confirmed" (or "Link not
  valid"), and removes the token with `history.replaceState`. A person who is
  already signed in as the pending account lands on the status page.
- **Pending** (`accountState` is `pending_verification` or `pending_approval`,
  or any private route answers 403 `pending`): only the status page. The heading
  is "Your account is awaiting approval". Email confirmation and approval are
  shown as two separate lines. Resend email appears only while unverified.
  `GET /api/auth/account-status` is called on focus and when the tab becomes
  visible, at most every 15 seconds, plus a 60 second timer while visible. On
  approval the app loads normally.
- **No access** (rejected, suspended or revoked at login, or a 401 carrying one of
  those statuses while waiting): a plain "No access" page with no detail about why.
- **First-time owner set-up** and the **forced password change** use the same
  dialog. Closing the forced-change dialog does not skip it: Log in resumes it.
- **Local-only mode** is unchanged: no backend (404, or unreachable on a device
  that never signed in) means no gate.

## Administration

Profile tab, "Administration" button, administrators and the owner only. Tabs:
Pending, Approved, Rejected, All (arrow keys move between them). Each row shows
name, email, an email verified badge, the requested date and the status. The
detail view offers:

- **Approve** with a role (Member or Coach), every feature permission as a
  checkbox (defaults follow the role's preset), and an optional private note.
  Body: `{action:"approve", role, permissions:{all seven}, note?, overrideVerification?:true}`.
  If the email is not verified, a confirmation is required and
  `overrideVerification:true` is sent.
- **Verify email manually**, **Reject** (optional reason, confirmation), and the
  **private note** (`GET`/`PUT /api/admin/users/:id/note`).
- For existing accounts: **Suspend** and **Revoke** (confirmation) and
  **Reactivate**, through `PATCH /api/admin/users/:id`.

All state is read from the server on every visit and after every action. 400,
403, 404, 409 and 429 answers are shown as the server's message. No password is
ever requested or shown. User-supplied text is only ever set with `textContent`.

## Accessibility

- Dialog: `role="dialog"`, `aria-modal`, labelled and described. Focus moves in on
  open, Tab and Shift+Tab wrap, Escape closes (ignored while a request runs),
  focus returns to the opener. The page behind is `inert` and `aria-hidden`.
- Tabs: `role="tablist"`, roving `tabindex`, Left/Right/Home/End.
- Every field has a visible `<label>`, an inline message tied by `aria-describedby`,
  and `aria-invalid` when wrong. Validation summaries go to a `role="alert"`
  region; progress and results go to a polite `role="status"` region. Server
  errors appear in a `role="alert"` element.
- Show/hide password: a button with a fixed name ("Show password") and
  `aria-pressed`. Password rules are text ("Done"/"Needed"), not colour alone.
- Autocomplete: `username`, `email`, `name`, `current-password`, `new-password`.
- Busy: the submit button gets `aria-busy` and `aria-disabled`, its label changes,
  and further submits are ignored. Focus stays where it was.
- Mobile: a bottom sheet that is as tall as the visible viewport (`dvh`, and
  `visualViewport` for the on-screen keyboard). The body of the dialog scrolls, so
  the submit button is always reachable; the focused field is scrolled into view.
- `prefers-reduced-motion` removes the dialog and spinner animation. All colours
  come from the existing tokens, so light and dark follow the app.

## Tests

```
cd gym/test && npm install      # jsdom, dev only
node auth.ui.test.js            # or ./run-all.sh for every suite
```

`auth.ui.test.js` boots the real `index.html` and scripts in jsdom. Part one uses a
scripted fake server. The last part is an end-to-end run: `fetch` calls the real
`handle()` from `gym/backend` in-process (node:sqlite, outbox mail), so sign up,
the emailed verify link, administrator approval, polling, rejection, and
forgot/reset all go through the real server logic. It is skipped with a message if
the backend or `node:sqlite` is not available (`RECOMP_GYM` points it at the
backend when the test is copied elsewhere, as `run-all.sh` does).

## Screenshots

`gym/docs/screens/auth/` was captured with Chromium (Playwright) against the real
backend running locally with the outbox mail provider and seeded requests.

## What was verified, and what was not

Verified: the test suites above, and the screenshots in Chromium at 1280 and 1100
wide, 390x844 and 390x420 (the 420 height simulates the keyboard; the submit
button stays reachable by scrolling the dialog body).

Not verified: a real iOS or Android on-screen keyboard (only a shrunk viewport),
Safari and Firefox, screen readers (VoiceOver, NVDA, TalkBack: announcements were
checked by reading the live regions, not by listening), password-manager save and
fill prompts, delivery of real email, and the Cloudflare Workers deployment path.
