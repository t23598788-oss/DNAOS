# connections/vercel/ — NOT_YET_BUILT (boundary planned, 2026-08-14)

**หน้าที่:** adapter สำหรับเชื่อมต่อ Vercel — เรียก Vercel REST API ขาออก
เท่านั้น (deploy, promote, rollback, env var, domain, build config, อ่าน
สถานะ deployment/Checks) เก็บ source code ของตัวเชื่อมเท่านั้น

**สถานะรอบนี้ (Owner, 2026-08-14):** ยังไม่มีการสร้าง full capability —
รอบนี้มีแค่การวางขอบเขต (boundary plan) และแผน test เท่านั้น ดู
[`../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md`](../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md)
ไม่มีไฟล์ source ในโฟลเดอร์นี้จนกว่าจะได้รับอนุมัติรอบถัดไป

**Input (เมื่อสร้างจริง):** `CommandEnvelope` ที่ route มาจาก
`../../control/command-router/`

**Output (เมื่อสร้างจริง):** `EventEnvelope` — ผ่าน mechanism เดียวกับที่
`connections/github/` ใช้จริงแล้ว (`operational-bridge` ยังไม่มี transport
จริง — ดูหมายเหตุใน `connections/github/README.md`)

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`,
`../../contracts/command/`, `../../contracts/event/`,
`../../contracts/identity/`, `../../config/connection-settings/`
(รูปแบบ ไม่ใช่โค้ด — NOT_YET_BUILT เช่นกัน)

**สิ่งที่ห้ามแตะ:**
- ห้าม hardcode Vercel token ในไฟล์ใดในโฟลเดอร์นี้เด็ดขาด — เมื่อสร้างจริง
  ต้องใช้ single-credential-channel pattern เดียวกับ
  `connections/github/`'s `EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME` / P-GH-013
  (**project-scoped token เท่านั้น ห้าม Full Account token** — เหตุผลเต็มอยู่
  ใน boundary plan §1)
- **ห้ามเรียก Billing/FOCUS endpoint เด็ดขาด** —
  `GET /v1/billing/charges`, `/v1/billing/contract-commitments`,
  `POST /v1/billing/buy` ห้ามมีใน adapter นี้ไม่ว่ากรณีใด แม้ token จะเข้าถึง
  ได้ก็ตาม (ข้อมูลการเงินระดับ invoice ต้องไม่อยู่ใน repo นี้ — G-ARCH-001,
  ดู boundary plan Rule 2)
- **ห้ามสร้าง write-capable intent ที่แตะ deployment จริง** (create
  deployment ที่ `target: production`, promote, rollback) **จนกว่า**
  `CHECKS_API_LIVE_TEST_PLAN.md`'s test จะรันจริงและได้ผลจริงแล้ว — ดู
  boundary plan Rule 4
- ห้ามรับ inbound webhook/drain ตรงในโฟลเดอร์นี้ — นั่นคือ
  `../vercel-webhooks/` และ `../vercel-drains/` แยกต่างหาก (boundary plan
  §2/§3)
- ห้ามเขียน decision logic ว่าจะ block/release deployment ไว้ในโฟลเดอร์นี้
  — decision อยู่ที่ `../../governance/release-gate/` เสมอ (boundary plan
  §4) โฟลเดอร์นี้ทำได้แค่ "เรียก Vercel ตามที่สั่ง" ไม่ตัดสินใจเอง

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `CHECKS_API_LIVE_TEST_PLAN.md` | plan | แผน test Checks API ด้วย project-scoped token — **ยังไม่รัน**, รอ token จริง |
| `README.md` | doc | ไฟล์นี้ |

ยังไม่มีไฟล์ source/contract/config/policy/test ใดๆ — capability ยังไม่ถูก
สร้าง ตาม Capability Folder Law ข้อ 1 (โฟลเดอร์มาก่อน แต่ยังไม่มี
implementation จนกว่า Owner จะอนุมัติรอบถัดไป)

## Related

- [`../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md`](../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md) — ขอบเขตเต็มของ 4 areas (adapter นี้ / webhook ingress / drain ingress / release-gate)
- [`../vercel-webhooks/README.md`](../vercel-webhooks/README.md), [`../vercel-drains/README.md`](../vercel-drains/README.md) — inbound ingress คนละ capability
- [`../../governance/release-gate/README.md`](../../governance/release-gate/README.md) — เจ้าของ decision logic
- [`../github/README.md`](../github/README.md), [`../github/ARCHITECTURE_DECISIONS.md`](../github/ARCHITECTURE_DECISIONS.md) — precedent ที่ capability นี้จะตามรูปแบบเดียวกันเมื่อสร้างจริง
