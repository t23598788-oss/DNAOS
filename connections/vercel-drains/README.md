# connections/vercel-drains/ — NOT_YET_BUILT (boundary planned, 2026-08-14)

**หน้าที่:** inbound log/observability drain receiver จาก Vercel — endpoint
HTTPS ที่รับ Vercel Drains push traffic ทีละ `schema`
(`log`/`trace`/`analytics`/`speed_insights`/`audit_log`/`connect`)

**ทำไมแยกจาก `../vercel-webhooks/`:** แม้เป็น inbound เหมือนกัน แต่ data
contract ต่างกันมาก — webhook คือ lifecycle notification ปริมาณต่ำ, drain
คือ stream ปริมาณสูง มีค่าใช้จ่ายจริง ($0.50/GB ตาม pricing doc ของ Vercel)
และมี schema ต่างกัน 6 แบบ — เหตุผลเต็มอยู่ที่
[`../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md`](../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md) §3

**Input (เมื่อสร้างจริง):** HTTP POST จาก Vercel Drains ตาม schema ที่
ลงทะเบียนไว้

**Output (เมื่อสร้างจริง):** บันทึก metadata ที่จำเป็นจริง (deployment id,
status, timestamp, level) เท่านั้น — **ห้ามเก็บเนื้อหา payload ดิบทั้งก้อน
ไว้ก่อนแล้วค่อยกรองทีหลัง**

**Dependency ที่อนุญาต:** `../../contracts/event/`,
`../../config/connection-settings/` (รูปแบบ)

**สิ่งที่ห้ามแตะ:**
- **ห้ามเก็บเนื้อหา log แบบดิบราวกับเป็นข้อมูลของ repo นี้เอง** — log
  ของ deployment อาจมีข้อมูลธุรกิจของ Business Domain อื่นปนอยู่ได้ ต้อง
  ดึงเฉพาะ operational metadata ที่ต้องใช้จริง แล้วทิ้งส่วนที่เหลือ (ดู
  G-ARCH-001 และ root `README.md`'s "ต้องไม่เก็บ")
- ห้าม register/configure drain ในโฟลเดอร์นี้ — นั่นเป็น outbound call
  อยู่ที่ `../vercel/`
- ห้ามเรียกเข้า `../vercel/` หรือ `../../governance/release-gate/` ตรงๆ —
  ส่งผ่าน `EventEnvelope` เท่านั้น ตาม Capability Folder Law ข้อ 9

ไม่มีไฟล์ source ในโฟลเดอร์นี้
