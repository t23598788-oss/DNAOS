import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";

/**
 * Financial aggregates are disabled until every source row has an enforced
 * company/organization owner and the caller's accounting permission is checked.
 * This route must not return a platform-wide total to a business account.
 */
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(
    {
      error: "FINANCE_OWNER_SCOPE_UNRESOLVED",
      message: "ปิดสรุปการเงินไว้จนกว่าจะยืนยันเจ้าของบริษัทและสิทธิ์บัญชีของผู้เรียกได้ครบ",
    },
    { status: 403 },
  );
}
