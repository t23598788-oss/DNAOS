import { NextResponse } from "next/server";
import { getAuthedUser, ANY_AUTHENTICATED, type AppRole, type AuthedUser } from "./session";
import { needsWorkspaceUnlock } from "./screen-lock";

// Canonical API-route guard (TASK-001). Every /api/admin/* and other protected
// route calls this instead of a locally copy-pasted requireAdmin() — one real
// Supabase Auth session, checked once, here.
//
// Usage:
//   const auth = await requireAuth(ADMIN_TIER)
//   if (auth instanceof NextResponse) return auth
//   // auth.email / auth.role / auth.id now available
export async function requireAuth(
  allowedRoles: AppRole[] = ANY_AUTHENTICATED
): Promise<AuthedUser | NextResponse> {
  const user = await getAuthedUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "ต้อง login ก่อนใช้งาน" },
      { status: 401 }
    );
  }

  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์เข้าถึงส่วนนี้" },
      { status: 403 }
    );
  }

  // M031 screen lock (server gate, not browser hiding): a user who holds a
  // valid Supabase session but has NOT unlocked the workspace this browser
  // session gets 403 SCREEN_LOCKED on every protected data API. The PIN-auth
  // endpoints themselves do their own session check and never run through
  // here, so this cannot lock the user out of unlocking.
  if (await needsWorkspaceUnlock(user)) {
    return NextResponse.json(
      { ok: false, error: "SCREEN_LOCKED" },
      { status: 403 }
    );
  }

  return user;
}
