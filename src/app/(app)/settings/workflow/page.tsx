import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { loadWorkflowSettings } from "@/lib/data/workflow-settings";
import { WorkflowForm } from "./workflow-form";
export const metadata = { title: "Workflow settings" };
export default async function WorkflowPage() {
  const user = await requireUser();
  if (!can(user, "workflow.manage")) notFound();
  const settings = await loadWorkflowSettings(getStore());
  return <>
    <PageHeader title="Workflow settings" description="Set up task phases and reusable deadlines for your team." />
    <div className="space-y-5">
      {settings.warning && <Alert tone="warning">{settings.warning}</Alert>}
      <WorkflowForm initial={settings.config} revision={settings.revision} writable={settings.writable} />
    </div>
  </>;
}
