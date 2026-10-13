import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ pitId: string }> }

// Fills in real GPS for pits that don't have it yet (9 of 96 pits per the
// 2026-07-11 audit) — the pricing engine (engines/distance.ts) can't find a
// pit at all without real coordinates.

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { pitId } = await params
  const body = await req.json().catch(() => ({}))
  const hasGps = !!body && typeof body === "object" && "latitude" in body && "longitude" in body
  const hasType = !!body && typeof body === "object" && "facility_type_id" in body
  if (!hasGps && !hasType) {
    return NextResponse.json({ error: "ต้องระบุ latitude/longitude หรือ facility_type_id" }, { status: 400 })
  }

  const db = supabase()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  // เส้นทางเดิม (ไม่เปลี่ยนพฤติกรรม): บันทึกพิกัด GPS
  if (hasGps) {
    const latitude = Number(body.latitude)
    const longitude = Number(body.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) {
      return NextResponse.json({ error: "พิกัดไม่ถูกต้อง" }, { status: 400 })
    }
    patch.latitude = latitude
    patch.longitude = longitude
  }

  // เส้นทางใหม่: บันทึกประเภทสถานประกอบการ (คอลัมน์เดิม pit_profiles.facility_type_id)
  if (hasType) {
    const typeId: unknown = body.facility_type_id
    if (typeId !== null) {
      if (typeof typeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(typeId)) {
        return NextResponse.json({ error: "facility_type_id ไม่ถูกต้อง" }, { status: 400 })
      }
      const { data: ftRow, error: ftErr } = await db.from("facility_types").select("id").eq("id", typeId).maybeSingle()
      if (ftErr) return NextResponse.json({ error: ftErr.message }, { status: 500 })
      if (!ftRow) return NextResponse.json({ error: "ไม่พบประเภทกิจการนี้ใน facility_types" }, { status: 400 })
    }
    // null = ยกเลิกการบันทึก แล้วให้หน้าจอแสดงประเภทที่อนุมานจากหลักฐานแทน (ไม่เขียนทับอัตโนมัติ)
    patch.facility_type_id = typeId
  }

  // ตรวจว่าบ่อมีอยู่จริงก่อนเขียน — ไม่พบ → 404 (ห้ามตอบ 200 เมื่อไม่มีแถวถูกเปลี่ยน)
  const { data: pitRow, error: findErr } = await db
    .from("pit_profiles")
    .select("id")
    .eq("id", pitId)
    .maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
  if (!pitRow) return NextResponse.json({ error: "ไม่พบบ่อ/แพล้นท์นี้" }, { status: 404 })

  const { data: updated, error } = await db
    .from("pit_profiles")
    .update(patch)
    .eq("id", pitId)
    .select("id")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    // ต้องไม่มีทางตอบ 200 เมื่อไม่มีแถวใดถูกเปลี่ยนจริง
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ: ไม่มีแถวถูกเปลี่ยนแปลง" }, { status: 500 })
  }
  return NextResponse.json({ ok: true, updated: updated.length })
}
