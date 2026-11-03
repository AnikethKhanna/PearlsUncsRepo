import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader, ProgressBar, ProjectStatusBadge, TaskStatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { canUpdateTaskIn, canViewProject } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { formatDisplayDate, today } from "@/lib/domain/dates";
import { isComplete, isOverdue, openPrerequisites, projectProgress } from "@/lib/domain/task-state";
import { TaskStatusForm } from "./task-status-form";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const { created } = await searchParams;
  const user = await requireUser();
  const store = getStore();

  const project = await store.getProject(id);
  // Same response for "doesn't exist" and "not allowed", so project IDs can't be probed.
  if (!project || !canViewProject(user, project)) notFound();

  const [tasks, users] = await Promise.all([store.getTasksByIds(project.taskIds), store.listUsers()]);
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const now = today();
  const progress = projectProgress(tasks, now);
  const editable = canUpdateTaskIn(user, project);
  const sorted = [...tasks].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.order - b.order);

  return (
    <>
      <nav className="mb-4 text-sm"><Link href="/projects" className="text-brand-700 hover:underline">← All projects</Link></nav>
      <PageHeader
        title={project.name}
        description={
          <>
            {project.siteName || "No site"} · {project.templateName} · {formatDisplayDate(project.startDate)}
            {project.endDate && ` – ${formatDisplayDate(project.endDate)}`}
          </>
        }
        actions={<ProjectStatusBadge status={project.status} />}
      />

      <div className="space-y-4">
        {created === "1" && <Alert tone="success">Project created with {tasks.length} tasks.</Alert>}
        {project.status === "Setting Up" && (
          <Alert tone="warning">This project didn&apos;t finish setting up. Some tasks may be missing — check against the template.</Alert>
        )}

        <Card className="p-5">
          <div className="flex items-center gap-4">
            <ProgressBar percent={progress.percent} label="Project progress" />
            <span className="whitespace-nowrap text-sm text-slate-700">{progress.complete} of {progress.total} tasks complete</span>
          </div>
          <div className="mt-3 flex gap-2">
            {progress.overdue > 0 && <Badge tone="red">{progress.overdue} overdue</Badge>}
            {progress.blocked > 0 && <Badge tone="amber">{progress.blocked} blocked</Badge>}
          </div>
        </Card>

        <Card>
          <h2 className="border-b border-slate-200 px-5 py-3 text-lg font-semibold">Tasks</h2>
          {sorted.length === 0 ? (
            <p className="p-5 text-sm text-slate-600">No tasks.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sorted.map((t) => {
                const blockers = openPrerequisites(t, byId);
                const overdue = isOverdue(t, now);
                const owners = t.assigneeIds.map((uid) => userNames.get(uid)).filter(Boolean);
                return (
                  <li key={t.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between" data-testid="task-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-medium ${isComplete(t) ? "text-slate-500" : "text-slate-900"}`}>{t.title}</span>
                        {overdue && <Badge tone="red">Overdue</Badge>}
                        {blockers.length > 0 && !isComplete(t) && <Badge tone="amber">Blocked</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        Due {formatDisplayDate(t.dueDate)} · {owners.length ? owners.join(", ") : <span className="italic">Unassigned</span>}
                        {t.ownerRole && <span className="text-slate-500"> ({t.ownerRole})</span>}
                      </p>
                      {blockers.length > 0 && !isComplete(t) && (
                        <p className="mt-1 text-sm text-amber-800">Waiting on: {blockers.map((b) => b.title).join("; ")}</p>
                      )}
                    </div>
                    {editable ? (
                      <TaskStatusForm taskId={t.id} status={t.status} taskTitle={t.title} />
                    ) : (
                      <TaskStatusBadge status={t.status} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
