# NMU Onboarding

Onboarding management for **No More Under** program launches. Built by a UW
Informatics capstone team: Aniketh Khanna, Josh Lee, Owen Perenchio and Pearl
Tugnayat.

This is an academic MVP. It uses Next.js 16, TypeScript and Tailwind, with
Airtable as the data store, Firebase Authentication for sign-in ("Continue
with Google" and email/password), and Cloud Firestore prepared as the next
data store. It's hosted on
Vercel.

## What works today

- **Continue with Google** and **email and password**, both through Firebase
  Authentication.
  - Only verified emails of existing, active users get in. An unknown Google
    account sees "ask an administrator" and gets no data.
  - Roles still come from the Users table. Admins land on All Projects and
    Staff on My Tasks.
  - If someone already set a password, Google is linked to the same account
    after they enter that password once.
  - Tested against the Firebase emulators. It needs NMU's Firebase project to
    go live (see [docs/firebase.md](docs/firebase.md)).
  - There is also an email-only development sign-in for local use.
- Create a project from a template, with role assignments, per-program task
  selection and a live due-date preview.
- Tasks are generated with calculated deadlines and dependencies and saved
  to the data store.
- The project page shows tasks with owner, due date, and **Blocked** and
  **Overdue** indicators. Staff change status inline, and the change
  persists after a refresh.
- A basic project list with progress, and a **My Tasks** dashboard
  (overdue / next 7 days / later).
- A **Cloud Firestore** data store, security rules and a dry-run
  Airtable → Firestore migration with verify and rollback. These are **not
  active**; Airtable remains the source of truth (see
  [docs/firestore-migration.md](docs/firestore-migration.md)).
- Server-side access control for Admin, Staff and Partner (Staff see only
  their own tasks; Partner has no access yet), mirrored in `firestore.rules`.

See [docs/architecture.md](docs/architecture.md) for the full plan and what's
next.

## Local setup

Requires Node.js 22 or newer. Java 11+ is needed only for the Firebase
emulators.

```bash
npm install
cp .env.example .env.local
```

**Option A, real Airtable data.** Fill in `AIRTABLE_TOKEN`,
`AIRTABLE_BASE_ID` and `SESSION_SECRET` in `.env.local`. Then check that the
base matches the app:

```bash
npm run airtable:inspect
```

**Option B, no credentials yet.** Set `DATA_BACKEND=memory`,
`ALLOW_DEV_SIGN_IN=true` and a `SESSION_SECRET` in `.env.local`. This uses a
**development placeholder** with illustrative sample data, which is lost on
restart. A yellow banner shows while it's active. The sign-in page lists
one-click sample accounts (people from the sample task spreadsheet).
The **Collegiate Swim Safely Series** template is the spreadsheet's 141 tasks.
The YMCA template is a small illustrative example that shows task
dependencies.

To update the sample template after editing
`data/sample-template-program-tasks.csv`, run:

```bash
npm run sample:import
```

**Firebase sign-in, Google and email/password (optional locally).** Run
`npm run emulators` and add the emulator settings listed in
[docs/firebase.md](docs/firebase.md#local-development-with-the-emulators) to
`.env.local`. It works with either data option above.

Then start the dev server:

```bash
npm run dev
```

Open http://localhost:3000.

## Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:emulators   # Google + email sign-in, Firestore store, security rules (needs Java)
```

```bash
npm run build
```

## Documentation

- [Architecture, hosting, env vars, plan, team split](docs/architecture.md)
- [Airtable schema review and proposal](docs/airtable-schema.md)
- [How task generation works](docs/task-generation.md)
- [Firebase: Google and email sign-in setup, env vars, emulators, deployment](docs/firebase.md)
- [Airtable → Firestore migration plan](docs/firestore-migration.md)

## Security notes

- Secrets live only in `.env.local` (git-ignored) and in Vercel environment
  variables. **Never commit them or paste them into chat.**
- The Airtable token and the Firebase service account are read only on the
  server (`src/lib/config.ts` is `server-only`). The `NEXT_PUBLIC_FIREBASE_*`
  web config is public by design. Never commit service-account JSON files.
- Permissions are enforced in server code (`src/lib/auth/permissions.ts`),
  not by hiding buttons.
