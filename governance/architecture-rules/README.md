# governance/architecture-rules/

กฎโครงสร้างของ repo นี้เอง — split มาจาก `governance/RULES.md` เดิม (2 ข้อ)
รวมกฎการจัดไฟล์รอบใหม่ (2026-08-14)

## G-ARCH-001 — Business Logic และ Operational Data ห้ามเข้า repo นี้เด็ดขาด

ห้ามเก็บ: ข้อมูลธุรกิจ, ชื่อลูกค้า, เอกสารธุรกิจ, ใบแจ้งหนี้, การเงิน,
ข้อมูลผู้ใช้ทางธุรกิจ, Operational Data, Business Database — ไม่ว่ารูปแบบ
ใด ข้อมูลเหล่านี้อยู่ในฐานข้อมูลของ Business Domain ของมันเองเสมอ ยังไม่มี
mechanical check — บังคับใช้ด้วยวินัยของผู้สร้างเท่านั้นวันนี้

**ตัวอย่างจริง (Owner, 2026-08-14):** `connections/vercel/` ห้ามเรียก
Vercel `GET /v1/billing/charges`, `/v1/billing/contract-commitments`,
`POST /v1/billing/buy` เด็ดขาด แม้ token จะเข้าถึงได้ก็ตาม — endpoint นี้
คืนข้อมูลการเงินระดับ invoice ตรงตามที่กฎข้อนี้ห้ามพอดี ดูเหตุผลเต็มที่
[`VERCEL_BOUNDARY_PLAN.md`](./VERCEL_BOUNDARY_PLAN.md) Rule 2

## G-ARCH-002 — ทุก field ต้องมีเหตุผลที่ต้องมี

ห้ามใส่ identity_id/account_id/tenant_id/software_id ลงทุก record เพียง
เพราะต้องการ future-proof — `contracts/command/command-envelope.ts` /
`contracts/event/event-envelope.ts` คือจุดเดียวที่ครบทั้ง 5 field โดยจำเป็น
record อื่นถือแค่ที่ตัวเองใช้จริง

## G-ARCH-003 — 1 หน้างาน = 1 โฟลเดอร์ (Owner, 2026-08-14)

Source code + test ของหน้างานหนึ่งต้องอยู่ในโฟลเดอร์เดียวกัน ห้ามรวม
หลายหน้าที่ไว้ในไฟล์ใหญ่ไฟล์เดียว ห้ามสร้าง `utils/`, `helpers/`,
`services/` เป็นที่โยนโค้ดรวม — Shared code ต้องมีผู้ใช้จริงมากกว่า 1
หน้างานก่อนจึงแยกเป็นไฟล์ร่วมได้ (ตัวอย่างจริงในรอบนี้:
`contracts/identity/envelope-identity.ts` มีผู้ใช้จริง 2 ราย —
`contracts/command/` และ `contracts/event/`)

**อัปเดต 2026-08-14 (รอบ 2): ข้อความเต็ม/บังคับใช้จริงของกฎนี้อยู่ที่
[`CAPABILITY_FOLDER_LAW.md`](./CAPABILITY_FOLDER_LAW.md) — LOCKED,
PERMANENT ARCHITECTURE LAW** ครอบคลุมเพิ่มเติมจากที่นี่: โฟลเดอร์ต้องมา
ก่อน source file เสมอ, ต้องตรวจ duplicate/overlapping capability ก่อน
สร้างใหม่ทุกครั้ง, Governance Gate 6 เงื่อนไข (REJECT/BLOCK+REVIEW/BLOCK),
และเป้าหมายว่า capability หนึ่งต้องแก้/ย้าย/test/assign/rollback/ตรวจ
dependency/ลบ ได้ "เป็นโฟลเดอร์เดียว" ทุกกรณี

## G-ARCH-004 — ทุกโฟลเดอร์ต้องมี README

อธิบาย: หน้าที่ / Input / Output / Dependency ที่อนุญาต / สิ่งที่ห้ามแตะ

## G-ARCH-005 — Permission Boundary ห้ามข้ามประเภทของตัวเอง (Owner, 2026-08-24, "DNA OS System Boundary Reconstruction")

ทุก capability ในระบบ (ทั้งสอง repo: DNA-OS-INFRASTRUCTURE และ
dna-os-deadboard) ถูกจัดประเภทเป็นหนึ่งใน 6 กลุ่ม: **DATA / SOFTWARE /
INFRA / SECURITY / EXTERNAL / AUTOMATION** แต่ละกลุ่มมี permission ที่
อนุญาตให้ทำได้เฉพาะเจาะจง และ **ห้าม permission ประเภทใดประเภทหนึ่ง
แปลงตัวเองข้าม boundary ได้** ไม่ว่าจะผ่าน `requireAuth()`/role check
ระดับใดก็ตาม — auth เป็นแค่ประตู ไม่ใช่ตัวกำหนด boundary:

- **DATA permission** อนุญาตให้ผู้ใช้เปลี่ยน "ข้อมูลของระบบ" ที่ตนมีสิทธิ์
  (CRUD ปกติ) เท่านั้น — ห้ามไหลต่อไปเป็น filesystem/source code/command
  execution/deploy
- **SOFTWARE permission** อนุญาตให้สร้าง **Candidate** เท่านั้น — ห้าม
  agent/route ที่สร้าง Candidate เป็นตัวเดียวกับที่แก้ canonical system,
  merge, migrate หรือ deploy เอง ต้องผ่าน Candidate → Classification →
  Duplicate Gate → Test → Evidence → Policy → Approval → Canonical Writer
  เสมอ
- **INFRA permission** อนุญาตให้ควบคุม runtime ที่กำหนดไว้ล่วงหน้าเท่านั้น
  (start/stop/restart/health ของ service ที่ registered แล้ว) — ห้าม
  ขยายเป็น arbitrary filesystem access หรือ arbitrary command execution
- **SECURITY permission** ตัดสินใจเรื่อง identity/authorization เท่านั้น —
  ห้ามเป็นทั้งผู้พิสูจน์ตัวตนและผู้อนุมัติสิทธิ์ในกลไกเดียวกันโดยปริยาย
  (ดู Layer 1 fix: `dna-os-deadboard/supabase/migrations/
  20260824000006_kill_signup_order_super_admin.sql`)
- **EXTERNAL permission** อนุญาตให้ยื่น **Intent** ออกนอกระบบเท่านั้น —
  Application และ Agent ห้ามเห็น credential จริงหรือเรียก provider ตรง
  (เป้าหมาย: Capability → External Action Intent → Policy → Credential
  Broker → Provider Adapter → External System → Evidence)
- **AUTOMATION permission** คือ dev-tool/local-agent เท่านั้น — ต้องไม่ใช่
  production write path

**บริบท:** พบระหว่าง System Boundary Reconstruction audit ว่า
`app/api/admin/ide/**` (SOFTWARE — filesystem writer + command execution)
รันอยู่ใน Public Application (Vercel production bundle) โดยมีแค่
`requireAuth(INFRA_TIER)` กั้น — ตัวอย่างจริงของการละเมิดกฎนี้: permission
ระดับ role check ไม่ใช่ boundary ระดับสถาปัตยกรรม สอง capability ประเภท
ต่างกันต้องแยกทางสถาปัตยกรรมจริง ไม่ใช่อาศัยแค่ auth check เดียว
ดู `reports/` ของ dna-os-deadboard สำหรับ Extraction Plan เต็ม

---

## สารบัญตามลำดับขั้นปฏิบัติการ

ลำดับนี้ไม่ใช่ลำดับตัวอักษร — มันคือลำดับที่งานต้องเกิดจริง กฎมาก่อนการสำรวจ
การสำรวจมาก่อนการให้ตัวตน ตัวตนมาก่อนทะเบียน ทะเบียนมาก่อนสัญญาการเชื่อมต่อ
และการนำขึ้นระบบจริงมาหลังสุดเสมอ

ลำดับ ความสัมพันธ์ และเงื่อนไขจบของแต่ละขั้น ถูกประกาศไว้ที่
`control/operational-lifecycle/stages.ts` และสถานะถูก **อนุมานจากหลักฐานจริง**
ทุกครั้งที่อ่าน ไม่มีที่ใดเก็บคำว่า "เสร็จแล้ว" ไว้ให้แก้ด้วยมือ
อ่านสถานะปัจจุบันได้ที่ `GET /owner/lifecycle`

ตารางนี้มีเอกสาร 15 ฉบับ: 14 รายการใน operational index และ
`STRUCTURE_LOCK_MAP.md` เป็น governance companion ที่ถูก index ไว้แต่ไม่ใช่
ขั้น lifecycle อีกชุดหนึ่ง ไม่ควรเรียก companion นี้ว่า "ขั้นที่ 15"

| # | เอกสาร | ขึ้นกับขั้น |
|---|--------|-------------|
| 01 | [`README.md`](./README.md) — ดัชนีนี้เอง | — |
| 02 | [`CAPABILITY_FOLDER_LAW.md`](./CAPABILITY_FOLDER_LAW.md) | — |
| 03 | [`SYSTEM_CONNECTION_CENSUS_PHASE1.md`](./SYSTEM_CONNECTION_CENSUS_PHASE1.md) | 02 |
| 04 | [`CANONICAL_TARGET_IDENTITY_DISCOVERY.md`](./CANONICAL_TARGET_IDENTITY_DISCOVERY.md) | 03 |
| 05 | [`CAPABILITY_REPOSITORY_LINEAGE_TRACE.md`](./CAPABILITY_REPOSITORY_LINEAGE_TRACE.md) | 02 |
| 06 | [`CROSS_SYSTEM_INSTANCE_REGISTRY_DESIGN.md`](./CROSS_SYSTEM_INSTANCE_REGISTRY_DESIGN.md) | 04, 05 |
| 07 | [`PROVIDER_PROJECT_IDENTITY_REGISTRATION.md`](./PROVIDER_PROJECT_IDENTITY_REGISTRATION.md) | 06 |
| 08 | [`CONNECTION_CONTRACT_PHASE_A.md`](./CONNECTION_CONTRACT_PHASE_A.md) | 07 |
| 09 | [`SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md`](./SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md) | 05 |
| 10 | [`CANONICAL_CAPABILITY_CATALOG_DRY_RUN.md`](./CANONICAL_CAPABILITY_CATALOG_DRY_RUN.md) | 09 |
| 11 | [`CAPABILITY_CATALOG_PROJECTION_DESIGN.md`](./CAPABILITY_CATALOG_PROJECTION_DESIGN.md) | 10 |
| 12 | [`OPERATIONAL_LIFECYCLE_MODEL.md`](./OPERATIONAL_LIFECYCLE_MODEL.md) | 06, 05 |
| 13 | [`ACCOUNTING_CANONICAL_TRUTH.md`](./ACCOUNTING_CANONICAL_TRUTH.md) | 02 |
| 14 | [`VERCEL_BOUNDARY_PLAN.md`](./VERCEL_BOUNDARY_PLAN.md) | 08, 12 |
| 15 | [`STRUCTURE_LOCK_MAP.md`](./STRUCTURE_LOCK_MAP.md) — governance companion, ไม่ใช่ขั้น | — |

เอกสารกำกับที่ไม่ใช่ขั้นของงาน — อ่านคู่กับตารางข้างบน:
`STRUCTURE_LOCK_MAP.md` และ `ACCOUNTING_AUTHORITY_ROLES.md` — ขอบเขตที่ถูกล็อกแล้วและบทบาท authority

ขั้น 05 กับ 09/10 และ 13 ประกาศไว้ว่าขนานกันได้ (`parallel_group`) — การขนานที่
ไม่ได้ประกาศไว้ถือว่าไม่อนุญาต
