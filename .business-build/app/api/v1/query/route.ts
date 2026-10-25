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
import { validateApiToken } from "@/services/supabase/api-tokens"
import { dispatch } from "@/engines/validation/dispatcher"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin } from "@/services/supabase/queries"
import commandRegistry from "@/registry/command-registry.json"
import capabilityRegistry from "@/registry/capability-registry.json"
import { decideCommandAccess } from "@/core/auth/apiCommandAccess"

/**
 * Core chain wiring (P2): the registry already links a command to its owner
 * module (registry/command-registry.json -> commands[<name>].owner) and a
 * capability to the same owner module (registry/capability-registry.json ->
 * capabilities[].OwnerModule). This resolves command -> capability ids from
 * those two existing registries only — no new mapping table, no second source
 * of truth. An unresolved command returns empty lists, never a guess.
 */
function capabilityContextForCommand(command: string): {
  owner_module: string | null
  capability_ids: string[]
} {
  const commands = (commandRegistry as { commands?: Record<string, { owner?: string }> }).commands ?? {}
  const ownerModule = commands[command]?.owner ?? null
  if (!ownerModule) return { owner_module: null, capability_ids: [] }
  const normalized = ownerModule.replace(/\.ts$/, "")
  const capabilities =
    (capabilityRegistry as { capabilities?: { CapabilityId: string; OwnerModule: string }[] }).capabilities ?? []
  const capabilityIds = capabilities
    .filter((entry) => entry.OwnerModule.replace(/\.ts$/, "") === normalized)
    .map((entry) => entry.CapabilityId)
  return { owner_module: ownerModule, capability_ids: capabilityIds }
}

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
    "Access-Control-Allow-Headers": "Content-Type, X-DNA-Token, X-DNA-Org",
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

  const tokenRecord = await validateApiToken(trimmedToken, requestId)
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

  // ── Verified identity / org scope ──
  // A token proves WHICH user issued it, never WHICH tenant it may read.
  // The organization must be named explicitly (X-DNA-Org) and the token
  // owner's membership + company ownership are verified server-side.
  if (!tokenRecord.scopes.includes("read")) {
    return NextResponse.json(
      { ok: false, error: "token นี้ไม่มี scope 'read'", request_id: requestId },
      { status: 403, headers: corsHeaders() }
    )
  }
  const orgId = (req.headers.get("x-dna-org") ?? "").trim()
  if (!orgId) {
    return NextResponse.json(
      { ok: false, code: "ORG_REQUIRED", error: "ต้องระบุ X-DNA-Org header (organization scope ไม่มีค่าเริ่มต้น)", request_id: requestId },
      { status: 403, headers: corsHeaders() }
    )
  }
  const db = supabaseAdmin()
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, role")
    .eq("email", tokenRecord.user_email)
    .maybeSingle()
  if (profileError || !profile) {
    return NextResponse.json(
      { ok: false, code: "AUTH_REQUIRED", error: "token owner ไม่มี profile ผู้ใช้จริง", request_id: requestId },
      { status: 401, headers: corsHeaders() }
    )
  }
  const scopeResult = await resolveVerifiedScope(db, {
    auth: { id: String(profile.id), role: String(profile.role) },
    organizationId: orgId,
  })
  if (!scopeResult.ok) {
    return NextResponse.json(
      { ok: false, code: scopeResult.code, error: scopeResult.reason, request_id: requestId },
      { status: 403, headers: corsHeaders() }
    )
  }

  // ── Command permission (default DENY) — same decision /api/v1/spec uses ──
  const commandEntry = (commandRegistry as { commands?: Record<string, { requires_confirmation?: boolean }> }).commands?.[rawCommand]
  const access = decideCommandAccess(rawCommand, {
    role: String(profile.role),
    tokenScopes: tokenRecord.scopes,
    organizationVerified: true,
  }, { requiresConfirmation: commandEntry?.requires_confirmation === true })
  if (!access.allowed) {
    return NextResponse.json(
      { ok: false, code: access.code, command: rawCommand, error: access.reason, request_id: requestId },
      { status: 403, headers: corsHeaders() }
    )
  }

  // ── Dispatch ── (ผ่าน Dispatcher ซึ่งตรวจ registry + rule 72 + scope)
  const result = await dispatch(rawCommand, args, false, { scope: scopeResult.scope })

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
      capability: capabilityContextForCommand(rawCommand),
    },
    { headers: corsHeaders() }
  )
}
