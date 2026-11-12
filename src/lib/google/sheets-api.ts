import type { TaskExport } from "@/lib/data/task-export";
import { GoogleApiError, GoogleAuthRevokedError, type FetchLike } from "./google-api";

// Per-file access: no broad spreadsheets/Drive or Calendar permission.
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";

export class SheetsExportError extends Error {}

export function spreadsheetBody(report: TaskExport) {
  const values = [report.headers, ...report.rows];
  if (values.some((row) => row.some((v) => typeof v === "string" && v.length > 50000)))
    throw new SheetsExportError("A task detail exceeds Google Sheets’ cell limit. Shorten it or export fewer tasks.");
  return {
    properties: { title: report.title, locale: "en_US", timeZone: "America/Los_Angeles" },
    sheets: [{
      properties: { sheetId: 0, title: "Tasks", gridProperties: { rowCount: Math.max(2, values.length), columnCount: report.headers.length, frozenRowCount: 1 } },
      basicFilter: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: report.headers.length } },
      data: [{
        startRow: 0, startColumn: 0,
        columnMetadata: report.headers.map((_, i) => ({ pixelSize: [0, 1, 8, 9, 10].includes(i) ? 300 : 160 })),
        rowData: values.map((row, index) => ({ values: row.map((v) => ({
          // Explicit stringValue prevents formulas from task text being evaluated.
          userEnteredValue: typeof v === "number" ? { numberValue: v } : { stringValue: v },
          userEnteredFormat: {
            wrapStrategy: "WRAP", verticalAlignment: "TOP",
            textFormat: { fontFamily: "Arial", fontSize: 11, bold: index === 0,
              foregroundColor: index === 0 ? { red: 1, green: 1, blue: 1 } : { red: 0.08, green: 0.09, blue: 0.12 } },
            backgroundColor: index === 0 ? { red: 0.03, green: 0.05, blue: 0.22 }
              : index % 2 === 0 ? { red: 0.95, green: 0.98, blue: 1 } : { red: 1, green: 1, blue: 1 },
          },
        })) })),
      }],
    }],
  };
}

/** Creates contents and formatting in ONE request; no empty-sheet/partial-write state. */
export async function createTaskSpreadsheet(accessToken: string, report: TaskExport, fetchImpl: FetchLike = fetch) {
  if (!report.rows.length) throw new SheetsExportError("No tasks match this view. Change the dashboard filters and try again.");
  const body = JSON.stringify(spreadsheetBody(report));
  if (Buffer.byteLength(body, "utf8") > 2_000_000)
    throw new SheetsExportError("This export is too large for one request. Filter by program or date and try again.");
  let response: Response;
  try {
    response = await fetchImpl("https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body, cache: "no-store", signal: AbortSignal.timeout(30000),
    });
  } catch {
    // Creation isn't idempotent: retrying automatically can create duplicate files.
    throw new SheetsExportError("Google did not confirm the export. Check your Google Drive for the sheet before trying again.");
  }
  if (response.status === 401) throw new GoogleAuthRevokedError();
  if (!response.ok) throw new GoogleApiError("Google Sheets export failed.", response.status);
  const result = await response.json().catch(() => null) as { spreadsheetId?: string } | null;
  if (!result?.spreadsheetId || !/^[A-Za-z0-9_-]+$/.test(result.spreadsheetId))
    throw new SheetsExportError("Google did not return a sheet link. Check your Google Drive before trying again.");
  return { url: `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`, count: report.rows.length };
}

export function sheetsErrorMessage(error: unknown): string {
  if (error instanceof SheetsExportError) return error.message;
  if (error instanceof GoogleAuthRevokedError) return "Google authorization expired or was revoked. Authorize Google Sheets again.";
  if (error instanceof GoogleApiError) {
    if (error.status === 403) return "Google refused access. Authorize Google Sheets again; if this continues, ask an admin to check the Sheets API and account permissions.";
    if (error.status === 429) return "Google’s export quota is temporarily full. Wait a moment before trying again.";
    if (error.status >= 500) return "Google could not confirm the export. Check your Drive for the sheet before trying again.";
  }
  return "The export could not be completed. Please try again. If it continues, contact an administrator.";
}
