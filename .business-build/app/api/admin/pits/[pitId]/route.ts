import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, countJobsByPitProfile } from "@/services/supabase/queries"

type Params = { params: Promise<{ pitId: string }> }
type Database = ReturnType<typeof supabase>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PitTarget = { id: string; pit_name: string; registered_name: string | null; deleted_at: string | null; is_open: boolean | null }
type PitImpact = { active_material_relationships: number; price_requests: number; partner_links: number; job_references: number; direct_document_references: number }
type ImpactSuccess = { pit: PitTarget; impact: PitImpact; blockers: string[]; dependency_graph: Record<string, unknown> }
type ImpactFailure = { error: string; status?: 404 }
type DeactivationResult = {
  ok: true
  replayed: boolean
  action: "deactivated"
  pit: { id: string; name: string; company_name: string | null }
  impact: PitImpact
  read_back: { id: string; deleted_at: string; is_open: false }
  counters_before: { total: number; active: number; inactive: number }
  counters_after: { total: number; active: number; inactive: number }
  audit_evidence: Record<string, unknown>
}

async function writeAudit(db: Database, actorId: string, entityId: string, action: string, field: string, oldValue?: string | null, newValue?: string | null) {
  return db.from("audit_logs").insert({ entity_type: "pit_profile", entity_id: entityId, action, field, old_value: oldValue ?? null, new_value: newValue ?? null, actor_user_id: actorId })
}

/** Only declared FK/canonical references are reported; document impact is never guessed. */
async function loadImpact(db: Database, pitId: string): Promise<ImpactSuccess | ImpactFailure> {
  const [pitResult, materialResult, requestResult, partnerResult] = await Promise.all([
    db.from("pit_profiles").select("id, pit_name, registered_name, deleted_at, is_open").eq("id", pitId).maybeSingle(),
    db.from("pit_materials").select("id").eq("pit_profile_id", pitId).is("deleted_at", null),
    db.from("pit_price_requests").select("id").eq("pit_profile_id", pitId),
    db.from("partners").select("id").eq("pit_profile_id", pitId),
  ])
  let jobReferences = 0
  try {
    jobReferences = await countJobsByPitProfile(db, pitId)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const firstError = [pitResult.error, materialResult.error, requestResult.error, partnerResult.error].find(Boolean)
  if (firstError) return { error: firstError.message }
  if (!pitResult.data) return { error: "ไม่พบบ่อ/แพล้นท์นี้", status: 404 as const }
  const impact = { active_material_relationships: materialResult.data?.length ?? 0, price_requests: requestResult.data?.length ?? 0, partner_links: partnerResult.data?.length ?? 0, job_references: jobReferences, direct_document_references: 0 }
  const blockers = [impact.active_material_relationships > 0 ? "active_material_relationships" : null, impact.price_requests > 0 ? "price_requests" : null, impact.partner_links > 0 ? "partner_links" : null, impact.job_references > 0 ? "job_references" : null].filter((value): value is string => Boolean(value))
  return {
    pit: pitResult.data,
    impact,
    blockers,
    dependency_graph: {
      target: { table: "pit_profiles", id: pitResult.data.id, name: pitResult.data.pit_name, company_name: pitResult.data.registered_name ?? null },
      foreign_keys: [
        { table: "pit_materials", relation: "pit_materials.pit_profile_id", active_count: impact.active_material_relationships, action: "archive on deactivate; blocks permanent delete" },
        { table: "pit_price_requests", relation: "pit_price_requests.pit_profile_id", count: impact.price_requests, action: "retain; blocks permanent delete" },
        { table: "partners", relation: "partners.pit_profile_id", count: impact.partner_links, action: "retain; blocks permanent delete even though database FK is SET NULL" },
      ],
      canonical_references: [{ table: "jobs", relation: "jobs.pit_profile_id", count: impact.job_references, action: "retain; blocks permanent delete" }],
      documents_and_transactions: { direct_pit_foreign_key_count: 0, discovery: "ไม่มี direct pit_profile_id foreign key ใน document/transaction schema ที่ canonical route ตรวจได้; partner links, price requests และ jobs ด้านบนคือ references ที่ตรวจพบจริง" },
      cost_engine: { reads: "engines/cost.ts reads active pit_materials by pit_profile_id + material_type_id", effect: impact.active_material_relationships > 0 ? "deactivation archives these prices; future calculations for this source/material will no longer resolve a verified price" : "no active price relation from this source is currently read by the cost engine" },
    },
  }
}

function expectedConfirmation(pit: { id: string; pit_name: string }, value: unknown) {
  return typeof value === "string" && (value.trim() === pit.id || value.trim() === pit.pit_name.trim())
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { pitId } = await params
  const body = await req.json().catch(() => ({}))
  const db = supabase()
  const { data: before, error: findError } = await db.from("pit_profiles").select("id, pit_name, registered_name, contact_name, phone, address, latitude, longitude, facility_type_id, is_open, deleted_at").eq("id", pitId).maybeSingle()
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 })
  if (!before) return NextResponse.json({ error: "ไม่พบบ่อ/แพล้นท์นี้" }, { status: 404 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const textFields = ["pit_name", "registered_name", "contact_name", "phone", "address"] as const
  for (const field of textFields) {
    if (!(field in body)) continue
    if (typeof body[field] !== "string") return NextResponse.json({ error: `${field} ต้องเป็นข้อความ` }, { status: 400 })
    const value = body[field].trim()
    if (field === "pit_name" && !value) return NextResponse.json({ error: "ต้องระบุชื่อบ่อ/แพล้นท์" }, { status: 400 })
    if (field === "pit_name" && value.length > 200) return NextResponse.json({ error: "ชื่อบ่อ/แพล้นท์ยาวเกิน 200 ตัวอักษร" }, { status: 400 })
    patch[field] = value || null
  }
  const hasLatitude = "latitude" in body
  const hasLongitude = "longitude" in body
  if (hasLatitude !== hasLongitude) return NextResponse.json({ error: "ต้องระบุ latitude และ longitude พร้อมกัน" }, { status: 400 })
  if (hasLatitude) {
    const latitude = Number(body.latitude), longitude = Number(body.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) return NextResponse.json({ error: "พิกัดไม่ถูกต้อง" }, { status: 400 })
    patch.latitude = latitude
    patch.longitude = longitude
  }
  if ("facility_type_id" in body) {
    if (body.facility_type_id !== null && body.facility_type_id !== "" && (typeof body.facility_type_id !== "string" || !UUID_RE.test(body.facility_type_id))) return NextResponse.json({ error: "facility_type_id ไม่ถูกต้อง" }, { status: 400 })
    if (typeof body.facility_type_id === "string") {
      const { data: type } = await db.from("facility_types").select("id").eq("id", body.facility_type_id).maybeSingle()
      if (!type) return NextResponse.json({ error: "ไม่พบประเภทกิจการนี้ใน facility_types" }, { status: 400 })
    }
    patch.facility_type_id = body.facility_type_id || null
  }
  const { data: updated, error: updateError } = await db.from("pit_profiles").update(patch).eq("id", pitId).select("id, pit_name, registered_name, contact_name, phone, address, latitude, longitude, facility_type_id, is_open, deleted_at, updated_at").single()
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  const { error: auditError } = await writeAudit(db, auth.id, pitId, "updated", "pit_profiles", JSON.stringify(before), JSON.stringify(updated))
  if (auditError) return NextResponse.json({ error: `บันทึกแล้วแต่สร้าง audit evidence ไม่สำเร็จ: ${auditError.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, pit: updated })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { pitId } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action
  if (action !== "preview" && action !== "deactivate" && action !== "delete_test") return NextResponse.json({ error: "action ต้องเป็น preview, deactivate หรือ delete_test" }, { status: 400 })
  if (!UUID_RE.test(pitId)) return NextResponse.json({ error: "pitId ไม่ถูกต้อง" }, { status: 400 })
  const db = supabase()
  const impactResult = await loadImpact(db, pitId)
  if ("error" in impactResult) return NextResponse.json({ error: impactResult.error }, { status: impactResult.status ?? 500 })
  const { pit, impact, blockers, dependency_graph: dependencyGraph } = impactResult
  const response = {
    pit: { id: pit.id, name: pit.pit_name, company_name: pit.registered_name ?? null }, impact, dependency_graph: dependencyGraph,
    permanent_delete_allowed: false,
    permanent_delete_blockers: ["permanent_delete_disabled_jobs_pit_profile_id_has_no_foreign_key", ...blockers],
    deactivation_plan: { records_to_archive: { pit_profiles: 1, active_pit_materials: impact.active_material_relationships }, records_to_retain: { pit_price_requests: impact.price_requests, partners: impact.partner_links, jobs: impact.job_references, material_types: "all" } },
  }
  if (action === "preview") return NextResponse.json({ ok: true, ...response })
  if (action === "delete_test") return NextResponse.json({ error: "ลบถาวรถูกปิดไว้: jobs.pit_profile_id ไม่มี FK จึงพิสูจน์การป้องกัน orphan reference ไม่ได้", ...response }, { status: 409 })
  const operationId = typeof body?.operation_id === "string" ? body.operation_id : ""
  if (!UUID_RE.test(operationId)) return NextResponse.json({ error: "operation_id ต้องเป็น UUID เพื่อป้องกันการส่งคำสั่งซ้ำ" }, { status: 400 })
  if (!expectedConfirmation(pit, body?.confirmation)) return NextResponse.json({ error: "ต้องพิมพ์ชื่อแหล่งหรือ Record ID ให้ตรงกับรายการที่จะดำเนินการ" }, { status: 400 })
  // The RPC is the sole destructive writer. It takes the operation claim,
  // locks/re-checks references, archives materials, deactivates the pit, writes
  // both audits and counters, and commits or rolls everything back together.
  const { data, error } = await db.rpc("deactivate_pit_resource", {
    p_pit_id: pitId,
    p_operation_id: operationId,
    p_actor_user_id: auth.id,
  })
  if (error || !data) {
    const message = error?.message ?? "transactional deactivation returned no result"
    const status = /pit_not_found/.test(message) ? 404 : /already_deactivated|operation_id_reused|jobs_pit_reference_schema_unavailable/.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json(data as unknown as DeactivationResult)
}