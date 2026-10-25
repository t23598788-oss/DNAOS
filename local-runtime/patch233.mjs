// patch233: distance labeling — node (utf8 safe)
import { readFileSync, writeFileSync } from "node:fs"
const p = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/engines/validation/dispatcher.ts"
let s = readFileSync(p, "utf8")
const old = `return { distance_km: dist.distance_km, duration: time, fuel, trips, note: "ประมาณการจาก haversine + อัตราเร็ว/น้ำมันจาก config ระบบ" };`
const neu = `return { distance_km: dist.distance_km, distance_method: "straight-line (haversine) — ไม่ใช่ระยะทางถนนจริง", eta_note: "เวลาประมาณการจากอัตราเร็วเฉลี่ยใน config — ไม่ใช่ ETA จริง", duration: time, fuel, trips };`
if (s.includes(old)) { s = s.replace(old, neu); writeFileSync(p, s); console.log("distance labeling fixed") }
else if (s.includes("distance_method")) console.log("already labeled")
else console.log("MARKER MISMATCH — ตรวจ manual")
