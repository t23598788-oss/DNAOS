# governance/dependency-rules/

กฎ dependency ข้ามระบบ/ข้ามโฟลเดอร์ — split มาจาก `governance/RULES.md` เดิม

## G-DEP-001 — ห้าม direct database dependency ระหว่าง Operational กับ Infrastructure

`dna-os-deadboard` (Operational) และ `DNA-OS-INFRASTRUCTURE` (นี่) คุยกัน
ผ่าน `contracts/operational-bridge/` เท่านั้น ห้าม query ข้ามฐานข้อมูลกัน
ทั้งสองทิศทาง

## G-DEP-002 — เจ้าของ Domain เข้าฐานของตัวเองได้ตรงๆ, Domain อื่นห้าม

Service ที่เป็นเจ้าของฐานข้อมูลหนึ่งเข้าฐานของตัวเองตรงได้ (เช่น
Operational ยังคุย Supabase ของตัวเองตรงได้เหมือนเดิม) — Domain อื่น/UI/AI/
External Software ต้องผ่าน API/Event/Contract เท่านั้น ไม่ใช่ "ห้าม direct
DB ทุกกรณี" แบบเหมารวม

## G-DEP-003 — Dependency ข้ามโฟลเดอร์ต้องเดินทางเดียว ไม่วนกลับ

`contracts/` ไม่ import จากที่ใดเลยนอกตัวมันเอง — เป็นชั้นล่างสุดของ
dependency graph ทั้งระบบ `permissions/` **อาจ** import จาก `contracts/`
ได้ (ทางเดียว) แต่ `contracts/` ห้าม import จาก `permissions/` เด็ดขาด —
พบ violation จริงรอบแรก (2026-08-14): `contracts/command/`,
`contracts/event/` เคย import `EnvelopeIdentity` จาก
`permissions/access-control/` ขณะที่ `permissions/access-control/scope-check.ts`
import กลับจาก `contracts/command/` — แก้แล้วโดยย้าย `EnvelopeIdentity`
เข้า `contracts/identity/` (ไม่ import อะไรเลย) แล้วให้ `permissions/`
import จากตรงนั้นแทน ผลคือ dependency เดินทิศทางเดียว: `permissions/` →
`contracts/` เท่านั้น. `control/`/`execution/`/`connections/` ก็ต้อง
import จาก `contracts/`/`permissions/` เข้าหาตัวเองในทิศทางเดียวกัน เมื่อ
มี implementation จริง

## G-DEP-004 — ตรวจ duplicate/overlapping capability ก่อนสร้าง dependency ใหม่ทุกครั้ง

ก่อนสร้าง capability folder ใหม่ ต้องตรวจว่ามี capability เดิมที่ซ้ำหรือ
ทับซ้อนหน้าที่กันอยู่แล้วหรือไม่ ก่อนจะปล่อยให้เกิด dependency ใหม่ขึ้นมา
ข้อความเต็มของกระบวนการตรวจ (DUPLICATE / OVERLAPPING_CAPABILITY / canonical
merge) อยู่ที่
[`../architecture-rules/CAPABILITY_FOLDER_LAW.md`](../architecture-rules/CAPABILITY_FOLDER_LAW.md)
ข้อ 4–6
