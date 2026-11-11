import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, TaskStatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can, canViewProject, canViewTask } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { formatDisplayDate } from "@/lib/domain/dates";
import { taskFormProps } from "../form-data";
import { TaskForm } from "../task-form";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: PageProps<"/projects/[id]/tasks/[taskId]">) {
  const { id, taskId } = await params;
  const user = await requireUser();
  const store = getStore();
  const project = await store.getProject(id);
  if (!project || !canViewProject(user, project)) notFound();
  const tasks = await store.getTasksByIds(project.taskIds);
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !canViewTask(user, project, task)) notFound();

  const back = (
    <nav className="mb-4 text-sm">
      <Link href={`/projects/${project.id}`} className="text-brand-700 hover:underline">
        ← {project.name}
      </Link>
    </nav>
  );

  if (can(user, "program.editTasks")) {
    return (
      <>
        {back}
        <PageHeader title="Edit task" description={project.name} actions={<TaskStatusBadge status={task.status} />} />
        <TaskForm {...await taskFormProps(project, tasks, task)} />
      </>
    );
  }

  // Read-only view for people who can see but not edit the task
  const users = await store.listUsers();
  const name = (uid: string) => users.find((u) => u.id === uid)?.name ?? "Unknown";
  const prereqs = tasks.filter((t) => task.dependsOnTaskIds.includes(t.id));
  return (
    <>
      {back}
      <PageHeader title={task.title} description={project.name} actions={<TaskStatusBadge status={task.status} />} />
      <Card className="p-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label="Due">{formatDisplayDate(task.dueDate)}</Item>
          <Item label="Phase">{task.phase || "—"}</Item>
          <Item label="Assigned to">{task.assigneeIds.map(name).join(", ") || "Unassigned"}</Item>
          <Item label="Owner role">{task.ownerRole || "—"}</Item>
          <Item label="Waits for">{prereqs.map((t) => `${t.title} (${t.status})`).join("; ") || "Nothing"}</Item>
          <Item label="Description">{task.description || "—"}</Item>
        </dl>
      </Card>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-line text-sm text-slate-900">{children}</dd>
    </div>
  );
}
