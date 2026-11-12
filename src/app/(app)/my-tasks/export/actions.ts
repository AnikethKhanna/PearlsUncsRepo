"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getAppUrl, getGoogleOAuthConfig, getSessionSecret } from "@/lib/config";
import { getStore } from "@/lib/data";
import { loadTaskExport } from "@/lib/data/task-export";
import { today } from "@/lib/domain/dates";
import { filtersToQuery, parseFilters } from "@/lib/domain/task-dashboard";
import { GoogleAuthRevokedError } from "@/lib/google/google-api";
import { createTaskSpreadsheet, SHEETS_SCOPE, sheetsErrorMessage } from "@/lib/google/sheets-api";
import { newSheetsState, pkceChallenge, readSheetsCookie, sealSheetsCookie, SHEETS_AUTH_PATH, SHEETS_EXPORT_PATH, SHEETS_STATE_COOKIE, SHEETS_TOKEN_COOKIE, type SheetsGrant } from "@/lib/google/sheets-session";

export interface ExportState { error?: string; url?: string; count?: number; authorizeAgain?: boolean }

export async function authorizeSheets(_previous: ExportState, form: FormData): Promise<ExportState> {
  const user = await getCurrentUser();
  if (!user || !can(user, "task.export")) return { error: "You do not have permission to export tasks." };
  const google = getGoogleOAuthConfig();
  if (!google) return { error: "Google Sheets authorization has not been configured. Ask an administrator to complete setup." };
  const query = filtersToQuery(parseFilters(Object.fromEntries(new URLSearchParams(String(form.get("query") ?? ""))), { canSeeEveryone: can(user, "task.viewAll") }));
  if (query.length > 1500) return { error: "The filter link is too long. Reset the dashboard filters and try again." };
  const state = newSheetsState(user.id, query);
  const origin = getAppUrl() ?? (await headers()).get("origin");
  if (!origin) return { error: "The application URL is not configured. Contact an administrator." };
  const secure = new URL(origin).protocol === "https:";
  (await cookies()).set(SHEETS_STATE_COOKIE, sealSheetsCookie(state, getSessionSecret(), "state"), {
    httpOnly: true, secure, sameSite: "lax", path: SHEETS_AUTH_PATH, maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: google.clientId, redirect_uri: `${origin.replace(/\/$/, "")}${SHEETS_AUTH_PATH}/callback`,
    response_type: "code", scope: `openid email ${SHEETS_SCOPE}`, state: state.nonce,
    access_type: "online", prompt: "select_account", login_hint: user.email,
    code_challenge: pkceChallenge(state.verifier), code_challenge_method: "S256",
  });
  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export async function exportToSheets(_previous: ExportState, form: FormData): Promise<ExportState> {
  try {
    const user = await getCurrentUser();
    if (!user || !can(user, "task.export")) return { error: "You do not have permission to export tasks." };
    // Fresh membership/role lookup at the point of export (not just the session cache).
    const current = await getStore().getUser(user.id);
    if (!current || !can(current, "task.export")) return { error: "Your access changed. Sign in again." };
    const jar = await cookies();
    const grant = readSheetsCookie<SheetsGrant>(jar.get(SHEETS_TOKEN_COOKIE)?.value, getSessionSecret(), "grant", current.id);
    if (!grant || grant.email.toLowerCase() !== current.email.toLowerCase())
      return { error: "Authorize your Google account to create a sheet.", authorizeAgain: true };
    const { report } = await loadTaskExport(getStore(), current, String(form.get("query") ?? ""), today());
    try { return await createTaskSpreadsheet(grant.accessToken, report); }
    catch (error) {
      if (error instanceof GoogleAuthRevokedError) {
        jar.delete({ name: SHEETS_TOKEN_COOKIE, path: SHEETS_EXPORT_PATH });
        return { error: sheetsErrorMessage(error), authorizeAgain: true };
      }
      return { error: sheetsErrorMessage(error) };
    }
  } catch { return { error: "Could not load your tasks. Please try again." }; }
}
