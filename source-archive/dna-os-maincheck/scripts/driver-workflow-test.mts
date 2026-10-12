import { recordTransportEvent, validateGps, verifySiteProximity, authorizeDriverAction, allowedForStatus,
  setLocalEventSink, setAuthorizeOverrideForTest, setSupabaseClient } from "@/engines/transport/driver-workflow"
import { createClient } from "@supabase/supabase-js"

/* eslint-disable @typescript-eslint/no-explicit-any */
const results: string[] = []
const ck = (id: string, cond: boolean, label: string) => { results.push(`${id} ${cond ? "PASS" : "FAIL"} ${label}`); }
const sink: any[] = []
setLocalEventSink(async (_t, row) => { sink.push(row) })
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
// Rule 71: engines ไม่สร้าง client เอง — test เป็นคน inject เข้าไป (แบบเดียวกับ production caller)
setSupabaseClient(s)

// fixture: job จริง (PENDING_REVIEW + pit ที่ยังมี row จริง)
const { data: jobRows } = await s.from("jobs").select("id, job_status, site_latitude, site_longitude, pit_profile_id").eq("job_status", "PENDING_REVIEW").is("deleted_at", null).limit(10)
let job: any = null, pit: any = null
for (const j of jobRows as any[]) {
  const { data: p } = await s.from("pit_profiles").select("latitude, longitude").eq("id", j.pit_profile_id).is("deleted_at", null).maybeSingle()
  if (p && j.site_latitude != null) { job = j; pit = p; break }
  if (!job && j.site_latitude != null) job = j // fallback: pit ของงานนี้ถูกลบจริง → ทดสอบ site อย่างเดียว
}
ck("setup", !!job && allowedForStatus(job.job_status), `job จริง ${job?.id?.slice(0, 8)} · pit coords จริง: ${pit ? "มี" : "ไม่มี (pit ถูกลบ — ทดสอบ site อย่างเดียว)"}`)
const mockLine = "U-SIM-DRIVER-DNA234"
// auth override (จำลองคนขับ — driver_profiles จริงว่าง 0 แถว)
setAuthorizeOverrideForTest(async () => ({ ok: true, driver: { driver_name: "คนขับจำลอง" }, job }))

const now = () => new Date().toISOString()
const gpsAt = (lat: number, lng: number, acc = 15) => ({ latitude: lat, longitude: lng, accuracy_m: acc, captured_at: now() })

// A. เห็นงานใน LINE (mock) + อ่าน job จริงจาก DB
ck("A", job && job.id, "งานปรากฏในระบบ (REAL read · ส่ง LINE = MOCK ไม่ส่งข้อความจริง)")
// B. รับงาน
const nonceB = "n-B-" + Date.now()
const b: any = await recordTransportEvent({ lineUserId: mockLine, jobId: job.id, eventType: "JOB_ACCEPTED", nonce: nonceB })
ck("B", b.ok, "ยอมรับงานบันทึกเป็น business_events (sink จำลอง)")
// C. GPS permission granted
ck("C", validateGps(gpsAt(13.79, 100.5)).ok, "GPS ได้รับสิทธิ์ → validate ผ่าน")
// D. GPS permission denied (ไม่มี GPS → บันทึก event ได้ ไม่แต่งพิกัด)
const d: any = await recordTransportEvent({ lineUserId: mockLine, jobId: job.id, eventType: "JOB_ACCEPTED", nonce: "n-D-" + Date.now() })
ck("D", d.ok && !d.verification, "GPS ถูกปฏิเสธ → event บันทึกได้โดยไม่มีพิกัดปลอม")
// E. ถึงแหล่ง (พิกัดจริง pit ถ้ามี — ถ้า pit ถูกลบใช้ site ทดสอบ geofence จริงแทน)
const srcLat = pit ? Number(pit.latitude) : Number(job.site_latitude)
const srcLng = pit ? Number(pit.longitude) : Number(job.site_longitude)
const ve = await verifySiteProximity(job, gpsAt(srcLat, srcLng))
ck("E", pit ? (ve.at_source && !ve.outside_radius) : ve.at_destination, pit ? `geofence จริง → to_source=${ve.to_source_km}กม. ≤ รัศมี${ve.radius_km}กม. (pit จริง)` : `geofence จริง → at_destination=${ve.at_destination} (site จริง · pit ถูกลบ)`)
// F. ถึงหน้างาน (พิกัดจริง site)
const vf = await verifySiteProximity(job, gpsAt(Number(job.site_latitude), Number(job.site_longitude)))
ck("F", vf.at_destination, `ถึงหน้างานจริง → to_destination=${vf.to_destination_km}กม.`)
// G. GPS ไกลจากทั้งสองจุด
const vg = await verifySiteProximity(job, gpsAt(16.43, 102.82))
ck("G", vg.outside_radius && !vg.at_destination, `GPS ไกล → flag outside_radius (ไม่ปิดงานอัตโนมัติ)`)
// H. accuracy แย่
ck("H", !validateGps(gpsAt(13.79, 100.5, 999)).ok, "accuracy 999m → ปฏิเสธ GPS_ACCURACY_POOR")
// I. รูปหลักฐาน (mock storage path)
const i: any = await recordTransportEvent({ lineUserId: mockLine, jobId: job.id, eventType: "PHOTO_EVIDENCE", gps: gpsAt(Number(job.site_latitude), Number(job.site_longitude)), photoPath: "attachments/sim/photo-test.jpg", nonce: "n-I-" + Date.now() })
ck("I", i.ok && String(i.row?.description).includes("photo="), "รูปหลักฐานผูกกับ event+job (upload จริง = MOCK)")
// J. ยืนยันส่งมอบ (authorized) + guard job COMPLETED
const j: any = await recordTransportEvent({ lineUserId: mockLine, jobId: job.id, eventType: "DELIVERY_CONFIRMED", nonce: "n-J-" + Date.now() })
ck("J", j.ok && !allowedForStatus("COMPLETED"), "ยืนยันส่งมอบบันทึก + job COMPLETED แล้วถูกกัน")
// K. คนขับไม่ได้รับอนุญาต (REAL — driver_profiles ว่าง ทุก id ต้องถูกปฏิเสธ)
const k: any = await authorizeDriverAction("U-FAKE-999", job.id)
ck("K", !k.ok && String(k.reason).includes("DRIVER_NOT_AUTHORIZED"), `บุคคลจริง: ${k.reason?.slice(0, 45)} (REAL)`)
// L. duplicate event
const l: any = await recordTransportEvent({ lineUserId: mockLine, jobId: job.id, eventType: "JOB_ACCEPTED", nonce: nonceB })
ck("L", !l.ok && String(l.reason).includes("DUPLICATE"), "nonce ซ้ำ → DUPLICATE_EVENT กัน replay")

console.log(results.join("\n"))
console.log(`TOTAL ${results.filter((r) => r.includes("PASS")).length}/${results.length} · events in sink: ${sink.length} · production writes: 0 (sink จำลองทั้งหมด)`)
