import { NextResponse } from "next/server";
import { getAuthedUser, ANY_AUTHENTICATED, type AppRole, type AuthedUser } from "./session";
import { isPlatformOperator, PLATFORM_MANAGEMENT_TIER } from "./platformOperator";
import { isDeveloperPlaneEnabled } from "./developerPlaneGate";

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

// Developer Plane guard (owner directive 2026-10-20): IDE / Dev Loop / Deploy /
// Release / Build / source fs / Worker Execute. Same session as requireAuth;
// adds the platform-operator decision (core/auth/platformOperator.ts). An
// employee or a business admin without a registry grant gets 403.
export async function requirePlatformOperator(): Promise<AuthedUser | NextResponse> {
  if (!isDeveloperPlaneEnabled()) {
    return NextResponse.json(
      { ok: false, code: "DEVELOPER_PLANE_DISABLED", error: "Developer Plane ปิดใช้งานในสภาพแวดล้อม production" },
      { status: 403 }
    );
  }
  const auth = await requireAuth(PLATFORM_MANAGEMENT_TIER);
  if (auth instanceof NextResponse) return auth;
  if (!isPlatformOperator({ role: auth.role, email: auth.email })) {
    return NextResponse.json(
      { ok: false, error: "ต้องเป็นผู้ดูแล Platform ที่ได้รับอนุญาต" },
      { status: 403 }
    );
  }
  return auth;
}