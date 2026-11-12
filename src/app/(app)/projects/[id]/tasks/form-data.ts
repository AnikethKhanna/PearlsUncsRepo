import "server-only";
import { getStore } from "@/lib/data";
import { loadWorkflowSettings } from "@/lib/data/workflow-settings";
import { phaseChoices, presetDate } from "@/lib/domain/workflow";
import { sortForDisplay } from "@/lib/domain/program-edit";
import type { Project, Task } from "@/lib/domain/types";
import type { TaskFormProps } from "./task-form";

/** Everything the task form needs, limited to what the browser should see. */
export async function taskFormProps(project: Project, tasks: Task[], editing?: Task): Promise<TaskFormProps> {
  const [users, { config }] = await Promise.all([getStore().listUsers(), loadWorkflowSettings(getStore())]);
  return {
    projectId: project.id,
    templateName: project.templateName,
    task: editing && {
      id: editing.id,
      title: editing.title,
      description: editing.description,
      phase: editing.phase,
      dueDate: editing.dueDate,
      ownerRole: editing.ownerRole,
      assigneeIds: editing.assigneeIds,
      dependsOnTaskIds: editing.dependsOnTaskIds,
    },
    phases: phaseChoices(config, editing?.phase),
    deadlinePresets: config.deadlinePresets.map((p) => ({ id: p.id, label: p.label, date: presetDate(p, project.startDate, project.endDate) })),
    staff: users
      .filter((u) => u.active && u.accessLevel !== "Partner")
      .map((u) => ({ id: u.id, name: u.name, jobTitle: u.jobTitle })),
    otherTasks: sortForDisplay(tasks)
      .filter((t) => t.id !== editing?.id)
      .map((t) => ({ id: t.id, title: t.title, phase: t.phase })),
  };
}
