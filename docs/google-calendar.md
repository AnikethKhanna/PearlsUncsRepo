# Google Calendar sync and deadline reminders

Staff can optionally connect their own Google Calendar. Each task assigned to
them then appears as an all-day event on its due date, with pop-up reminders
(default: 2 days before, at 9:00 AM). Overdue work gets one combined reminder
(default: weekly, on Mondays) instead of email. Catalina and Mary asked for
this because their inboxes already get too many messages.

Nothing here replaces Airtable or Google sign-in. Airtable stays the only
source of task data. The calendar holds copies that the app keeps up to date.

## Current status (November 2026)

- **Built and tested with mocks.** The automated tests are listed at the end of this page.
- **Connect works with a real Google account, locally.** We tested with a
  **student-owned Google Cloud test project**: sample data on
  `localhost:3000`, and the Google sign-in screen in Testing mode.
- **Not yet set up for NMU.** There is no NMU-owned Google Cloud project, no
  production deployment with these settings, and no "Calendar Connections"
  table in NMU's Airtable base. See
  [Handing off to NMU](#handing-off-to-nmu) below.
- **Open question for NMU:** are staff accounts Google Workspace (Gmail) or
  Microsoft 365 (Outlook)? NMU currently shares an Excel sheet, which hints at
  Microsoft. This feature writes to **Google** Calendar, so it fits best if
  staff use Google accounts. Catalina and Mary asked for Google Calendar.

## What it does

| | |
| --- | --- |
| **Who** | Admin and Staff (`calendar.sync` in `src/lib/auth/permissions.ts`). Partners can't. |
| **What syncs** | Only tasks **assigned to that person**, in active programs they can see. It uses the same permission code as My Tasks. Admins also get only their own tasks, not everyone's. |
| **Event** | An all-day event on the due date called "NMU task: …". It shows as "free", so it never blocks meetings, and it links back to the task. |
| **No duplicates** | Each event's ID is derived from the user ID and task ID. Running a sync again, two syncs at once, or a person deleting an event by hand all end with exactly one event per task. |
| **Updates** | A changed due date, title or status updates the event in place. The event is removed when the task is done or not needed, the person is taken off it, its due date is cleared, the task is deleted, or the program is completed or cancelled. It comes back if the task is reopened. |
| **Only our events** | The app only lists, updates and deletes events it created. These carry private tags (`nmuApp`, `nmuUser`) and an `nmu…` ID. Nothing else in the calendar is touched. |
| **Deadline reminders** | Pop-ups 1, 2, 3 and/or 7 days before, at a chosen time in the calendar's time zone. Overdue tasks get no reminders, because past-due pop-ups would be useless. |
| **Overdue reminder** | One short timed event, "NMU: 3 overdue tasks", listing them. **Weekly**: it sits on the next Monday. **Daily**: today. Or off. It is a single event that only moves on those days, so repeated syncs never create extra notifications. It disappears when nothing is overdue. |
| **Settings** | **Google Calendar** in the nav (`/settings/calendar`): connect, choose a calendar (only ones the person owns), turn syncing on or off, set reminders and the overdue reminder, sync now, and disconnect. Disconnecting revokes access at Google and can remove the NMU events. |
| **In-app** | Overdue work is already flagged in the app: the Overdue tile and section on My Tasks, and the red "Overdue" labels on the calendar. |

### When syncs happen

1. **Right after a task changes.** This covers status updates, task edits (both
   old and new assignees), task deletion and project creation. It uses Next's
   `after()`, so saving never waits on Google.
2. **When someone presses "Sync now"** or saves their settings.
3. **Once a day** via Vercel Cron (`vercel.json`, `GET /api/cron/calendar-sync`).
   This catches anything the first two missed: a failed sync, edits made
   directly in Airtable, tasks becoming overdue, and the overdue reminder
   moving.

### Errors

| Situation | What happens |
| --- | --- |
| Access token expired (after about 1 hour) | Refreshed automatically, and the request is retried once. |
| Access revoked, password changed, or refresh token expired (`invalid_grant`) | The connection is marked **Needs reconnecting**. The person sees a Reconnect button, and the daily run skips them so Google isn't asked over and over. |
| A calendar permission was unticked on Google's consent screen | The connection is refused with a clear message, and the partial grant is revoked. |
| Google busy (429, 5xx, rate-limit 403) | Retried 3 times with increasing waits. If it still fails, the other events are still saved, the problem is shown on the settings page, and the next sync tries again. |
| Chosen calendar deleted, or not the person's own | A plain message asks them to choose another calendar. |
| `TOKEN_ENCRYPTION_KEY` changed | Stored tokens can't be decrypted, so each person is asked to reconnect. |
| "Calendar Connections" table missing in Airtable | The settings page explains this (admins see the table name). |

### Time zones

Due dates are calendar dates with no time of day, so deadline events are
all-day events. They show on the same date in every time zone. Reminders
and the overdue reminder use the chosen calendar's own time zone (from Google).
"Overdue" for calendar purposes is judged by that time zone's date.

## Security

- **Permissions requested** (incremental, only when someone clicks Connect):
  `openid email`, to show which account is connected;
  `calendar.events.owned`, for events on calendars **the person owns**;
  `calendar.calendarlist.readonly`, to list calendars to choose from.
  This is narrower than full `calendar` or `calendar.events` access: the app
  can't read or change calendars that are only shared with the person.
- **Tokens never reach the browser.** The OAuth code exchange happens
  server-to-server. The refresh token is encrypted with AES-256-GCM
  (`TOKEN_ENCRYPTION_KEY`) before it is stored in Airtable. Short-lived
  access tokens are kept only in server memory.
- **No secrets in code or public environment variables.** Every variable below
  is server-only; never give one a `NEXT_PUBLIC_` prefix. `src/lib/config.ts`
  is marked `server-only`.
- **CSRF protection.** The OAuth `state` is stored in an httpOnly cookie, tied
  to the signed-in user, and checked in the callback.
- **The cron endpoint** requires `Authorization: Bearer <CRON_SECRET>`, checked
  in constant time. Without `CRON_SECRET` it refuses every request. Its
  response contains only counts.
- **Logs** record error types and HTTP status codes only, never tokens, names
  or task titles.
- **Limit who can open the "Calendar Connections" table** in Airtable. The
  tokens are encrypted, but the table still shows who connected which Google
  account.

## Setup

### 1. Google Cloud (same project and OAuth client as sign-in)

1. **APIs & Services → Library** → enable **Google Calendar API**.
2. **APIs & Services → OAuth consent screen → Data access** (or **Scopes**) → add:
   - `https://www.googleapis.com/auth/calendar.events.owned`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
3. **Audience / user type**: if NMU uses Google Workspace, choose **Internal**,
   so only NMU accounts can connect and no Google verification is needed. With
   **External**, sensitive Calendar scopes need Google's app verification
   before people outside the test-user list can connect. Until then, add
   testers as **Test users**. Note that refresh tokens for External apps in
   "Testing" status expire after 7 days; people would then see "Reconnect".
4. **Credentials → your OAuth client → Authorized redirect URIs** → add:
   - `https://<your-domain>/auth/google/calendar/callback`
   - `http://localhost:3000/auth/google/calendar/callback` (local testing)
   - Keep the existing `/auth/google/callback` URIs for sign-in.

### 2. Airtable: add the "Calendar Connections" table

Field names must match `src/lib/airtable/schema.ts` → `calendarConnections`, or
edit that file to match your names.

| Field | Type | Notes |
| --- | --- | --- |
| User ID (primary) | Single line text | The Users record ID (`rec…`) |
| User | Link to Users | For people reading the table |
| Google Account | Email or single line text | |
| Refresh Token (encrypted) | Long text | Encrypted by the app; unusable without the key |
| Calendar ID | Single line text | `primary` = main calendar |
| Calendar Name | Single line text | |
| Calendar Time Zone | Single line text | e.g. `America/Los_Angeles` |
| Sync Enabled | Checkbox | |
| Reminder Days | Single line text | e.g. `2` or `1,7` |
| Reminder Time | Single line text | `HH:MM` |
| Overdue Reminders | Single select: `off`, `daily`, `weekly` | |
| Status | Single select: `connected`, `needs_reconnect`, `error` | |
| Last Synced At | Single line text | ISO timestamp |
| Last Error | Long text | Plain-language message, never a token |

The Airtable token needs read and write access to this table (it already has
`data.records:read` and `data.records:write` on the base). `npm run airtable:inspect`
reports the table as optional until it exists.

### 3. Environment variables (Vercel → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Already set for sign-in |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`. Keep it stable: changing it means everyone reconnects. Use different values for Production and Preview. |
| `CRON_SECRET` | 16+ random characters (e.g. `openssl rand -base64 24`). Vercel sends it to the cron route automatically. |
| `APP_URL` | e.g. `https://nmu-onboarding.vercel.app`. Used for the redirect URI and the links in events. |
| `GOOGLE_ALLOWED_DOMAIN` | Optional. If set, only calendars from that Workspace domain can be connected. |

### 4. Scheduler: Vercel Cron

`vercel.json` runs `GET /api/cron/calendar-sync` daily at `0 13 * * *` (13:00 UTC,
which is 5 AM Pacific in winter and 6 AM in summer). On the Hobby plan Vercel
may run it any time within that hour, and allows only one run per day; both
are fine here. Cron jobs run only on **production** deployments. Vercel doesn't
retry a failed run, but the next day's run, task-change syncs and "Sync now"
cover it. Each run handles about 4 minutes' worth of users and leaves the rest
for the next run (`maxDuration` is 300 seconds).

To run it by hand (e.g. after deploying):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/calendar-sync
# → {"connections":3,"synced":3,"skipped":0,"needsReconnect":0,"errors":0,"deferred":0}
```

Hosting somewhere other than Vercel? Call that URL once a day from any
scheduler (GitHub Actions, cron-job.org…) with the same header.

## Local testing with your own Google Cloud project

Use this to try the real Google connection before NMU has a project. Any team
member can do it with a personal Google account.

1. At <https://console.cloud.google.com>, create a project (e.g. "NMU Onboarding Test").
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Google Auth Platform → Branding / Audience** (older menus: **OAuth consent screen**):
   - **User type: External.** Leave **Publishing status: Testing**. Don't
     publish: an unverified published app gets "Access blocked" for calendar
     access.
   - **Test users:** add every Gmail address that will click Connect.
   - **Data access / Scopes:** add `calendar.events.owned` and
     `calendar.calendarlist.readonly` (full URLs in [Setup](#1-google-cloud-same-project-and-oauth-client-as-sign-in)).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   choose **User data** if the wizard asks, then **Web application**. Leave
   JavaScript origins empty and add these **Authorized redirect URIs** exactly:
   ```
   http://localhost:3000/auth/google/callback
   http://localhost:3000/auth/google/calendar/callback
   ```
   Click **Save**. Changes can take about 5 minutes to apply.
5. Create `.env.local` in the project root. It is ignored by git, so never
   commit it or paste its values into chat or issues:
   ```
   DATA_BACKEND=memory
   ALLOW_DEV_SIGN_IN=true
   SESSION_SECRET=<any 32+ random characters>
   GOOGLE_CLIENT_ID=<…apps.googleusercontent.com>
   GOOGLE_CLIENT_SECRET=<GOCSPX-…>
   TOKEN_ENCRYPTION_KEY=<output of: openssl rand -base64 32>
   ```
   Don't copy `.env.example` as is: it sets `DATA_BACKEND=airtable`, which
   needs Airtable credentials.
6. Run `npm run dev` and open **http://localhost:3000**. Use `localhost`, not
   `127.0.0.1`: the app builds the redirect URI from the address bar.
7. Sign in with a **one-click sample account** (e.g. Sam Okafor, Staff). "Sign
   in with Google" only works for emails in the app's Users list, and your
   Gmail isn't a sample user. Then go to **Google Calendar → Connect**, choose
   your test Gmail, click **Continue** past "Google hasn't verified this app",
   and tick **both** calendar boxes.
8. Sam's sample deadlines appear in your Google Calendar as "NMU task: …"
   all-day events. Afterwards, use **Disconnect** with "remove the NMU events"
   ticked to clean up.

Limits of Testing mode: only listed test users can connect, the "unverified"
warning appears, and **refresh tokens expire after 7 days**, after which the
app shows "Needs reconnecting". The sample data and connections reset every
time the dev server restarts.

## Handing off to NMU

The student test project is **for testing only**. Before real staff use the
feature, NMU should own every account and secret. Nothing in the code changes:
only settings do.

### Decide first (with Catalina, Mary, or whoever manages NMU's accounts)

- [ ] Do staff use **Google Workspace** accounts (e.g. `name@nomoreunder.org` on Gmail)?
  If they use Microsoft 365, stop and revisit: Outlook calendars would need a different integration.
- [ ] Which NMU account will **own** the Google Cloud project? Ideally a shared
  admin account or at least two named staff, not one person who might leave.
- [ ] Where will the app be hosted? `vercel.json` assumes Vercel; see
  [Scheduler](#4-scheduler-vercel-cron) for other hosts.

### NMU's Google Cloud project

- [ ] Sign in to <https://console.cloud.google.com> **with the NMU account** and create a project (e.g. "NMU Onboarding").
- [ ] **IAM & Admin → IAM:** add a second NMU person as **Owner**. Optionally add
  students as **Editor** during the handoff, and remove them afterwards.
- [ ] Enable **Google Calendar API**.
- [ ] Consent screen: set **User type: Internal** (needs Google Workspace).
  Internal apps skip Google's verification and the 7-day token expiry, and
  only NMU accounts can connect. Add the app name, NMU logo, and support email,
  and add both calendar scopes.
- [ ] Create an **OAuth client (Web application)** with the production redirect URIs:
  ```
  https://<production-domain>/auth/google/callback
  https://<production-domain>/auth/google/calendar/callback
  ```
  Google doesn't accept wildcards, so each Vercel **preview** URL would need
  its own entry. Test on the production domain or one fixed preview domain
  instead.
- [ ] If NMU isn't on Google Workspace (External user type), the calendar scopes
  are "sensitive": Google's **app verification** (privacy policy, homepage,
  short video) is required before staff outside the test-user list can connect.
  Allow a few weeks.

### Deployment settings (Vercel → Settings → Environment Variables, Production)

- [ ] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: from **NMU's** client, never the student test client.
- [ ] `TOKEN_ENCRYPTION_KEY`: a **new** key (`openssl rand -base64 32`). Store a
  copy in NMU's password manager. Losing or changing it means everyone reconnects.
- [ ] `CRON_SECRET`: new random value, 16+ characters.
- [ ] `APP_URL`: the production URL, e.g. `https://onboarding.nomoreunder.org`.
- [ ] `GOOGLE_ALLOWED_DOMAIN`: NMU's Workspace domain, so only NMU accounts can sign in or connect.
- [ ] Airtable: add the **Calendar Connections** table ([Setup step 2](#2-airtable-add-the-calendar-connections-table))
  and restrict who can open it.
- [ ] Redeploy, then run the [checklist below](#what-is-tested-and-what-needs-real-credentials) on the production URL.

### Clean up the student test setup

- [ ] Students: **Disconnect** in the app (or remove access at <https://myaccount.google.com/permissions>).
- [ ] Delete the student test project's OAuth client, or the whole test project.
- [ ] Delete local `.env.local` files that hold old secrets.
- [ ] Remove student access to NMU's Google Cloud project, Vercel and Airtable when the handoff is complete.
- [ ] If any secret was ever shared outside NMU (chat, email, a commit), create a new one and update Vercel.

## Troubleshooting

| What you see | Why | Fix |
| --- | --- | --- |
| Settings page: "isn't set up on this server yet. Missing settings: …" | Those environment variables are empty on this server. Admins see the names; staff see "Ask an administrator". | Set them (`.env.local` locally, Vercel settings in production) and restart or redeploy. |
| Google: **Error 400: redirect_uri_mismatch** | The address the app sent isn't registered on **that** OAuth client. Click "see error details" to see the `redirect_uri` sent. | Add that exact URI to the client whose ID is in your settings, and check the project picker. Watch for `https`/`http`, a trailing `/`, or `127.0.0.1` vs `localhost`. Click **Save** and wait about 5 minutes. |
| Google: **Access blocked: … has not completed the Google verification process** | External app: the Google account isn't a **test user**, or the app was set to "In production" without verification. | Add the account under **Audience → Test users**, keep the status at **Testing**, and choose that exact account on Google's screen. |
| Google: "Google hasn't verified this app" with a **Continue** button | Normal for an External app in Testing mode. | Click **Continue**. NMU avoids this screen with an Internal app. |
| App: "Google Calendar wasn't connected because a permission was unticked" | One of the calendar boxes on Google's screen was left unticked. | Connect again and tick both boxes. |
| App: "Use your NMU Google account" | `GOOGLE_ALLOWED_DOMAIN` is set and a different account was chosen. | Choose the NMU account. |
| App: **Needs reconnecting** | Access was removed, the 7-day test-mode token expired, the password changed, or `TOKEN_ENCRYPTION_KEY` changed. | Click **Reconnect**. If it happens to everyone at once, check whether the key changed. |
| Connected, but no events appear | Google Calendar API isn't enabled, or the person has no open tasks with due dates in active programs. | Enable the API; check **Last synced** and any error on the settings page; press **Sync now**. |
| Settings page: Airtable table missing | The **Calendar Connections** table doesn't exist or its name differs from `schema.ts`. | Create it ([Setup step 2](#2-airtable-add-the-calendar-connections-table)) or edit `src/lib/airtable/schema.ts`. |
| Cron URL returns 401 or 503 | Wrong or missing `Authorization: Bearer <CRON_SECRET>` (401), or `CRON_SECRET` / Google settings not set (503). | Set `CRON_SECRET` in Vercel. Vercel sends the header automatically on production. |

## What is tested, and what needs real credentials

The automated tests (`tests/calendar-sync*.test.ts`) run the real sync code
against a **mock** Google API (`tests/fake-google.ts`) and the in-memory or
mock-Airtable store. They cover:

- no duplicates, including repeated, concurrent and hand-deleted events;
- updates and removals;
- per-role permissions;
- the overdue reminder not repeating;
- token refresh, revocation, retries and partial failures;
- encryption;
- cron authorization;
- Airtable storage.

They don't contact Google. Before relying on the feature, a teammate with the
Google Cloud project should do these by hand on a preview deployment:

1. Connect, then check the consent screen lists only the three items above.
2. Check events appear in Google Calendar with a 2-day reminder.
3. Change a due date and mark a task Done, and check Google Calendar follows.
4. Remove access at <https://myaccount.google.com/permissions> and press "Sync
   now". You should see "Needs reconnecting".
5. Call the cron URL with the secret, and without it (expect 401).
