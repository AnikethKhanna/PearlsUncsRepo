# NMU Onboarding

Onboarding management for **No More Under** program launches. Built by a UW
Informatics capstone team: Aniketh Khanna, Josh Lee, Owen Perenchio and Pearl
Tugnayat.

This is an academic MVP. It uses Next.js 16, TypeScript and Tailwind, with
Airtable as the data store, hosted on Vercel.

## What works today

- Sign in with Google: implemented, but **not yet verified** end to end
  because it needs NMU's OAuth client. There is also an email-only
  development sign-in for local use.
- Create a project from a template, with role assignments, per-program task
  selection and a live due-date preview.
- Tasks are generated with calculated deadlines and dependencies and saved
  to the data store.
- The project page shows tasks with owner, due date, and **Blocked** and
  **Overdue** indicators. Staff change status inline, and the change
  persists after a refresh.
- A basic project list with progress.
- Server-side access control for Admin, Staff and Partner (Partner has no
  access yet).

See [docs/architecture.md](docs/architecture.md) for the full plan and what's
next.

## Local setup

Requires Node.js 20.9 or newer (22 recommended).

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
restart. A yellow banner shows while it's active. Sign in as
`admin@example.org` or `staff@example.org`.

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
npm run build
```

## Documentation

- [Architecture, hosting, env vars, plan, team split](docs/architecture.md)
- [Airtable schema review and proposal](docs/airtable-schema.md)
- [How task generation works](docs/task-generation.md)

## Security notes

- Secrets live only in `.env.local` (git-ignored) and in Vercel environment
  variables. **Never commit them or paste them into chat.**
- The Airtable token is read only on the server (`src/lib/config.ts` is
  `server-only`).
- Permissions are enforced in server code (`src/lib/auth/permissions.ts`),
  not by hiding buttons.
