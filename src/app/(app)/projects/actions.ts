"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthorizationError, getCurrentUser, requirePermission } from "@/lib/auth/current-user";
import { canUpdateTask } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { isIsoDate } from "@/lib/domain/dates";
import { generateTaskDrafts, rolesForSteps } from "@/lib/domain/generate-tasks";
import { TASK_STATUSES, type TaskStatus } from "@/lib/domain/types";

export interface CreateProjectState {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "siteId" | "templateId" | "startDate" | "endDate", string>>;
}

/**
 * Feature A: create a project and generate its tasks from a template.
 * Every value from the browser is re-validated here; the server recomputes
 * roles and due dates itself rather than trusting the preview.
 */
export async function createProject(_prev: CreateProjectState, formData: FormData): Promise<CreateProjectState> {
  let projectId: string;
  try {
    const user = await requirePermission("project.create");
    const store = getStore();

    const name = String(formData.get("name") ?? "").trim();
    const siteId = String(formData.get("siteId") ?? "");
    const templateId = String(formData.get("templateId") ?? "");
    const startDate = String(formData.get("startDate") ?? "");
    const endDateRaw = String(formData.get("endDate") ?? "");
    const endDate = endDateRaw === "" ? null : endDateRaw;
    const excludedStepIds = formData.getAll("excludeStep").map(String);

    const fieldErrors: CreateProjectState["fieldErrors"] = {};
    if (!name) fieldErrors.name = "Give the project a name.";
    else if (name.length > 200) fieldErrors.name = "Keep the name under 200 characters.";
    if (!siteId) fieldErrors.siteId = "Choose a site.";
    if (!templateId) fieldErrors.templateId = "Choose a program template.";
    if (!isIsoDate(startDate)) fieldErrors.startDate = "Enter the program start date.";
    if (endDate !== null && !isIsoDate(endDate)) fieldErrors.endDate = "Enter a valid end date.";
    else if (endDate && isIsoDate(startDate) && endDate < startDate)
      fieldErrors.endDate = "End date can't be before the start date.";
    if (Object.keys(fieldErrors).length) return { fieldErrors };

    const [sites, template, users] = await Promise.all([store.listSites(), store.getTemplate(templateId), store.listUsers()]);
    if (!sites.some((s) => s.id === siteId)) return { fieldErrors: { siteId: "That site no longer exists." } };
    if (!template || !template.active) return { fieldErrors: { templateId: "That template is not available." } };
    if (template.steps.length === 0) return { fieldErrors: { templateId: "That template has no steps yet." } };

    // Role assignments: field "role_<index>" refers to the template's roles, recomputed here.
    const assignable = new Set(users.filter((u) => u.active && u.accessLevel !== "Partner").map((u) => u.id));
    const roleAssignments: Record<string, string[]> = {};
    rolesForSteps(template.steps).forEach((role, i) => {
      const uid = String(formData.get(`role_${i}`) ?? "");
      if (uid && assignable.has(uid)) roleAssignments[role] = [uid];
    });

    const { drafts, warnings } = generateTaskDrafts({
      steps: template.steps,
      startDate,
      endDate,
      excludedStepIds,
      roleAssignments,
    });
    if (drafts.length === 0) return { error: "Select at least one task to include." };
    if (warnings.some((w) => w.startsWith("Template has a circular dependency")))
      return { error: warnings.find((w) => w.startsWith("Template has a circular dependency")) };

    const project = await store.createProjectWithTasks(
      {
        name,
        siteId,
        templateId,
        startDate,
        endDate,
        teamUserIds: [...new Set(Object.values(roleAssignments).flat())],
        createdByUserId: user.id,
      },
      drafts,
    );
    projectId = project.id;
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    console.error("createProject failed:", err instanceof Error ? err.message : "unknown error");
    return {
      error:
        "The project couldn't be fully saved. If it now appears with status “Setting Up”, some tasks may be missing — contact an administrator.",
    };
  }
  revalidatePath("/projects");
  redirect(`/projects/${projectId}?created=1`);
}

export interface TaskUpdateState {
  error?: string;
  savedAt?: number;
}

/** Change a task's status. Admins may update any task; Staff only tasks assigned to them (checked here, on the server). */
export async function updateTaskStatus(_prev: TaskUpdateState, formData: FormData): Promise<TaskUpdateState> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "Please sign in again." };

    const taskId = String(formData.get("taskId") ?? "");
    const status = String(formData.get("status") ?? "") as TaskStatus;
    if (!TASK_STATUSES.includes(status)) return { error: "Unknown status." };

    const store = getStore();
    const task = await store.getTask(taskId);
    const project = task?.projectId ? await store.getProject(task.projectId) : null;
    if (!task || !project || !canUpdateTask(user, project, task)) return { error: "You don't have permission to update this task." };

    await store.updateTask(task.id, { status });
    revalidatePath(`/projects/${project.id}`);
    revalidatePath("/projects");
    revalidatePath("/my-tasks");
    return { savedAt: Date.now() };
  } catch (err) {
    console.error("updateTaskStatus failed:", err instanceof Error ? err.message : "unknown error");
    return { error: "Couldn't save. Please try again." };
  }
}
