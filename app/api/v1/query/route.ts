/**
 * POST /api/v1/query
 *
 * ท่อหลักสำหรับ AI ภายนอก — รับ command ผ่าน token แล้วส่งผ่าน Dispatcher
 *
 * Auth: Header X-DNA-Token: <token>
 *       หรือ Query param  ?token=<token>
 *
 * Body: { "command": "debt.list", "args": {} }
 *   หรือ { "command": "partner__timeline", "args": { "partner_id": "uuid" } }
 *   (OpenAI double-underscore → dot แปลงอัตโนมัติ)
 *
 * เฉพาะ read commands (requires_confirmation: false) เท่านั้น
 * Write commands ต้องผ่าน /admin UI เท่านั้น (Rule 72)
 */

import { NextRequest, NextResponse } from "next/server"
import { validateApiToken } from "@/lib/supabase/api-tokens"
import { dispatch } from "@/lib/v2-rules/dispatcher"

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-DNA-Token",
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}

export async function POST(req: NextRequest) {
  // ── Auth ──
  const token =
    req.headers.get("x-dna-token") ??
    req.nextUrl.searchParams.get("token") ??
    ""

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "ต้องใส่ X-DNA-Token header — สร้าง token ได้ที่ /admin/api-tokens" },
      { status: 401, headers: corsHeaders() }
    )
  }

  const tokenRecord = await validateApiToken(token)
  if (!tokenRecord) {
    return NextResponse.json(
      { ok: false, error: "token ไม่ถูกต้องหรือถูก revoke แล้ว" },
      { status: 401, headers: corsHeaders() }
    )
  }

  // ── Parse body ──
  let body: { command?: string; args?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: "body ต้องเป็น JSON: { command, args }" },
      { status: 400, headers: corsHeaders() }
    )
  }

  // แปลง OpenAI style double-underscore กลับเป็น dot
  const rawCommand = String(body.command ?? "").replace(/__/g, ".")
  const args = body.args ?? {}

  if (!rawCommand) {
    return NextResponse.json(
      { ok: false, error: "ต้องระบุ command" },
      { status: 400, headers: corsHeaders() }
    )
  }

  // ── Dispatch ── (ผ่าน Dispatcher ซึ่งตรวจ registry + rule 72)
  const result = await dispatch(rawCommand, args, false)

  if (!result.ok) {
    const status = result.requires_confirmation ? 403 : 400
    return NextResponse.json(
      {
        ok: false,
        command: rawCommand,
        error: result.violations.join("; "),
        requires_confirmation: result.requires_confirmation,
        hint: result.requires_confirmation
          ? "command นี้ต้องยืนยันจากมนุษย์ผ่าน /admin UI เท่านั้น (Rule 72)"
          : undefined,
      },
      { status, headers: corsHeaders() }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      command: rawCommand,
      user: tokenRecord.user_email,
      data: result.data,
    },
    { headers: corsHeaders() }
  )
}
