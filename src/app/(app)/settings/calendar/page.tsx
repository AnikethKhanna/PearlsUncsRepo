import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, PageHeader, buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getSyncDeps } from "@/lib/calendar-sync";
import { calendarClientFor } from "@/lib/calendar-sync/sync-service";
import { calendarSyncBlocker } from "@/lib/config";
import { getStore } from "@/lib/data";
import { StorageNotReadyError } from "@/lib/data/store";
import { REMINDER_DAY_OPTIONS, REMINDER_TIME_OPTIONS } from "@/lib/domain/calendar-sync";
import type { CalendarConnection } from "@/lib/domain/types";
import type { GoogleCalendarListEntry } from "@/lib/google/google-api";
import { disconnectCalendar, saveCalendarSettings, syncNow } from "./actions";

export const metadata: Metadata = { title: "Google Calendar" };

const ERRORS: Record<string, string> = {
  "not-configured": "Google Calendar sync hasn't been set up on this server yet.",
  "not-allowed": "Your account can't use Google Calendar sync.",
  "not-connected": "Connect Google Calendar first.",
  denied: "Google Calendar wasn't connected (the request was cancelled on Google's page).",
  failed: "Connecting to Google didn't work. Please try again.",
  "missing-permission":
    "Google Calendar wasn't connected because a permission was unticked. Connect again and allow both calendar permissions.",
  "wrong-domain": "Use your NMU Google account to connect a calendar.",
  storage: "The connection couldn't be saved. Ask an administrator to check the Calendar Connections table.",
  reconnect: "Google access was revoked or has expired. Reconnect Google Calendar to resume syncing.",
  "sync-failed": "Some events couldn't be synced. See the details below; the next sync will try again.",
  "calendars-unavailable": "Couldn't load your calendars from Google. Please try again.",
  "bad-calendar": "That calendar can't be used. Choose one of your own calendars.",
};
const WARNINGS: Record<string, string> = {
  "old-calendar": "Some NMU events may still be in your previous calendar; you can delete them there.",
  "remove-failed": "Some NMU events couldn't be removed from Google Calendar; you can delete them there.",
};

export default async function CalendarSettingsPage({ searchParams }: PageProps<"/settings/calendar">) {
  const user = await requireUser();
  const q = await searchParams;
  const param = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const count = (k: string) => Math.max(0, Math.min(99999, Number.parseInt(param(k), 10) || 0));

  const header = (
    <PageHeader
      title="Google Calendar"
      description="Optional: put the deadlines of tasks assigned to you in your own Google Calendar, with reminders."
      actions={
        <Link href="/calendar" className={buttonSecondary}>
          In-app calendar
        </Link>
      }
    />
  );

  if (!can(user, "calendar.sync"))
    return (
      <>
        {header}
        <Alert tone="info">Your account can&apos;t use Google Calendar sync.</Alert>
      </>
    );

  const blocker = calendarSyncBlocker();
  if (blocker)
    return (
      <>
        {header}
        <Alert tone="warning">
          Google Calendar sync isn&apos;t set up on this server yet.
          {can(user, "admin.manage") ? <> Missing settings: {blocker}. See docs/google-calendar.md.</> : " Ask an administrator."}
        </Alert>
      </>
    );

  let conn: CalendarConnection | null = null;
  let storageProblem = "";
  try {
    conn = await getStore().getCalendarConnection(user.id);
  } catch (err) {
    storageProblem = err instanceof StorageNotReadyError && can(user, "admin.manage") ? err.message : "Calendar settings can't be loaded right now.";
  }

  // Live list of the person's own calendars (only if the connection works).
  let calendars: GoogleCalendarListEntry[] | null = null;
  const deps = getSyncDeps();
  if (conn && deps && conn.status !== "needs_reconnect") {
    try {
      calendars = await calendarClientFor(conn, deps).listCalendars();
    } catch {
      calendars = null;
    }
  }

  return (
    <>
      {header}
      <div className="space-y-4">
        {param("connected") && <Alert tone="success">Google Calendar connected. Your task deadlines are being added now.</Alert>}
        {param("disconnected") && <Alert tone="success">Google Calendar disconnected and access revoked.</Alert>}
        {param("synced") && (
          <Alert tone="success">
            Synced: {count("c")} added, {count("u")} updated, {count("d")} removed.
          </Alert>
        )}
        {param("saved") && (
          <Alert tone="success">Settings saved{param("off") ? ". Syncing is off and NMU events were removed from your calendar" : ""}.</Alert>
        )}
        {ERRORS[param("error")] && <Alert tone="error">{ERRORS[param("error")]}</Alert>}
        {WARNINGS[param("warn")] && <Alert tone="warning">{WARNINGS[param("warn")]}</Alert>}
        {storageProblem && <Alert tone="error">{storageProblem}</Alert>}

        {!storageProblem && !conn && <ConnectCard />}
        {conn && <ConnectedCard conn={conn} calendars={calendars} />}
      </div>
    </>
  );
}

function ConnectCard() {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-slate-900">Connect Google Calendar</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>Each task assigned to you gets an all-day event on its due date, with a reminder 2 days before (you can change this).</li>
        <li>Events update when a task&apos;s date, people or status changes, and disappear when it&apos;s done.</li>
        <li>If tasks become overdue, you get one short reminder a week (or daily, or never; your choice), not a message per task.</li>
        <li>Only your own tasks are synced. Nobody else can see or change your calendar through this app.</li>
      </ul>
      <p className="mt-3 text-sm text-slate-600">
        Google will ask to let NMU Onboarding see your email address, see the list of your calendars, and manage events on calendars you own.
        It can&apos;t see or change calendars shared with you. You can disconnect at any time.
      </p>
      {/* A plain link: this starts a redirect to Google, so it must not be prefetched. */}
      <a href="/auth/google/calendar" className={`${buttonPrimary} mt-4`}>
        Connect Google Calendar
      </a>
    </Card>
  );
}

function ConnectedCard({ conn, calendars }: { conn: CalendarConnection; calendars: GoogleCalendarListEntry[] | null }) {
  const needsReconnect = conn.status === "needs_reconnect";
  const lastSynced = conn.lastSyncedAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: conn.calendarTimeZone }).format(new Date(conn.lastSyncedAt))
    : "Not yet";
  const options = calendars ?? [{ id: conn.calendarId, summary: conn.calendarName, accessRole: "owner" as const }];
  return (
    <>
      <Card className="p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Google account">{conn.googleEmail || "Connected"}</Row>
            <Row label="Calendar">{conn.calendarName || conn.calendarId}</Row>
            <Row label="Status">
              {needsReconnect ? (
                <span className="font-semibold text-red-700">Needs reconnecting</span>
              ) : !conn.syncEnabled ? (
                "Syncing is off"
              ) : conn.status === "error" ? (
                <span className="font-semibold text-amber-800">Last sync had problems</span>
              ) : (
                <span className="font-semibold text-green-800">Syncing</span>
              )}
            </Row>
            <Row label="Last synced">{lastSynced}</Row>
          </dl>
          <div className="flex flex-wrap gap-2">
            {needsReconnect ? (
              <a href="/auth/google/calendar" className={buttonPrimary}>
                Reconnect Google Calendar
              </a>
            ) : (
              conn.syncEnabled && (
                <form action={syncNow}>
                  <button type="submit" className={buttonSecondary}>
                    Sync now
                  </button>
                </form>
              )
            )}
          </div>
        </div>
        {conn.lastError && (
          <div className="mt-4">
            <Alert tone={needsReconnect ? "error" : "warning"}>{conn.lastError}</Alert>
          </div>
        )}
      </Card>

      {!needsReconnect && (
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Settings</h2>
          <form action={saveCalendarSettings} className="space-y-5">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="syncEnabled" defaultChecked={conn.syncEnabled} className="mt-0.5 h-4 w-4" />
              <span>
                <span className="font-medium text-slate-900">Sync my task deadlines to Google Calendar</span>
                <span className="block text-slate-600">Turning this off removes the NMU events from your calendar.</span>
              </span>
            </label>

            <div>
              <label htmlFor="calendarId" className={labelClass}>
                Calendar
              </label>
              <select id="calendarId" name="calendarId" defaultValue={conn.calendarId} className={`${inputClass} mt-1 max-w-md`}>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.primary ? `${c.summary} (main calendar)` : c.summary}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600">
                {calendars ? "Only calendars you own are listed. Switching moves the NMU events." : "Couldn't load your calendar list from Google right now."}
              </p>
            </div>

            <fieldset>
              <legend className={labelClass}>Remind me before each deadline</legend>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                {REMINDER_DAY_OPTIONS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5">
                    <input type="checkbox" name="reminderDays" value={d} defaultChecked={conn.reminderDays.includes(d)} className="h-4 w-4" />
                    {d === 1 ? "1 day before" : `${d} days before`}
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                at
                <select name="reminderTime" defaultValue={conn.reminderTime} className={`${inputClass} w-auto`}>
                  {REMINDER_TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`2000-01-01T${t}:00Z`))}
                    </option>
                  ))}
                </select>
                <span className="text-slate-600">({conn.calendarTimeZone.replace(/_/g, " ")} time)</span>
              </label>
              <p className="mt-1 text-xs text-slate-600">Google shows these as pop-up notifications. Untick all for no deadline reminders.</p>
            </fieldset>

            <fieldset>
              <legend className={labelClass}>Overdue tasks reminder</legend>
              <div className="mt-2 space-y-1.5 text-sm">
                {(
                  [
                    ["weekly", "Weekly, on Mondays (recommended)"],
                    ["daily", "Every day while something is overdue"],
                    ["off", "Off"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="radio" name="overdueReminders" value={value} defaultChecked={conn.overdueReminders === value} className="h-4 w-4" />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                One short event listing all your overdue tasks, at the reminder time above. It never creates one event per task.
              </p>
            </fieldset>

            <button type="submit" className={buttonPrimary}>
              Save settings
            </button>
          </form>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-slate-900">Disconnect</h2>
        <form action={disconnectCalendar} className="mt-3 space-y-3">
          {!needsReconnect && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="removeEvents" defaultChecked className="h-4 w-4" />
              Also remove the NMU events from my Google Calendar
            </label>
          )}
          <button type="submit" className={`${buttonSecondary} text-red-700`}>
            Disconnect Google Calendar
          </button>
        </form>
      </Card>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}
