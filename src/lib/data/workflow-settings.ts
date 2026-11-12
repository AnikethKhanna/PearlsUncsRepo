import { createHash } from "node:crypto";
import { can } from "@/lib/auth/permissions";
import { DEFAULT_WORKFLOW, validateWorkflow, WorkflowValidationError, type WorkflowConfig } from "@/lib/domain/workflow";
import type { User } from "@/lib/domain/types";
import { StorageNotReadyError, type DataStore } from "./store";

export const workflowRevision = (config: WorkflowConfig) => createHash("sha256").update(JSON.stringify(config)).digest("hex");
export async function loadWorkflowSettings(store: DataStore) {
  try {
    const config = await store.getWorkflowConfig() ?? structuredClone(DEFAULT_WORKFLOW);
    return { config, revision: workflowRevision(config), writable: true, warning: "" };
  } catch (error) {
    if (!(error instanceof StorageNotReadyError) && !(error instanceof WorkflowValidationError)) throw error;
    const config = structuredClone(DEFAULT_WORKFLOW);
    return { config, revision: workflowRevision(config), writable: false,
      warning: error instanceof StorageNotReadyError
        ? "Workflow settings storage is not available. Existing defaults remain in use. Ask the base owner to set up Workflow Settings in Airtable (docs/workflow-settings.md)."
        : "Stored workflow settings need repair. Existing defaults remain in use; no saved settings have been overwritten." };
  }
}

/** Service boundary is also tested directly: no staff/partner writes, no destructive phase edits. */
export async function saveWorkflowSettings(store: DataStore, user: User | null, input: unknown, revision: string) {
  if (!user || !can(user, "workflow.manage")) throw new WorkflowValidationError("Only active administrators can configure workflows.");
  const current = await loadWorkflowSettings(store);
  if (!current.writable) throw new WorkflowValidationError(current.warning);
  if (revision !== current.revision) throw new WorkflowValidationError("These settings changed since you opened the page. Reload before saving your changes.");
  const config = validateWorkflow(input, current.config);
  await store.saveWorkflowConfig(config);
  return { config, revision: workflowRevision(config) };
}
