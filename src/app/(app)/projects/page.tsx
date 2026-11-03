import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, ProgressBar, ProjectStatusBadge, Badge, buttonPrimary } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can, canViewProject } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { formatDisplayDate, today } from "@/lib/domain/dates";
import { projectProgress } from "@/lib/domain/task-state";

export const metadata: Metadata = { title: "All Projects" };

/**
 * Basic project list so users can reach projects. The full "All Projects"
 * dashboard (Feature C: upcoming deadlines, filters) is Phase 3.
 */
export default async function ProjectsPage() {
  const user = await requireUser();
  const store = getStore();
  const projects = (await store.listProjects()).filter((p) => canViewProject(user, p));
  const tasks = await store.getTasksByIds(projects.flatMap((p) => p.taskIds));
  const now = today();

  return (
    <>
      <PageHeader
        title="All Projects"
        description="Program launches you have access to."
        actions={can(user, "project.create") && <Link href="/projects/new" className={buttonPrimary}>New project</Link>}
      />
      {projects.length === 0 ? (
        <Card className="p-8 text-center text-slate-600">No projects yet.</Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => {
            const progress = projectProgress(tasks.filter((t) => t.projectId === p.id), now);
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="block rounded-lg focus-visible:outline-offset-4">
                  <Card className="p-5 transition hover:border-brand-600">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold text-slate-900">{p.name}</h2>
                        <p className="text-sm text-slate-600">{p.siteName || "No site"} · {p.templateName}</p>
                      </div>
                      <ProjectStatusBadge status={p.status} />
                    </div>
                    <p className="mt-3 text-sm text-slate-700">Program starts {formatDisplayDate(p.startDate)}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <ProgressBar percent={progress.percent} label={`${p.name} progress`} />
                      <span className="whitespace-nowrap text-xs text-slate-600">{progress.complete}/{progress.total} done</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      {progress.overdue > 0 && <Badge tone="red">{progress.overdue} overdue</Badge>}
                      {progress.blocked > 0 && <Badge tone="amber">{progress.blocked} blocked</Badge>}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
