# WAVE 2 — CENTRAL AUTHORITY REPAIR (รายงานผล)
**วันที่:** 2026-10-25 · **HEAD:** `d7fbb05b` · **ขอบเขต:** local source + offline test
**ผลรวม: 🟡 PARTIAL PASS — Direct Business Writes 14 → 11 (−3) · Authority resolver ทำงานจริง 24/24 · 11 จุดที่เหลือ BLOCKED พร้อมหลักฐาน**

---

## 01 OBJECTIVE — เกณฑ์ที่ต้องผ่าน

| # | เกณฑ์ | ผล |
|---|---|---|
| 1 | ทุกช่องทางเป็น transport เท่านั้น | 🟡 11 จุดยังเหลือ (จาก 14) |
| 2 | ทุกการเปลี่ยนข้อมูลธุรกิจผ่าน Authority กลาง | 🟡 มี resolver + price command แล้ว · ยังไม่ผูกทุกเส้นทาง |
| 3 | Actor → Organization → Resource → Scope → Action + fail-closed | ✅ ผ่าน 24/24 (pure test) |
| 4 | ห้ามใช้ ADMIN_TIER / first-link / ชื่อบริษัท เป็นสิทธิ์ | ✅ บังคับในโค้ด (role เดียว = DENY) |
| 5 | คำสั่งซ้ำไม่สร้างธุรกรรมซ้ำ | ✅ order_no derive จาก idempotency key + UNIQUE ใน DB |
| 6 | ไม่มีผลบางส่วน (ธุรกรรม+audit) | 🟡 compensation ผ่าน test · atomic เต็มต้องมี RPC (proposal) |
| 7 | Meta ตอบกลับช่องทางเดิม | ⛔ BLOCKED (ไม่มี outbound adapter — ไม่สร้างใหม่) |

---

## 02 SOURCE EVIDENCE

### 2.1 Diff ที่ทำจริง (local เท่านั้น)

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `core/authority/resolve.ts` **(ใหม่)** | resolver: owner / explicit grant / org match / time window / revoke · admin role เดียว = `ROLE_IS_NOT_AUTHORITY` · ไม่มี input ของ LINE link/display name |
| `engines/canonical/material-price-write.ts` **(ใหม่)** | 2 คำสั่ง: `recordSellerOffer` (หลักฐานเท่านั้น) + `applyMaterialPrice` (ต้องมีสิทธิ์) · audit ทุกครั้ง · compensation เมื่อ audit fail |
| `engines/canonical/audit.ts:30–37` | เพิ่ม `price.offer_recorded` / `price.updated` / `price.created` (additive) |
| `engines/canonical/transaction-write.ts:107–160, 195–215` | `orderNoFor(idempotencyKey)` + replay lookup + 23505 race recovery |
| `engines/integration-gateway/adapters/line.ts:37–47, 100–112` | เพิ่ม `sender_id` ใน evidence (เดิมทิ้ง `source.userId`) |
| `app/api/internal/connect/material-price/route.ts` **(ใหม่)** | Connect boundary ปิดคำสั่ง `price.offer.record` + secret fail-closed |
| `supabase/functions/_shared/connect-price.ts` **(ใหม่)** | Deno bridge → boundary (fail-closed, ไม่มี fallback) |
| `supabase/functions/line-webhook-v2/engines/supplier-quote-reply.ts` | **ลบ**การเขียน `pit_materials` ทั้งหมด · คำตอบผู้ขาย = offer ผ่าน bridge · ข้อความตอบไม่กล่าวอ้างว่าอัปเดตราคาแล้ว |
| `supabase/functions/line-webhook-v2/handlers/text.ts:87` | ส่ง LINE message id เป็น evidence + idempotency key |
| `app/api/admin/transactions/route.ts:70,85–95` | รับ/ส่ง `idempotency_key` |
| `app/api/admin/ide/_lib/canonicalJobTransportRuntime.ts:58–62` | ส่ง `env.idempotency_key` เข้า `createTransaction` |
| `engines/jobs/auto-create.ts:154–160` | key = `job_auto_create:<event.id>` (1 event ≤ 1 transaction) |
| `scripts/authority-resolver.test.ts` **(ใหม่)** · `scripts/material-price-authority.test.ts` **(ใหม่)** · `scripts/transaction-idempotency.test.ts` **(ใหม่)** · `scripts/central-processing-boundary.test.ts` (ขยาย) | offline tests |

**ไม่มี** UI change · ไม่มี migration apply · ไม่มีข้อความ LINE จริง · ไม่มี commit/push/deploy

### 2.2 จำนวน Direct Business Writes (นับจาก source จริง)

| กลุ่ม | ก่อน | หลัง | จุดที่ย้าย |
|---|---|---|---|
| A ราคา/คำขอราคา | 3 | **0** | `supplier-quote-reply.ts:51,68,70` → `material-price-write.ts#recordSellerOffer` (ผ่าน Connect route) |
| B อำนาจ | 2 | 2 | — |
| C ชำระเงิน (print) | 5 | 5 | — |
| D สถานที่ | 3 | 3 | — |
| E ค่าบริการ | 1 | 1 | — |
| **รวม** | **14** | **11** | **−3** |

หลักฐาน: `scripts/central-processing-boundary.test.ts` → `FAIL B 11 direct business write(s)` (ก่อนหน้า 14)

### 2.2b ตรวจ Authority รายจุด — 14 จุด (§01)

**A. ราคาและคำขอราคา — 3 จุด (ย้ายสำเร็จ 3/3)**

| # | จุด / Source Evidence | Existing Writer (เดิม) | Canonical Route (ใหม่) | ผู้มีสิทธิ์สั่งงาน | Tenant / Resource Scope | Idempotency | Atomic | Audit | Regression Test |
|---|---|---|---|---|---|---|---|---|---|
| A1 | `engines/supplier-quote-reply.ts` เดิม insert `pit_materials` (ราคาใหม่) | provider tier เขียนตารางราคาโดยตรง | `_shared/connect-price.ts` → `POST /api/internal/connect/material-price` → `material-price-write.ts:158 recordSellerOffer` | ผู้ขาย (เจ้าของ `pit_profiles.line_user_id` ของคำขอนั้น) — เป็น **ข้อเสนอ** ไม่ใช่ราคากลาง | `request.pit_profile_id` ต้องตรงกับผู้ส่ง + `pit_price_requests.status=pending` | `seller_offer:<request>:<message_id>` (LINE message id) | offer + audit ในคำสั่งเดียว; audit fail → คืน error ไม่ทิ้งแถว | `price.offer_recorded` (`audit.ts:30–37`) | `material-price-authority.test.ts` 30/30 · `transaction-idempotency.test.ts` |
| A2 | `supplier-quote-reply.ts` เดิม update `pit_materials` (ราคาที่มีอยู่) | provider tier | `material-price-write.ts:231 applyMaterialPrice` (ยังไม่ผูก route) | owner ของ resource หรือ explicit grant `price.write` | `resource.organizationId` + grant org match | `idempotency_key` ต่อคำสั่ง | ต้องมี RPC M1 จึง atomic เต็ม (ตอนนี้ compensation) | `price.updated` / `price.created` | `authority-resolver.test.ts` 24/24 |
| A3 | `app/api/admin/pits/[pitId]/materials/route.ts:27,41,54,62,81` เขียน `pit_materials` + `audit_logs` สองคำสั่ง | admin route (legacy) | ยังไม่ย้าย — ต้องเรียก `applyMaterialPrice` | ปัจจุบัน `requireAuth(ADMIN_TIER)` — resolver ปฏิเสธ role เดี่ยว (`ROLE_IS_NOT_AUTHORITY`, `resolve.ts:161`) | ไม่มี org/resource scope ในคำขอ | ไม่มี | ไม่ atomic (2 คำสั่งแยก) | เขียนเองแบบ manual | ⛔ BLOCKED (ต้อง M1+M2 ก่อน) |

**B. การมอบอำนาจ — 2 จุด (BLOCKED 2)**

| # | จุด / Source Evidence | Existing Writer | Canonical Route ที่ต้องใช้ | ผู้มีสิทธิ์สั่งงาน | Scope ที่ขาด | Idempotency | Atomic / Audit | Test |
|---|---|---|---|---|---|---|---|---|
| B1 | `engines/authorization-check.ts:60` insert `pending_authorizations` | provider tier สร้างคำขออนุมัติ | ต้องมี `authority_grants` (M2) + คำสั่งกลาง | เจ้าของ resource เท่านั้น (ตาม M2) | ไม่มี `scope`, `valid_from/to`, `revoked_at`, หลักฐานผู้อนุมัติ | ไม่มี | ไม่มี audit ผูก | ⛔ BLOCKED — schema ไม่พอ |
| B2 | `handlers/postback.ts:99–100` update `pending_authorizations.status` | provider tier อนุมัติ/ปฏิเสธเอง | คำสั่ง `authority.decide` ผ่าน resolver | ผู้ถือ grant ที่ยังไม่ถูก revoke | ไม่ตรวจว่า actor เป็นเจ้าของ resource หรือผู้รับมอบ | ไม่มี | ไม่ atomic กับการเขียนธุรกิจ | ⛔ BLOCKED — ต้อง M2 |

**C. สถานะการรับเงิน — 5 จุด (BLOCKED 5)**

| # | จุด / Source Evidence | Existing Writer | Canonical Route ที่ต้องใช้ | ผู้มีสิทธิ์สั่งงาน | Scope ที่ขาด | Idempotency | Atomic / Audit | Test |
|---|---|---|---|---|---|---|---|---|
| C1 | `engines/print-jobs.ts:42` insert `print_jobs` | provider tier | ต้องผูก job → `receipt_documents` | พนักงานหน้าร้านที่มีสิทธิ์ตาม org | ไม่มี org scope ของผู้สั่ง | ไม่มี | ไม่มี audit | ⛔ BLOCKED (M3) |
| C2 | `print-jobs.ts:73–74` update `copies/amount_expected` | provider tier | คำนวณผ่าน pricing เดิม + audit | เจ้าของ job | ไม่มี | ไม่มี | ไม่ atomic | ⛔ BLOCKED |
| C3 | `print-jobs.ts:99–100` update `status=paid` (เงินสด) | **provider tier ตั้ง paid เอง** | `confirmPayment` (Canonical Payment Authority) + สถานะเงินสดนำส่งแยก | ผู้มีสิทธิ์รับเงินเท่านั้น | ไม่มี | ไม่มี | ไม่ atomic/audit | ⛔ BLOCKED — ผิดกฎ §04 ตรง ๆ |
| C4 | `print-jobs.ts:111` update `payment_method=transfer` | provider tier | ผ่าน receipt-confirm-flow | ผู้มีสิทธิ์ | ไม่มี | ไม่มี | ไม่มี audit | ⛔ BLOCKED |
| C5 | `print-jobs.ts:133,146–147` update `status=paid, amount_paid` | provider tier | `confirmPayment` + `payment_allocations` | Payment Authority | ไม่มี | `PAYMENT_ALREADY_ALLOCATED` (มีใน RPC แต่ไม่ถูกเรียกจากที่นี่) | ไม่ atomic | ⛔ BLOCKED — ต้อง M3 |

**D. สถานที่และโครงการ — 3 จุด (BLOCKED 3)**

| # | จุด / Source Evidence | Existing Writer | Canonical Route ที่ต้องใช้ | ผู้มีสิทธิ์สั่งงาน | Scope ที่ขาด | Idempotency | Atomic / Audit | Test |
|---|---|---|---|---|---|---|---|---|
| D1 | `engines/event-followup.ts:527` insert `customer_sites` | provider tier | Site Authority กลาง (ยังไม่มี) | เจ้าของ `customer_company_id` | ไม่ตรวจ org ของผู้ส่ง | ไม่มี | ไม่มี audit | ⛔ BLOCKED (M4) |
| D2 | `event-followup.ts:542` insert `customer_sites` (สาขาที่ 2) | provider tier | เดียวกัน | เดียวกัน | ไม่มี | ไม่มี | ไม่มี | ⛔ BLOCKED |
| D3 | `handlers/location.ts:62` insert `customer_sites` จากพิกัด LINE | provider tier | ต้องเป็น **ข้อมูลรอยืนยัน** ไม่ใช่สถานที่จริงทันที | เจ้าของ org | ใช้ `link.company_id` จาก first-link โดยไม่ตรวจ grant | ไม่มี | ไม่มี audit | ⛔ BLOCKED — ผิดกฎ §05 |

**E. สถานะค่าบริการ — 1 จุด (BLOCKED 1)**

| # | จุด / Source Evidence | Existing Writer | Canonical Route ที่ต้องใช้ | ผู้มีสิทธิ์สั่งงาน | Scope ที่ขาด | Idempotency | Atomic / Audit | Test |
|---|---|---|---|---|---|---|---|---|
| E1 | `engines/owner-dispatcher.ts:153` update `supabase_billing_events` | provider tier (status flip) | derived read model จาก payable / `processing_fee` ของ Transaction | ระบบบัญชีกลาง | ไม่มีโมเดลค่าบริการผูก Transaction | ไม่มี | ไม่มี audit | ⛔ BLOCKED — ยังไม่มี fee model |

### 2.3 หมายเหตุสำคัญเรื่องราคา (ความซื่อสัตย์ของตัวเลข)
- **provider side** ไม่เขียนราคาแล้ว (0 จุด)
- แต่ **admin route** `app/api/admin/pits/[pitId]/materials/route.ts:62–87` ยังเขียน `pit_materials` + audit เอง (สองคำสั่ง) → ถือเป็น legacy writer ที่ยังเหลือ
- `applyMaterialPrice()` ถูกสร้างเป็นคำสั่งกลางแล้ว **แต่ยังไม่ผูกกับ route** เพราะ route ใช้ `ADMIN_TIER` ซึ่ง resolver ปฏิเสธโดยเจตนา (ไม่มีข้อมูลเจ้าของ/grant) การผูกตอนนี้จะทำให้แอดมินแก้ราคาไม่ได้ → **BLOCKED รอข้อมูลสิทธิ์ + การอนุมัติ**

### 2.4 Authority resolver — กติกาที่บังคับใช้ (ทดสอบแล้ว)
```
Actor → Organization → Resource → Granted Scope → Action
owner:  resource.ownerProfileId === actor.profileId      → allow (เฉพาะ price.write / price.offer.record / site.create)
grant:  subject=actor · action ตรง · resource ตรง/"*"   → allow
org:    grant.organizationId === resource.organizationId และ actor อยู่ใน org → มิฉะนั้น deny
time:   validFrom ≤ at ≤ validTo · revokedAt ≠ null → deny · วันที่เพี้ยน = deny
role:   super_admin/admin เดียว ๆ → deny (ROLE_IS_NOT_AUTHORITY)
```
ไม่มีพารามิเตอร์สำหรับ LINE link / display name / company name → **first-link และ name-matching ทำไม่ได้เชิงโครงสร้าง**

### 2.5 Idempotency (§06) — สถานะรายคำสั่ง

| คำสั่ง | กลไก | สถานะ |
|---|---|---|
| Transaction create | `orderNoFor(key)` + UNIQUE(order_no) + 23505 recovery | ✅ ทำ |
| Business event | `event_code UNIQUE` | ✅ มีอยู่แล้ว |
| Seller price offer | `idempotency_key` + answered-state no-op | ✅ ทำ |
| Document create | job envelope `idempotency_key` + `customer_order` link | ✅ มีอยู่แล้ว |
| Payment allocation | `PAYMENT_ALREADY_ALLOCATED` + atomic RPC | ✅ มีอยู่แล้ว |
| Processing fee | ยังไม่มีโมเดลค่าบริการ | ⛔ BLOCKED |
| Vehicle/equipment booking | ไม่มีกลไกจอง | ⛔ BLOCKED |

---

## 03 RESULT

### 3.1 Regression (§09)

| suite | ผล |
|---|---|
| `central-processing-boundary.test.ts` | **71 checks, 3 findings** (B 11 / F / G6) |
| `authority-resolver.test.ts` (ใหม่) | **24/24 PASS** |
| `material-price-authority.test.ts` (ใหม่) | **30/30 PASS** |
| `transaction-idempotency.test.ts` (ใหม่) | **11/11 PASS** |
| `connect-channel-receive.test.ts` | **77/77 PASS** (ยืนยันหลังเพิ่ม sender_id) |
| `connect-identity-model-test.ts` | 54 PASS |
| `connect-inbound-boundary-test.ts` | 53 PASS |
| `business-event-authority-test.ts` | 34 PASS |
| `document-authority-census.test.ts` | 58 PASS |
| `connect-boundary-census-test.ts` | 15 PASS |
| `payment-atomic-boundary-test.ts` | PASS (12+C1–C4; output ระบุ production untouched) |
| `npx tsc --noEmit` | **0 error** |

**ประเภทหลักฐาน:** Static = boundary/authority/idempotency structure + 4 ชุดเดิม · Mock = price authority (in-memory deps) + LINE/Meta normalization · Local E2E = ไม่มี (ไม่ได้รัน server) · **Production Evidence = ไม่มีในรอบนี้**

### 3.2 จุดที่ย้ายสำเร็จ / ยัง BLOCKED

| กลุ่ม | ย้ายสำเร็จ | BLOCKED | เหตุผลที่ยังไม่ผ่าน (หลักฐาน) |
|---|---|---|---|
| A ราคา | **3/3 provider writes** | การรวม route ฝั่งแอดมิน | route ยังใช้ `ADMIN_TIER` (`materials/route.ts:27`) ไม่มีข้อมูลเจ้าของ/grant + ต้อง atomic RPC |
| B อำนาจ | 0/2 | 2 | `pending_authorizations` ไม่มี scope/วันมีผล/หลักฐาน (`authorization-check.ts:60`, `postback.ts:100`); ต้องมี `authority_grants` (migration proposal) |
| C ชำระเงิน | 0/5 | 5 | `print_jobs` ไม่ผูกกับ `receipt_documents`/`confirmPayment`; ต้องมี linkage + นโยบายเงินสด (`print-jobs.ts:42,74,100,111,147`) |
| D สถานที่ | 0/3 | 3 | ไม่มี site authority/canonical writer; ต้องมีคำสั่งกลาง + tenant validation (`event-followup.ts:527,542`, `handlers/location.ts:62`) |
| E ค่าบริการ | 0/1 | 1 | ต้องเป็น derived read model จาก payable (`owner-dispatcher.ts:154`) |
| — | — | Meta outbound | ไม่มี `graph.facebook.com` ในโปรเจกต์ — **ไม่สร้าง Messaging Engine ใหม่** |
| — | — | Company scope | `requireAuth`/`session` มีแต่ role (test F) — ต้องมี org membership scope |

### 3.3 Migration ที่เสนอ (ยังไม่ Apply)

| # | Migration ขั้นต่ำ | Rollback | Test ที่ต้องมีก่อน apply |
|---|---|---|---|
| M1 | RPC `apply_material_price(price + audit)` เพื่อ atomic เต็ม | `drop function` | `material-price-authority` ขยายเป็น DB test |
| M2 | `authority_grants` (+ `org_members.scope`, `revoked_at`) | `drop table` / drop columns | authority resolver + claim/decide test |
| M3 | `print_jobs.receipt_document_id` + unique + สถานะ `collect_on_pickup` | drop columns | print-job-payment test |
| M4 | `customer_site_requests` (pending confirmation) หรือคอลัมน์สถานะยืนยัน | drop table | site-create-authority test |
| M5 | `supabase_billing_events.status` เป็น view/derived หรือ col `derived_at` | restore writes | billing-derived test |

### 3.4 Canonical Writers ที่เปลี่ยนแปลง
- `engines/canonical/audit.ts` (action vocabulary)
- `engines/canonical/transaction-write.ts` (idempotency)
- `engines/canonical/material-price-write.ts` (ใหม่ — รวมอำนาจราคาเป็นคำสั่งเดียว ไม่ใช่ writer คู่ขนาน และไม่มี provider branch)
- **ไม่แตะ** `document-write`, `payment-write`, `expense-write`, `event-write`, `inbound-write`

### 3.5 ความเสี่ยงที่ยังเหลือ
1. compensation ≠ atomic: ถ้า process ตายระหว่าง write กับ audit จะเหลือแถวที่ไม่มี audit (ต้อง M1)
2. admin route ยังเป็น price writer ที่สอง (ต้อง M2 + ผูก route)
3. LINE ยัง dual path (legacy business pipeline + observe) — retire ยังไม่ทำ
4. Meta inbound ยังตอบกลับไม่ได้

> **STOP** — ไม่มี production change, ไม่มี migration apply, ไม่มี commit/push/deploy, ไม่มีข้อความจริง
