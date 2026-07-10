/**
 * GET    /api/admin/connectors/[id] — one Connector
 * PATCH  /api/admin/connectors/[id] — update name/config/secret
 * DELETE /api/admin/connectors/[id] — remove Connector
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { getConnectorById, updateConnector, deleteConnector, redactConnector } from "@/gateway/connectors"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const connector = await getConnectorById(id)
  if (!connector) return NextResponse.json({ error: "ไม่พบ Connector นี้" }, { status: 404 })
  return NextResponse.json({ connector: redactConnector(connector) })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const body = await req.json().catch(() => ({}))
    const connector = await updateConnector(id, {
      name: body.name,
      config: body.config,
      secret: body.secret,
    })
    return NextResponse.json({ connector: redactConnector(connector) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    await deleteConnector(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
