import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, buttonSecondary, inputClass } from "@/components/ui";
import { TaskStatusForm } from "@/components/task-status-form";
import { requireUser } from "@/lib/auth/current-user";
import { ACCESS_SUMMARY, canUpdateTask, canViewProject } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { addDays, formatDisplayDate, today } from "@/lib/domain/dates";
import { isComplete, isOverdue, openPrerequisites } from "@/lib/domain/task-state";
import { TASK_STATUSES, type Project, type Task } from "@/lib/domain/types";

export const metadata: Metadata = { title: "My Tasks" };

const STATUS_FILTERS = ["open", "all", ...TASK_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * My Tasks (Feature B): everything assigned to the signed-in person across
 * their active projects. Separate from All Projects, as the RFP requires.
 */
export default async function MyTasksPage({ searchParams }: PageProps<"/my-tasks">) {
  const user = await requireUser();
  const store = getStore();
  const sp = await searchParams;
  const statusFilter: StatusFilter = STATUS_FILTERS.includes(sp.status as StatusFilter)
    ? (sp.status as StatusFilter)
    : "open";
  const projectFilter = typeof sp.project === "string" ? sp.project : "all";
  const sort = sp.sort === "project" ? "project" : "due";

  // Active projects this user can see (completed/cancelled ones are history, not to-dos)
  const projects = (await store.listProjects()).filter(
    (p) => canViewProject(user, p) && p.status !== "Completed" && p.status !== "Cancelled",
  );
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const mine = (await store.getTasksByIds(user.assignedTaskIds)).filter(
    (t) => t.projectId && projectById.has(t.projectId) && t.assigneeIds.includes(user.id),
  );
  // Prerequisites may belong to other people; load them to know whether tasks are blocked.
  const prereqIds = mine.flatMap((t) => t.dependsOnTaskIds).filter((id) => !mine.some((t) => t.id === id));
  const prereqs = await store.getTasksByIds(prereqIds);
  const byId = new Map([...mine, ...prereqs].map((t) => [t.id, t]));

  const now = today();
  const weekFromNow = addDays(now, 7);
  const open = mine.filter((t) => !isComplete(t));
  const summary = {
    open: open.length,
    overdue: open.filter((t) => isOverdue(t, now)).length,
    thisWeek: open.filter((t) => t.dueDate && t.dueDate >= now && t.dueDate <= weekFromNow).length,
    blocked: open.filter((t) => openPrerequisites(t, byId).length > 0).length,
  };

  const shown = mine
    .filter((t) => projectFilter === "all" || t.projectId === projectFilter)
    .filter((t) =>
      statusFilter === "all" ? true : statusFilter === "open" ? !isComplete(t) : t.status === statusFilter,
    )
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.order - b.order);

  const groups: { title: string; tasks: Task[] }[] =
    sort === "project"
      ? projects
          .map((p) => ({ title: p.name, tasks: shown.filter((t) => t.projectId === p.id) }))
          .filter((g) => g.tasks.length > 0)
      : [
          { title: "Overdue", tasks: shown.filter((t) => isOverdue(t, now)) },
          {
            title: "Due in the next 7 days",
            tasks: shown.filter((t) => !isOverdue(t, now) && t.dueDate && t.dueDate <= weekFromNow),
          },
          { title: "Later", tasks: shown.filter((t) => !isOverdue(t, now) && (!t.dueDate || t.dueDate > weekFromNow)) },
        ].filter((g) => g.tasks.length > 0);

  return (
    <>
      <PageHeader
        title="My Tasks"
        description={`Tasks assigned to ${user.name} across active projects. Signed in as ${user.accessLevel}: ${ACCESS_SUMMARY[user.accessLevel]}`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open tasks" value={summary.open} />
        <Stat label="Overdue" value={summary.overdue} tone={summary.overdue ? "red" : undefined} />
        <Stat label="Due in 7 days" value={summary.thisWeek} />
        <Stat label="Blocked" value={summary.blocked} tone={summary.blocked ? "amber" : undefined} />
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filter tasks">
        <Filter label="Status" name="status" value={statusFilter}>
          <option value="open">Open (not done)</option>
          <option value="all">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Filter>
        <Filter label="Project" name="project" value={projectFilter}>
          <option value="all">All my projects</option>
          {projects
            .filter((p) => mine.some((t) => t.projectId === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Filter>
        <Filter label="Group by" name="sort" value={sort}>
          <option value="due">Due date</option>
          <option value="project">Project</option>
        </Filter>
        <button type="submit" className={buttonSecondary}>
          Apply
        </button>
      </form>

      {groups.length === 0 ? (
        <Card className="p-8 text-center text-slate-600">
          {mine.length === 0 ? "You have no tasks assigned in active projects." : "No tasks match these filters."}
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <Card key={g.title}>
              <h2 className="flex justify-between border-b border-slate-200 px-5 py-3 font-semibold">
                <span className={g.title === "Overdue" ? "text-red-800" : ""}>{g.title}</span>
                <span className="text-sm font-normal text-slate-500">{g.tasks.length}</span>
              </h2>
              <ul className="divide-y divide-slate-100">
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    project={projectById.get(t.projectId!)!}
                    byId={byId}
                    now={now}
                    canEdit={canUpdateTask(user, projectById.get(t.projectId!)!, t)}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function TaskRow({
  task: t,
  project,
  byId,
  now,
  canEdit,
}: {
  task: Task;
  project: Project;
  byId: Map<string, Task>;
  now: string;
  canEdit: boolean;
}) {
  const blockers = openPrerequisites(t, byId);
  return (
    <li
      className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
      data-testid="my-task-row"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${isComplete(t) ? "text-slate-500" : "text-slate-900"}`}>{t.title}</span>
          {isOverdue(t, now) && <Badge tone="red">Overdue</Badge>}
          {blockers.length > 0 && !isComplete(t) && <Badge tone="amber">Blocked</Badge>}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          <Link href={`/projects/${project.id}`} className="text-brand-700 hover:underline">
            {project.name}
          </Link>
          {" · "}Due {formatDisplayDate(t.dueDate)}
          {t.ownerRole && <span className="text-slate-500"> · {t.ownerRole}</span>}
        </p>
        {blockers.length > 0 && !isComplete(t) && (
          <p className="mt-1 text-sm text-amber-800">Waiting on: {blockers.map((b) => b.title).join("; ")}</p>
        )}
      </div>
      {canEdit && <TaskStatusForm taskId={t.id} status={t.status} taskTitle={t.title} />}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <Card className="p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-slate-600">{label}</div>
    </Card>
  );
}

function Filter({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-slate-800">{label}</span>
      <select name={name} defaultValue={value} className={`${inputClass} w-auto`}>
        {children}
      </select>
    </label>
  );
}
