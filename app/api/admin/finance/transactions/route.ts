import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(
    { error: "FINANCE_OWNER_SCOPE_UNRESOLVED", message: "ปิดรายการการเงินรวมจนกว่าจะกรองตามเจ้าของบริษัทที่ยืนยันแล้วได้" },
    { status: 403 },
  );
}
