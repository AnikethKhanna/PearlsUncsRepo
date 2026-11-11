import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can, canViewProject } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { SaveTemplateForm } from "./save-template-form";

export const metadata: Metadata = { title: "Save as template" };

export default async function SaveAsTemplatePage({ params }: PageProps<"/projects/[id]/save-as-template">) {
  const { id } = await params;
  const user = await requireUser();
  const store = getStore();
  const project = await store.getProject(id);
  if (!project || !canViewProject(user, project)) notFound();
  if (!can(user, "template.manage")) return <Alert tone="error">Only administrators can save templates.</Alert>;
  if (!project.startDate)
    return <Alert tone="error">This program needs a start date before it can be saved as a template.</Alert>;

  const [tasks, original] = await Promise.all([
    store.getTasksByIds(project.taskIds),
    project.templateId ? store.getTemplate(project.templateId) : Promise.resolve(null),
  ]);

  return (
    <>
      <nav className="mb-4 text-sm">
        <Link href={`/projects/${project.id}`} className="text-brand-700 hover:underline">
          ← {project.name}
        </Link>
      </nav>
      <PageHeader
        title="Save program as a new template"
        description={`Turn “${project.name}” into a reusable template for future programs.`}
      />
      <SaveTemplateForm
        projectId={project.id}
        defaultName={`${project.name} (template)`}
        defaultProgramType={original?.programType ?? ""}
        counts={{
          total: tasks.length,
          notNeeded: tasks.filter((t) => t.status === "Not Needed").length,
          withNotes: tasks.filter((t) => t.notes.trim()).length,
          assigned: tasks.filter((t) => t.assigneeIds.length > 0).length,
        }}
      />
    </>
  );
}
