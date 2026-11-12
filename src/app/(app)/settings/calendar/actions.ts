"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { getSyncDeps } from "@/lib/calendar-sync";
import {
  calendarClientFor,
  forgetAccessToken,
  removeAppEvents,
  syncUserCalendar,
  type SyncResult,
} from "@/lib/calendar-sync/sync-service";
import {
  REMINDER_TIME_OPTIONS,
  cleanReminderDays,
  isValidReminderTime,
} from "@/lib/domain/calendar-sync";
import { OVERDUE_REMINDER_MODES, type OverdueReminderMode } from "@/lib/domain/types";
import { decryptToken } from "@/lib/google/token-crypto";

/**
 * Calendar settings. Every action acts ONLY on the signed-in person's own
 * connection (the user id comes from the session, never from the form).
 * Results are reported with fixed codes in the URL, never with free text.
 */

const PAGE = "/settings/calendar";

async function context() {
  const user = await requirePermission("calendar.sync");
  const deps = getSyncDeps();
  if (!deps) redirect(`${PAGE}?error=not-configured`);
  const conn = await deps.store.getCalendarConnection(user.id);
  if (!conn) redirect(`${PAGE}?error=not-connected`);
  return { user, deps, conn };
}

const resultQuery = (r: SyncResult) =>
  r.outcome === "synced"
    ? `synced=1&c=${r.created}&u=${r.updated}&d=${r.deleted}`
    : r.outcome === "needs_reconnect"
      ? "error=reconnect"
      : r.outcome === "skipped"
        ? "saved=1"
        : "error=sync-failed";

export async function saveCalendarSettings(formData: FormData): Promise<void> {
  const { user, deps, conn } = await context();

  const syncEnabled = formData.get("syncEnabled") === "on";
  const reminderDays = cleanReminderDays(formData.getAll("reminderDays"));
  const timeRaw = String(formData.get("reminderTime") ?? "");
  const reminderTime =
    isValidReminderTime(timeRaw) && (REMINDER_TIME_OPTIONS as readonly string[]).includes(timeRaw) ? timeRaw : conn.reminderTime;
  const overdueRaw = String(formData.get("overdueReminders") ?? "");
  const overdueReminders = (OVERDUE_REMINDER_MODES as readonly string[]).includes(overdueRaw)
    ? (overdueRaw as OverdueReminderMode)
    : conn.overdueReminders;
  const calendarId = String(formData.get("calendarId") ?? conn.calendarId) || conn.calendarId;

  let next = { ...conn, syncEnabled, reminderDays, reminderTime, overdueReminders };
  let warning = "";

  if (calendarId !== conn.calendarId) {
    // Only a calendar the person OWNS (as reported by Google just now) can be chosen.
    let chosen;
    try {
      chosen = (await calendarClientFor(conn, deps).listCalendars()).find((c) => c.id === calendarId && c.accessRole === "owner");
    } catch {
      redirect(`${PAGE}?error=calendars-unavailable`);
    }
    if (!chosen) redirect(`${PAGE}?error=bad-calendar`);
    // Move: take our events out of the old calendar first, so nothing is left behind.
    try {
      await removeAppEvents(conn, deps);
    } catch {
      warning = "&warn=old-calendar";
    }
    next = { ...next, calendarId: chosen.id, calendarName: chosen.summary, calendarTimeZone: chosen.timeZone || conn.calendarTimeZone };
  }

  if (conn.syncEnabled && !syncEnabled) {
    // Turning syncing off removes the NMU events, so nothing goes stale in the calendar.
    try {
      await removeAppEvents(next, deps);
    } catch {
      warning = "&warn=remove-failed";
    }
  }

  await deps.store.saveCalendarConnection(next);
  revalidatePath(PAGE);
  if (!syncEnabled) redirect(`${PAGE}?saved=1&off=1${warning}`);
  redirect(`${PAGE}?${resultQuery(await syncUserCalendar(user.id, deps))}${warning}`);
}

export async function syncNow(): Promise<void> {
  const { user, deps } = await context();
  const result = await syncUserCalendar(user.id, deps);
  revalidatePath(PAGE);
  redirect(`${PAGE}?${resultQuery(result)}`);
}

export async function disconnectCalendar(formData: FormData): Promise<void> {
  const { user, deps, conn } = await context();
  let warning = "";
  if (formData.get("removeEvents") === "on" && conn.status !== "needs_reconnect") {
    try {
      await removeAppEvents(conn, deps);
    } catch {
      warning = "&warn=remove-failed";
    }
  }
  // Revoke at Google too, so the stored token is useless even before it's deleted here.
  const refreshToken = decryptToken(conn.encryptedRefreshToken, deps.encryptionKey);
  if (refreshToken) await deps.oauth.revoke(refreshToken).catch(() => {});
  await deps.store.deleteCalendarConnection(user.id);
  forgetAccessToken(user.id);
  revalidatePath(PAGE);
  redirect(`${PAGE}?disconnected=1${warning}`);
}

