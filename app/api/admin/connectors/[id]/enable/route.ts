/**
 * POST /api/admin/connectors/[id]/enable — body: { enabled: boolean }
 *
 * ขั้นที่ 4 ของ lifecycle: Connect → Register → Test → Enable
 * ต้องกดเองเสมอ ระบบไม่ auto-enable ให้แม้ Test จะผ่านแล้ว
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { setConnectorEnabled, redactConnector } from "@/gateway/connectors"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const body = await req.json().catch(() => ({}))
    const enabled = Boolean(body.enabled)
    const connector = await setConnectorEnabled(id, enabled)
    return NextResponse.json({ connector: redactConnector(connector) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
