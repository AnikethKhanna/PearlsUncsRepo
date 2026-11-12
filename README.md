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
- **My Tasks dashboard:** summary tiles (click to filter) and collapsible
  sections (Overdue, Due in the next 7 days, In progress, Upcoming, Completed).
  You can search, filter by program, status, due date and assignee (admins),
  and sort. Active filters show as removable chips, with **Reset filters**.
  Admins can switch to **Everyone's tasks**; Staff only ever see their own.
- **Calendar:** a "Next 7 days" strip on My Tasks and a full **Calendar**
  page with month and week views. Shows task due dates and program start/end
  dates, using the same filters and permissions as My Tasks. Overdue, due
  today, upcoming and completed tasks each have a colour, a symbol and a text
  label. Clicking a task opens its task page. Tasks with no due date are
  listed under **No due date**.
- **Google Calendar sync (optional):** staff connect their own Google
  Calendar under **Google Calendar**. Their assigned task deadlines appear as
  events with reminders (default 2 days before), kept up to date as tasks
  change, plus one combined overdue reminder (weekly by default). Needs Google
  Cloud, Airtable and Vercel setup: see
  [docs/google-calendar.md](docs/google-calendar.md), which also has the
  **handoff checklist** for moving the Google Cloud project, secrets and
  hosting to NMU-owned accounts, and a troubleshooting table.
- **All Projects**.
- **Flexible programs:** admins can add, edit, remove and reorder tasks in one
  program without changing its template or other programs. **Save as
  Template** turns a program into a new reusable template. The **Templates**
  pages show what's reusable.
- Server-side access control: Admins see and change everything; Staff see and
  update only their own tasks; Partner has no access yet.

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
