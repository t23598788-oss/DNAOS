/**
 * /api/admin/rules — EVENT-DRIVEN RULES.
 *
 *   GET   → every rule (priority order) + the last 20 evaluations
 *   POST  → create a rule (event type + target roles + action + template)
 *   PATCH → edit / enable / disable one rule
 *
 * Evaluation itself lives in engines/rules and is triggered through
 * /api/admin/rules/run (dry run by default) or by the webhook that raises the
 * event. This route only stores the rulebook.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"

const RULE_SELECT =
  "id, code, name, event_type, target_roles, action, channel, message_template, conditions, priority, active, created_at, updated_at"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/** Rules store `conditions` as JSON; the UI edits it as JSON text. */
function parseConditions(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: {} }
  if (typeof raw === "object" && !Array.isArray(raw)) return { ok: true, value: raw as Record<string, unknown> }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "conditions ต้องเป็น JSON object" }
      }
      return { ok: true, value: parsed as Record<string, unknown> }
    } catch {
      return { ok: false, error: "conditions ไม่ใช่ JSON ที่ถูกต้อง" }
    }
  }
  return { ok: false, error: "conditions ต้องเป็น JSON object" }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabaseAdmin()
  const [rulesRes, runsRes] = await Promise.all([
    db.from("event_rules").select(RULE_SELECT).order("priority").order("code"),
    db
      .from("event_rule_runs")
      .select("id, rule_code, event_type, event_key, mode, matched, targets, status, error, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  if (rulesRes.error) {
    console.error("[rules] read failed:", rulesRes.error.message)
    return NextResponse.json({ rules: [], runs: [], error: rulesRes.error.message }, { status: 500 })
  }

  return NextResponse.json({ rules: rulesRes.data ?? [], runs: runsRes.data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)

  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : ""
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  const eventType = typeof body?.eventType === "string" ? body.eventType.trim().toUpperCase() : ""
  const targetRoles: string[] = Array.isArray(body?.targetRoles)
    ? body.targetRoles.filter((r: unknown): r is string => typeof r === "string" && r.trim() !== "")
    : []
  const action = body?.action === "flag_exception" ? "flag_exception" : "notify_line"
  const channel = body?.channel === "in_app" ? "in_app" : "line"
  const messageTemplate = typeof body?.messageTemplate === "string" ? body.messageTemplate.trim() : null

  if (!code) return badRequest("ต้องระบุ code ของกฎ")
  if (!/^[A-Z0-9_]{3,64}$/.test(code)) return badRequest("code ใช้ได้เฉพาะ A-Z, 0-9 และ _ (3–64 ตัว)")
  if (!name) return badRequest("ต้องระบุชื่อกฎ")
  if (!eventType) return badRequest("ต้องระบุ eventType (เช่น EVENT_ORDER_CREATED)")
  if (targetRoles.length === 0) return badRequest("ต้องเลือกอย่างน้อย 1 role ปลายทาง")

  const conditions = parseConditions(body?.conditions)
  if (!conditions.ok) return badRequest(conditions.error)

  const db = supabaseAdmin()
  const { data, error } = await db
    .from("event_rules")
    .insert({
      code,
      name,
      event_type: eventType,
      target_roles: targetRoles,
      action,
      channel,
      message_template: messageTemplate,
      conditions: conditions.value,
      priority: Number.isFinite(Number(body?.priority)) ? Number(body.priority) : 100,
      active: body?.active === false ? false : true,
    })
    .select(RULE_SELECT)
    .single()

  if (error) {
    const duplicate = error.code === "23505"
    console.error("[rules] insert failed:", error.message)
    return NextResponse.json(
      { error: duplicate ? `มีกฎ code ${code} อยู่แล้ว` : error.message },
      { status: duplicate ? 409 : 500 },
    )
  }

  return NextResponse.json({ rule: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === "string" ? body.id.trim() : ""
  if (!id) return badRequest("ต้องระบุ id ของกฎ")

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body?.name === "string") patch.name = body.name.trim()
  if (typeof body?.eventType === "string" && body.eventType.trim()) {
    patch.event_type = body.eventType.trim().toUpperCase()
  }
  if (Array.isArray(body?.targetRoles)) {
    const roles = body.targetRoles.filter((r: unknown): r is string => typeof r === "string" && r.trim() !== "")
    if (roles.length === 0) return badRequest("ต้องเลือกอย่างน้อย 1 role ปลายทาง")
    patch.target_roles = roles
  }
  if (body?.action === "notify_line" || body?.action === "flag_exception") patch.action = body.action
  if (body?.channel === "line" || body?.channel === "in_app") patch.channel = body.channel
  if (typeof body?.messageTemplate === "string") patch.message_template = body.messageTemplate.trim() || null
  if (body?.conditions !== undefined) {
    const conditions = parseConditions(body.conditions)
    if (!conditions.ok) return badRequest(conditions.error)
    patch.conditions = conditions.value
  }
  if (Number.isFinite(Number(body?.priority))) patch.priority = Number(body.priority)
  if (typeof body?.active === "boolean") patch.active = body.active

  const db = supabaseAdmin()
  const { data, error } = await db.from("event_rules").update(patch).eq("id", id).select(RULE_SELECT).single()

  if (error) {
    console.error("[rules] update failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rule: data })
}
