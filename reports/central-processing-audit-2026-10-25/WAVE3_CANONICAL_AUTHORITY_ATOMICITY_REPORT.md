# WAVE 3 — CANONICAL AUTHORITY & ATOMIC WRITER REPAIR
**วันที่:** 2026-10-25 · **BASE_SHA:** `d7fbb05b2512389f384d7642fb52830d3d193fb2` · **ขอบเขต:** local source + local DB (PostgreSQL 18 ชั่วคราว) + offline tests
**ผลรวม: 🟡 PARTIAL PASS — Price writers 2 → 1 · Atomic price+audit พิสูจน์บน local DB 19 checks · Concurrency พิสูจน์ด้วย row lock จริง · Direct provider writes ยัง 11 จุด (BLOCKED ตามหลักฐาน) · Org scope ยัง BLOCKED (ไม่มีตาราง org ใน schema)**

---

## 01 OBJECTIVE — เกณฑ์และ Baseline

### 1.1 Baseline ที่ตรวจซ้ำจาก Source จริง (ไม่รับตัวเลขรายงานเดิมโดยอัตโนมัติ)

| รายการ | รายงาน WAVE 2 อ้าง | ตรวจซ้ำก่อนแก้ (2026-10-25) | ผล |
|---|---|---|---|
| Provider Direct Business Writes | 11 | **11** (`central-processing-boundary` B) | ✅ ตรง |
| Boundary Test | 68/71 | **68/71** (71 checks, 3 findings: B/F/G6) | ✅ ตรง |
| Authority Resolver | 24/24 | **24/24 PASS** | ✅ ตรง |
| Material Price Test | 30/30 | **30/30 PASS** (เวอร์ชัน WAVE 2) | ✅ ตรง |
| Transaction Idempotency | 11/11 | **11/11 PASS** | ✅ ตรง |
| `npx tsc --noEmit` | 0 error | **0 error** | ✅ ตรง |
| Working tree | — | 73 entries (งาน local อื่นค้างอยู่ก่อน WAVE 3) | บันทึกไว้ ไม่เขียนทับ |
| ทดสอบเพิ่มที่พบว่าล้มก่อนเริ่ม | — | `connect-inbound-boundary-test` **52/53** (A4 ขัดกับ sender_id ของ WAVE 2) | พบ conflict จริง → ดู §2.5 |

### 1.2 เกณฑ์ที่ต้องผ่านใน WAVE 3

| # | เกณฑ์ | ผล |
|---|---|---|
| 1 | Price Writer เหลือ authority เดียว (admin + provider) | ✅ **PASS** (2 → 1) |
| 2 | ราคา + Audit อยู่ใน transaction เดียว | ✅ **PASS (Local DB)** · ⛔ ยังไม่ apply production |
| 3 | Organization/Resource Scope + fail-closed | 🟡 resolver/loader PASS · **org binding BLOCKED** (ไม่มีตาราง) |
| 4 | ซ้ำ/พร้อมกันไม่สร้างรายการซ้ำ | ✅ **PASS (Local DB + mock)** |
| 5 | 11 provider writes ที่เหลือ | ⛔ **BLOCKED 11** (หลักฐาน §2.4) |
| 6 | Meta ตอบกลับช่องทางเดิม | ⛔ **BLOCKED** (ไม่มี outbound adapter) |
| 7 | ไม่มี production change | ✅ ไม่มี migration apply / deploy / commit / push |

---

## 02 SOURCE EVIDENCE

### 2.1 Diff ที่ทำจริง (local เท่านั้น)

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `engines/canonical/material-price-write.ts:131,148` | เขียนผ่าน `.rpc("record_seller_offer_atomic")` / `.rpc("apply_material_price_atomic")` เท่านั้น · **ลบ compensation path ทั้งหมด** · `:66` fail-closed `PRICE_ATOMIC_RPC_MISSING` |
| `app/api/admin/pits/[pitId]/materials/route.ts:43,57,60` | เลิกเขียน `pit_materials` + `audit_logs` เอง · เหลือ `requireAuth(ADMIN_TIER)` เป็น gate ชั้นหยาบ + `loadAuthorityContext` + `applyMaterialPrice` |
| `engines/authority/load.ts` **(ใหม่)** `:39,61,116` | loader: `org_members` → organizationIds, `authority_grants` → ScopeGrant · error/ไม่มีตาราง = **[] (fail-closed)** · ไม่มี branch "unknown = allow" |
| `supabase/migrations/20261025000001_material_price_atomic_v1.sql` **(ใหม่)** `:43,126` | 2 ฟังก์ชัน atomic: lock `pit_price_requests` / `pit_profiles` + `pit_materials` (`for update` `:75,178,198`), audit insert ในฟังก์ชันเดียว (`:102,230`), revoke anon/authenticated (`:255–266`) |
| `..._v1_rollback.sql` **(ใหม่)** | drop 2 ฟังก์ชันเท่านั้น ไม่แตะข้อมูล |
| `supabase/migrations/20261025000002_authority_grants_proposal.sql` **(ใหม่)** `:41` | ตาราง `authority_grants` (closed action vocabulary, valid window, revoked_at) · ระบุชัดว่า **ไม่มี RLS policy** เพราะยังไม่มี ownership column |
| `..._authority_grants_rollback.sql` **(ใหม่)** | drop table + คำสั่ง export ก่อน drop |
| `scripts/material-price-authority.test.ts` | เขียนใหม่ 45 checks: atomic-only seam, deny path, no compensation |
| `scripts/authority-scope-and-concurrency.test.ts` **(ใหม่)** | 40 checks: loader fail-closed, org/cross-tenant, concurrent price/offer, SQL evidence, fee/booking BLOCKED evidence |
| `scripts/connect-inbound-boundary-test.ts` | แก้เฉพาะ A4 ที่ขัดกับข้อกำหนด identity (§2.5) |

**ไม่แตะ:** UI · `document-write` · `payment-write` · `expense-write` · `event-write` · provider adapters · ตารางธุรกิจเดิม

### 2.2 หลักฐาน Schema — สิทธิ์ที่มีจริง vs ที่ไม่มี

| ตารางที่ WAVE 3 สั่งให้ตรวจ | มีใน schema? | หลักฐาน |
|---|---|---|
| `organizations` | ❌ **ไม่มี** | `grep -rniE "^create table.*organizations" supabase/…` = 0 |
| `org_members` | ❌ **ไม่มี** | grep ทั้ง `supabase/migrations` + `local-migration` = 0 |
| `identity_memberships` | ❌ **ไม่มี** | grep = 0 |
| `scoped_grants` | ✅ มี แต่เป็น **AI tool scope** (`subject_type IN account/device/tool`, action read/write/delete/run/install/send/secret) ไม่ใช่ org/resource authority | `20260926000001_tool_scope_and_commands.sql:19–32` · แก้ข้อความจาก WAVE 3 ฉบับแรกที่ระบุว่าไม่มี |
| `companies` | ✅ มี แต่ไม่มี owner/member column | `full_schema.sql:849–865` (`line_user_id` เท่านั้น) |
| `pit_profiles.user_id` | ✅ มี (nullable) = เจ้าของ resource เดียวที่พิสูจน์ได้ | `full_schema.sql:1381–1408` |
| `company_line_links` | ✅ มี (หลักฐานการเชื่อม LINE ไม่ใช่สิทธิ์) | `full_schema.sql:880+` |
| `audit_logs` | ✅ มี (`actor_user_id`, entity, action, old/new) | `full_schema.sql:761–776` |
| `authority_grants` | ❌ ไม่มี → **เสนอ migration** (ไม่ apply) | migration `20261025000002` |

**ผล:** การตรวจสิทธิ์จริงตอนนี้มีได้ 2 ทางเท่านั้น — (1) owner ของ `pit_profiles.user_id` (2) grant ที่จะมาจากตารางที่ยังไม่ถูก apply. ทุกทางอื่น **DENY** รวมถึง `ADMIN_TIER` เดี่ยว (`resolve.ts:161 ROLE_IS_NOT_AUTHORITY`).

### 2.3 Atomicity — Local Database E2E (PostgreSQL 18, cluster ชั่วคราว `/tmp`, ไม่ใช่ production)

สร้าง schema ขั้นต่ำตาม dump จริง (`profiles`, `pit_profiles`, `pit_materials`, `pit_price_requests`, `audit_logs`) แล้ว apply migration ทั้งสองไฟล์:

| การทดสอบ | ผล |
|---|---|
| owner update 520 → price committed + `price.updated` 1 แถว | PASS (3 checks) |
| ราคาเดิมซ้ำ → `changed=false`, audit ไม่เพิ่ม | PASS (2 checks) |
| `authority_allowed=false` → exception, ราคา/audit ไม่เปลี่ยน | PASS (2 checks) |
| owner-path แต่ profile ไม่ตรง (`owner_mismatch`) → ปฏิเสธ | PASS (2 checks) |
| **trigger ทำให้ audit insert ล้ม → ราคา 600 rollback กลับ 520, audit ไม่เพิ่ม** | **PASS (2 checks)** |
| สร้างราคาใหม่ → `price.created` | PASS (2 checks) |
| seller offer 480 → request answered, **ราคากลางยัง 520**, audit 1 | PASS (3 checks) |
| offer ซ้ำ → `already_recorded=true`, audit ไม่เพิ่ม | PASS (2 checks) |
| offer ราคาอื่นบน request ที่ตอบแล้ว → exception, ค่าเดิมคงอยู่ | PASS (1 check) |
| pit ที่ `user_id = null` อ้าง owner → ปฏิเสธ, ไม่มีแถวใหม่ | PASS (1 check) |
| **ROLLBACK ทั้งสองไฟล์** → functions = 0, `authority_grants` = null | PASS |
| **Apply migration ซ้ำ** (idempotency ของไฟล์) | PASS |

**รวม 19/19 functional checks PASS** + rollback + re-apply

### 2.4 Concurrency — Local DB (สอง connection จริง)

| การทดสอบ | ผล |
|---|---|
| Session A: `begin; apply(price=900); pg_sleep(2); commit` · Session B เริ่มหลัง 0.4s ด้วยราคาเดียวกัน | A `changed=true` · B **รอ 2 วินาที** แล้ว `changed=false` · audit 1 แถว · ราคาสุดท้าย 900 |

หลักฐาน: `for update` บน `pit_profiles` (`migration:178`) + no-op ภายใน lock (`:196`) → คำสั่งซ้ำไม่สร้าง audit/แถวซ้ำ แม้เข้ามาพร้อมกันจริง

### 2.5 Conflict ที่พบและวิธีแก้ (ไม่ใช่การลด assertion)

`connect-inbound-boundary-test.ts:93` เดิมบังคับว่า **"provider user id never enters evidence"** แต่ `central-processing-boundary.test.ts` C บังคับว่า LINE evidence **ต้องมี `sender_id`** (Meta มีอยู่แล้ว; WAVE 2 เติมให้ LINE) — สองเทสต์ขัดกันเองและทำให้ suite ล้ม 52/53 ตั้งแต่ก่อน WAVE 3

การแก้: เปลี่ยน A4 เป็นกฎที่แม่นยำกว่าเดิม
- provider id ไปได้ **เฉพาะ key `sender_id`** ที่อยู่ใน whitelist
- ห้าม display name / phone / picture / token / ข้อความลูกค้า
- ยังคงตรวจ key whitelist เดิมทั้งหมด

ผล: **54/54 PASS** และสอดคล้องกับ WAVE 3 §06 ("รักษา Provider Identity … โดยไม่ถือว่า Identity เป็นอำนาจธุรกิจ") — ไม่ได้ลบการป้องกัน content leak

### 2.6 ตัวเลข Price Writers / Direct Writes (นับจาก source จริง)

| รายการ | ก่อน WAVE 3 | หลัง WAVE 3 | หลักฐาน |
|---|---|---|---|
| Price writer modules | **2** (`material-price-write.ts` + admin materials route) | **1** (`material-price-write.ts` → RPC) | `grep -rn "from(\"pit_materials\")"` = read-only ทุกจุด; ไม่มี `.insert/.update` เหลือ |
| Provider direct business writes | 11 | **11** (ไม่เปลี่ยน) | boundary test B |
| - ราคา (A) | 0 (ย้ายแล้ว WAVE 2) | 0 | supplier-quote-reply ไม่มี write |
| - อำนาจ (B) | 2 | 2 | `authorization-check.ts:60`, `postback.ts:99–100` |
| - เงินพิมพ์ (C) | 5 | 5 | `print-jobs.ts:42,73–74,99–100,111,146–147` |
| - สถานที่ (D) | 3 | 3 | `event-followup.ts:527,542`, `handlers/location.ts:62` |
| - ค่าบริการ (E) | 1 | 1 | `owner-dispatcher.ts:153` |

> หมายเหตุความซื่อสัตย์: admin route **ไม่เคยอยู่ใน census provider tier** ดังนั้นการรวม route ไม่ลดเลข 11 — แต่ลด **price writers 2 → 1** ซึ่งเป็นตัวชี้วัดของ WAVE 3 §03

### 2.7 Test Results (Static / Mock / Local DB)

| Suite | ประเภท | ผล |
|---|---|---|
| `central-processing-boundary.test.ts` | Static + Mock | 71 checks, **3 findings** (B 11, F org scope, G6 Meta) |
| `authority-resolver.test.ts` | Pure | **24/24 PASS** |
| `material-price-authority.test.ts` (rewritten) | Mock + Static | **45/45 PASS** |
| `authority-scope-and-concurrency.test.ts` (new) | Mock + Static + cross-tenant | **40/40 PASS** |
| `transaction-idempotency.test.ts` | Pure + Static | **11/11 PASS** |
| `connect-channel-receive.test.ts` | Mock | **77/77 PASS** |
| `connect-identity-model-test.ts` | Static | **54/54 PASS** |
| `connect-inbound-boundary-test.ts` | Mock + Static | **54/54 PASS** (หลังแก้ conflict §2.5) |
| `business-event-authority-test.ts` | Static | **34/34 PASS** |
| `document-authority-census.test.ts` | Static | **58/58 PASS** |
| `connect-boundary-census-test.ts` | Static | **15/15 PASS** |
| `payment-atomic-boundary-test.ts` | Static + existing local proof | **PASS** (ไม่ได้รัน DB ใหม่ในรอบนี้) |
| `npx tsc --noEmit` | Static | **0 error** |
| `npx next build` | Build | **exit 0** (300/300 pages, compiled 10.1s) |
| Material price SQL functional | **Local DB E2E** | **19/19 PASS** + rollback + re-apply |
| Price concurrency | **Local DB E2E** | PASS (lock wait 2s, 1 audit) |

**Trace ID:** ไม่มี — ไม่มีการเรียก production/network; local run label = `LOCAL-PG18-20261025`

### 2.8 Migration ที่เสนอ แต่ยังไม่ Apply

| # | ไฟล์ | สิ่งที่เพิ่ม | Rollback | สิ่งที่ต้องทำก่อน apply production |
|---|---|---|---|---|
| M1 | `20261025000001_material_price_atomic_v1.sql` | `record_seller_offer_atomic`, `apply_material_price_atomic` | drop 2 functions | preflight 3 queries ใน header ต้องได้ 0 rows · รัน local/staging · ตรวจ duplicate live price |
| M2 | `20261025000002_authority_grants_proposal.sql` | `authority_grants` + 2 partial indexes | drop table | ต้องมี `organizations`/`org_members` ก่อนใช้ org scope · export ก่อน rollback |

**ยังไม่ Apply ที่ใดทั้งสิ้น** (ไม่ใช่ production และไม่ใช่ Supabase local — ไม่มี Docker)

---

## 03 RESULT

### 3.1 สรุปตัวเลข

| ตัวชี้วัด | ผล |
|---|---|
| Direct Business Writes ก่อนแก้ | **11** (provider tier) |
| Direct Business Writes หลังแก้ | **11** (ไม่ลด — ทั้ง 11 จุดยัง BLOCKED ตามหลักฐาน) |
| Price Writers ก่อน → หลัง | **2 → 1** |
| จุดที่รวมเข้าระบบกลางสำเร็จในรอบนี้ | **1 คำสั่ง/2 เส้นทาง** (admin price + seller offer → atomic RPC เดียว) |
| จุดที่ยัง BLOCKED | **11 provider writes + org scope + fee contract + resource booking + Meta outbound** |
| Regression PASS/FAIL | PASS 10 suites · boundary 68/71 (3 findings ที่รายงานไว้) · tsc 0 · build exit 0 |
| Canonical Writers ที่เปลี่ยน | `material-price-write.ts` (atomic RPC, no compensation) · `audit.ts` ไม่เปลี่ยนรอบนี้ |
| Migration ที่เสนอ ยังไม่ apply | **2** (+ rollback 2 ไฟล์) |
| Local DB E2E | 19/19 functional · 1 concurrency race · rollback/re-apply PASS |

### 3.2 สถานะรายเกณฑ์

| เกณฑ์ | ผล | เหตุผลจริง |
|---|---|---|
| Organization Scope | **FAIL / BLOCKED** | ไม่มี `organizations`/`org_members`/`identity_memberships` ใน schema → loader คืน `[]` และ resolver DENY org grant ทุกกรณี (fail-closed) · ต้อง M2 + ตาราง org ก่อน |
| Atomic Price + Audit | **PASS (Local DB)** | trigger-broken audit ทำให้ราคา rollback จริง · **Production ยังไม่ apply** จึงยังไม่มีผล producción |
| Concurrent Idempotency (price/offer) | **PASS (Local DB + mock)** | row lock + state no-op + unique order_no |
| Concurrent Idempotency (fee) | **BLOCKED** | ไม่มี `fee_contracts`/`processing_fee` ใน schema (0 references) |
| Resource/vehicle booking | **BLOCKED** | ไม่มีตาราง/เส้นทางจองใน repo (0 references) |
| Payment allocation | **PASS (existing)** | `receipt_already_allocated` + `for update` (migration 20260923000001) |
| Document idempotency | **PASS (existing)** | job envelope `idempotency_key` |
| Meta outbound | **BLOCKED** | ไม่มี `graph.facebook.com`/outbound adapter — ไม่สร้างใหม่ |

### 3.3 สิ่งที่ยัง BLOCKED และเกณฑ์ปลดล็อก

| กลุ่ม | จำนวน | สิ่งที่ขาด (หลักฐาน) | เกณฑ์ปลดล็อก |
|---|---|---|---|
| B การมอบอำนาจ | 2 | `pending_authorizations` ไม่มี scope/validity/revoked_at (`authorization-check.ts:60`, `postback.ts:99`) | apply M2 + เขียน loader ฝั่ง provider → central command (ยังไม่ทำ เพราะ provider ต้องไม่ถือสิทธิ์) |
| C เงินงานพิมพ์ | 5 | `print_jobs` ไม่ผูก `receipt_documents`; ตั้ง `paid` เอง (`print-jobs.ts:99–100,146–147`) | M3: `print_jobs.receipt_document_id` + สถานะเงินสดนำส่ง + เรียก `confirmPayment` |
| D สถานที่ | 3 | ไม่มี Site Authority; insert จาก LINE โดยใช้ `link.company_id` (`event-followup.ts:527,542`, `location.ts:62`) | M4: `customer_site_requests` (pending confirmation) + site writer กลาง |
| E ค่าบริการ | 1 | ไม่มี fee model; เขียน `supabase_billing_events` ตรง (`owner-dispatcher.ts:153`) | ออกแบบ fee ผูก Transaction + derived read model |
| Meta | 1 ช่องทาง | ไม่มี outbound adapter | สร้าง adapter ใหม่เมื่อเจ้าของอนุมัติ (นอกขอบเขต) |
| Org scope | ทั้งระบบ | ไม่มีตาราง org | M2 + org tables + membership backfill |

### 3.4 ความเสี่ยง / ข้อจำกัดของหลักฐาน

1. **Local DB ไม่ใช่ Supabase เต็มรูปแบบ** — ใช้ PostgreSQL 18 กับ schema ขั้นต่ำ 5 ตาราง; ยังไม่ทดสอบ RLS, PostgREST, หรือ Supabase RPC layer จริง
2. **Production ยังใช้โค้ดเดิม** — atomic path จะทำงานหลัง apply M1 + deploy เท่านั้น; ถ้า deploy ก่อน apply ราคาจะ fail-closed ด้วย 503 (ตั้งใจ)
3. **Grant path ไม่ถูก re-validate ใน SQL** — ฟังก์ชันเชื่อ decision จาก resolver และตรวจ owner-path ซ้ำ; service-role boundary เป็น trust boundary เดียวกันกับ writer อื่นทุกตัว (บันทึกไว้ใน header)
4. **`check-drift.sh`:** 1003 ไฟล์บนดิสก์ vs 996 registered = 7 unaccounted ตามสคริปต์ (รายการจริง 8 path: 7 เป็นงาน local ค้างจากรอบก่อน + `engines/authority/load.ts` ใหม่ 1 ไฟล์) — ไม่รัน `sync-registry` เพราะจะเขียนทับ registry ที่กำลังถูกแก้โดยงานอื่น
5. **ไม่มี production trace** — Trace ID = N/A; หลักฐานทั้งหมดเป็น static/mock/local DB
6. **UI:** ไม่เปลี่ยน; admin price ที่ไม่ใช่เจ้าของจะได้ 403 พร้อม reason (พฤติกรรมใหม่ตามข้อกำหนด authority)

---

> **STOP** — ไม่มี production change · ไม่มี migration apply · ไม่มี deploy/commit/push · ไม่มีข้อความ LINE จริง · ไม่มีการโอนเงิน · ไม่มี UI change
