import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { resolveDestination } from "@/core/auth/resolveDestination";
import { hasFreshPrimaryVerification } from "@/core/auth/screen-lock";
import { getWorkspaceScreenLock } from "@/gateway/auth";

// PWA start_url bounce (2026-09-24, step: ทางติดตั้งเว็บแอป) — the ONE
// role-authoritative entry for the installed app (manifest.start_url =
// "/app"). No session → /login?next=/app (middleware keeps the roundtrip via
// the safe-next guard); session → resolveDestination(role, null), the single
// landing authority (registry/permissions.json#workspace_landing) — so
// partner/customer never open the installed app onto an /admin start_url they
// cannot access, and staff land on the system Home (/admin/relationships)
// exactly like a normal login. Existing authorities only: no second auth, no
// new landing map, no middleware matcher change (the page self-gates).
//
// M032 §02 rule 3 (owner directive): this page IS the post-login funnel, so it
// also answers the PIN question before anything protected renders:
//   session + NO PIN yet + fresh primary verification → /account/first-pin
//   ONCE, then straight into the workspace (the setup route issues the unlock
//   cookie, so no immediate second prompt). A session without a PIN whose
//   verification is NOT fresh (M030/M028 accounts, employees) keeps landing in
//   the workspace exactly as before, and a session WITH a PIN is funneled to
//   the lock screen by requireAuthPage one hop later — no repeat prompt ever.
export default async function AppStartPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login?next=/app");

  const workspace = resolveDestination(user.role, null);

  try {
    const lock = await getWorkspaceScreenLock(user.id);
    if (!lock && (await hasFreshPrimaryVerification())) {
      redirect(`/account/first-pin?first=1&next=${encodeURIComponent(workspace)}`);
    }
  } catch {
    // Fail-closed (M032 §05): cannot even read whether a PIN exists → deny.
    redirect("/login?error=screen_lock_unavailable");
  }

  redirect(workspace);
}
