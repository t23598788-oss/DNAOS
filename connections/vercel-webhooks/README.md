# connections/vercel-webhooks/ — NOT_YET_BUILT (boundary planned, 2026-08-14)

**หน้าที่:** inbound webhook receiver จาก Vercel เท่านั้น — endpoint HTTPS
ที่รับ `POST` payload ของ Vercel (`deployment.*`, `project.*`, `domain.*`,
`budget.reached`, ...), ตรวจ `x-vercel-signature` (HMAC-SHA1 กับ webhook
secret) ก่อนเชื่อถือ body ใดๆ แล้วแปลง payload ที่ตรวจผ่านแล้วเป็น
`EventEnvelope`

**ทำไมแยกจาก `../vercel/`:** ทิศทางข้อมูลตรงข้ามกัน (`../vercel/` = DNA OS
เรียก Vercel ขาออก, ที่นี่ = Vercel เรียกเข้ามา) failure mode ต่างกัน
(ขาเข้าต้องตอบเร็วและถูกตั้งแต่ครั้งแรก ตาม schedule ของ Vercel ไม่ใช่ของ
เรา) และรูปแบบ credential ต่างกัน (ที่นี่ตรวจ signature ที่ Vercel ส่งมา
ไม่ใช่ส่ง bearer token ออกไป) — เหตุผลเต็มอยู่ที่
[`../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md`](../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md) §2

**Input (เมื่อสร้างจริง):** HTTP POST จาก Vercel พร้อม `x-vercel-signature`
header

**Output (เมื่อสร้างจริง):** `EventEnvelope` — เฉพาะ payload ที่ผ่านการตรวจ
signature แล้วเท่านั้น

**Dependency ที่อนุญาต:** `../../contracts/event/`,
`../../contracts/identity/`, `../../config/connection-settings/` (รูปแบบ)

**สิ่งที่ห้ามแตะ:**
- ห้ามเชื่อถือ body ใดๆ ก่อนตรวจ `x-vercel-signature` ผ่านเสมอ
- ห้าม register/list/delete webhook ในโฟลเดอร์นี้ — นั่นเป็น outbound call
  อยู่ที่ `../vercel/` (`POST/GET/DELETE /v1/webhooks`)
- ห้ามเรียกเข้า `../vercel/` หรือ `../../governance/release-gate/` ตรงๆ —
  ส่งผ่าน `EventEnvelope` เท่านั้น ตาม Capability Folder Law ข้อ 9

ไม่มีไฟล์ source ในโฟลเดอร์นี้
