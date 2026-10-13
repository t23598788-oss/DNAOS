import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolveBusinessType, BUSINESS_TYPE_LABELS } from "./_lib/businessType"

// Real pit/quarry inventory that the pricing engines (engines/distance.ts,
// engines/cost.ts) actually read from — pit_profiles + pit_materials joined
// to real material names, so the control room shows exactly what the
// pricing pipeline can and can't compute yet (owner instruction 2026-07-10:
// this must live in the real control room, connected to the live database,
// not a one-off report).

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()

  const [{ data: pits, error }, { data: pitMaterials }, { data: materialTypes }, { data: facilityTypes }] = await Promise.all([
    db.from("pit_profiles")
      .select("id, pit_name, address, latitude, longitude, deleted_at, line_user_id, facility_type_id")
      .order("pit_name"),
    db.from("pit_materials")
      .select("pit_profile_id, material_type_id, price")
      .is("deleted_at", null),
    db.from("material_types").select("id, name"),
    db.from("facility_types").select("id, code, name, name_th").order("code"),
  ])

  if (error) {
    console.error("[pits] list query failed:", error.message)
    return NextResponse.json({ pits: [], materialTypes: materialTypes ?? [] })
  }

  const materialNameById = new Map((materialTypes ?? []).map((m) => [m.id, m.name]))
  const materialsByPit = new Map<string, { material_type_id: string; name: string; price: number }[]>()
  for (const pm of pitMaterials ?? []) {
    const name = materialNameById.get(pm.material_type_id)
    if (!name) continue
    const list = materialsByPit.get(pm.pit_profile_id) ?? []
    list.push({ material_type_id: pm.material_type_id, name, price: Number(pm.price) })
    materialsByPit.set(pm.pit_profile_id, list)
  }

  const provinceOf = (addr: string | null) => {
    const m = (addr ?? "").match(/จ\.?\s*([ก-๙]+)/)
    return m ? m[1] : null
  }

  const result = (pits ?? []).map((p) => {
    const materials = materialsByPit.get(p.id) ?? []
    // อนุมานจากข้อมูลเดิม (ชื่อ + วัสดุที่ผูกราคา) — อ่านอย่างเดียว ไม่เขียน DB
    const derived = resolveBusinessType({ pit_name: p.pit_name, materialNames: materials.map((m) => m.name) })
    // ลำดับความสำคัญ: 1) ค่าที่บันทึกจริงใน facility_type_id → 2) อนุมานจากหลักฐาน → 3) ยังจำแนกไม่ได้
    const stored = p.facility_type_id
      ? (facilityTypes ?? []).find((f) => f.id === p.facility_type_id) ?? null
      : null
    const type = stored
      ? { code: stored.code, label: stored.name_th || stored.name, source: "STORED", evidence: `บันทึกจริงใน facility_types (${stored.code})` }
      : derived.code !== "UNCLASSIFIED"
        ? { code: derived.code, label: derived.label, source: "INFERRED", evidence: derived.evidence }
        : { code: "UNCLASSIFIED", label: derived.label, source: "NONE", evidence: derived.evidence }
    return {
      id: p.id,
      name: p.pit_name,
      address: p.address,
      province: provinceOf(p.address),
      lat: p.latitude && Number(p.latitude) !== 0 ? Number(p.latitude) : null,
      lng: p.longitude && Number(p.longitude) !== 0 ? Number(p.longitude) : null,
      materials,
      active: !p.deleted_at,
      line_user_id: p.line_user_id ?? null,
      facility_type_id: p.facility_type_id ?? null,
      business_type: type.code,
      business_type_label: type.label,
      type_source: type.source,
      type_evidence: type.evidence,
      business_type_evidence: type.evidence,
    }
  })

  const typeCounts: Record<string, number> = {}
  for (const r of result) typeCounts[r.business_type] = (typeCounts[r.business_type] ?? 0) + 1
  const typeLabels: Record<string, string> = { ...BUSINESS_TYPE_LABELS }
  for (const f of facilityTypes ?? []) typeLabels[f.code] = f.name_th || f.name

  return NextResponse.json({ pits: result, materialTypes: materialTypes ?? [], facilityTypes: facilityTypes ?? [], typeCounts, typeLabels })
}

// Owner request 2026-10-13 (Business Workspace ใหม่ /biz): ตารางวัตถุดิบต้อง
// "เพิ่มบ่อ/แพล้นท์ใหม่ได้จริง" — ก่อนหน้านี้เป็น read-only พอถึงขั้นตอนเพิ่มก็ติดว่า
// ไม่มี POST path เลย (ปุ่มเพิ่มในหน้าถูกปิดไว้พร้อมเหตุผล "ยังไม่มี API สร้างบ่อใหม่")
// เส้นทางนี้เขียนลงตารางเดิม pit_profiles (คอลัมน์เดิมทั้งหมด ไม่มีตารางใหม่) และ
// บังคับสิทธิ์ ADMIN_TIER เหมือน GET/PATCH อื่นของโฟลเดอร์นี้
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const pitName = typeof body?.pit_name === "string" ? body.pit_name.trim() : ""
  if (!pitName) return NextResponse.json({ error: "ต้องระบุชื่อบ่อ/แพล้นท์" }, { status: 400 })
  if (pitName.length > 200) return NextResponse.json({ error: "ชื่อบ่อ/แพล้นท์ยาวเกิน 200 ตัวอักษร" }, { status: 400 })

  const address = typeof body?.address === "string" && body.address.trim() ? body.address.trim() : null

  // พิกัด GPS: ถ้าส่งมาต้องถูกต้องทั้งคู่ (กติกาเดียวกับ PATCH — ค่า 0 ใช้แทน "ไม่ทราบพิกัด" ไม่ได้)
  let latitude: number | null = null
  let longitude: number | null = null
  if ("latitude" in body || "longitude" in body) {
    latitude = Number(body.latitude)
    longitude = Number(body.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) {
      return NextResponse.json({ error: "พิกัดไม่ถูกต้อง (ต้องระบุทั้งละติจูดและลองจิจูดที่ไม่ใช่ 0)" }, { status: 400 })
    }
  }

  // ประเภทสถานประกอบการ: ถ้าส่งมาต้องมีอยู่จริงใน facility_types (ไม่เดา ไม่สร้าง code ใหม่)
  let facilityTypeId: string | null = null
  const rawType = body?.facility_type_id
  if (rawType !== undefined && rawType !== null && rawType !== "") {
    if (typeof rawType !== "string" || !UUID_RE.test(rawType)) {
      return NextResponse.json({ error: "facility_type_id ไม่ถูกต้อง" }, { status: 400 })
    }
    const db = supabase()
    const { data: ftRow, error: ftErr } = await db.from("facility_types").select("id").eq("id", rawType).maybeSingle()
    if (ftErr) return NextResponse.json({ error: ftErr.message }, { status: 500 })
    if (!ftRow) return NextResponse.json({ error: "ไม่พบประเภทกิจการนี้ใน facility_types" }, { status: 400 })
    facilityTypeId = rawType
  }

  const row: Record<string, unknown> = {
    id: crypto.randomUUID(),
    pit_name: pitName,
    address,
    latitude,
    longitude,
    facility_type_id: facilityTypeId,
    updated_at: new Date().toISOString(),
  }

  const db = supabase()
  const { data: created, error } = await db.from("pit_profiles").insert(row).select("id, pit_name").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, pit: created }, { status: 201 })
}
