import Link from "next/link";
import { signOut } from "@/app/sign-in/actions";
import { can, homePathFor } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/current-user";
import { getStore } from "@/lib/data";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const placeholder = getStore().kind === "memory";

  return (
    <>
      {placeholder && (
        <div role="status" className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">
          Development placeholder data — changes are NOT saved to Airtable and disappear when the server restarts.
        </div>
      )}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href={homePathFor(user)} className="text-lg font-bold text-brand-700">
            NMU Onboarding
          </Link>
          <nav aria-label="Main" className="flex flex-1 flex-wrap gap-4 text-sm font-medium">
            <Link href="/my-tasks" className="text-slate-700 hover:text-brand-700">
              My Tasks
            </Link>
            <Link href="/projects" className="text-slate-700 hover:text-brand-700">
              All Projects
            </Link>
            {can(user, "project.create") && (
              <Link href="/projects/new" className="text-slate-700 hover:text-brand-700">
                New Project
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user.name} <span className="text-slate-400">({user.accessLevel})</span>
            </span>
            <form action={signOut}>
              <button type="submit" className="font-medium text-brand-700 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
