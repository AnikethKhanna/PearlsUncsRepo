"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getStore } from "@/lib/data";
import { saveWorkflowSettings } from "@/lib/data/workflow-settings";
import { WorkflowValidationError } from "@/lib/domain/workflow";
export interface WorkflowState { error?: string; success?: string; revision?: string }
export async function updateWorkflow(_previous: WorkflowState, form: FormData): Promise<WorkflowState> {
  try {
    const user = await getCurrentUser();
    const current = user ? await getStore().getUser(user.id) : null;
    const raw = String(form.get("config") ?? "");
    if (raw.length > 30000) return { error: "The configuration is too large." };
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return { error: "Invalid configuration. Reload and try again." }; }
    const result = await saveWorkflowSettings(getStore(), current, input, String(form.get("revision") ?? ""));
    revalidatePath("/settings/workflow");
    revalidatePath("/projects", "layout");
    return { success: "Workflow settings saved. Existing task dates and labels are unchanged.", revision: result.revision };
  } catch (error) {
    return { error: error instanceof WorkflowValidationError ? error.message : "Could not save workflow settings. Check the Airtable setup and try again." };
  }
}
