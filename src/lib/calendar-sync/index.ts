import "server-only";
import { after } from "next/server";
import { getAppUrl, getGoogleOAuthConfig, getTokenEncryptionKey } from "@/lib/config";
import { getStore } from "@/lib/data";
import { GoogleOAuth } from "@/lib/google/google-api";
import { syncCalendarsForUsers, type SyncDeps } from "./sync-service";

/** Real dependencies from server environment variables, or null if Calendar sync isn't configured. */
export function getSyncDeps(): SyncDeps | null {
  const google = getGoogleOAuthConfig();
  let key: Buffer | null = null;
  try {
    key = getTokenEncryptionKey();
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Invalid TOKEN_ENCRYPTION_KEY");
  }
  if (!google || !key) return null;
  return {
    store: getStore(),
    oauth: new GoogleOAuth({ clientId: google.clientId, clientSecret: google.clientSecret }),
    encryptionKey: key,
    appUrl: getAppUrl(),
  };
}

/**
 * After a task change, update the affected people's Google Calendars once the
 * response has been sent (so saving never waits on Google). The daily cron run
 * catches anything this misses.
 */
export function queueCalendarSync(userIds: string[]): void {
  const deps = getSyncDeps();
  if (!deps || userIds.length === 0) return;
  after(() =>
    syncCalendarsForUsers([...new Set(userIds)], deps).catch((err) =>
      console.error("Calendar sync after a task change failed:", err instanceof Error ? err.name : "unknown"),
    ),
  );
}
