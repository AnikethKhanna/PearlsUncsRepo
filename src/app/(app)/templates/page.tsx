import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const user = await requireUser();
  if (!can(user, "template.manage")) return <Alert tone="error">Only administrators can view templates.</Alert>;
  const templates = await getStore().listTemplates();

  return (
    <>
      <PageHeader
        title="Program templates"
        description="Reusable starting points. Creating a program copies a template's tasks; editing a program never changes its template."
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {templates.map((t) => (
          <li key={t.id}>
            <Link href={`/templates/${t.id}`} className="block rounded-lg">
              <Card className="p-5 transition hover:border-brand-600">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-slate-900">{t.name}</h2>
                  {!t.active && <span className="text-xs text-slate-500">Inactive</span>}
                </div>
                <p className="text-sm text-slate-600">
                  {t.programType || "No program type"} · {t.steps.length} steps
                </p>
                {t.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{t.description}</p>}
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
