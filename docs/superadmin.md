# Super admin: bootstrap, sign-in and recovery

The **Super admin** is the person who runs ConvoyPass: they create company workspaces and their admins from the Super admin
console (`/platform`). They belong to no workspace and see no business data. A super admin exists only because **a script on a
trusted machine created it**; there is no signup, invite or screen for it, and there never should be.

Everything below uses the same four commands, each with `--help`:

| Command | What it does |
|---|---|
| `npm run superadmin:create` | create an account, or `--repair` / `--reset-password` an existing one |
| `npm run superadmin:doctor` | check the account, with the likely cause and the fix for every failure (`--fix`, `--json`) |
| `npm run superadmin:disable` | disable an account and sign it out everywhere |
| `npm run dev:superadmin` | emulator only: a demo super admin with fixed dev credentials |

## How scripts pick the target

Every script in `scripts/` goes through one resolver (`scripts/lib/env.ts`):

- `--env emulator|staging|prod` is **required**. There is no default and nothing is guessed; a typo (`--env production`) is refused.
- `staging` and `prod` are the project IDs in `.firebaserc` (aliases `staging` and `prod`). A placeholder, a missing alias or the
  same project under both names is refused. An environment variable never overrides a real project ID.
- `emulator` talks to the local Auth/Firestore emulators (`FIREBASE_*_EMULATOR_HOST` come from `firebase.json`) under the project
  the emulators run with (`FIREBASE_PROJECT_ID` if set, else the `.firebaserc` default, else `demo-conveypass`).
- Before anything happens the script prints a banner with the environment, the project ID and what it is about to do.
- **Production needs two things:** `--confirm-prod` **and** the project ID typed back at a prompt. In CI, where there is no
  terminal, pass `--confirm-project <project-id>` instead; it must match exactly. (With `--password-stdin` the terminal is taken
  by the pipe, so use `--confirm-project` there too.)
- Credentials are Google **Application Default Credentials**. If they are missing, expired or for the wrong account, the script
  prints the fix and stops (see below).

**Passwords are never command-line arguments** (they would sit in your shell history and the process list). `--password` is
rejected with that explanation. A password is either generated and printed once, or piped in with `--password-stdin`.

## First-time production bootstrap

You need: Node 22, this repository with `npm install` done, the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install),
and a Google account that may administer Firebase Authentication and Firestore in the production project (for example the Firebase Admin role).

1. **Check the project.** `.firebaserc` must name the real production project under `prod` (no `REPLACE-ME`). Check
   `functions/.env.prod` has `APP_BASE_URL=https://app.your-domain` (used to print the sign-in URL) and `FUNCTIONS_REGION`.
2. **Sign in to Google Cloud for the scripts:**
   ```sh
   gcloud auth application-default login
   gcloud config set project <your-prod-project-id>
   ```
   (Alternatively export `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`. Treat that file like a password.)
3. **Make sure the functions and rules are deployed** (`docs/ops.md`, deploy order). The sign-in page calls `getOperatorProfile`.
4. **Create the account** with a **company mailbox** that is used for nothing else:
   ```sh
   npm run superadmin:create -- --env prod --confirm-prod --email you@your-company.com --name "Your Name"
   ```
   The script prints the banner, asks you to type the project ID, creates the account and **reads everything back**. Near the end
   of the output you get the **temporary password, once**:
   ```
     temporary password: <20 characters>
   ```
   Put it in a password manager immediately. It is not stored anywhere (not in a file, a log, an audit entry or Firestore).
   To choose the password yourself: `pass show my/entry | npm run superadmin:create -- ... --password-stdin ...` (14+ characters,
   not a common password, not the email; no forced change is set because you already chose it).
5. **First sign-in.** Open `https://<your app>/platform/login` (the script prints the URL). Sign in with the temporary password.
   You are taken straight to **Choose a new password** and cannot reach anything else until you set one (14+ characters, not
   common, not your email). Then you land on `/platform`.
6. **Verify** (next section).

Rehearse the same steps on staging first: replace `prod --confirm-prod` with `staging`.

## Verify with the doctor

```sh
npm run superadmin:doctor -- --env prod --confirm-prod --email you@your-company.com
```

It prints a PASS/FAIL table and exits non-zero on any failure:

| Check | Why |
|---|---|
| Auth user exists, is not disabled | the account can sign in |
| Email is verified | the console refuses an unverified super admin |
| Claims are exactly `role: platform` + `platformAdmin: true` | the claims are what the server trusts |
| No other claims, no `tenantId` | a token with a tenant is not a super admin token |
| `operators/{uid}` exists and is `active` | the server re-reads it on every call |
| No `users/{uid}` document | a super admin is never a workspace user |
| `getOperatorProfile` is deployed (not on the emulator) | plain HTTP reachability, no credentials are sent |

For each failure it prints the likely cause and the exact command to fix it. `--fix` repairs claims, verified email and the
`operators` profile (never the password, never a disabled state, never a `users` document). `--json` prints the result as JSON
for CI (the banner then goes to stderr). It is safe to run any number of times.

## Recovery

| Situation | What to do |
|---|---|
| **Forgot the password** | `npm run superadmin:create -- --env prod --confirm-prod --email … --reset-password`. Prints a new temporary password once, revokes every session, forces a change at the next sign-in. |
| **Sign-in fails, something is off** | `npm run superadmin:doctor -- --env prod --confirm-prod --email …`, then `--fix`, or `superadmin:create … --repair` (same repair; `--repair` also accepts `--enable` to re-enable an account that was disabled on purpose). The password is not touched. |
| **Lost access to your machine** | Run the same commands from [Google Cloud Shell](https://shell.cloud.google.com) (it has `gcloud` and Node): clone the repo, `npm install`, `gcloud config set project <prod-project-id>`, then `--reset-password`. Cloud Shell is already signed in; `gcloud auth application-default login` is only needed if it asks. |
| **Wrong Google account / "could not authenticate"** | The script prints the fix: `gcloud auth application-default login`, `gcloud config set project <id>` (check with `gcloud auth list`), or set `GOOGLE_APPLICATION_CREDENTIALS`. |
| **Suspected compromise** | 1. `npm run superadmin:disable -- --env prod --confirm-prod --email …` (disables the account and revokes its tokens). 2. Read `platformAuditLog` in the Firebase console (filter `actorUid` = the uid): invites created/revoked, workspaces and admins created or reset. 3. Review the affected workspaces' **Audit log** (entries with actor "ConvoyPass Super Admin"). 4. Reset the credentials of any workspace admin the account touched. 5. Create a new account on a **different mailbox** with `superadmin:create`. |

## Before the first paying client: multi-factor authentication

The super admin can create workspaces and admins, so protect the account with a second factor. **This module does not enforce
MFA in the app, and the app has no screen to enrol or to answer a second-factor challenge.** Treat the steps below as a plan, not a
finished control.

Console steps (Firebase console, production project):

1. Authentication > Settings (or Sign-in method) > **Upgrade to Identity Platform** (billing must be enabled).
2. Authentication > Sign-in method > **Multi-factor authentication** > Enable, and enable the **TOTP** (authenticator app) provider.
3. Keep SMS off (TOTP only).

**Warning.** Once a user has enrolled a second factor, Firebase refuses a password-only sign-in with
`auth/multi-factor-auth-required`. `/platform/login` does not handle that challenge, so it would show the generic "These details
don't match" message and the account could no longer sign in to the console. **Do not enrol a super admin account until an
enrolment and challenge screen has been built** (out of scope here; see `CLAUDE.md`). If it happens, remove the enrolled factor in
the console (Authentication > Users > the user > remove multi-factor) or use `--reset-password` only after that.

## Production checklist

- [ ] A **company mailbox** for each super admin (not a personal address, not a shared inbox that many people read).
- [ ] **One or two** super admins only.
- [ ] **A separate account per person.** Never share the login; the audit trail names the account.
- [ ] Passwords live in a password manager; the temporary password was changed at the first sign-in.
- [ ] `superadmin:doctor` is PASS for every account.
- [ ] Nobody uses the dev credentials (`dev:superadmin`) outside the emulator; they do not exist in staging or production.
- [ ] MFA decision recorded (see above): enabled in the project and enrolment built, or consciously postponed.
- [ ] A named person knows the recovery steps above and has access to the Google Cloud project.

## The console's own safeguards

- `/platform/login` is a separate page ("Super admin sign-in"), public, lazy, `noindex` and `no-referrer`. It is linked from no
  workspace screen. A workspace account, a wrong password, an unknown email and a disabled super admin all get the same message
  ("These details don't match a super admin account.") and nobody who is not a valid super admin stays signed in.
- Changing the password needs the current password again and a sign-in from the last 5 minutes. Other changes (create, reset,
  disable) need a sign-in from the last 15 minutes; when it is stale the console offers the password prompt or the sign-in page,
  and returns you to where you were.
- **Idle timeout:** 30 minutes without pointer, key, touch or scroll activity signs the super admin out; the last minute shows a
  warning with a countdown. One-time invite links and temporary passwords still on screen are dropped from memory.

## Dev only: the emulator super admin

```sh
npm run emulators          # one terminal
npm run dev:superadmin     # another: creates or repairs the demo super admin and prints its credentials
npm run dev                # sign in at http://localhost:5173/platform/login
```

The credentials are fixed so a reset emulator can be refilled in one step, and are **for the emulator only**:
`superadmin@dev.convoypass.test` / `DevOnly-Superadmin-2026`. `dev:superadmin` refuses every environment but `--env emulator`,
and no seed script creates a super admin on staging or production.
