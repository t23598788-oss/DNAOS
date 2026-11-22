/**
 * Global profile-role assignment is retired. Organization membership and
 * company-scoped grants are the only valid business authorization sources.
 */

import { NextResponse } from "next/server"

export async function PATCH() {
  return NextResponse.json(
    { error: "ปิดการเปลี่ยนบทบาทระดับระบบแล้ว; สิทธิ์ต้องจัดการผ่านสมาชิกและขอบเขตขององค์กร" },
    { status: 403 },
  )
}
