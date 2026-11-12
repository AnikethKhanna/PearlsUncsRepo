import { describe, expect, it, vi } from "vitest";
import { createTaskSpreadsheet, SHEETS_SCOPE, sheetsErrorMessage, spreadsheetBody } from "@/lib/google/sheets-api";
import { GoogleApiError, GoogleAuthRevokedError } from "@/lib/google/google-api";
const report = { title: "NMU tasks", headers: ["Task Name", "Days Overdue"], rows: [["=IMPORTXML(unsafe)", 3], ["Task two", 0]] };
describe("Google Sheets API", () => {
  it("creates data and readable formatting atomically with explicit literal values", async () => {
    const fetcher = vi.fn(async () => Response.json({ spreadsheetId: "sheet-123" }));
    expect(await createTaskSpreadsheet("secret-token", report, fetcher)).toEqual({ url: "https://docs.google.com/spreadsheets/d/sheet-123/edit", count: 2 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-token" });
    const body = JSON.parse(String(init.body));
    expect(body.sheets[0].properties.gridProperties.frozenRowCount).toBe(1);
    expect(body.sheets[0].data[0].rowData[1].values[0].userEnteredValue).toEqual({ stringValue: "=IMPORTXML(unsafe)" });
    expect(body.sheets[0].data[0].rowData[1].values[1].userEnteredValue).toEqual({ numberValue: 3 });
    expect(body.sheets[0].basicFilter.range.endRowIndex).toBe(3);
    expect(SHEETS_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });
  it.each([400, 403, 429, 500, 503])("reports HTTP %s without retrying a non-idempotent create or exposing Google's body", async (status) => {
    const fetcher = vi.fn(async () => Response.json({ error: "secret/credentials/task contents" }, { status }));
    let caught: unknown;
    try { await createTaskSpreadsheet("token", report, fetcher); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(GoogleApiError);
    expect(sheetsErrorMessage(caught)).not.toContain("secret/");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("asks to reauthorize on 401", async () => {
    await expect(createTaskSpreadsheet("token", report, async () => new Response(null, { status: 401 }))).rejects.toBeInstanceOf(GoogleAuthRevokedError);
  });
  it("handles network uncertainty without retrying and advises checking Drive", async () => {
    const fetcher = vi.fn(async () => { throw new Error("private request details"); });
    await expect(createTaskSpreadsheet("token", report, fetcher)).rejects.toThrow("Check your Google Drive");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not create empty or oversized sheets", async () => {
    const fetcher = vi.fn();
    await expect(createTaskSpreadsheet("token", { ...report, rows: [] }, fetcher)).rejects.toThrow("No tasks");
    expect(() => spreadsheetBody({ ...report, rows: [["x".repeat(50001)]] })).toThrow("cell limit");
    await expect(createTaskSpreadsheet("token", { ...report, rows: Array.from({ length: 100 }, () => ["x".repeat(30000)]) }, fetcher)).rejects.toThrow("too large");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not accept an invalid sheet id/URL returned by Google", async () => {
    await expect(createTaskSpreadsheet("token", report, async () => Response.json({ spreadsheetId: "https://evil.test" }))).rejects.toThrow("sheet link");
  });
});
