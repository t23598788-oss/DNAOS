import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getJobById, setJobAssignedDriver } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

// Operator assigns (or unassigns) a driver for a job. The transporter portal
// (/api/public/transporter) shows a driver only the jobs whose
// assigned_person_id equals their driver_profiles.id, so this is the write
// path that makes that list non-empty. Body: { driver_profile_id: string | null }.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id: jobId } = await params
  const body = (await req.json().catch(() => null)) as { driver_profile_id?: unknown } | null
  const raw = body?.driver_profile_id
  if (raw !== null && typeof raw !== "string") {
    return NextResponse.json({ ok: false, error: "driver_profile_id ต้องเป็น string หรือ null" }, { status: 400 })
  }
  const driverProfileId = raw === null || raw === "" ? null : raw

  const db = supabase()
  const job = await getJobById(db, jobId)
  if (!job) return NextResponse.json({ ok: false, error: "ไม่พบงาน" }, { status: 404 })

  if (driverProfileId) {
    const { data: driver, error } = await db
      .from("driver_profiles")
      .select("id")
      .eq("id", driverProfileId)
      .is("deleted_at", null)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!driver) return NextResponse.json({ ok: false, error: "ไม่พบโปรไฟล์ผู้ขนส่ง" }, { status: 400 })
  }

  try {
    await setJobAssignedDriver(db, jobId, driverProfileId)
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "assign failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, job_id: jobId, assigned_person_id: driverProfileId })
}
