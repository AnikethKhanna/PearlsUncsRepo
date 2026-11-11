import Link from "next/link";
import { Card } from "@/components/ui";

export default function ProjectNotFound() {
  return (
    <Card className="p-8 text-center">
      <h1 className="text-lg font-semibold">Project not found</h1>
      <p className="mt-2 text-sm text-slate-600">It may not exist, or you may not have access to it.</p>
      <Link href="/projects" className="mt-4 inline-block text-brand-700 hover:underline">
        Back to all projects
      </Link>
    </Card>
  );
}
