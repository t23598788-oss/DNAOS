/**
 * Platform-wide user listing is retired. A business user directory must be
 * implemented from org_members and restricted to the caller's organization.
 */

import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { DISABLED_ROLE_TIER } from "@/core/auth/session"

export async function GET() {
  const auth = await requireAuth(DISABLED_ROLE_TIER)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ error: "ปิดรายชื่อผู้ใช้ระดับแพลตฟอร์มแล้ว; ใช้รายชื่อสมาชิกภายในองค์กรเท่านั้น" }, { status: 403 })
}
