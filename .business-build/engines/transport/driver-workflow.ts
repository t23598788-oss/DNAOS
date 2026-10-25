// engines/transport/driver-workflow.ts — DNA-000234 LOCAL
// LINE-driver transport workflow: auth → GPS validation → site verification →
// canonical event recording (business_events) — ห้าม LINE เขียนตรง DB.
// Rule 71 / Guard 3: engines ห้ามสร้าง Supabase client เอง — ต้องให้ caller inject มา
// (รูปแบบเดียวกับ setLocalEventSink / setAuthorizeOverrideForTest ที่ไฟล์นี้มีอยู่แล้ว:
//  script/route ฝั่ง外面 เป็นคน createClient แล้วส่งเข้ามา — engines ไม่แตะ credential)
import type { SupabaseClient } from "@supabase/supabase-js"
import { haversine } from "@/engines/distance"
import { createBusinessEvent, buildBusinessEventRow, type CreateBusinessEventInput } from "@/engines/canonical/event-write"
import { getJobById } from "@/services/supabase/queries"

export type TransportEventType =
  | "JOB_ACCEPTED" | "ARRIVED_AT_SOURCE" | "LOADING_STARTED" | "LOADING_COMPLETED"
  | "DEPARTED_SOURCE" | "ARRIVED_AT_DESTINATION" | "PHOTO_EVIDENCE" | "DELIVERY_CONFIRMED"

export type GpsObservation = { latitude: number; longitude: number; accuracy_m: number; captured_at: string }

export type WorkflowContext = {
  lineUserId: string; jobId: string; eventType: TransportEventType
  gps?: GpsObservation; photoPath?: string; nonce: string
}

const ACCURACY_LIMIT_M = Number(process.env.DRIVER_GPS_ACCURACY_LIMIT_M ?? 100)
const MAX_AGE_MIN = Number(process.env.DRIVER_GPS_MAX_AGE_MIN ?? 5)
const seenNonces = new Set<string>() // local replay guard — prod: unique key ที่ business_events
type Rec = (table: string, row: Record<string, unknown>) => Promise<void>
let sinkRec: Rec | null = null
export function setLocalEventSink(fn: Rec | null) { sinkRec = fn }
let authOverride: ((lineUserId: string, jobId: string) => Promise<{ ok: boolean; reason?: string; driver?: Record<string, unknown>; job?: Record<string, unknown> }>) | null = null
// test-only: inject authorization (driver_profiles จริงว่างเปล่า 0 แถว — production ใช้ตัวจริงเสมอ)
export function setAuthorizeOverrideForTest(fn: typeof authOverride) { authOverride = fn }
function db(): SupabaseClient | null {
  return injectedClient
}
let injectedClient: SupabaseClient | null = null
// Rule 71: caller (route/script) สร้าง client แล้วส่งเข้ามา — engines ไม่แตะ env/credential เอง
export function setSupabaseClient(client: SupabaseClient | null) { injectedClient = client }

export function validateGps(gps: GpsObservation): { ok: boolean; reason?: string } {
  if (typeof gps.latitude !== "number" || typeof gps.longitude !== "number") return { ok: false, reason: "GPS_INVALID_COORDINATES" }
  if (gps.latitude < -90 || gps.latitude > 90 || gps.longitude < -180 || gps.longitude > 180) return { ok: false, reason: "GPS_INVALID_COORDINATES" }
  if (gps.latitude === 0 && gps.longitude === 0) return { ok: false, reason: "GPS_INVALID_COORDINATES" }
  if (typeof gps.accuracy_m !== "number" || gps.accuracy_m < 0) return { ok: false, reason: "GPS_ACCURACY_MISSING" }
  if (gps.accuracy_m > ACCURACY_LIMIT_M) return { ok: false, reason: `GPS_ACCURACY_POOR (${Math.round(gps.accuracy_m)}m>${ACCURACY_LIMIT_M}m)` }
  const t = Date.parse(gps.captured_at); const now = Date.now()
  if (Number.isNaN(t)) return { ok: false, reason: "GPS_TIMESTAMP_INVALID" }
  if (t > now + 60_000) return { ok: false, reason: "GPS_TIMESTAMP_IN_FUTURE" }
  if (now - t > MAX_AGE_MIN * 60_000) return { ok: false, reason: `GPS_STALE (>${MAX_AGE_MIN}min)` }
  return { ok: true }
}

export async function authorizeDriverAction(lineUserId: string, jobId: string):
  Promise<{ ok: boolean; reason?: string; driver?: Record<string, unknown>; job?: Record<string, unknown> }> {
  const s = db(); if (!s) return { ok: false, reason: "DB_UNAVAILABLE" }
  const { data: drv } = await s.from("driver_profiles")
    .select("id, driver_name, line_user_id, vehicle_plate_text, user_id").eq("line_user_id", lineUserId).is("deleted_at", null).maybeSingle()
  if (!drv) return { ok: false, reason: "DRIVER_NOT_AUTHORIZED (line_user_id ไม่พบใน driver_profiles)" }
  const job = await getJobById(s, jobId)
  if (!job) return { ok: false, reason: "JOB_NOT_FOUND" }
  if (job.job_status === "COMPLETED") return { ok: false, reason: "JOB_ALREADY_COMPLETED" }
  if (job.job_status === "SUSPENDED") return { ok: false, reason: "JOB_SUSPENDED" }
  return { ok: true, driver: drv, job }
}


export async function verifySiteProximity(job: { pit_profile_id?: string; site_latitude?: string | number; site_longitude?: string | number }, gps: GpsObservation) {
  const radiusKm = Number(process.env.DRIVER_SITE_RADIUS_KM ?? 0.5) // รัศมีหน้างาน/แหล่ง (config env — production ย้ายไป app_configs เมื่ออนุมัติ)
  const s = db()
  let pitLat: number | null = null, pitLng: number | null = null
  if (s && job.pit_profile_id) {
    const { data: pit } = await s.from("pit_profiles").select("latitude, longitude").eq("id", job.pit_profile_id).is("deleted_at", null).maybeSingle()
    if (pit) { pitLat = Number(pit.latitude); pitLng = Number(pit.longitude) }
  }
  const siteLat = job.site_latitude != null ? Number(job.site_latitude) : null
  const siteLng = job.site_longitude != null ? Number(job.site_longitude) : null
  const toSource = pitLat != null && pitLng != null ? haversine(gps.latitude, gps.longitude, pitLat, pitLng) : null
  const toDest = siteLat != null && siteLng != null ? haversine(gps.latitude, gps.longitude, siteLat, siteLng) : null
  const r2 = (n: number | null) => (n == null ? null : parseFloat(n.toFixed(2)))
  return {
    radius_km: radiusKm,
    to_source_km: r2(toSource), to_destination_km: r2(toDest),
    at_source: toSource != null ? toSource <= radiusKm : false,
    at_destination: toDest != null ? toDest <= radiusKm : false,
    outside_radius: (toSource ?? Infinity) > radiusKm && (toDest ?? Infinity) > radiusKm,
  }
}

// canonical path = business_events insert ผ่าน server client เท่านั้น — local sink สำหรับ test
export async function recordTransportEvent(ctx: WorkflowContext):
  Promise<{ ok: boolean; reason?: string; row?: Record<string, unknown>; verification?: unknown }> {
  if (seenNonces.has(ctx.nonce)) return { ok: false, reason: "DUPLICATE_EVENT (replay protection)" }
  seenNonces.add(ctx.nonce)
  const auth = authOverride ? await authOverride(ctx.lineUserId, ctx.jobId) : await authorizeDriverAction(ctx.lineUserId, ctx.jobId)
  if (!auth.ok) return { ok: false, reason: auth.reason }
  let verification: unknown = undefined
  if (ctx.gps) {
    const v = validateGps(ctx.gps); if (!v.ok) return { ok: false, reason: v.reason }
    verification = await verifySiteProximity(auth.job as never, ctx.gps)
  }
  // เส้นทางกลางเดียว (census D0/D1): business_events mutation ผ่าน canonical writer
  // (engines/canonical/event-write.ts) เท่านั้น — ห้าม insert ตรงที่นี่และอื่นใด
  // ทั้ง production และ test sink ได้ row shape เดียวกันจาก builder ตัวเดียวของ writer
  const canonicalInput: CreateBusinessEventInput = {
    eventCode: `driver.${ctx.eventType.toLowerCase()}`,
    eventType: "transport",
    eventDate: new Date().toISOString().slice(0, 10),
    title: `รถ: ${ctx.eventType}`,
    description: `job=${ctx.jobId}${ctx.photoPath ? ` photo=${ctx.photoPath}` : ""}`,
    source: { provider: "line", externalSubjectId: ctx.lineUserId },
    context: { job_id: ctx.jobId, gps: ctx.gps ?? null, verification },
    metadata: { recorded_by: "driver-workflow", nonce: ctx.nonce },
    actor: "driver-workflow",
  }
  const row = buildBusinessEventRow(canonicalInput)
  if (sinkRec) await sinkRec("business_events", row)
  else {
    const s = db()
    if (!s) return { ok: false, reason: "DB_UNAVAILABLE" }
    const written = await createBusinessEvent(s, canonicalInput)
    if (!written.ok) return { ok: false, reason: written.error }
    return { ok: true, row: written.data, verification }
  }
  return { ok: true, row, verification }
}

// ตรวจตาม canonical job_status เดิม — ห้าม invent status ใหม่
export function allowedForStatus(status: string): boolean {
  return status !== "SUSPENDED" && status !== "COMPLETED"
}
