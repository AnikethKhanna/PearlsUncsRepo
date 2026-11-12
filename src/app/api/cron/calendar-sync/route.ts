import { NextResponse, type NextRequest } from "next/server";
import { getSyncDeps } from "@/lib/calendar-sync";
import { isAuthorizedCronRequest } from "@/lib/calendar-sync/cron-auth";
import { syncAllCalendars } from "@/lib/calendar-sync/sync-service";
import { getCronSecret } from "@/lib/config";

/** Up to 5 minutes for the daily run (Vercel's limit for this plan applies). */
export const maxDuration = 300;

/**
 * Daily job (Vercel Cron, see vercel.json): re-sync every connected calendar
 * and place the deduplicated overdue reminder. Safe to run more than once:
 * event ids are fixed per task, so a repeat run changes nothing.
 * Protected by CRON_SECRET (Vercel sends "Authorization: Bearer <CRON_SECRET>").
 */
export async function GET(request: NextRequest) {
  const secret = getCronSecret();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deps = getSyncDeps();
  if (!deps) return NextResponse.json({ error: "Google Calendar sync is not configured" }, { status: 503 });
  try {
    // Counts only: no names, tasks or tokens in the response or logs.
    return NextResponse.json(await syncAllCalendars(deps, { timeBudgetMs: 240_000 }));
  } catch (err) {
    console.error("Daily calendar sync failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
