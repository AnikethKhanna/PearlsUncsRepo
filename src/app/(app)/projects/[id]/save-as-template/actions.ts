"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthorizationError, requirePermission } from "@/lib/auth/current-user";
import { canViewProject } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { formatDisplayDate } from "@/lib/domain/dates";
import { buildTemplateFromProject } from "@/lib/domain/template-from-project";

export interface SaveTemplateState {
  error?: string;
  fieldErrors?: Partial<Record<"name", string>>;
}

/**
 * Create a NEW reusable template from an existing program.
 * The program and its original template are only read, never changed.
 */
export async function saveProgramAsTemplate(_prev: SaveTemplateState, formData: FormData): Promise<SaveTemplateState> {
  let templateId: string;
  try {
    const user = await requirePermission("template.manage");
    const store = getStore();
    const project = await store.getProject(String(formData.get("projectId") ?? ""));
    if (!project || !canViewProject(user, project)) return { error: "That program isn't available." };

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { fieldErrors: { name: "Give the template a name." } };
    if (name.length > 200) return { fieldErrors: { name: "Keep the name under 200 characters." } };
    const templates = await store.listTemplates();
    if (templates.some((t) => t.name.trim().toLowerCase() === name.toLowerCase()))
      return { fieldErrors: { name: "A template with this name already exists. Choose another name." } };

    const [tasks, original] = await Promise.all([
      store.getTasksByIds(project.taskIds),
      project.templateId ? store.getTemplate(project.templateId) : Promise.resolve(null),
    ]);
    const { steps } = buildTemplateFromProject(project, tasks, original?.steps ?? [], {
      includeNotNeeded: formData.get("includeNotNeeded") === "on",
      includeNotes: formData.get("includeNotes") === "on",
      includeAssignees: formData.get("includeAssignees") === "on",
    });
    if (steps.length === 0) return { error: "There are no tasks to save." };

    const extra = String(formData.get("description") ?? "")
      .trim()
      .slice(0, 2000);
    const template = await store.createTemplate(
      {
        name,
        programType:
          String(formData.get("programType") ?? "")
            .trim()
            .slice(0, 100) ||
          original?.programType ||
          "",
        description: [
          extra,
          `Saved from the program "${project.name}" (${formatDisplayDate(project.startDate)}) by ${user.name}.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      steps,
    );
    templateId = template.id;
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    console.error("saveProgramAsTemplate failed:", err instanceof Error ? err.message : "unknown error");
    return {
      error:
        "Couldn't save the template. If you ticked “include assignments”, the Airtable Template Steps table needs a “Default Assignees” field (see docs).",
    };
  }
  revalidatePath("/templates");
  revalidatePath("/projects/new");
  redirect(`/templates/${templateId}?created=1`);
}
