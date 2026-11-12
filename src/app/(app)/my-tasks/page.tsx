import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { TaskStatusForm } from "@/components/task-status-form";
import { requireUser } from "@/lib/auth/current-user";
import { ACCESS_SUMMARY, can, canUpdateTask, canViewProject, canViewTask } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { formatDisplayDate, today } from "@/lib/domain/dates";
import {
  DUE_FILTERS,
  LABELS,
  SORTS,
  STATUS_FILTERS,
  activeFilterChips,
  applyFilters,
  buildSections,
  filtersToQuery,
  parseFilters,
  sortRows,
  summarize,
  type DashboardFilters,
  type DashboardRow,
  type Section,
} from "@/lib/domain/task-dashboard";
import { isComplete, isOverdue, openPrerequisites } from "@/lib/domain/task-state";
import type { Project, Task } from "@/lib/domain/types";
import { FilterBar } from "./filter-bar";

export const metadata: Metadata = { title: "My Tasks" };

/** Rows shown per section before "Show N more", to keep sections short. */
const ROWS_BEFORE_MORE = 5;

/**
 * Task dashboard (Feature B, redesigned from sponsor feedback): summary tiles,
 * collapsible sections by urgency, and filters/sorting kept in the URL.
 * Staff only ever get their own tasks; admins can switch to everyone's tasks.
 */
export default async function MyTasksPage({ searchParams }: PageProps<"/my-tasks">) {
  const user = await requireUser();
  const store = getStore();
  const canSeeEveryone = can(user, "task.viewAll");
  const f = parseFilters(await searchParams, { canSeeEveryone });

  // ---- Load only what this person may see (same store + permission checks as everywhere else) ----
  const projects = (await store.listProjects()).filter(
    (p) => canViewProject(user, p) && p.status !== "Completed" && p.status !== "Cancelled",
  );
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskIds = f.scope === "all" ? projects.flatMap((p) => p.taskIds) : user.assignedTaskIds;
  const tasks = (await store.getTasksByIds(taskIds)).filter((t) => {
    const project = t.projectId ? projectById.get(t.projectId) : undefined;
    if (!project || !canViewTask(user, project, t)) return false;
    return f.scope === "all" || t.assigneeIds.includes(user.id);
  });
  const [prereqs, users] = await Promise.all([
    store.getTasksByIds(tasks.flatMap((t) => t.dependsOnTaskIds).filter((id) => !tasks.some((t) => t.id === id))),
    store.listUsers(),
  ]);
  const byId = new Map([...tasks, ...prereqs].map((t) => [t.id, t]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const now = today();
  const allRows: DashboardRow[] = tasks.map((t) => ({
    task: t,
    projectName: projectById.get(t.projectId!)!.name,
    blocked: !isComplete(t) && openPrerequisites(t, byId).length > 0,
    assigneeNames: t.assigneeIds.map((id) => userName.get(id) ?? "Unknown"),
  }));
  const summary = summarize(allRows, now);
  const shown = sortRows(applyFilters(allRows, f, now), f.sort);
  const sections = buildSections(shown, now);

  const projectsInScope = projects.filter((p) => tasks.some((t) => t.projectId === p.id));
  const chips = activeFilterChips(f, {
    project: (id) => projectById.get(id)?.name ?? "Unknown program",
    user: (id) => userName.get(id) ?? "Unknown",
  });
  const resetHref = `/my-tasks${filtersToQuery({ ...f, project: "all", status: "all", due: "any", assignee: "all", q: "" })}`;
  const tile = (key: "status" | "due", value: string): string =>
    `/my-tasks${filtersToQuery(f, { [key]: f[key] === value ? (key === "status" ? "all" : "any") : value } as Partial<DashboardFilters>)}`;

  return (
    <>
      <PageHeader
        title={f.scope === "all" ? "Everyone's tasks" : "My Tasks"}
        description={`Signed in as ${user.name} (${user.accessLevel}): ${ACCESS_SUMMARY[user.accessLevel]}`}
      />

      {canSeeEveryone && (
        <nav
          aria-label="Whose tasks"
          className="mb-5 inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm font-medium"
        >
          {(["mine", "all"] as const).map((scope) => (
            <Link
              key={scope}
              href={`/my-tasks${filtersToQuery({ ...f, scope, assignee: "all" })}`}
              aria-current={f.scope === scope ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${f.scope === scope ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {scope === "mine" ? "My tasks" : "Everyone's tasks"}
            </Link>
          ))}
        </nav>
      )}

      {/* Summary tiles: totals for the whole view (not affected by filters). Click one to filter by it. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href={tile("status", "open")} active={f.status === "open"} label="Open tasks" value={summary.open} />
        <Tile
          href={tile("due", "overdue")}
          active={f.due === "overdue"}
          label="Overdue"
          value={summary.overdue}
          tone="red"
        />
        <Tile
          href={tile("due", "next7")}
          active={f.due === "next7"}
          label="Due in 7 days"
          value={summary.dueSoon}
          tone="amber"
        />
        <Tile
          href={tile("status", "blocked")}
          active={f.status === "blocked"}
          label="Blocked"
          value={summary.blocked}
          tone="amber"
        />
      </div>

      <Card className="mb-5 p-4">
        <FilterBar
          key={filtersToQuery(f) /* reset the form when filters change via links */}
          scope={f.scope}
          values={{ project: f.project, status: f.status, due: f.due, assignee: f.assignee, q: f.q, sort: f.sort }}
          options={{
            project: [
              { value: "all", label: "All programs" },
              ...projectsInScope.map((p) => ({ value: p.id, label: p.name })),
            ],
            status: STATUS_FILTERS.map((s) => ({ value: s, label: LABELS.status[s] })),
            due: DUE_FILTERS.map((d) => ({ value: d, label: LABELS.due[d] })),
            assignee:
              f.scope === "all"
                ? [
                    { value: "all", label: "Anyone" },
                    { value: "unassigned", label: "Unassigned" },
                    ...users
                      .filter((u) => tasks.some((t) => t.assigneeIds.includes(u.id)))
                      .map((u) => ({ value: u.id, label: u.name })),
                  ]
                : null,
            sort: SORTS.map((s) => ({ value: s, label: LABELS.sort[s] })),
          }}
        />
        <div
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm"
          data-testid="filter-status"
        >
          <span className="text-slate-700">
            Showing <strong>{shown.length}</strong> of {allRows.length} tasks · Sort: {LABELS.sort[f.sort]}
          </span>
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.removeHref}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800 ring-1 ring-brand-100 hover:bg-brand-100"
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label} <span aria-hidden>×</span>
            </Link>
          ))}
          {chips.length > 0 && (
            <Link href={resetHref} className="ml-auto font-semibold text-brand-700 hover:underline">
              Reset filters
            </Link>
          )}
        </div>
      </Card>

      {sections.length === 0 ? (
        <Card className="p-8 text-center text-slate-600">
          {allRows.length === 0 ? (
            "No tasks assigned in active programs."
          ) : (
            <>
              No tasks match these filters.{" "}
              <Link href={resetHref} className="font-semibold text-brand-700 hover:underline">
                Reset filters
              </Link>
            </>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {sections.map((s) => (
            <SectionCard key={s.key} section={s}>
              {(rows) =>
                rows.map((r) => (
                  <TaskRow
                    key={r.task.id}
                    row={r}
                    project={projectById.get(r.task.projectId!)!}
                    byId={byId}
                    now={now}
                    showPeople={f.scope === "all"}
                    canEdit={canUpdateTask(user, projectById.get(r.task.projectId!)!, r.task)}
                  />
                ))
              }
            </SectionCard>
          ))}
        </div>
      )}
    </>
  );
}

/** Collapsible section (native <details>, so it works without JavaScript and with keyboards/screen readers). */
function SectionCard({
  section: s,
  children,
}: {
  section: Section;
  children: (rows: DashboardRow[]) => React.ReactNode;
}) {
  const first = s.rows.slice(0, ROWS_BEFORE_MORE);
  const rest = s.rows.slice(ROWS_BEFORE_MORE);
  const accent =
    s.key === "overdue"
      ? "border-l-red-600"
      : s.key === "dueSoon"
        ? "border-l-amber-500"
        : s.key === "completed"
          ? "border-l-green-600"
          : "border-l-slate-300";
  return (
    <details
      open={s.open}
      className={`group rounded-lg border border-l-4 border-slate-200 bg-white shadow-sm ${accent}`}
      data-testid={`section-${s.key}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-slate-400 transition group-open:rotate-90">
            ▶
          </span>
          <span className={`font-semibold ${s.key === "overdue" ? "text-red-800" : "text-slate-900"}`}>{s.title}</span>
          <span className="hidden text-sm text-slate-500 sm:inline">· {s.hint}</span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.key === "overdue" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}
          data-testid="section-count"
        >
          {s.rows.length}
        </span>
      </summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">{children(first)}</ul>
      {rest.length > 0 && (
        <details className="border-t border-slate-100">
          <summary className="cursor-pointer list-none px-5 py-2 text-sm font-semibold text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
            Show {rest.length} more
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">{children(rest)}</ul>
        </details>
      )}
    </details>
  );
}

function TaskRow({
  row,
  project,
  byId,
  now,
  showPeople,
  canEdit,
}: {
  row: DashboardRow;
  project: Project;
  byId: Map<string, Task>;
  now: string;
  showPeople: boolean;
  canEdit: boolean;
}) {
  const t = row.task;
  const blockers = openPrerequisites(t, byId);
  return (
    <li
      className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-start sm:justify-between"
      data-testid="my-task-row"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/projects/${project.id}/tasks/${t.id}`}
            className={`font-medium hover:underline ${isComplete(t) ? "text-slate-500" : "text-slate-900"}`}
            data-testid="my-task-title"
          >
            {t.title}
          </Link>
          {isOverdue(t, now) && <Badge tone="red">Overdue</Badge>}
          {row.blocked && <Badge tone="amber">Blocked</Badge>}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          <Link href={`/projects/${project.id}`} className="text-brand-700 hover:underline">
            {project.name}
          </Link>
          {" · "}Due {formatDisplayDate(t.dueDate)}
          {showPeople && <> · {row.assigneeNames.join(", ") || <span className="italic">Unassigned</span>}</>}
          {!showPeople && t.ownerRole && <span className="text-slate-500"> · {t.ownerRole}</span>}
        </p>
        {row.blocked && (
          <p className="mt-1 text-sm text-amber-800">Waiting on: {blockers.map((b) => b.title).join("; ")}</p>
        )}
      </div>
      {canEdit && <TaskStatusForm taskId={t.id} status={t.status} taskTitle={t.title} />}
    </li>
  );
}

/** Summary tile; also a quick filter (click again to clear). */
function Tile({
  href,
  label,
  value,
  tone,
  active,
}: {
  href: string;
  label: string;
  value: number;
  tone?: "red" | "amber";
  active: boolean;
}) {
  const color =
    value === 0
      ? "text-slate-900"
      : tone === "red"
        ? "text-red-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-slate-900";
  const urgentBg = tone === "red" && value > 0 ? "bg-red-50 border-red-200" : "bg-white border-slate-200";
  return (
    <Link
      href={href}
      aria-pressed={active}
      aria-label={`${label}: ${value}${active ? " (filter on, click to clear)" : " (click to filter)"}`}
      className={`block rounded-lg border p-4 shadow-sm transition hover:border-brand-600 ${urgentBg} ${active ? "ring-2 ring-brand-600" : ""}`}
    >
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="flex items-center justify-between text-sm text-slate-600">
        {label}
        {active && <span className="text-xs font-semibold text-brand-700">Filtering ✓</span>}
      </div>
    </Link>
  );
}
