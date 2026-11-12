# Google Sheets task export

## Staff workflow

1. Open **My Tasks**, choose a task scope (admins can choose Everyone's tasks), then apply filters and sorting.
2. Select **Export to Google Sheets**. Review the matching count and the first five rows.
3. Select **Authorize Google Sheets** and use the Google account matching your NMU user email.
4. On return, select **Create Google Sheet**. Wait for the success message, then open the sheet link.

Each export creates a new spreadsheet in that person's Google Drive; the app does not change sharing permissions. The page disables creation while pending and after success. Returning to the export page starts a new export. **Download CSV** uses the same permissions, filters, columns and sorting, and remains available when Google is not configured.

The export includes all matches, including tasks hidden inside collapsed dashboard sections. The spreadsheet is a flat table in the selected sort order; dashboard urgency sections are not exported as separate sheets. Clearing filters exports all tasks in the selected dashboard scope. Administrators also have an explicit **Export all authorized tasks with no filters** link. Like My Tasks, exports contain tasks from active programs; Completed/Cancelled programs are excluded. Staff cannot expand access by changing scope, assignee, project IDs or URLs.

Columns: Task Name, Program/Project, Assigned To, Status, Due Date, Days Overdue, Phase, Owner Role, Description, Notes, Document Links, Blocked. Dates use `YYYY-MM-DD` without timezone conversion. Days Overdue is zero for completed/not-needed tasks, undated tasks and future deadlines. The date comparison uses the app's Pacific calendar date. Missing text is blank. Hidden prerequisite titles and user credentials are never included.

The export is a snapshot when Create is clicked: data and authorization are reloaded then. It does not continuously sync with Airtable.

## Google Cloud setup

Use the existing NMU-owned Google Cloud project and OAuth web client used for sign-in. No service account or new database is required.

1. Enable **Google Sheets API** in Google Cloud → APIs & Services → Library.
2. In Google Auth Platform (OAuth consent), configure the app audience and add test users while the app is in Testing. Add the scope `https://www.googleapis.com/auth/drive.file` alongside identity scopes `openid` and `email`. Do not add full `drive` or `spreadsheets` access for this feature.
3. Under the existing Web application OAuth client, add exact authorized redirect URIs:
   - Local default: `http://localhost:3000/auth/google/sheets/callback`
   - This checkout's demo: `http://127.0.0.1:3100/auth/google/sheets/callback`
   - Production: `https://YOUR-NMU-HOST/auth/google/sheets/callback`
4. Configure server-only environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (32+ random characters), and `APP_URL` matching the actual origin. Preserve any existing `GOOGLE_ALLOWED_DOMAIN` restriction.
5. Ensure the user's Google email matches an active Admin or Staff row in Airtable Users. The app deliberately rejects exporting to a different Google identity.
6. Restart the local server or redeploy. Open the export page and authorize. For live local testing, use a test Airtable base and your registered Google identity; made-up memory-mode emails are not real Google accounts.
7. Verify with a small non-confidential test program: select a filter and sort, create a sheet, check columns/count/order, and verify Staff cannot export other people's tasks. Test cancellation and revocation too.

Google documents `drive.file` as the recommended per-file scope for this use case, and the spreadsheet create method accepts it:
- [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Create spreadsheet](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create)
- [Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)

## Implementation and security

- `src/lib/data/task-export.ts` loads authorized rows through `loadTasksInScope`, then calls the dashboard's `parseFilters`, `applyFilters`, and `sortRows`. No parallel export-only filter implementation.
- Page preview, CSV endpoint and Create action check roles on the server. Export operations reload the user's current record rather than trusting cached roles/assignments. Inputs contain filter state, never client-provided task records.
- Google authorization is separate from ordinary sign-in and Calendar authorization. It requests online access; no refresh token, background sync, new Airtable connection table, or broad Google scope is needed.
- OAuth uses a random state, PKCE verifier/challenge, initiating-user binding and a ten-minute expiry. The callback requires a verified matching email from Google's token endpoint, client audience, issuer, token expiry and configured domain.
- The short-lived access token is AES-256-GCM encrypted in an HttpOnly, SameSite=Lax cookie scoped to `/my-tasks/export` (Secure on HTTPS). The key is derived with purpose separation from the server session secret. It expires no later than the token, at most one hour. Token material never enters rendered HTML, client props, logs or the spreadsheet.
- Existing authorization can be removed in the user's Google Account connected-app settings. Authorization expiry/revocation prompts a new authorization; ordinary sign-in remains unchanged.
- Spreadsheet contents, frozen headers, filter row, column widths and formatting are sent in one `spreadsheets.create` request. Task text uses explicit `stringValue`, so text beginning with `=` is not evaluated as a formula. CSV also escapes formula-like text.
- A single export is bounded to 2 MB of API payload and 50,000 characters per cell. Large exports show an actionable message to narrow filters. They are not silently truncated.
- Create requests are not automatically retried because an uncertain response could otherwise produce duplicate files. On timeouts/5xx/malformed success responses, the UI tells the user to check Drive before retrying.

## Verification and troubleshooting

Automated tests cover filter combinations, all sort modes, empty/missing-date results, active-program scope, staff/partner/inactive/anonymous boundaries, role changes, CSV injection, OAuth state/PKCE/identity/scope rejection, encrypted grants, and Google API 400/401/403/429/5xx/network failures.

| Symptom | Check |
| --- | --- |
| Authorization button disabled | Set Google OAuth environment variables and restart/redeploy. |
| `redirect_uri_mismatch` | Match scheme, hostname, port and callback path exactly; `localhost` and `127.0.0.1` differ. |
| Use matching account | Google email must match the active app user. |
| Permission not granted | Authorize again and allow the requested per-file scope. |
| Google refused access | Check Sheets API enabled, account policy, user test allowlist and granted scope. |
| Authorization expired | Authorize again; short-lived grants are intentional. |
| Export too large | Narrow program/date filters. |
| Google did not confirm export | Check Google Drive before another attempt. |

Live Google creation and real Airtable access require configured credentials. This implementation was checked with automated Google/Airtable fakes and local browser flows; those do not replace the live acceptance check above.
