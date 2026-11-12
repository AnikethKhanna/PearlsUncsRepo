"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function AppNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return <nav aria-label="Main navigation" className="flex flex-wrap gap-1 py-2">
    {items.map(({ href, label }) => {
      const active = pathname === href || (href === "/my-tasks" && pathname.startsWith("/my-tasks/"))
        || (href === "/templates" && pathname.startsWith("/templates/"))
        || (href === "/projects" && pathname.startsWith("/projects/") && pathname !== "/projects/new");
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${active ? "bg-brand-100 text-brand-800" : "text-slate-700 hover:bg-slate-100 hover:text-brand-700"}`}>{label}</Link>;
    })}
  </nav>;
}
