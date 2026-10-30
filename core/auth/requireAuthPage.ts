import { redirect } from "next/navigation";
import { getAuthedUser, ANY_AUTHENTICATED, type AppRole, type AuthedUser } from "./session";
import { needsWorkspaceUnlock } from "./screen-lock";

// M031: pages that must stay reachable while the workspace is locked —
// the lock screen itself and the PIN setup/reset page. Everything else
// (every protected workspace surface) bounces to the lock screen instead of
// rendering when the user holds a valid session but has not unlocked yet.
const UNLOCK_EXEMPT_PAGES = ["/screen-lock", "/account/first-pin"];

// Page/layout-level guard (Server Components) — same session check as
// requireAuth, but redirects to /login instead of returning JSON. Use in
// app/admin/layout.tsx, app/business/layout.tsx, app/partner/page.tsx,
// app/user/page.tsx so the route itself is denied even if middleware.ts's
// coarse gate is ever bypassed or misconfigured (defense in depth, one real
// source of truth — same getAuthedUser() as the API guard, not a second
// auth implementation).
export async function requireAuthPage(
  nextPath: string,
  allowedRoles: AppRole[] = ANY_AUTHENTICATED
): Promise<AuthedUser> {
  const user = await getAuthedUser();

  if (!user) {
    console.log("[TRACE-AUTH] requireAuthPage REDIRECT (no user)", { nextPath });
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  // M031 screen lock (server-side gate): valid session, but this browser
  // session has not unlocked the workspace → the phone-style lock screen.
  // Server-rendered check, not a browser-side overlay.
  if (
    (await needsWorkspaceUnlock(user)) &&
    !UNLOCK_EXEMPT_PAGES.some((p) => nextPath === p || nextPath.startsWith(p + "/"))
  ) {
    console.log("[TRACE-AUTH] requireAuthPage SCREEN_LOCKED", { nextPath });
    redirect(`/screen-lock?next=${encodeURIComponent(nextPath)}`);
  }

  if (!allowedRoles.includes(user.role)) {
    console.log("[TRACE-AUTH] requireAuthPage REDIRECT (role not allowed)", {
      nextPath,
      role: user.role,
      allowedRoles,
    });
    redirect("/login?error=forbidden");
  }

  console.log("[TRACE-AUTH] requireAuthPage PASS", { nextPath, role: user.role });
  return user;
}