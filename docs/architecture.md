# Architecture and development plan

## System summary

NMU Onboarding is a small Next.js web app. It replaces the per-program Google
Sheets with **templates** that generate a dated, assigned, dependency-aware
task list for each **project**, meaning one program launch at one site.
Staff sign in with "Continue with Google" or with email and password, both
through Firebase Authentication. The server checks their access level and reads and writes
Airtable, which stays the single source of truth. Cloud Firestore is
prepared as its replacement (see [firestore-migration.md](firestore-migration.md)). Staff never touch
Airtable directly and don't need Airtable seats.

## Smallest viable architecture

```
Browser ──HTTPS──▶ Next.js on Vercel (server components + server actions)
                     │  • auth: Firebase (Google popup or email/password) → signed httpOnly cookie
                     │  • authorization: src/lib/auth/permissions.ts (every page/action)
                     │  • business logic: src/lib/domain/* (pure, unit-tested)
                     │  • data access: src/lib/data/* → AirtableClient
                     ▼
                  Airtable REST API (token is server-side env var only)
                  — or, after migration, Cloud Firestore via firebase-admin
```

- **One database at a time.** `DATA_BACKEND` selects Airtable (default),
  Firestore or the in-memory placeholder. The app never writes to two. The
  Airtable client is about 150 lines with no SDK. Runtime dependencies are
  `next`, `react`, `server-only`, `firebase` (browser Auth) and
  `firebase-admin` (server).
- **The Airtable token is only read in `src/lib/config.ts`**, which is marked
  `server-only`. If any browser code imports it, the build fails. The
  production build was checked: a sentinel token value did not appear in any
  client bundle.
- **Airtable rate limit:** 5 requests per second per base. The client spaces
  requests and retries on 429. One project with 30 tasks takes about 8 requests.

## Repository structure

```
src/
  app/
    sign-in/                 sign-in page + dev sign-in action
    auth/firebase/session/   Firebase ID token → app session cookie (every sign-in method)
    (app)/layout.tsx         signed-in shell (nav, placeholder banner)
    (app)/projects/          list, new (form + preview), [id] detail, actions.ts
  components/ui.tsx          shared buttons, badges, cards
  lib/
    config.ts                env vars (server-only)
    airtable/schema.ts       ← table/field names: the ONE file to adapt to the base
    airtable/client.ts       REST client (batching, throttling, retries)
    data/store.ts            DataStore interface
    data/airtable-store.ts   Airtable implementation
    data/memory-store.ts     DEVELOPMENT PLACEHOLDER (sample data, not persistent)
    data/firestore-store.ts  Firestore implementation (DATA_BACKEND=firestore)
    firebase/                web config, browser Auth, Admin SDK
    migration/               Airtable → Firestore plan + verify (pure)
    domain/                  types, date rules, task generation, blocked/overdue
    auth/                    session tokens, permissions, current user
scripts/inspect-airtable.mjs read-only schema inspection + mapping check
scripts/migrate-airtable-to-firestore.ts  dry-run / apply / verify / rollback
src/proxy.ts                 early redirect to /sign-in (the real check is server-side)
firestore.rules              Firestore Security Rules (mirror permissions.ts)
tests/                       Vitest unit + Airtable-store tests (fake Airtable API)
docs/                        this documentation
```

The folders split cleanly by owner, so teammates rarely edit the same files.
See the team split below.

## Hosting recommendation: Vercel

Vercel is built by the Next.js team, so it needs zero configuration. It gives
preview deployments per pull request and built-in cron, which we'll use for
email reminders in Phase 4. Railway also works but adds a long-running server
to maintain.

1. Import the GitHub repo into Vercel. The framework is auto-detected.
2. Under **Settings → Environment Variables**, add the variables from
   `.env.example` for the **Production** and **Preview** environments. Use
   separate values for each if possible.
3. Leave `ALLOW_DEV_SIGN_IN` unset in Production. The code refuses it there
   anyway.
4. In Firebase, enable the Google provider and add the Vercel domain to
   Authentication → Authorized domains (see [firebase.md](firebase.md)).

> Vercel's free Hobby plan is for non-commercial use. Confirm with NMU whether
> its use qualifies, or use a Pro or nonprofit plan on NMU's own account so
> the handoff is clean.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `AIRTABLE_TOKEN` | yes | Personal access token. Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`. Access: the NMU base only. Create it under an NMU-owned account, not a student's. |
| `AIRTABLE_BASE_ID` | yes | `app…` ID of the base |
| `SESSION_SECRET` | yes | 32+ random characters, used to sign session cookies |
| `APP_URL` | recommended | Public base URL, used to check that sign-in requests come from the app |
| `DATA_BACKEND` | no | `airtable` (default), `firestore` (after migration) or `memory` (dev placeholder, refused in production) |
| `NEXT_PUBLIC_FIREBASE_*` | for sign-in | Public Firebase web config. See [firebase.md](firebase.md). |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | for sign-in and Firestore | Service account for `firebase-admin`. **Secret.** |
| `ALLOW_DEV_SIGN_IN` | no | `true` enables email-only sign-in **locally**. Ignored in production. |

Never paste these values into chat, issues or commits. They belong only in
`.env.local` (git-ignored) and in Vercel's settings.

## Access control (confirmed requirement vs. working assumption)

| Level | Can | Status |
| --- | --- | --- |
| Admin | see and update every project and task; create projects | confirmed by requirements |
| Staff | see only the tasks assigned to them (My Tasks, and their own tasks inside a project); update only those tasks; see only projects where they have a task | per team decision; **staff can't create projects** (one-line change in `ROLE_PERMISSIONS`) |
| Partner | nothing yet | deferred pending sponsor decision |

These checks run on the server for every page and action. An inaccessible
project returns 404, so project IDs can't be probed. Verified with browser
tests that replay a Staff or Partner session cookie against Admin forms.
`firestore.rules` enforces the same levels for any direct Firestore access
(`npm run test:emulators`). New sign-ins never get admin access: Firebase
accounts only map to existing, active Users records by verified email.

## Ordered development plan

**Required for the Nov 6 demo:**

1. ✅ Foundation: Next.js app, server-only Airtable client, schema mapping, inspection script, env setup.
2. ✅ Phase 2 workflow: create project → generate tasks → save → open → change status → persists after refresh.
3. ⏳ Connect to the real base: run `airtable:inspect`, adjust `schema.ts`, enter 2 real templates. **(team, needs credentials)**
4. ⏳ Deploy to Vercel with Firebase sign-in (Google + email) and verify reads and writes against Airtable on the deployed URL.
5. ✅ My Tasks dashboard (Feature B): overdue / next 7 days / later, status and project filters, inline status updates.
6. ⏳ All Projects (Feature C): add upcoming deadlines and filters to the existing list.

**After the demo (Phase 4–5):** task detail page with notes and Drive links,
add/reassign tasks, activity history table, "program date changed → review
proposed new deadlines" screen (shows old vs. new date per task and nothing
changes until confirmed), email reminders through Vercel Cron and Gmail,
template/user/site admin screens, partner access, runbook and user guide.

## Suggested team split

| Person | Owns | Files |
| --- | --- | --- |
| Josh (data/backend) | connect the real base, `schema.ts`, Airtable store, permissions | `src/lib/airtable`, `src/lib/data`, `src/lib/auth` |
| Aniketh (frontend/UX) | My Tasks page, All Projects dashboard polish, task detail page | `src/app/(app)/my-tasks`, `src/app/(app)/projects`, `src/components` |
| Owen (testing/docs) | acceptance checklist on the deployed app, extend `tests/`, runbook and user guide | `tests/`, `docs/` |
| Pearl (lead) | get real templates and steps from NMU, confirm the 5 open questions, set up Vercel and Google accounts under NMU ownership | Airtable content, accounts |
