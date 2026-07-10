/**
 * POST /api/admin/connectors/[id]/test — re-run the real connection test
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { runConnectorTest, redactConnector } from "@/gateway/connectors"

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const connector = await runConnectorTest(id)
    return NextResponse.json({ connector: redactConnector(connector) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
