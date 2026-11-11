import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can, canViewProject } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { taskFormProps } from "../form-data";
import { TaskForm } from "../task-form";

export const metadata: Metadata = { title: "Add task" };

export default async function NewTaskPage({ params }: PageProps<"/projects/[id]/tasks/new">) {
  const { id } = await params;
  const user = await requireUser();
  const store = getStore();
  const project = await store.getProject(id);
  if (!project || !canViewProject(user, project)) notFound();
  if (!can(user, "program.editTasks"))
    return <Alert tone="error">Only administrators can add tasks to a program.</Alert>;
  const tasks = await store.getTasksByIds(project.taskIds);

  return (
    <>
      <nav className="mb-4 text-sm">
        <Link href={`/projects/${project.id}`} className="text-brand-700 hover:underline">
          ← {project.name}
        </Link>
      </nav>
      <PageHeader title="Add a task to this program" description={project.name} />
      <TaskForm {...await taskFormProps(project, tasks)} />
    </>
  );
}
