import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { homePathFor } from "@/lib/auth/permissions";
import { configProblems } from "@/lib/config";

/** Send people to their role's dashboard, or to sign-in. */
export default async function Home() {
  const user = configProblems().length === 0 ? await getCurrentUser() : null;
  redirect(user ? homePathFor(user) : "/sign-in");
}
