/**
 * /api/admin/roles — USER ROLE MAPPING.
 *
 * The network-role layer the owner asked for ("เพิ่มฟิลด์ role ในระบบ เช่น
 * ROLE_CUSTOMER, ROLE_SUPPLIER_SAND, ROLE_TRANSPORTER, ROLE_ENGINEER"):
 *
 *   GET    → role catalog + every assignment + partner candidates for the picker
 *   POST   → assign a role to a partner / LINE user / profile (idempotent upsert)
 *   PATCH  → change one assignment (active flag, line_user_id, display_name, note)
 *   DELETE → remove one assignment (?id=)
 *
 * This is deliberately separate from the login tier on public.profiles.role
 * (app_role) — that decides what a user may OPEN; this decides who a business
 * event is ROUTED to (engines/rules).
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"

const SUBJECT_KINDS = ["partner", "line_user", "profile"] as const
type SubjectKind = (typeof SUBJECT_KINDS)[number]

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabaseAdmin()

  const [rolesRes, assignmentsRes, partnersRes] = await Promise.all([
    db
      .from("role_definitions")
      .select("code, label_th, label_en, description_th, notify_channel, sort_order, active")
      .order("sort_order"),
    db
      .from("role_assignments")
      .select("id, role_code, subject_kind, subject_id, display_name, line_user_id, partner_id, active, note, created_at, updated_at")
      .order("role_code")
      .order("display_name"),
    // Candidate list for the picker. 300 is a control-room-sized page, not a
    // dump of every partner row (the table ordering keeps it stable).
    db
      .from("partners")
      .select("id, name, partner_type_label, phone, role_name")
      .is("deleted_at", null)
      .order("name")
      .limit(300),
  ])

  if (rolesRes.error) {
    console.error("[roles] role_definitions read failed:", rolesRes.error.message)
    return NextResponse.json(
      { roles: [], assignments: [], partners: [], error: rolesRes.error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    roles: rolesRes.data ?? [],
    assignments: assignmentsRes.data ?? [],
    partners: partnersRes.data ?? [],
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const roleCode = typeof body?.roleCode === "string" ? body.roleCode.trim() : ""
  const subjectKind = typeof body?.subjectKind === "string" ? body.subjectKind.trim() : ""
  const subjectId = typeof body?.subjectId === "string" ? body.subjectId.trim() : ""

  if (!roleCode) return badRequest("ต้องระบุ roleCode")
  if (!SUBJECT_KINDS.includes(subjectKind as SubjectKind)) {
    return badRequest(`subjectKind ต้องเป็นหนึ่งใน ${SUBJECT_KINDS.join(", ")}`)
  }
  if (!subjectId) return badRequest("ต้องระบุ subjectId (partner id / LINE userId / profile id)")

  const lineUserId = typeof body?.lineUserId === "string" && body.lineUserId.trim() ? body.lineUserId.trim() : null
  const displayName = typeof body?.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : null
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null

  const db = supabaseAdmin()

  const { data: role, error: roleError } = await db
    .from("role_definitions")
    .select("code")
    .eq("code", roleCode)
    .maybeSingle()
  if (roleError) {
    console.error("[roles] role lookup failed:", roleError.message)
    return NextResponse.json({ error: roleError.message }, { status: 500 })
  }
  if (!role) return badRequest(`ไม่พบ role ${roleCode} ใน role_definitions`)

  // A partner assignment carries the partner id AND (when known) the LINE id of
  // the person to notify — the rules engine pushes to line_user_id only.
  const row = {
    role_code: roleCode,
    subject_kind: subjectKind,
    subject_id: subjectId,
    display_name: displayName,
    line_user_id: lineUserId,
    partner_id: subjectKind === "partner" ? subjectId : null,
    note,
    active: body?.active === false ? false : true,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await db
    .from("role_assignments")
    .upsert(row, { onConflict: "role_code,subject_kind,subject_id" })
    .select("id, role_code, subject_kind, subject_id, display_name, line_user_id, partner_id, active, note, created_at, updated_at")
    .single()

  if (error) {
    console.error("[roles] assignment upsert failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ assignment: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === "string" ? body.id.trim() : ""
  if (!id) return badRequest("ต้องระบุ id ของ role assignment")

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body?.active === "boolean") patch.active = body.active
  if (typeof body?.lineUserId === "string") patch.line_user_id = body.lineUserId.trim() || null
  if (typeof body?.displayName === "string") patch.display_name = body.displayName.trim() || null
  if (typeof body?.note === "string") patch.note = body.note.trim() || null

  const db = supabaseAdmin()
  const { data, error } = await db
    .from("role_assignments")
    .update(patch)
    .eq("id", id)
    .select("id, role_code, subject_kind, subject_id, display_name, line_user_id, partner_id, active, note, created_at, updated_at")
    .single()

  if (error) {
    console.error("[roles] assignment update failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ assignment: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return badRequest("ต้องระบุ ?id= ของ role assignment")

  const db = supabaseAdmin()
  const { error } = await db.from("role_assignments").delete().eq("id", id)

  if (error) {
    console.error("[roles] assignment delete failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
