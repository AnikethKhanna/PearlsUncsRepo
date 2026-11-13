import Link from "next/link";
import { signOut } from "@/app/sign-in/actions";
import { Brand } from "@/components/brand";
import { AppNav } from "@/components/app-nav";
import { can } from "@/lib/auth/permissions";
import { isDemoEmail } from "@/lib/auth/demo-accounts";
import { requireUser } from "@/lib/auth/current-user";
import { getStore } from "@/lib/data";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const placeholder = getStore().kind === "memory";
  const items = [
    { href: "/my-tasks", label: "My Tasks" },
    { href: "/calendar", label: "Calendar" },
    { href: "/projects", label: "All Projects" },
    ...(can(user, "template.manage") ? [{ href: "/templates", label: "Templates" }] : []),
    ...(can(user, "project.create") ? [{ href: "/projects/new", label: "New Project" }] : []),
    ...(can(user, "calendar.sync") ? [{ href: "/settings/calendar", label: "Google Calendar" }] : []),
    ...(can(user, "workflow.manage") ? [{ href: "/settings/workflow", label: "Workflow Settings" }] : []),
  ];
  return <>
    <a href="#main-content" className="skip-link">Skip to main content</a>
    {placeholder && <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950">Demo data · Changes stay in this session and reset when the server restarts.</div>}
    <header className="border-b border-slate-200 border-t-4 border-t-brand-accent bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3">
          <Link href="/my-tasks" aria-label="No More Under — program management home" className="flex items-center gap-4"><Brand /><span className="hidden border-l border-slate-200 pl-4 text-sm font-semibold text-brand-700 sm:block">Program management</span></Link>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right"><span className="block font-semibold text-slate-800">{user.name}</span><span className="text-slate-600">{user.accessLevel}{isDemoEmail(user.email) && " · Demo account"}</span></div>
            <form action={signOut}><button type="submit" className="rounded-md border border-slate-300 px-3 py-2 font-semibold text-brand-700 hover:bg-slate-50">Sign out</button></form>
          </div>
        </div>
        <AppNav items={items} />
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
  </>;
}
