"use client";
import { useActionState } from "react";
import { Alert, buttonPrimary, buttonSecondary } from "@/components/ui";
import { authorizeSheets, exportToSheets } from "./actions";

export function ExportForm({ query, count, configured, connectedEmail }: { query: string; count: number; configured: boolean; connectedEmail?: string }) {
  const [auth, authAction, authorizing] = useActionState(authorizeSheets, {});
  const [result, exportAction, exporting] = useActionState(exportToSheets, {});
  const pending = authorizing || exporting;
  return <div className="space-y-4" aria-busy={pending}>
    {auth.error && <Alert tone="error">{auth.error}</Alert>}
    {result.error && <Alert tone="error">{result.error}</Alert>}
    {result.url && <Alert tone="success">
      <p>Created a Google Sheet with {result.count} tasks.</p>
      <a href={result.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold underline">Open your Google Sheet (new tab)</a>
    </Alert>}
    {connectedEmail && !result.authorizeAgain && <p className="text-sm text-slate-600">Creating in {connectedEmail}&apos;s Google Drive.</p>}
    <div className="flex flex-wrap items-center gap-3">
      {connectedEmail && !result.authorizeAgain ? <form action={exportAction}>
        <input type="hidden" name="query" value={query} />
        <button className={buttonPrimary} disabled={pending || count === 0 || !!result.url}>
          {exporting ? "Creating your sheet…" : result.url ? "Sheet created" : "Create Google Sheet"}
        </button>
      </form> : <form action={authAction}>
        <input type="hidden" name="query" value={query} />
        <button className={buttonPrimary} disabled={pending || !configured || count === 0}>
          {authorizing ? "Opening Google authorization…" : "Authorize Google Sheets"}
        </button>
      </form>}
      <a href={`/api/tasks/export/csv${query}`} className={buttonSecondary}>Download CSV</a>
    </div>
    <p className="text-sm text-slate-600" role="status" aria-live="polite">
      {exporting ? "Please wait while your sheet is created." : authorizing ? "Continue in Google, then return here to create your sheet." : "Creates a new, private spreadsheet. Sharing stays under your control in Google Sheets."}
    </p>
  </div>;
}
