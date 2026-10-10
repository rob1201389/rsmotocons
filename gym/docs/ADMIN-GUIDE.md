# Recomp administrator guide

## Before you start

Pick your login email and a passphrase. Both go into the **server** environment,
never into the app. I have deliberately not invented an email for you.

The temporary password you sent in chat is burned — it was transmitted in a
message and is stored in that conversation. It also fails the password policy
(no uppercase letter and no symbol), so the server would refuse it anyway and
tell you why rather than quietly accepting it.

## One-time setup

```bash
OWNER_EMAIL='you@yourdomain' \
BOOTSTRAP_OWNER_PASSWORD='a passphrase you choose' \
node backend/server.js
```

The console prints `[bootstrap] owner created`. The bootstrap then writes
`bootstrap_done` to the `meta` table and will never run again, so nobody can
re-trigger it to mint a second owner.

Log in. You are forced to change the password before any other screen or
endpoint will answer you.

## Creating logins

You said you would supply the logins yourself, so there is no self-registration
and no email is ever sent. Admin → Accounts → New:

- **Email** is just the login identifier.
- **Password** you set, and the account must change it on first login.
- **Role**: member, coach, admin or owner. Only the owner can create admins or
  owners.
- **Status**: active immediately, or pending if you want to approve later.

## Roles

| Role | What it can do |
|---|---|
| **Owner** | Everything. The only role that can grant admin or owner. Cannot be demoted or suspended if it is the last one. |
| **Admin** | Create and manage accounts, assign coaches, read the audit log. **Cannot read a member's training or health records** unless explicitly assigned to them, and every such read is audited. |
| **Coach / Reviewer** | Reads and replies to reviews for the members assigned to them. Nobody else. |
| **Member** | Their own data only. |

That admin restriction is deliberate. Account administration and access to
somebody's health records are different powers, and bundling them is how
personal data leaks inside small organisations.

## Feature permissions

Seven features can be switched per user: training, library, nutrition, recipes,
garmin, progress, reviews. Role presets apply, and a per-user override wins.

Turning a feature off hides it **and** refuses it at the API. There is a test
that turns off training for a member and then calls `/api/state` directly to
confirm the request is refused, not just the tab hidden.

## Suspending someone

Set status to suspended or revoked. Every live session for that account is
revoked in the same transaction, so the next request they make fails with a 401.
Reactivating does not resurrect the old session; they log in again.

**One honest limitation:** a device that is offline cannot be told it has been
revoked. It keeps whatever is already in its local cache until it next reaches
the server. Local caches are cleared on logout and are per-account, but an
offline device holding cached data is a property of offline-capable apps, not
something a server-side check can reach. Plan around it for shared devices.

## Reviews

A member submits a workout review tied to a specific session. Assigned reviewers
see it in an inbox with New / In review / Replied / Resolved, and reply in a
thread the member can read.

A reviewer can **propose** a plan change with a required reason. It does nothing
until the member accepts it. Completed workout records are never overwritten.

## Audit log

Admin → Audit. Records account creation, role and status changes, permission
changes, assignments, logins, password changes and every read of another user's
records, with actor, target, time and IP.

## Importing your existing data

Profile → Your data → Import into my account. It previews first: how many
sessions are new, how many are duplicates by id, how many weigh-ins are new, and
the date range. Nothing is written until you confirm, and the merge is additive
by session id, so re-importing the same file changes nothing.
