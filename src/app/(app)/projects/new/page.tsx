import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { NewProjectForm } from "./new-project-form";

export const metadata: Metadata = { title: "New Project" };

export default async function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  const user = await requireUser();
  if (!can(user, "project.create")) {
    return <Alert tone="error">Only administrators can create projects.</Alert>;
  }
  const store = getStore();
  const { template } = await searchParams;
  const [sites, templates, users] = await Promise.all([
    store.listSites(),
    store.listTemplates({ activeOnly: true }),
    store.listUsers(),
  ]);
  // Only pass the browser what the form needs (no emails, no record internals).
  const staff = users
    .filter((u) => u.active && u.accessLevel !== "Partner")
    .map((u) => ({ id: u.id, name: u.name, jobTitle: u.jobTitle }));

  return (
    <>
      <PageHeader
        title="New project"
        description="Pick a site, a program template and dates. Tasks and deadlines are generated for you and can be edited later."
      />
      <NewProjectForm
        sites={sites.map((s) => ({ id: s.id, name: s.name, location: s.location }))}
        templates={templates}
        initialTemplateId={templates.some((t) => t.id === template) ? (template as string) : ""}
        staff={staff}
      />
    </>
  );
}
