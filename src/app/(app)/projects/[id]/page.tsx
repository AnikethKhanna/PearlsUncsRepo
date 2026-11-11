import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  Card,
  PageHeader,
  ProgressBar,
  ProjectStatusBadge,
  TaskStatusBadge,
  buttonPrimary,
  buttonSecondary,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can, canUpdateTask, canViewProject, canViewTask } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { formatDisplayDate, today } from "@/lib/domain/dates";
import { isComplete, isOverdue, openPrerequisites, projectProgress } from "@/lib/domain/task-state";
import { TaskStatusForm } from "@/components/task-status-form";
import { phasesOf, sortForDisplay } from "@/lib/domain/program-edit";
import { moveTaskAction } from "./tasks/actions";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const { created, saved, removed } = await searchParams;
  const user = await requireUser();
  const store = getStore();

  const project = await store.getProject(id);
  // Same response for "doesn't exist" and "not allowed", so project IDs can't be probed.
  if (!project || !canViewProject(user, project)) notFound();

  const [allTasks, users] = await Promise.all([store.getTasksByIds(project.taskIds), store.listUsers()]);
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  // Blocked/waiting status needs every task; only tasks this user may see are listed.
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const tasks = allTasks.filter((t) => canViewTask(user, project, t));
  const seesAll = can(user, "task.viewAll");
  const editsProgram = can(user, "program.editTasks");
  const now = today();
  const progress = projectProgress(tasks, now);
  // The program's own order (editable), grouped by phase.
  const sorted = sortForDisplay(tasks);
  const phases = phasesOf(sorted);

  return (
    <>
      <nav className="mb-4 text-sm">
        <Link href="/projects" className="text-brand-700 hover:underline">
          ← All projects
        </Link>
      </nav>
      <PageHeader
        title={project.name}
        description={
          <>
            {project.siteName || "No site"} · {project.templateName} · {formatDisplayDate(project.startDate)}
            {project.endDate && ` – ${formatDisplayDate(project.endDate)}`}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            {editsProgram && (
              <Link href={`/projects/${project.id}/tasks/new`} className={buttonPrimary}>
                Add task
              </Link>
            )}
            {can(user, "template.manage") && project.startDate && (
              <Link href={`/projects/${project.id}/save-as-template`} className={buttonSecondary}>
                Save as template
              </Link>
            )}
          </div>
        }
      />

      <div className="space-y-4">
        {created === "1" && <Alert tone="success">Project created with {tasks.length} tasks.</Alert>}
        {typeof saved === "string" && <Alert tone="success">Task saved in this program.</Alert>}
        {removed === "1" && <Alert tone="success">Task removed from this program.</Alert>}
        {editsProgram && (
          <Alert tone="info">
            Editing here changes <strong>this program only</strong>
            {project.templateName ? (
              <> — not the &ldquo;{project.templateName}&rdquo; template or other programs made from it</>
            ) : null}
            .
            {project.templateId && can(user, "template.manage") && (
              <>
                {" "}
                <Link href={`/templates/${project.templateId}`} className="font-semibold underline">
                  View the template
                </Link>
              </>
            )}
          </Alert>
        )}
        {!seesAll && (
          <Alert tone="info">
            Showing only your {tasks.length} task{tasks.length === 1 ? "" : "s"} in this project (of {allTasks.length}).
            Admins see every task.
          </Alert>
        )}
        {project.status === "Setting Up" && (
          <Alert tone="warning">
            This project didn&apos;t finish setting up. Some tasks may be missing — check against the template.
          </Alert>
        )}

        <Card className="p-5">
          <div className="flex items-center gap-4">
            <ProgressBar percent={progress.percent} label="Project progress" />
            <span className="whitespace-nowrap text-sm text-slate-700">
              {progress.complete} of {progress.total} {seesAll ? "tasks" : "of your tasks"} complete
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            {progress.overdue > 0 && <Badge tone="red">{progress.overdue} overdue</Badge>}
            {progress.blocked > 0 && <Badge tone="amber">{progress.blocked} blocked</Badge>}
          </div>
        </Card>

        <Card>
          <h2 className="border-b border-slate-200 px-5 py-3 text-lg font-semibold">
            {seesAll ? "Tasks" : "Your tasks"}
          </h2>
          {sorted.length === 0 ? (
            <p className="p-5 text-sm text-slate-600">No tasks.</p>
          ) : (
            phases.map((phase) => {
              const phaseTasks = sorted.filter((t) => (t.phase || "Other") === phase);
              const done = phaseTasks.filter(isComplete).length;
              return (
                <section key={phase} aria-label={phase}>
                  <h3 className="flex justify-between border-b border-slate-200 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <span>{phase}</span>
                    <span className="normal-case tracking-normal">
                      {done} of {phaseTasks.length} complete
                    </span>
                  </h3>
                  <ul className="divide-y divide-slate-100">
                    {phaseTasks.map((t) => {
                      const blockers = openPrerequisites(t, byId);
                      const overdue = isOverdue(t, now);
                      const owners = t.assigneeIds.map((uid) => userNames.get(uid)).filter(Boolean);
                      return (
                        <li
                          key={t.id}
                          id={`task-${t.id}`}
                          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
                          data-testid="task-row"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/projects/${project.id}/tasks/${t.id}`}
                                data-testid="task-title"
                                className={`font-medium hover:underline ${isComplete(t) ? "text-slate-500" : "text-slate-900"}`}
                              >
                                {t.title}
                              </Link>
                              {overdue && <Badge tone="red">Overdue</Badge>}
                              {blockers.length > 0 && !isComplete(t) && <Badge tone="amber">Blocked</Badge>}
                            </div>
                            <p className="mt-1 text-sm text-slate-600">
                              Due {formatDisplayDate(t.dueDate)} ·{" "}
                              {owners.length ? owners.join(", ") : <span className="italic">Unassigned</span>}
                              {t.ownerRole && <span className="text-slate-500"> ({t.ownerRole})</span>}
                            </p>
                            {blockers.length > 0 && !isComplete(t) && (
                              <p className="mt-1 text-sm text-amber-800">
                                Waiting on: {blockers.map((b) => b.title).join("; ")}
                              </p>
                            )}
                          </div>
                          <div className="flex items-start gap-3">
                            {canUpdateTask(user, project, t) ? (
                              <TaskStatusForm taskId={t.id} status={t.status} taskTitle={t.title} />
                            ) : (
                              <TaskStatusBadge status={t.status} />
                            )}
                            {editsProgram && <EditControls projectId={project.id} task={t} />}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </Card>
      </div>
    </>
  );
}

/** Edit / move up / move down for one task in this program (admins). */
function EditControls({ projectId, task }: { projectId: string; task: { id: string; title: string } }) {
  const btn = "rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50";
  return (
    <div className="flex items-center gap-1">
      <Link href={`/projects/${projectId}/tasks/${task.id}`} className={btn} aria-label={`Edit ${task.title}`}>
        Edit
      </Link>
      {(["up", "down"] as const).map((direction) => (
        <form key={direction} action={moveTaskAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="direction" value={direction} />
          <button
            type="submit"
            className={btn}
            aria-label={`Move ${task.title} ${direction}`}
            title={`Move ${direction}`}
          >
            {direction === "up" ? "↑" : "↓"}
          </button>
        </form>
      ))}
    </div>
  );
}
