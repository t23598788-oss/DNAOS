import { NextResponse } from "next/server";
import { getAuthedUser, ANY_AUTHENTICATED, type AppRole, type AuthedUser } from "./session";

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

  return user;
}