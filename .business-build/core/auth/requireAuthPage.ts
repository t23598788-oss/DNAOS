import { redirect } from "next/navigation";
import { getAuthedUser, ANY_AUTHENTICATED, type AppRole, type AuthedUser } from "./session";
import { isPlatformOperator, PLATFORM_MANAGEMENT_TIER } from "./platformOperator";
import { isDeveloperPlaneEnabled } from "./developerPlaneGate";

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

// Developer Plane page guard — same session; platform-operator decision on top.
export async function requirePlatformOperatorPage(nextPath: string): Promise<AuthedUser> {
  if (!isDeveloperPlaneEnabled()) redirect("/login?error=forbidden");
  const user = await requireAuthPage(nextPath, PLATFORM_MANAGEMENT_TIER);
  if (!isPlatformOperator({ role: user.role, email: user.email })) {
    redirect("/login?error=forbidden");
  }
  return user;
}