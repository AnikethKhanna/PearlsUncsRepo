import { can } from "@/lib/auth/permissions";
import { applyFilters, parseFilters, sortRows } from "@/lib/domain/task-dashboard";
import { isOverdue } from "@/lib/domain/task-state";
import type { User } from "@/lib/domain/types";
import type { DataStore } from "./store";
import { loadTasksInScope } from "./task-scope";

export class ExportAccessError extends Error {}
export const EXPORT_HEADERS = [
  "Task Name", "Program/Project", "Assigned To", "Status", "Due Date", "Days Overdue",
  "Phase", "Owner Role", "Description", "Notes", "Document Links", "Blocked",
];
export type ExportCell = string | number;
export interface TaskExport {
  title: string;
  headers: string[];
  rows: ExportCell[][];
}

/** The same authorization, filters and sort as My Tasks. Never accepts task rows/IDs from the browser. */
export async function loadTaskExport(store: DataStore, user: User | null, query: string, todayIso: string) {
  if (!user || !can(user, "task.export")) throw new ExportAccessError("You do not have permission to export tasks.");
  const filters = parseFilters(Object.fromEntries(new URLSearchParams(query)), { canSeeEveryone: can(user, "task.viewAll") });
  const scoped = await loadTasksInScope(store, user, filters.scope);
  const rows = sortRows(applyFilters(scoped.rows, filters, todayIso), filters.sort);
  const report: TaskExport = {
    title: `No More Under — ${filters.scope === "all" ? "Team tasks" : "My tasks"} — ${todayIso}`,
    headers: [...EXPORT_HEADERS],
    rows: rows.map(({ task: t, projectName, assigneeNames, blocked }) => [
      t.title, projectName, assigneeNames.join(", "), t.status, t.dueDate ?? "",
      isOverdue(t, todayIso) ? Math.round((Date.parse(todayIso + "T00:00:00Z") - Date.parse(t.dueDate + "T00:00:00Z")) / 86400000) : 0,
      t.phase, t.ownerRole, t.description, t.notes, t.documentLinks.join("\n"), blocked ? "Yes" : "No",
    ]),
  };
  // Do not export prerequisite titles from scoped.byId: staff may not be allowed to see them.
  return { report, filters };
}

/** RFC 4180 quoting plus formula-injection protection for spreadsheet programs. */
export function taskExportCsv(report: TaskExport): string {
  const cell = (v: ExportCell) => {
    let s = String(v);
    if (typeof v === "string" && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return "\uFEFF" + [report.headers, ...report.rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
