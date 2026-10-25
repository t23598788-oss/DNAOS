# DNA OS — AI CONTEXT AUTHORITY: STEP 1–5 EXECUTION
**วันที่:** 2026-10-25 · **โครงการ:** `xeytcavxejhyzxwevgto`
**คำสั่งเจ้าของ:** ลำดับงาน 5 ข้อ (ปิดช่อง AI → แก้ identity LINE → ตรวจ 86 ระเบียน → แยกสิทธิ์ → ทดสอบสององค์กร)
**สถานะ:** STEP 1, 2, 3, 4, 5 ดำเนินการแล้ว — **ไม่มีการเขียนฐานข้อมูล / ไม่มี migration / ไม่ assign เจ้าของ / ไม่ deploy**

---

## 01 สรุปผลตามลำดับงาน

| # | งาน | ผล |
|---|---|---|
| 1 | ปิดช่องทาง AI ที่อ่านข้อมูลนอกสิทธิ์ | **DONE** — เพิ่ม DataScope กลาง, dispatcher fail-closed, ทุก AI entry point แนบ scope |
| 2 | แก้การระบุตัวตนบริษัทผ่าน LINE | **DONE** — ใช้ `connect_external_identities.trust_level = verified` เท่านั้น; ลบ name-match ออก 4 จุด |
| 3 | ตรวจความสัมพันธ์ 86 ระเบียนกับบัญชีผู้รวบรวม | **DONE (READ-ONLY)** — 86/86 = UNKNOWN; รายงาน `DNAOS_DATA_OWNERSHIP_VERIFICATION_86.md` |
| 4 | แยกสิทธิ์ค้นพบ / เผยแพร่ราคา / ทำธุรกรรม / อ่านภายใน | **DONE** — `core/authority/rights.ts` + 32 การทดสอบ |
| 5 | ทดสอบว่า AI เจ้าของเห็นข้อมูลที่มีสิทธิ์ และองค์กรอื่นเห็นเฉพาะที่อนุญาต | **DONE** — offline 50 checks + live read-only 5 checks |

---

## 02 STEP 1 — DataScope กลาง

### 2.1 กติกาที่บังคับใช้

```
session / token
      │
      ▼
profiles.id + role ──(org_members)──► organizationIds
      │
      ▼
DataScope = platform | organization | none
      │
      ├─ platform     : super_admin (ผู้ปฏิบัติการแพลตฟอร์ม) — เห็นทุกระเบียน
      ├─ organization : เฉพาะ companies.organization_id ที่อยู่ใน membership
      └─ none         : อ่าน tenant data ไม่ได้ (DENY)
```

- `organization_id = NULL` เป็นของ **platform เท่านั้น** — องค์กรใดจะอ้างโดยปริยายไม่ได้
- ไม่รับ organization id จาก body/query/header
- ไม่มี scope = ไม่มีสิทธิ์ (ไม่ใช่ "ไม่กรอง")

### 2.2 ไฟล์ที่เพิ่ม

| ไฟล์ | หน้าที่ |
|---|---|
| `core/authority/data-scope.ts` | โมเดล scope + รายการคำสั่งที่เป็น tenant read |
| `core/authority/data-scope-context.ts` | พา scope ผ่าน request (AsyncLocalStorage, Node only) |
| `engines/authority/session-scope.ts` | แปลง session/token เป็น scope (platform / organization / none) |

### 2.3 ไฟล์ที่แก้

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `engines/validation/dispatcher.ts` | `dispatch(..., scope?)`; tenant read ที่ไม่มี scope → `DATA_SCOPE_REQUIRED`; ส่ง scope เข้า reader ทุกคำสั่ง |
| `services/supabase/queries.ts` | `getPartners/getPartnerById/getPartnerByName/getDocuments/getLatestInvoice/getReceipts/getOpenDebts/getAllDebts/getDebtTrackings/getJobs/getCustomerGps/getDocumentsByPartner/getBusinessEventsByPartner` รับ scope และกรองตามองค์กร |
| `services/supabase/api-tokens.ts` | เพิ่ม `getApiTokenCallerProfile()` (id + role ปัจจุบัน) |
| `app/api/command/route.ts` | `requireAuth(ADMIN_TIER)` + `runWithDataScope` |
| `app/api/chat/route.ts` | pipeline ทำงานภายใต้ scope ของผู้เรียก |
| `app/api/v1/query/route.ts` | token → profile ปัจจุบัน → scope; dispatch ภายใต้ scope |
| `app/api/admin/capability-boxes/run/route.ts` | dispatch ภายใต้ scope |
| `app/api/internal/line/command/route.ts` | owner bridge (secret-gated) = platform scope พร้อม reason `OWNER_INTERNAL_BRIDGE` |
| `app/api/internal/openclaw/command/route.ts` | เหมือนข้างบน |
| `app/api/admin/line-customers/[lineUserId]/ask/route.ts` | pipeline ภายใต้ scope ของ admin ที่เรียก |

**คำสั่งที่ถูกคุ้มครอง (tenant reads):** `partner.list`, `partner.find`, `partner.profile`, `partner.timeline`, `debt.current`, `debt.list`, `debt.all`, `debt.trackings`, `invoice.list`, `invoice.latest`, `document.*`, `job.list`, `job.active`
**ไม่ถูกคุ้มครอง (master data/คำนวณ):** `material.list`, `business.calculate_tax`, `invoice.items` (รับ debt object ที่ผ่าน scope แล้ว)

### 2.4 พฤติกรรมที่ยังคงเดิมสำหรับงานธุรกิจ

- เจ้าของระบบ (super_admin) ยังใช้คำสั่งเดิมได้ครบ — live check ยืนยันอ่าน 86/86
- `/admin` UI ยังอ่านแบบเดิม (route admin-tier ไม่ได้อยู่ในเส้น AI)
- คำสั่งเขียนไม่เปลี่ยน (ยังต้องผ่าน Rule 72)

---

## 03 STEP 2 — LINE identity

| ไฟล์ | เดิม | ใหม่ |
|---|---|---|
| `supabase/functions/line-webhook-v2/engines/relationship-qa.ts` | link ก่อน แล้ว fallback จับชื่อ `companies.name = line_name` | `connect_external_identities` ที่ `trust_level = verified` และมี `company_id` เท่านั้น; ถ้าไม่พบหรือพบ >1 → ไม่ตอบยอดหนี้ |
| `app/api/admin/line-customers/[lineUserId]/route.ts` | link หรือชื่อ | link เท่านั้น |
| `app/api/admin/line-customers/[lineUserId]/build-event/route.ts` | link หรือชื่อ | link เท่านั้น |
| `app/api/admin/line-customers/route.ts` | link หรือชื่อ (แสดงหนี้) | link เท่านั้น |

ผลข้างเคียงที่ตั้งใจ: ผู้ติดต่อที่ยังไม่มี link/verified จะไม่ถูก attach กับบริษัทใด — ระบบจะถามชื่อแทนการเดา

---

## 04 STEP 3 — ตรวจ 86 ระเบียนกับบัญชีผู้รวบรวม

รายละเอียดเต็ม: **`DNAOS_DATA_OWNERSHIP_VERIFICATION_86.md`**

ข้อสรุปสำคัญ:
- ไม่มีคอลัมน์ `created_by/collected_by/source/import_batch` และไม่มี audit event ของ companies → **ผู้นำเข้า UNKNOWN**
- `companies` 86/86 มี `organization_id = NULL`; องค์กรถูกสร้าง 2026-10-18 หลังข้อมูล
- identity 12 แถวเป็น backfill 2026-10-08 ไม่ใช่หลักฐานการรวบรวม
- **ไม่มีการ assign เจ้าของ** — รอ attestation ของเจ้าของระบบ

---

## 05 STEP 4 — แยกสิทธิ์ 4 ประเภท

ไฟล์: `core/authority/rights.ts` (pure, ไม่มี I/O)

| สิทธิ์ | ใครได้ | หมายเหตุ |
|---|---|---|
| `record.read.internal` | platform / org member / resource owner | เป็นสิทธิ์เดียวที่ DataScope ให้ |
| `directory.discover` | ทุก actor ที่ยืนยันแล้ว **ถ้า** `discoverable = true` | คืนเฉพาะฟิลด์ public; ค่า default คือไม่เปิด |
| `price.publish` | เจ้าของราคา / org ที่ owner verified / platform สำหรับแถวที่ไม่มีเจ้าของ | อ่านภายในไม่ทำให้เผยแพร่ได้ |
| `transaction.create` | เจ้าของ / org member | **platform ไม่มีสิทธิ์ทำธุรกรรมแทน** |

หลักการที่ทดสอบแล้ว: สิทธิ์หนึ่งไม่ imply อีกสิทธิ์ (platform อ่านได้แต่ทำธุรกรรมไม่ได้; stranger discover ได้แต่ internal read ไม่ได้)

---

## 06 STEP 5 — ผลทดสอบ

### 6.1 Offline (ไม่แตะ DB)

`npx tsx scripts/ai-data-scope-and-identity.test.ts`

```
checks=50 failed=0
GATE: PASS
```

ครอบคลุม: scope matrix · สององค์กรแยกกัน · NULL เป็น platform-only · dispatcher deny · สิทธิ์ 4 ประเภท · ไม่มี name-match · ทุก entry point แนบ scope

### 6.2 Live read-only กับ Production

`SUPABASE_SERVICE_ROLE_KEY=… npx tsx --env-file=.env.local scripts/ai-data-scope-live-check.ts`

```
PASS  platform scope reads the full directory (86/86)
PASS  organization scope sees only its own companies (0/0)
PASS  unattributed records stay platform-only (86)
PASS  unscoped partner.list is denied
PASS  an out-of-scope company cannot be read by id
checks=5 failed=0
GATE: PASS
```

ตีความ:
- **AI ของเจ้าของ (platform) ยังอ่านข้อมูลที่มีสิทธิ์ได้ครบ 86 รายการ**
- **องค์กรจริงวันนี้เห็น 0 รายการ** เพราะยังไม่มีบริษัทใดถูกผูกองค์กร — ถูกต้องตามหลัก "NULL ไม่ใช่ของใคร"
- เมื่อองค์กรมีข้อมูลของตนในอนาคต ตัวกรองจะคืนเฉพาะแถวที่ `organization_id` ตรง membership (ทดสอบด้วย fixture สององค์กรใน offline suite)

### 6.3 Regression suite ที่รัน

| ชุดทดสอบ | ผล |
|---|---|
| `tsc --noEmit` | PASS (ไม่มี error) |
| `authority-resolver.test.ts` | 24/24 |
| `authority-scope-and-concurrency.test.ts` | 40/40 |
| `authority-step1-org-binding.test.ts` | 40/40 |
| `material-price-authority.test.ts` | 45/45 |
| `connect-inbound-boundary-test.ts` | 54/54 |
| `ai-context-test.ts` | 12/12 |
| `context-planner-test.ts` | 14/14 |
| `job-live-path-test.ts` (live) | PASS |
| `public-catalog-policy-test.ts` | **110 passed / 2 failed — pre-existing** |

**หมายเหตุ public-catalog 2 checks:** เป็นความไม่ตรงกันที่มีอยู่ก่อนรอบนี้ระหว่างเทสต์กับ `engines/canonical/material-price-write.ts` (writer เปลี่ยนไปเรียก RPC `apply_material_price_atomic` ซึ่งบันทึก audit ภายใน DB function แล้ว แต่เทสต์ยังตรวจ regex `.from("audit_logs").insert` และ `.select("id, price")`) — ไม่ได้เกิดจาก STEP 1–5 และไม่ได้แก้ในรอบนี้

---

## 07 สิ่งที่ยังไม่ได้ทำ (ต้องรอเจ้าของอนุมัติ)

| # | งาน | เหตุผล |
|---|---|---|
| 1 | ผูก `organization_id` ให้ 86 ระเบียน | ต้องมี attestation (STEP 3) — ห้ามเดา |
| 2 | Migration สำหรับ provenance/disclosure/AI scope | ยังไม่ขออนุมัติ schema change |
| 3 | เปิด public directory (discovery) | ยังไม่มีคอลัมน์ `discoverable` และยังไม่มีนโยบายเผยแพร่ |
| 4 | Scope ให้ `/api/admin/*` ทั้งหมด | รอบนี้ปิดเฉพาะเส้น AI ตามลำดับงานข้อ 1; admin UI ยังเป็น admin-tier |
| 5 | แก้ 2 checks ของ public-catalog | งานคนละส่วน (material price writer) |

---

## 08 ไฟล์ที่เพิ่ม/แก้ในรอบนี้

**เพิ่ม**
- `core/authority/data-scope.ts`
- `core/authority/data-scope-context.ts`
- `core/authority/rights.ts`
- `engines/authority/session-scope.ts`
- `scripts/ai-data-scope-and-identity.test.ts`
- `scripts/ai-data-scope-live-check.ts`
- รายงาน 3 ฉบับ (audit, verification 86, execution นี้)

**แก้**
- `engines/validation/dispatcher.ts`
- `services/supabase/queries.ts`
- `services/supabase/api-tokens.ts`
- `app/api/command/route.ts`, `app/api/chat/route.ts`, `app/api/v1/query/route.ts`
- `app/api/admin/capability-boxes/run/route.ts`
- `app/api/internal/line/command/route.ts`, `app/api/internal/openclaw/command/route.ts`
- `app/api/admin/line-customers/[lineUserId]/ask/route.ts`
- `app/api/admin/line-customers/[lineUserId]/route.ts`
- `app/api/admin/line-customers/[lineUserId]/build-event/route.ts`
- `app/api/admin/line-customers/route.ts`
- `supabase/functions/line-webhook-v2/engines/relationship-qa.ts`
- `scripts/job-live-path-test.ts` (อัปเดต assertions ให้ตรง signature ที่มี scope)

**ไม่แตะ:** ฐานข้อมูล, RLS, role, migration, AI Gateway provider, `organization_id`
