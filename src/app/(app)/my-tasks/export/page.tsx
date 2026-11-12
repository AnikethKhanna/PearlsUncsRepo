import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Alert, Card, PageHeader, buttonSecondary } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getGoogleOAuthConfig, getSessionSecret } from "@/lib/config";
import { getStore } from "@/lib/data";
import { loadTaskExport } from "@/lib/data/task-export";
import { today } from "@/lib/domain/dates";
import { DEFAULT_FILTERS, filtersToQuery, LABELS } from "@/lib/domain/task-dashboard";
import { readSheetsCookie, SHEETS_TOKEN_COOKIE, type SheetsGrant } from "@/lib/google/sheets-session";
import { ExportForm } from "./export-form";

export const metadata = { title: "Export to Google Sheets" };
const errors: Record<string, string> = {
  denied: "Google authorization was cancelled. Your tasks have not been exported.",
  state: "This authorization request expired or was not valid. Please start again.",
  permission: "Google Sheets permission was not granted. Authorize again and allow access to files created by this app.",
  account: "Use the Google account matching your NMU sign-in email.",
  configuration: "Google authorization is not configured. Ask an administrator to complete setup.",
  failed: "Could not complete Google authorization. Please try again.",
  "not-allowed": "You do not have permission to export tasks.",
};
export default async function ExportPage({ searchParams }: PageProps<"/my-tasks/export">) {
  const sessionUser = await requireUser();
  const user = await getStore().getUser(sessionUser.id);
  if (!user || !can(user, "task.export")) notFound();
  const params = await searchParams;
  const queryString = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => typeof v === "string" ? [[k, v]] : Array.isArray(v) ? [[k, v[0]]] : [])).toString();
  const { report, filters } = await loadTaskExport(getStore(), user, queryString, today());
  const query = filtersToQuery(filters);
  const grant = readSheetsCookie<SheetsGrant>((await cookies()).get(SHEETS_TOKEN_COOKIE)?.value, getSessionSecret(), "grant", user.id);
  const configured = !!getGoogleOAuthConfig();
  return <>
    <PageHeader title="Export to Google Sheets" description="Take your current task view into a new spreadsheet." actions={<Link href={`/my-tasks${query}`} className={buttonSecondary}>Back to tasks</Link>} />
    <div className="space-y-5">
      {typeof params.error === "string" && errors[params.error] && <Alert tone="error">{errors[params.error]}</Alert>}
      {!configured && <Alert tone="warning">Google Sheets export is not set up yet. Ask an administrator to enable it. You can download this same view as a CSV in the meantime.</Alert>}
      <Card className="space-y-5 p-6">
        <div><h2 className="text-lg font-semibold">{report.rows.length} matching tasks</h2>
          <p className="mt-1 text-sm text-slate-600">{filters.scope === "all" ? "Everyone’s authorized tasks" : "Your assigned tasks"} in active programs · {LABELS.sort[filters.sort]}. Includes matching tasks in collapsed sections.</p>
          <p className="mt-1 text-sm text-slate-600">Dates use YYYY-MM-DD. Task data and access are checked again when you create the sheet.</p>
        </div>
        {can(user, "task.viewAll") && <p className="text-sm"><Link href={`/my-tasks/export${filtersToQuery({ ...DEFAULT_FILTERS, scope: "all" })}`} className="font-semibold text-brand-700 underline">Export all authorized tasks with no filters</Link></p>}
        {report.rows.length === 0 && <Alert tone="info">No tasks match this view. Return to the dashboard to adjust your filters.</Alert>}
        <ExportForm key={query} query={query} count={report.rows.length} configured={configured} connectedEmail={grant?.email} />
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Preview</h2><p className="text-sm text-slate-600">First five tasks. The spreadsheet includes all {report.rows.length} matches and their available details.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">Preview of the task export in the selected sort order</caption>
          <thead className="bg-slate-50"><tr>{report.headers.slice(0, 6).map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{report.rows.slice(0, 5).map((row, i) => <tr key={i} className="border-t border-slate-200">{row.slice(0, 6).map((v, c) => <td key={c} className="px-4 py-3">{v === "" ? "—" : v}</td>)}</tr>)}</tbody>
        </table></div>
      </Card>
    </div>
  </>;
}
