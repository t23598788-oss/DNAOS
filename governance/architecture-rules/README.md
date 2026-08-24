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
