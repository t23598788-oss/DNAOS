import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";

/** Company expense rows currently lack an enforced tenant owner key. */
function denyUnscopedFinance() {
  return NextResponse.json(
    { error: "FINANCE_OWNER_SCOPE_UNRESOLVED", message: "ปิดรายการค่าใช้จ่ายจนกว่าจะยืนยันบริษัทเจ้าของข้อมูลได้" },
    { status: 403 },
  );
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return denyUnscopedFinance();
}

export async function POST() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return denyUnscopedFinance();
}
