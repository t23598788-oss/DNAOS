import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { resolveDestination } from "@/core/auth/resolveDestination";

// Single entry point (Single Workspace Shell migration). Thin redirect only —
// reuses the exact same role -> destination logic every login already uses
// (core/auth/resolveDestination.ts), rather than a second, parallel decision
// here. Any authenticated role lands on its real workspace; anonymous visitors
// go to /login same as every other protected route.
export default async function WorkspaceEntryPage() {
  const user = await getAuthedUser();

  if (!user) {
    redirect("/login?next=/workspace");
  }

  redirect(resolveDestination(user.role));
}
