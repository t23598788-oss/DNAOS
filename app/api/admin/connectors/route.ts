/**
 * GET  /api/admin/connectors — list every registered Connector
 * POST /api/admin/connectors — register a new Connector (auto test + status)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { listConnectors, createConnector, runConnectorTest, redactConnector, redactConnectors, type CreateConnectorInput } from "@/gateway/connectors"

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const connectors = await listConnectors()
    return NextResponse.json({ connectors: redactConnectors(connectors) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[connectors] list query failed:", msg)
    return NextResponse.json({ connectors: [] })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? "").trim()
    const authType = String(body.auth_type ?? "")
    const validTypes = ["login", "oauth", "api_key", "token", "uri", "mcp", "webhook"]

    if (!name) return NextResponse.json({ error: "ต้องระบุชื่อ Connector" }, { status: 400 })
    if (!validTypes.includes(authType)) {
      return NextResponse.json({ error: `auth_type ต้องเป็นหนึ่งใน: ${validTypes.join(", ")}` }, { status: 400 })
    }

    const input: CreateConnectorInput = {
      name,
      auth_type: authType as CreateConnectorInput["auth_type"],
      config: body.config ?? {},
      secret: body.secret ?? {},
    }
    let connector = await createConnector(input)

    // ทดสอบการเชื่อมต่อทันทีหลังสร้าง (ยกเว้น oauth ที่ต้อง authorize ก่อน)
    if (connector.auth_type !== "oauth" && connector.auth_type !== "webhook") {
      connector = await runConnectorTest(connector.id)
    }

    // webhook มี signing_secret ที่ระบบสร้างให้เอง — ต้องโชว์ให้ copy ครั้งเดียวตอนสร้าง
    // ประเภทอื่นเป็นค่าที่ผู้ใช้พิมพ์เองอยู่แล้ว ไม่ต้อง echo กลับ
    const responseConnector = connector.auth_type === "webhook" ? connector : redactConnector(connector)

    return NextResponse.json({ connector: responseConnector }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
