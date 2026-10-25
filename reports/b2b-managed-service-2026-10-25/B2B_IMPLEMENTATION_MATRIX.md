# B2B — IMPLEMENTATION MATRIX (P0/P1/P2)
**วันที่:** 2026-10-25 · ทุกหัวข้อมี Source Path, สิ่งที่มีแล้ว, สิ่งที่ขาด, แนวทางเชื่อมของเดิม, เกณฑ์ทดสอบ
**สถานะ:** ข้อเสนอ — ยังไม่มีการแก้โค้ด/สคีมา/UI ในรอบนี้

---

## P0 — ความปลอดภัย (ต้องเสร็จก่อนเปิด B2B ใด ๆ)

### P0-1 Tenant isolation ของ writer ราคา
- **Source:** `app/api/admin/pits/[pitId]/materials/route.ts:27` · `core/public-catalog/authority.ts:187`
- **มีแล้ว:** `requireAuth(ADMIN_TIER)` + `pit_profiles.user_id` (เจ้าของ)
- **ขาด:** การตรวจว่า actor เป็นเจ้าของ/ผู้รับมอบหมายของ pit นั้น · admin tier เขียนได้ทุกบ่อ
- **แนวทาง:** เรียกตัวตรวจเดิม (`resolveWriter`/`ownerAccepted`) ก่อนเขียน; admin ต้องมี grant ชัดเจนหรือ break-glass ที่บันทึกเหตุผล
- **ทดสอบ:** actor ที่ไม่ใช่เจ้าของ → 403 · เจ้าของ → 200 · admin ไม่มี grant → 403 · admin มี break-glass → 200 + audit เหตุผล

### P0-2 Writer integrity (atomic price + audit)
- **Source:** `materials/route.ts:62–87` · `engines/canonical/audit.ts:72,84`
- **มีแล้ว:** เขียนราคา + `audit_logs` (คนละคำสั่ง) · `audit_written` ใน response
- **ขาด:** atomicity; `actor_user_id` ของ canonical writer = NULL; ไม่มี trace; `company_id` NULL
- **แนวทาง:** RPC เดียว (update + audit) เรียกจาก route เดิม; เพิ่ม `price.updated/created` ใน `CANONICAL_AUDIT_ACTIONS`; แก้ `recordCanonicalAudit` ให้เก็บ actor จริง
- **ทดสอบ:** จำลอง audit ล้มเหลว → ราคาไม่เปลี่ยน + response ≠ 200 · ปกติ → 1 แถว audit ครบ old/new/actor/entity
- **หมายเหตุ:** ต้องอนุมัติ migration/RPC — ยังไม่ทำ

### P0-3 Ownership ที่ตรวจสอบได้
- **Source:** `pit_profiles.user_id` (3 แถว, 0 resolve) · `identities.auth_user_id`
- **มีแล้ว:** คอลัมน์ผูกเจ้าของ
- **ขาด:** ข้อมูลจริงที่ resolve ได้; ไม่มี FK
- **แนวทาง:** เติม `user_id` จาก identity ที่ยืนยันแล้ว (งานข้อมูล ไม่ใช่สคีมา) + ตรวจตอน login
- **ทดสอบ:** ทุก pit ที่เผยแพร่มีเจ้าของ resolve ได้ 100% · ถ้าไม่ → ห้ามเผยแพร่ (fail-closed)

### P0-4 แยกสิทธิ์เผยแพร่จากสิทธิ์แก้ราคา
- **Source:** `app/api/admin/publications/route.ts:296` · `authority.ts:165–192`
- **มีแล้ว:** publication writer แยกจาก price writer; `allowed_public_fields`, `expires_at`
- **ขาด:** ผู้อนุมัติเผยแพร่ที่ผูกกับเจ้าของ (ตอนนี้ = admin tier)
- **แนวทาง:** grant `publication.approve` ใน scope เดียวกับ 4.3; เก็บ `authorized_by_user_id`
- **ทดสอบ:** price_editor เผยแพร่ไม่ได้ → 403 · approver เผยแพร่ได้ · ถอนได้ · ทุกครั้งมี event

---

## P1 — การดำเนินงาน B2B

### P1-1 มอบหมายผู้ดูแล (delegation)
- **Source:** `org_members` (organization_id,user_id,role,created_at) · `identity_memberships(revoked_at)`
- **มีแล้ว:** โครงสมาชิก org + การถอดสิทธิ์แบบมีเวลา
- **ขาด:** scope ระดับทรัพยากร, granted_by, revoked_at ใน org_members
- **แนวทาง:** เพิ่ม 3 คอลัมน์ (migration เดียว) + ใช้ `identity_memberships` เป็นบันทึกการมอบ
- **ทดสอบ:** owner มอบ → b2b เห็นเฉพาะ pit ใน scope · ถอด → สิทธิ์หายทันที · ประวัติยังอยู่

### P1-2 แก้ข้อมูลแทนเจ้าของ (managed edit)
- **Source:** writer ราคาเดิม + grant จาก P1-1
- **มีแล้ว:** writer เดียว
- **ขาด:** การแสดงว่า "แก้ในนามใคร"
- **แนวทาง:** audit field `on_behalf_of` (organization_owner) + `actor_user_id` ของผู้แก้
- **ทดสอบ:** แถว audit มีทั้ง actor และ on_behalf_of · เจ้าของเห็นในประวัติของตน

### P1-3 รับแจ้งปัญหาการใช้งาน (intake)
- **Source:** ไม่มีตาราง/route รองรับ · ของใกล้เคียง: `pit_price_requests` (ขอราคา), `maintenance_tickets` (ซ่อมอุปกรณ์)
- **มีแล้ว:** ช่องทาง LINE + `notifications/send` + `audit_logs`
- **ขาด:** ตั๋วบริการ (ผู้แจ้ง/หมวด/สถานะ/SLA/ผู้รับผิดชอบ)
- **แนวทาง:** ใช้ `audit_logs` เป็นเหตุการณ์ + ตาราง tickets (อนุมัติ) — **ยังไม่สร้างในรอบนี้**
- **ทดสอบ:** แจ้ง → มีตั๋ว → มอบหมาย → ปิด → เจ้าของเห็นประวัติ

---

## P2 — การเผยแพร่

### P2-1 Public Reader
- **Source:** `services/public-catalog/reader.ts:69,86` · `app/api/public/products/route.ts:32`
- **มีแล้ว:** default-deny 4 ชั้น, owner gate, invalidation, TTL 60s, ไม่มี SWR
- **ขาด:** การวัดผล invalidation จริง (ยังไม่มีรายการเผยแพร่ให้ทดสอบ)
- **แนวทาง:** วัดเมื่อได้อนุมัติเผยแพร่ 1 รายการชั่วคราว
- **ทดสอบ:** เปลี่ยนราคา → process เดียวกันเห็นทันที · instance อื่น ≤ 60s (ยอมรับ)

### P2-2 ราคา/พิกัด/สถานะข้อมูล
- **Source:** `core/public-catalog/policy.ts:223` (owner gate) · reader hydration
- **มีแล้ว:** ฟิลด์ whitelist, verified flag, coordinates แบบ opt-in
- **ขาด:** `verified_by` จริง (ยังไม่มีผู้ตรวจราคา)
- **แนวทาง:** ใช้ flow ยืนยันราคาเดิมของ admin + บันทึกผู้ตรวจ
- **ทดสอบ:** ไม่มีผู้ตรวจ → ไม่แสดงป้ายยืนยัน · มี → แสดงพร้อมวันที่

### P2-3 Evidence Chain
- **Source:** `reports/publication-safety-audit-2026-10-25/*`
- **มีแล้ว:** publication_events + audit_logs + trace (publication)
- **ขาด:** trace ของราคา, actor ใน canonical audit, หลักฐาน cache
- **แนวทาง:** รวมใน P0-2
- **ทดสอบ:** ทุกการเผยแพร่/ถอน/แก้ราคา join กลับได้ด้วย trace เดียว

---

## ตารางสรุปช่องว่างตามความสามารถบริการพาร์ตเนอร์ (STEP 04)

| ความสามารถ | มีแล้ว | ขาด | ระดับ |
|---|---|---|---|
| รับแจ้งปัญหาการใช้งาน | LINE inbound, `notifications/send`, `audit_logs` | ตั๋ว/สถานะ/ผู้รับผิดชอบ | P1 |
| มอบหมายเจ้าหน้าที่ดูแลพาร์ตเนอร์ | `org_members` (ยังไม่มี scope) | scope + granted_by + revoked_at | P1 |
| ตรวจข้อมูลสินค้าและราคา | `/admin/pits`, `/api/admin/pits`, `pit_materials` | มุมมองของเจ้าของ/ผู้รับมอบ | P1 |
| ติดตามสถานะงานบริการ | — | โมเดลสถานะงานบริการ | P1 |
| บันทึกประวัติการแก้ปัญหา | `audit_logs` (4,806 แถว) | การผูกกับตั๋ว | P1 |
| ส่งเรื่องเทคนิคไปทีมวิศวกรรม | `business_failure_bridge`, dev-loop | เส้นทางจากตั๋ว → งานวิศวกรรม | P1 |
| แสดงหลักฐานให้เจ้าของตรวจ | `publication_events`, `audit_logs` | หน้าสรุปของเจ้าของ (ยังห้ามสร้าง UI) | P2 |

---

## Test Matrix (ยังไม่รัน — ต้องอนุมัติก่อน)

| ระดับ | ชุดทดสอบ | เกณฑ์ |
|---|---|---|
| Offline | policy/authority tests (`public-catalog-policy:test`) | 112/112 คงเดิม + เพิ่มกรณี scope |
| Offline | writer integrity (จำลอง audit fail) | ราคาไม่เปลี่ยนเมื่อ audit fail |
| Integration (local + prod read-only) | 401/403 ทุก writer | ไม่มี session → 401; ผิด scope → 403 |
| Integration | 404 / reader fail-closed | ตามรอบก่อน (ผ่านแล้ว) |
| Live (ต้องอนุมัติ) | วัด invalidation หลังแก้ราคา | process เดียวกัน < 2s; instance อื่น ≤ 60s |
| Live | วัด publish/withdraw | event + trace ครบ, reader ตอบถูก |

---

## ลำดับที่แนะนำ
1. P0-3 (ข้อมูลเจ้าของ) → 2. P0-1 (scope) → 3. P0-2 (atomic audit) → 4. P0-4 (แยกสิทธิ์เผยแพร่)
5. P1-1/P1-2 (delegation + managed edit) → 6. P1-3 (ticket) → 7. P2 (วัดผลจริง)

**ทุกข้อต้องมีใบอนุมัติแยกสำหรับ migration/UI** — รอบนี้หยุดที่เอกสารเท่านั้น
