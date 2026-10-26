/**
 * GET  /api/admin/connectors — list every registered Connector
 * POST /api/admin/connectors — register a new Connector (auto test + status)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { listConnectors, createConnector, runConnectorTest, redactConnector, redactConnectors, type CreateConnectorInput } from "@/gateway/connectors"
import { findContract } from "@/engines/connectors/registry"
import { getLatestProposal } from "@/engines/integration-gateway/evidence/proposalStore"
import { buildConnectRuntimeDeps } from "./_lib/connectRuntime"
import { normalizeSignatureHeader } from "@/core/webhook-signature"

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

    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : ""

    // webhook ต้องประกาศชื่อ header ที่ใช้ตรวจลายเซ็น ไม่งั้นตรวจไม่ได้เลย →
    // ปฏิเสธตั้งแต่ที่นี่ (fail-closed ตาม owner audit 2026-10-26, C3)
    const signatureHeader = normalizeSignatureHeader(body.signature_header ?? body.config?.signature_header)
    if (authType === "webhook" && !signatureHeader) {
      return NextResponse.json(
        { error: "SIGNATURE_HEADER_REQUIRED", detail: "webhook connector ต้องระบุ signature_header" },
        { status: 400 }
      )
    }

    const input: CreateConnectorInput = {
      name,
      auth_type: authType as CreateConnectorInput["auth_type"],
      provider: provider || undefined,
      signature_header: signatureHeader || undefined,
      event_id_path: typeof body.event_id_path === "string" ? body.event_id_path : undefined,
      config: body.config ?? {},
      secret: body.secret ?? {},
    }

    // Provider-declared requirements — only when the caller declares a provider
    // that actually has a Connect contract (engines/connectors/registry.ts).
    // Required secret field NAMES must be present, and the provider's own
    // non-secret defaults are filled in so one Connect is enough. Field names are
    // reported; secret values are never echoed back.
    const contract = provider ? findContract(provider) : undefined
    if (contract) {
      const prep = await contract.prepareConnect(buildConnectRuntimeDeps())
      const secretObj = input.secret as Record<string, unknown>
      const missing = prep.required_secret_field_keys.filter((key) => {
        const value = secretObj[key]
        return value === undefined || value === null || String(value).length === 0
      })
      if (missing.length > 0) {
        return NextResponse.json({ error: "missing_required_secret_fields", missing_fields: missing }, { status: 400 })
      }
      const configObj = input.config as Record<string, unknown>
      for (const d of prep.defaults) {
        if (configObj[d.key] === undefined) configObj[d.key] = d.value
      }
    }

    // Owner approval is a real trust boundary, enforced here on the server (a UI
    // gate alone would be bypassable through this same API): a provider whose
    // contract declares OWNER_REQUIRED may only be connected while an approved
    // 'connect.approval.requested' proposal exists in the one proposal store.
    if (contract && contract.approvalRequirement === "OWNER_REQUIRED") {
      const approval = await getLatestProposal(supabaseAdmin(), contract.providerId, "connect.approval.requested")
      if (approval?.status !== "approved") {
        return NextResponse.json(
          { error: "OWNER_APPROVAL_REQUIRED", provider: contract.providerId, approval_status: approval?.status ?? "none" },
          { status: 403 }
        )
      }
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
