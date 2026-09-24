import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { resolveDestination } from "@/core/auth/resolveDestination";

// PWA start_url bounce (2026-09-24, step: ทางติดตั้งเว็บแอป) — the ONE
// role-authoritative entry for the installed app (manifest.start_url =
// "/app"). No session → /login?next=/app (middleware keeps the roundtrip via
// the safe-next guard); session → resolveDestination(role, null), the single
// landing authority (registry/permissions.json#workspace_landing) — so
// partner/customer never open the installed app onto an /admin start_url they
// cannot access, and staff land on the system Home (/admin/relationships)
// exactly like a normal login. Existing authorities only: no second auth, no
// new landing map, no middleware matcher change (the page self-gates).
export default async function AppStartPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login?next=/app");
  redirect(resolveDestination(user.role, null));
}