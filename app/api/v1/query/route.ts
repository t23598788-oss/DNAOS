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
import { randomUUID } from "crypto"
import { validateApiToken, getApiTokenCallerProfile, MissingServiceRoleKeyError } from "@/services/supabase/api-tokens"
import { runWithDataScope } from "@/core/authority/data-scope-context"
import { resolveTokenDataScope } from "@/engines/authority/session-scope"
import permissions from "@/registry/permissions.json"
import { dispatch } from "@/engines/validation/dispatcher"

// TEMPORARY DIAGNOSTIC (owner-approved, 2026-08-04) — API token UNAUTHORIZED
// root-cause audit. Logs shape only (lengths, booleans, masked project ref),
// never the raw token, a prefix of it, or any hash. Remove once root cause
// is confirmed from real Production logs — see services/supabase/api-tokens.ts
// for the matching validateApiToken() diagnostic block.
function maskedProjectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const m = url.match(/https:\/\/([a-z0-9]{4})[a-z0-9]*\.supabase\.co/)
  return m ? `${m[1]}***` : "unknown"
}

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
  const requestId = randomUUID()

  // ── Auth ──
  const headerToken = req.headers.get("x-dna-token")
  const rawToken = headerToken ?? req.nextUrl.searchParams.get("token") ?? ""
  const trimmedToken = rawToken.trim()

  // TEMPORARY DIAGNOSTIC — shape only, never the value.
  console.log("[api/v1/query][diag]", JSON.stringify({
    request_id: requestId,
    header_present: headerToken !== null,
    received_token_length: rawToken.length,
    received_token_trimmed_length: trimmedToken.length,
    supabase_project_ref: maskedProjectRef(),
  }))

  if (!trimmedToken) {
    return NextResponse.json(
      { ok: false, error: "ต้องใส่ X-DNA-Token header — สร้าง token ได้ที่ /admin/api-tokens", request_id: requestId },
      { status: 401, headers: corsHeaders() }
    )
  }

  // PART 1 (ปิดช่องโหว่ข้ามองค์กร, 2026-10-24): token ที่ถูกต้องต้อง resolve
  // ไปยัง profiles.role อยู่ใน admin tier เสมอ (ตรรกะเดียวกับการออก token:
  // /api/admin/api-tokens ใช้ requireAuth(ADMIN_TIER) + createApiToken(auth.email))
  // ตรวจ activate ล่าสุดผ่าน server ทุก request — ไม่ยืนยัน client cookie/state.
  // MissingServiceRoleKeyError → 503 (env provisioning problem, honest ตามเดิม).
  let tokenRecord
  let callerProfile: { id: string; role: string | null } | null = null
  const callerRole = (): string | null => callerProfile?.role ?? null
  try {
    tokenRecord = await validateApiToken(trimmedToken, requestId)
    if (tokenRecord) {
      callerProfile = await getApiTokenCallerProfile(tokenRecord.user_email)
    }
  } catch (err) {
    if (err instanceof MissingServiceRoleKeyError) {
      return NextResponse.json(
        { ok: false, error: "ระบบ token ยังไม่พร้อมใช้งาน (SUPABASE_SERVICE_ROLE_KEY ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์) — แจ้งผู้ดูแลระบบ", request_id: requestId },
        { status: 503, headers: corsHeaders() }
      )
    }
    throw err
  }

  console.log("[api/v1/query][diag]", JSON.stringify({
    request_id: requestId,
    token_valid: !!tokenRecord,
    // shape-only universal info — never logs email/token, ไม่มี secret
    caller_role_present: callerRole() !== null,
    caller_role: callerRole(),
  }))

  // บังคับสิทธิ์ระดับ Management ที่ฝั่ง Server — token ได้สิทธิ์จาก profiles.role
  // ปัจจุบันเท่านั้น (role ถูกแก้เมื่อไร ผลทันทีที่ request ถัดไป)
  const adminTier = permissions.role_tiers.admin_tier as string[]
  if (tokenRecord && !callerRole()) {
    return NextResponse.json(
      { ok: false, error: "token ไม่ผูกกับบัญชีผู้ใช้ในระบบอีกต่อไป (ไม่มี membership) — ร้องขอ token ใหม่ที่ /admin/api-tokens", request_id: requestId },
      { status: 403, headers: corsHeaders() }
    )
  }
  if (tokenRecord && callerRole() && !adminTier.includes(callerRole() as string)) {
    return NextResponse.json(
      { ok: false, error: "role ของบัญชีผู้ถือ token ไม่มีสิทธิ์ใช้ /api/v1/query — ผู้บริหารระบบใช้ผ่าน /admin UI เท่านั้น", request_id: requestId },
      { status: 403, headers: corsHeaders() }
    )
  }

  if (!tokenRecord) {
    return NextResponse.json(
      { ok: false, error: "token ไม่ถูกต้องหรือถูก revoke แล้ว", request_id: requestId },
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
  // STEP 1: the token's profile decides the read scope. A tenant admin token
  // can no longer read another organization's companies/debts.
  const scope = await resolveTokenDataScope(callerProfile)
  const result = await runWithDataScope(scope, () => dispatch(rawCommand, args, false))

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
