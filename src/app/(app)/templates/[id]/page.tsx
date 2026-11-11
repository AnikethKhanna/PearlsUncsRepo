import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, PageHeader, buttonPrimary } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { describeRule } from "@/lib/domain/dates";
import { phasesOf, sortForDisplay } from "@/lib/domain/program-edit";

export const metadata: Metadata = { title: "Template" };

export default async function TemplatePage({ params, searchParams }: PageProps<"/templates/[id]">) {
  const { id } = await params;
  const { created } = await searchParams;
  const user = await requireUser();
  if (!can(user, "template.manage")) return <Alert tone="error">Only administrators can view templates.</Alert>;
  const store = getStore();
  const template = await store.getTemplate(id);
  if (!template) notFound();
  const steps = sortForDisplay(template.steps.map((s) => ({ ...s, dueDate: null })));
  const title = (sid: string) => template.steps.find((s) => s.id === sid)?.title ?? "(removed step)";

  return (
    <>
      <nav className="mb-4 text-sm">
        <Link href="/templates" className="text-brand-700 hover:underline">
          ← All templates
        </Link>
      </nav>
      <PageHeader
        title={template.name}
        description={`Reusable template · ${template.programType || "No program type"} · ${template.steps.length} steps`}
        actions={
          template.active && can(user, "project.create") ? (
            <Link href={`/projects/new?template=${template.id}`} className={buttonPrimary}>
              Start a program from this template
            </Link>
          ) : undefined
        }
      />
      <div className="space-y-4">
        {created === "1" && <Alert tone="success">Template saved. You can now start new programs from it.</Alert>}
        <Alert tone="info">
          <strong>This is a reusable template.</strong> Changes to a template only affect programs created afterwards —
          existing programs keep their own copies. To change one program, open it from All Projects and use &ldquo;Add
          task&rdquo; or &ldquo;Edit&rdquo;.{" "}
          {store.kind === "airtable"
            ? "Template steps are edited in Airtable (Template Steps table) for now."
            : "In-app editing of template steps is not built yet."}
        </Alert>
        {template.description && <p className="whitespace-pre-line text-sm text-slate-700">{template.description}</p>}
        <Card>
          {phasesOf(steps).map((phase) => (
            <section key={phase} aria-label={phase}>
              <h2 className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {phase}
              </h2>
              <ol className="divide-y divide-slate-100">
                {steps
                  .filter((s) => (s.phase || "Other") === phase)
                  .map((s) => (
                    <li key={s.id} className="px-5 py-3 text-sm" data-testid="template-step">
                      <div className="font-medium text-slate-900">{s.title}</div>
                      <div className="text-slate-600">
                        {describeRule(s)}
                        {s.defaultOwnerRoles.length > 0 && ` · ${s.defaultOwnerRoles.join(", ")}`}
                      </div>
                      {s.dependsOnStepIds.length > 0 && (
                        <div className="text-amber-800">Waits for: {s.dependsOnStepIds.map(title).join("; ")}</div>
                      )}
                    </li>
                  ))}
              </ol>
            </section>
          ))}
        </Card>
      </div>
    </>
  );
}
