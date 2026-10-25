# B2B — WRITER INTEGRITY AUDIT
**วันที่:** 2026-10-25 (UTC) · **HEAD:** `d7fbb05b` · **โหมด:** read-only (ตรวจโค้ด + อ่าน DB) — ไม่มีการแก้โค้ด/DB ในรอบนี้

> **แยกประเภทหลักฐาน**
> 🟢 **PROVEN (Production จริง)** = อ่านจาก DB/ไฟล์จริงในรอบนี้ (มี ID/บรรทัด/ตัวเลขกำกับ)
> 🟡 **โค้ดปัจจุบัน** = ตรวจจาก source โดยยังไม่ได้รันกับข้อมูลจริง
> 🔵 **PROPOSED** = ข้อเสนอ ยังไม่ได้ทำ (ต้องอนุมัติ)

---

## 01 OBJECTIVE

ตรวจว่า **การแก้ราคาหนึ่งครั้งผ่าน writer เดิม** บันทึกครบ 6 อย่าง และวิเคราะห์กรณี audit ล้มเหลวหลังราคาถูกเขียนแล้ว โดยไม่สร้าง writer ใหม่

| # | ต้องบันทึก | เกณฑ์ PASS |
|---|---|---|
| 1 | ราคาก่อน/หลัง | มี old และ new ผูกกับ record เดียวกัน |
| 2 | ตัวตนผู้แก้ + องค์กร | actor ที่ resolve เป็นบัญชีจริง + องค์กรที่รับผิดชอบ |
| 3 | Source Record ID | อ้าง `pit_materials.id` ตรงกับแถวที่แก้ |
| 4 | วันที่/เวลาจริง | เวลาที่เขียนจริง ไม่ใช่เวลาที่ผู้ใช้กรอก |
| 5 | Trace ID + ผล | มี trace ที่ join ได้ + ผลสำเร็จ/ล้มเหลว |
| 6 | ผล Cache Invalidation | ระบุว่าอะไรถูก invalidate และเชื่อถือได้แค่ไหน |

---

## 02 SOURCE EVIDENCE

### S1 — เส้นทางเขียนราคา (writer เดิม, ไม่มีตัวใหม่)
`app/api/admin/pits/[pitId]/materials/route.ts`

| บรรทัด | สิ่งที่ทำ |
|---|---|
| 27 | `requireAuth(ADMIN_TIER)` — ด่านเดียวของ route |
| 42 | อ่านแถวเดิม `select("id, price")` เพื่อเก็บราคาก่อนแก้ |
| 62–66 | `update({ price, updated_at: now })` หรือ `insert` |
| 74 | `invalidatePublicCatalog()` |
| 75 | `revalidatePath("/products","layout")` |
| 79–87 | `audit_logs.insert({ actor_user_id: auth.id, entity_type:"pit_materials", entity_id, action: price_updated/created, field:"price", old_value, new_value })` |
| 96–99 | response `{ ok, id, audit_written, revalidated: true }` |

### S2 — Canonical audit writer (ตัวกลางที่ควรใช้)
`engines/canonical/audit.ts`

| บรรทัด | ข้อเท็จจริง |
|---|---|
| 18–36 | `CANONICAL_AUDIT_ACTIONS` = document/payment/debt/transaction/artifact/expense/payable — **ไม่มี price\_\*** |
| 67 | โยน error ถ้าไม่มี `actor` |
| 72 | **`actor_user_id: null` เสมอ** — actor string ถูก validate แล้วไม่ถูกเก็บลงคอลัมน์ใด |
| 84 | audit ล้มเหลว → **throw** (ผู้เรียกตัดสินใจ abort) |

`audit_logs` (DB จริง): `id, actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, ip_address, user_agent, created_at` — **ไม่มีคอลัมน์ `actor` และไม่มี `trace_id`**

### S3 — สถิติจริงใน `audit_logs` (Production)
- ทั้งหมด **4,806 แถว**; `company_id` ไม่ว่าง **120 แถว** (2.5%)
- action ที่พบบ่อย: `connector/run` 4,303 · `ai_invocation/ai.invocation` 155 · `document_artifact/artifact.created` 46 · `invoices/document.*` 109 · `business_failure_bridge/*` 65
- **ไม่มีแถว `price_updated` เลย** (เพราะยังไม่มีการแก้ราคาหลังเปิดใช้ audit ในรอบก่อน)

### S4 — Publication writer (เส้นทางเผยแพร่)
`app/api/admin/publications/route.ts`

| บรรทัด | ข้อเท็จจริง |
|---|---|
| 292 | `organization_owner` **derive จากต้นทาง** ไม่รับจาก client |
| 296 | `verified_by = auth.email` เมื่อ publish (เฉพาะเมื่อผู้กดยืนยัน) |
| 303 | `trace_id = randomUUID()` ต่อครั้ง |
| 336–337 | invalidate + revalidatePath |
| 341 | `publication_events.insert(...)` — มี `trace_id` และ `actor` (email) |

### S5 — Reader / Cache
`services/public-catalog/reader.ts`
- 69: `PUBLIC_CACHE_SECONDS = 60`
- 86–88: `invalidatePublicCatalog()` → `memo.clear()`
- 95: memo เป็น `Map` **ในหน่วยความจำของ process** (ไม่ shared)

---

## 03 RESULT

### R1 — ตารางผลรายข้อ

| # | รายการ | ผล | หลักฐาน |
|---|---|---|---|
| 1 | ราคาก่อน/หลัง | **PASS** | `old_value`/`new_value` (S1:85–86) — แถวใหม่ `old_value = null` ถูกต้อง |
| 2 | ตัวตนผู้แก้ | **PASS** | `actor_user_id = auth.id` (S1:80) |
| 2 | องค์กรที่รับผิดชอบ | **FAIL** | `company_id` ไม่ถูกส่งเลย → NULL ทุกแถวราคา · `pit_profiles` ไม่มี FK ไป `companies`/`organizations` จึง resolve ไม่ได้จากข้อมูลจริง |
| 3 | Source Record ID | **PASS** | `entity_type='pit_materials'`, `entity_id=rowId` |
| 4 | เวลาจริง | **PASS (มีสองนาฬิกา)** | `audit_logs.created_at` = now() ของ DB; `pit_materials.updated_at` = ISO จาก app — สองแหล่ง อาจต่างกันได้เล็กน้อย |
| 5 | Trace ID | **FAIL** | `audit_logs` ไม่มีคอลัมน์ trace; response ไม่คืน trace |
| 5 | ผลการดำเนินการ | **PASS (บางส่วน)** | `audit_written` บอกผลการเขียน audit; ไม่มีผลของราคาเอง |
| 6 | Cache invalidation | **PARTIAL** | `revalidated: true` = "เรียกแล้ว" ไม่ใช่ "ยืนยันแล้ว" และไม่มีหลักฐานเก็บถาวร |

### R2 — Audit ล้มเหลวหลังราคาถูกเขียน (ช่องว่างจริง)

พฤติกรรมปัจจุบัน: อัปเดตราคาสำเร็จ → `audit_logs.insert` ล้มเหลว → `console.error` + ตอบ `200 {audit_written:false}`

| ผลกระทบ | คำอธิบาย |
|---|---|
| หลักฐานหายแบบเงียบ | ราคาเปลี่ยนแล้วแต่ไม่มีแถว audit; ไม่มี retry, ไม่มี compensation |
| ตรวจย้อนหลังไม่ได้ | `pit_materials` มีเพียง `updated_at` ไม่รู้ว่าใครแก้ |
| ผู้ใช้ไม่รู้ | UI เดิมไม่อ่าน `audit_written` |

**แนวทางที่เสนอ (ยังไม่ทำ — ต้องอนุมัติ เพราะแตะ schema/RPC)**

| ทางเลือก | วิธี | ข้อดี | ข้อเสีย |
|---|---|---|---|
| **A (แนะนำ)** | เพิ่ม Postgres function 1 ตัว (RPC) ที่ `update price + insert audit_logs` ใน transaction เดียว แล้วให้ **route เดิม** เรียก RPC แทนสองคำสั่งแยก | atomic จริง, ไม่มี writer ที่สอง, route ยังเป็นประตูเดียว | ต้อง migration ใหม่ (อนุมัติ) |
| B | เขียน audit "intent" ก่อน แล้ว price แล้ว update audit เป็น committed | เห็นร่องรอยแม้ crash | ต้องเพิ่มคอลัมน์สถานะใน audit_logs + แถวซ้ำ |
| C | Reconciler (read-only): หา `pit_materials.updated_at` ที่ไม่มี audit row ในหน้าต่างเวลาเดียวกัน แล้วรายงาน | ไม่แตะ schema, ตรวจ drift ได้ | ไม่ป้องกัน แค่ตรวจจับ |

**คำแนะนำ:** ทำ A เป็น P0 และ C เป็น safety net ระยะเปลี่ยนผ่าน · ห้ามทำ B (ซ้ำซ้อนกับ A และทำให้ตาราง audit มีสถานะกึ่งสำเร็จ)

### R3 — ความสอดคล้องกับ Canonical Writer

| ข้อ | ผล |
|---|---|
| ราคาถูกเขียนผ่าน canonical writer? | **ไม่** — `engines/canonical/*` ไม่มีไฟล์ใดแตะ `pit_materials` (ตรวจด้วย grep) |
| Audit ของราคาใช้ `recordCanonicalAudit`? | **ไม่** — เขียน `audit_logs` ตรง (เพราะ vocabulary ไม่มี price) |
| ผลข้างเคียง | มีสองมาตรฐานในตารางเดียว: canonical (actor_user_id = NULL, throw on fail) vs price (actor_user_id = auth.id, ไม่ throw) |
| ข้อเสนอ | เพิ่ม `price.updated` / `price.created` ใน `CANONICAL_AUDIT_ACTIONS` (additive) แล้วให้ price writer เรียก `recordCanonicalAudit` — **แต่ต้องแก้ audit.ts ให้เก็บ actor จริงก่อน** ไม่เช่นนั้นตัวตนผู้แก้จะหายไป |

### R4 — เกณฑ์ทดสอบที่ต้องผ่านเมื่อแก้ (ยังไม่รัน)

| กรณี | เกณฑ์ |
|---|---|
| แก้ราคาปกติ | มี 1 แถว audit: old/new ถูก, actor = auth.id, entity_id = pit_materials.id |
| audit insert ล้มเหลว (จำลอง) | ราคา **ไม่เปลี่ยน** และ response ไม่ใช่ 200 (ภายใต้ทางเลือก A) |
| publish/withdraw | `publication_events` มี trace_id + actor; reader เห็นผลทันทีใน process เดียวกัน |
| cache | หลังเขียน 1 ครั้ง: memo ว่าง, หน้าเว็บไม่แสดงราคาเก่าใน process เดียวกัน; instance อื่น ≤ 60s (ยอมรับ ไม่ใช่ real-time) |
| tenant | ผู้ใช้ที่ไม่ใช่เจ้าของ/ไม่ได้รับมอบหมายแก้ไม่ได้ (401/403) — ยังไม่มีกลไกนี้ ดูเอกสารสถาปัตยกรรม |
