import { redirect } from "next/navigation";
import { getAuthedUser, ANY_AUTHENTICATED, type AppRole, type AuthedUser } from "./session";

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