# Firebase: setup, configuration and deployment

This document covers the Firebase pieces of NMU Onboarding:

- **Firebase Authentication:** "Continue with Google" plus email and password. This is the app's only sign-in system; the old hand-written Google OAuth routes were removed.
- **Cloud Firestore:** a data store built and tested, but **not active**. Airtable stays the source of truth until the migration in [firestore-migration.md](firestore-migration.md) is verified.

## How it fits together

```
Browser ── Google popup, or email + password ──▶ Firebase Auth
   │  ID token (once)
   ▼
POST /auth/firebase/session ── firebase-admin verifyIdToken (signature, expiry, revocation)
   │  verified email ──▶ Users table (Airtable today; Firestore after cutover)
   ▼
App session cookie (httpOnly, signed, 12 h): one cookie for every sign-in method
   │  redirect: Admin → /projects (All Projects), Staff → /my-tasks
Server components and actions: requireUser() and permissions.ts on every request
```

- **Firebase only proves who someone is.** What they can do comes from the **Access Level** in the Users table, the same as before. Existing accounts and permissions are unchanged, and session cookies stay valid across a migration because document IDs are the original Airtable record IDs.
- **Admin access is never granted automatically.** Firebase can't create app users. A Firebase account whose email isn't an active user in the Users table gets no session. Access levels are never read from a token.
- **The email must be verified.** Anyone can create a Firebase account for any address, so only a verified email proves ownership. Unverified sign-ins are refused, and the form offers "Resend verification email".
- **One source of session truth.** After the exchange, the browser's Firebase session is discarded. Persistence is in-memory, so no Firebase refresh token or Google token sits in `localStorage`. Refreshes are covered by the app's cookie. Signing out clears that cookie.
- **Google and email/password are identical after sign-in.** Both go through the same route, the same Users-table check, the same cookie and the same permissions. `tests/google-sign-in.emulator.test.ts` checks this with the real project and task actions.
- **Protected routes.** `src/proxy.ts` sends signed-out visitors to `/sign-in` early. The real check (signature, expiry, active user, permissions) runs on the server in `src/app/(app)/layout.tsx` and in every server action.

Code map:

| File | Purpose |
| --- | --- |
| `src/lib/firebase/config.ts` | Public web config from `NEXT_PUBLIC_FIREBASE_*`, plus Firestore collection names |
| `src/lib/firebase/client.ts` | Browser Auth (modular SDK, in-memory persistence), friendly error messages, and `startAppSession()` (the shared token exchange) |
| `src/lib/firebase/google.ts` | Google provider (basic scopes only), popup outcomes, secure account linking, and the future Calendar scopes |
| `src/lib/firebase/admin.ts`, `server.ts` | Admin SDK factory, and the cached server-only accessor |
| `src/lib/config.ts` | `getFirebaseAdminConfig()`: the only place service-account secrets are read |
| `src/lib/auth/firebase-sign-in.ts` | Who may sign in, as whom (pure, unit-tested) |
| `src/app/auth/firebase/session/route.ts` | Exchanges the ID token for the session cookie (checks the request comes from this app's own origin, to block cross-site requests) |
| `src/app/sign-in/firebase-sign-in.tsx` | "Continue with Google" button, email/password sign-in, set your first password, forgot password, the linking step |
| `src/lib/auth/permissions.ts` → `homePathFor()` | Which dashboard each role lands on |
| `src/lib/data/firestore-store.ts` | Firestore version of the data store (`DataStore`), selected with `DATA_BACKEND=firestore` |
| `firestore.rules`, `firestore.indexes.json`, `firebase.json` | Security rules, indexes and emulator configuration |

## Firebase Console setup (manual, one time)

Do this under an **NMU-owned Google account**, not a student's, so the handoff is clean.

1. **Create the project.** Go to https://console.firebase.google.com, choose Add project, and name it, for example, `nmu-onboarding`. Analytics isn't needed.
2. **Register a web app.** In Project settings → General → Your apps, add a **Web** app. Copy the `firebaseConfig` values into the `NEXT_PUBLIC_FIREBASE_*` variables. These values are public by design.
3. **Turn on email/password.** Go to Build → Authentication → Get started → Sign-in method → **Email/Password** → Enable. Leave "Email link" off.
4. **Turn on Google.**
   1. In Build → Authentication → Sign-in method, choose **Add new provider → Google → Enable**.
   2. Set the **public-facing name** to `NMU Onboarding` and pick a **support email**, an NMU address people can reply to.
   3. Save. Firebase creates the Google OAuth client for you, so no client ID or secret goes into this app.
5. **Google consent screen.** In the Google Cloud Console for the same project, open APIs & Services → OAuth consent screen ("Google Auth Platform → Branding").
   1. Check the app name (`NMU Onboarding`), the support email and, optionally, the NMU logo.
   2. Choose the **audience**. Use **Internal** if every staff member has an NMU Google Workspace account; then only NMU accounts can use it and no Google review is needed. Otherwise use **External** and click **Publish app**.
   3. Sign-in requests only basic profile scopes (`openid`, `email`, `profile`), so no Google verification is required. Calendar scopes, later, would require it.
6. **Authorized domains.** Under Authentication → Settings → Authorized domains, add every address people sign in from:
   - The production domain, e.g. `nmu-onboarding.vercel.app`, and any custom domain.
   - A stable Preview domain if you test on Vercel previews. Wildcards aren't supported, so add a fixed alias such as the branch URL `nmu-onboarding-git-dev-<team>.vercel.app` rather than per-commit URLs.
   - `localhost` is already there.

   A missing domain shows people "Google sign-in isn't allowed from this web address yet".
7. **Recommended settings** (Authentication → Settings):
   - **Password policy:** require at least 8 characters with letters and numbers.
   - **Email enumeration protection:** leave it on (the default). The app already shows the same message whether or not an account exists.
   - **User account linking:** keep **"Link accounts that use the same email"** (the default). One person then has one Firebase account whichever way they sign in. If Firebase can't link automatically, the app asks for the existing password once and links Google to that same account.
   - **User actions:** to stop self-service "set your password", untick *Enable create (sign-up)*. An admin then adds people under Authentication → Users, and they use "Forgot password?" to choose a password. They still have to verify their email the first time.
   - **Templates:** customize the sender name and wording of the verification and password-reset emails.
8. **Service account for the server.** Go to Project settings → Service accounts → **Generate new private key**.
   - Copy `project_id`, `client_email` and `private_key` into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`.
   - Paste the key on one line with literal `\n` sequences; the app converts them back to newlines.
   - **Then delete the downloaded JSON file.** Never commit it. `.gitignore` blocks the usual file names as a backstop.
9. **Create Cloud Firestore** (only when preparing the migration). Go to Build → Firestore Database → Create database.
   - Choose **production mode** and a US region such as `us-west1`. The region can't be changed later.
   - Then deploy the rules (see below).

## Environment variables

All of these are listed in `.env.example`. Put real values only in `.env.local` (git-ignored) and in Vercel → Settings → Environment Variables.

| Name | Secret? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | no (public) | Web config for browser sign-in. All four are required for the email/password form to appear. |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID` | no | Optional parts of the web config |
| `FIREBASE_PROJECT_ID` | no | Project for the Admin SDK |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | **yes** | Service account the server uses to verify sign-ins (and to use Firestore). Alternatively set `GOOGLE_APPLICATION_CREDENTIALS`. |
| `DATA_BACKEND` | no | `airtable` (default), `firestore`, or `memory` |
| `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | no | **Local only.** Point the app at the emulators. Refused in production. |

"Continue with Google" and the email/password form appear only when **both** the public web config and the server credentials (or the emulators) are present.
- If only one half is set, the sign-in page says that sign-in is unavailable. When running `npm run dev` it also names what's missing.
- Development sign-in still works alongside, when it's enabled locally.

Changing a `NEXT_PUBLIC_` variable requires a **rebuild or redeploy**, because Next.js bakes these values into the browser bundle at build time.

## Local development with the emulators

The emulators need Java 11 or newer. `firebase-tools` is a dev dependency, so nothing has to be installed globally.

```bash
npm run emulators            # Auth on :9099, Firestore on :8080 (project "demo-nmu-onboarding")
```

In `.env.local`, add the following and restart `npm run dev`:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=demo-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-nmu-onboarding.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-nmu-onboarding
NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:0000000000000000
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

You can use any `DATA_BACKEND`:

- With `memory`, sign in with a sample email such as `sam@example.org`.
- With `firestore`, first load the sample data into the emulator: `npm run migrate:firestore -- --from-sample --apply`.

The emulator doesn't send real email. Verification and reset links appear in the terminal running `npm run emulators`; open one to verify.

**Google on the emulator.** "Continue with Google" opens the emulator's own account page instead of Google's.
1. Choose **Add new account**.
2. Enter an email from the Users table, e.g. `sam@example.org` for Staff or `jordan@example.org` for Admin.
3. Choose **Sign in with Google.com**.

No real Google account is involved. An email that isn't in the Users table shows the "ask an administrator" message.

**Google against the real Firebase project, locally.** Leave out the three `*_EMULATOR_HOST` lines and use the real `NEXT_PUBLIC_FIREBASE_*` and service-account values. `localhost` is an authorized domain by default. Sign in with a Google account whose email is an active user in the Users table.

## Tests

```bash
npm test                     # unit tests (sign-in rules, mapping, migration plan, config); no emulators needed
npm run test:emulators       # starts the emulators, runs the tests below, stops them
```

`npm run test:emulators` covers four areas:

- `tests/google-sign-in.emulator.test.ts`: Google sign-in through the real session route.
  - Role-based redirects, returning users and no duplicate profiles.
  - Unapproved and deactivated accounts get nothing.
  - Secure account linking, and Google and password sign-ins mapping to the same user.
  - The real project and task server actions, used after Google sign-in.
- `tests/firebase-auth.emulator.test.ts`: real email/password accounts through the real session route. It checks verified versus unverified, unknown and deactivated users, revoked tokens, forged tokens, and cross-site requests.
- `tests/firestore-rules.emulator.test.ts`: `firestore.rules` for Admin, Staff and Partner, signed-out users, unverified users, a spoofed `appUserId`, and self-promotion attempts.
- `tests/firestore-store.emulator.test.ts`: `FirestoreStore` running the app's real workflow.

## Security rules

The app reads and writes Firestore **only from the server**, using the Admin SDK after the checks in `permissions.ts`. The Admin SDK bypasses the rules. `firestore.rules` is the second line of defense if anything ever talks to Firestore from a browser, and it mirrors the same access levels:

- **Admin:** reads and manages sites, templates, template steps, projects and tasks, including task assignments.
- **Staff:** reads only tasks assigned to them and projects where they have a task. On their own tasks they can change **only** `status` (plus `completedAt` and `updatedAt`).
- **Partner and everyone else:** no access.
- **`/users` can't be written from any client,** so nobody can change an access level, their own or anyone else's. The role is read live from the user's document, so deactivation applies immediately. The `appUserId` custom claim, set by the server after a verified match, is only an identity link, and its email must still match the user record.
- If an admin changes task assignees directly in a client, `projects.assigneeUserIds` (which the rules use for project visibility) must be updated too. The app's own code paths keep it correct.

Deploy rules and indexes (after `npx firebase login` and `npx firebase use <project-id>`):

```bash
npm run firebase:deploy-rules
```

## Google sign-in: how it behaves

- **Popup, not redirect.** The app runs on Vercel, while Firebase's sign-in handler runs on `<project>.firebaseapp.com`. `signInWithRedirect` across two domains breaks in browsers that block third-party storage: Safari, Firefox, and Chrome with tracking protection. `signInWithPopup` works in all of them, including phones, where it opens a tab. The popup opens straight from the button click, so pop-up blockers allow it. If one is blocked anyway, the page asks the person to allow pop-ups and try again.
  - Switching to redirect later would mean serving Firebase's `/__/auth/*` handler from the app's own domain and setting `authDomain` to it.
  - Don't add a `Cross-Origin-Opener-Policy: same-origin` header; it breaks the popup.
- **Access needs approval.** A Google account gets in only if its email is an **active user in the Users table**. Adding that row is the administrator's approval. Anyone else sees: "That account isn't on the NMU staff list yet… Ask an administrator to add your email." No app profile, role or project data is created for them. Roles are never taken from Google or Firebase.
- **Returning users and duplicates.** Firebase keeps one account per person, and the app matches it to the Users record by verified email. Signing in again, or switching between Google and password, lands on the **same** app user, with the same role and tasks. Sign-in never creates app profiles.
- **Account-provider conflicts.** If someone set a password first and Firebase can't link Google automatically, the page says the email already has a password and asks for it once. Google is then linked to the same account. The pending Google credential lives only in page memory for that one step and is never stored.
- **Where people land.** Admins go to **All Projects** and Staff to **My Tasks**, for every sign-in method (`homePathFor()`).
- **Errors** are explained in plain language and the button can be retried. This covers a closed or blocked popup (closing it is treated as a quiet cancel), network errors, an unauthorized domain, a disabled provider, missing configuration, an unapproved account and a provider conflict.

## Future: Google Calendar

Ordinary sign-in **never** asks for Calendar access. The scope is defined, but unused, as `GOOGLE_CALENDAR_SCOPES` in `src/lib/firebase/google.ts`. A unit test makes sure sign-in doesn't request it. The intended design for a later "Connect Google Calendar" button:

1. An explicit **Connect calendar** action on a settings page requests `calendar.events` using Google's incremental authorization. The person sees a Calendar-specific consent screen only at that moment.
2. Syncing deadlines in the background needs an offline **refresh token**, which a Firebase popup doesn't provide. Use Google Identity Services' authorization-code flow (`google.accounts.oauth2.initCodeClient`) and exchange the code **on the server**.
3. Store the refresh token **only on the server**, encrypted, in its own `calendarConnections` collection or table that rules make unreadable to clients. Never store it in the browser or in the Users record.
4. Offer **Disconnect**, which revokes the token at Google and deletes the record.
5. Calendar scopes are "sensitive", so an **External** consent screen will need Google's verification before launch. An **Internal** (Workspace-only) app doesn't.

## Deployment checklist (Vercel)

1. Complete the Console setup above.
2. In Vercel, add the `NEXT_PUBLIC_FIREBASE_*` variables and the three `FIREBASE_*` service-account variables for **Production** and **Preview**. Use a separate Firebase project for Preview if you can.
3. **Do not** set any `*_EMULATOR_HOST` variable on Vercel. Production refuses them anyway.
4. Add the deployment domain to Authentication → Authorized domains. Check that the Google provider is enabled and the consent screen is published, or set to Internal.
5. Redeploy, since `NEXT_PUBLIC_` values only change in a new build.
6. Smoke test on the deployed URL, in a private window:
   - **Continue with Google** as an Admin: you land on All Projects. Open a project and change a task status.
   - **Continue with Google** as a Staff member: you land on My Tasks and see only your own tasks.
   - **Continue with Google** with an account that isn't in the Users table: you're refused with the "ask an administrator" message.
   - Email and password: set a password for a test user, verify the email, and sign in.
   - Sign out, then press Back: you're sent to the sign-in page.
7. Keep `DATA_BACKEND=airtable` until the Firestore migration has passed `--verify` and the team has decided to cut over.

## Known limitations

- Signing out ends the app session in that browser, but an already-issued 12-hour cookie isn't revoked on the server. To cut someone off immediately, untick **Active** on their user record; that applies within a minute. Disabling their Firebase account stops new sign-ins.
- `npm audit` reports advisories in `@grpc/grpc-js`, which the Firebase SDKs pull in. Both concern gRPC **servers**, and this app only acts as a gRPC client. Re-check when Firebase releases an update.
- `firebase-admin` 14 and `firebase-tools` need **Node.js 22 or newer**.
