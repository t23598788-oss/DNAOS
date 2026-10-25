# DNA OS — PRODUCTION PUBLICATION CLOSEOUT
**วันที่:** 2026-10-25 (UTC) · **Project:** Production `xeytcavxejhyzxwevgto` · **HEAD:** `d7fbb05b` (ไม่มีการ commit)
**ขอบเขต:** แก้เฉพาะ Local Source Code · **ไม่** แก้ Production DB · ไม่ deploy · ไม่ push · ไม่ commit · ไม่แก้ราคา · ไม่สร้างตาราง/Writer ใหม่

---

## 01 OBJECTIVE

| ขั้น | เป้าหมาย | เกณฑ์ผ่าน |
|---|---|---|
| 01 | Migration history | Schema ตรงไฟล์ 100% + มีแผนซ่อมเฉพาะ `20261024000002` พร้อมหลักฐานก่อน–หลัง (ยังไม่รัน) |
| 02 | Cache invalidation | writer เดิมตัวเดียวแจ้ง reader + หน้าจอ; ไม่มี writer/ระบบราคาใหม่; ไม่กล่าวอ้าง real-time |
| 03 | Soft 404 | รายการที่ไม่มี/ถูกถอน ต้องได้ HTTP 404 จริง โดยไม่เปลี่ยนดีไซน์ |
| 04 | Evidence chain | actor, องค์กร, source/record, authorization, trace, การเปลี่ยนราคา + เวลา, reader time, display time, สถานะ |
| 05 | ทดสอบ | tsc, policy, authz/tenant, invalidation, 404, fail-closed, migration safety |
| 06 | เว็บต้นฉบับ | ไฟล์ครบ + hash + mapping (ไม่รวมโค้ด) |

---

## 02 SOURCE EVIDENCE

### STEP 01 — Migration
- ไฟล์: `supabase/migrations/20261024000002_public_publication_registry.sql` (`create table` บรรทัด 34, 109)
- DB จริง: 26 คอลัมน์ (17+9) · 9 constraints · RLS เปิด · policies 0 · fingerprint `bc5c51ac8fa4d005c8c25bb469b15415`
- `schema_migrations` มี `20261024000002` = **0 แถว** · pending 22 · remote-only 7 · version ซ้ำ 2 กลุ่ม
- แผน + คำสั่ง + หลักฐานก่อน/หลัง: `MIGRATION-REPAIR-PLAN.md` (**ยังไม่รัน**)

### STEP 02 — Cache invalidation (writer เดิมเท่านั้น)
| ไฟล์:บรรทัด | การเปลี่ยนแปลง |
|---|---|
| `services/public-catalog/reader.ts:69+` | เพิ่ม `invalidatePublicCatalog()` → `memo.clear()` (per-process; ระบุขีดจำกัด multi-instance ในคอมเมนต์) |
| `app/api/admin/pits/[pitId]/materials/route.ts` | หลังเขียนสำเร็จ: `invalidatePublicCatalog()` + `revalidatePath("/products","layout")` — writer เดิม ไม่มีตัวใหม่ |
| `app/api/admin/publications/route.ts` | หลัง publish/withdraw: invalidation ชุดเดียวกัน (เดิมถอนแล้วอาจค้างได้ถึง TTL) |
| `app/api/public/products/route.ts:32` | `Cache-Control: public, s-maxage=60` — **ตัด `stale-while-revalidate=300`** (เดิมเสิร์ฟราคาเก่าได้ถึง ~360s) |

ข้อจำกัดที่ประกาศไว้ในโค้ด: memo เป็น per-process → cross-instance upper bound = TTL 60s (ไม่ใช่ real-time)

### STEP 03 — Soft 404
- สาเหตุ: `app/products/loading.tsx` เป็น Suspense boundary ของ segment `products` → shell ถูก stream เป็น 200 ก่อน `notFound()`
- แก้: ย้ายไป `app/products/catalog/loading.tsx` (skeleton เดิมของ catalog คงอยู่, ดีไซน์ไม่เปลี่ยน)
- ผลจริง (dev server + Production DB, GET only):
  | คำขอ | ก่อน | หลัง |
  |---|---|---|
  | `/products/mat-36e4b0c9-3c9f332b` (withdrawn) | 200 + หน้า 404 | **404** |
  | `/products/does-not-exist-xyz` | 200 + หน้า 404 | **404** |
  | `/products/catalog` | 200 | **200** (26,648 B) |

### STEP 04 — Evidence Chain
| หัวข้อ | สถานะ | หลักฐาน |
|---|---|---|
| Identity ผู้ดำเนินการ | **มีแล้ว** (ราคา) | `audit_logs.actor_user_id = auth.id` จาก writer เดิม |
| องค์กรเจ้าของข้อมูล | มี | `publication_records.organization_owner = pit:36e4b0c9…` |
| Source table / Record ID | มี | `pit_materials` / `3c9f332b…` |
| Authorization evidence | มีบางส่วน | `authorized_by` + `evidence` jsonb (ยังเป็นข้อความ ไม่ผูกบัญชีของเจ้าของบ่อ) |
| Trace ID | **แก้แล้ว** | e2e script ใส่ `trace_id` ให้ทั้ง `publication_records` และ `publication_events` (ของเดิมเป็น NULL) |
| การเปลี่ยนราคา + เวลา | **แก้แล้ว** | writer เดิมเขียน `audit_logs` (`price_updated`, old→new, actor, created_at) — เดิมมีแค่ `updated_at` |
| เวลาอ่านจาก Reader | มี | `generated_at` ของ API (บันทึกในรายงานรอบก่อน) |
| เวลาแสดงผล | มี | วัดสด 0.5–1.1s (รอบก่อน) |
| สถานะเผยแพร่ | มี | `withdrawn` (คงไว้ตามคำสั่ง) |

รายการทดสอบ `59bc4af2…` ยัง **withdrawn** · ราคา **50** · events **2** (ไม่มีการเขียนเพิ่มในรอบนี้)

### STEP 05 — ผลทดสอบ

| การทดสอบ | ผล | หลักฐาน |
|---|---|---|
| TypeScript | **PASS** | `npx tsc --noEmit` exit 0 |
| Policy tests | **PASS** | `public-catalog-policy:test` **112/112** (เพิ่มหมวด 16 = 18 checks) |
| Authorization / Tenant isolation | **PASS** | policy 13/15 (owner mismatch, platform-only, role gate) + POST ไม่มี session → **401** ทั้งสอง writer |
| Cache invalidation | **PASS (structural)** | 16.* ยืนยัน writer เดิมเรียก invalidator + revalidate; `invalidatePublicCatalog()` ปลอดภัยเมื่อ memo ว่าง |
| HTTP 404 | **PASS** | ตาราง STEP 03 |
| Public Reader fail-closed | **PASS** | ไม่มี service key → `PUBLIC_CATALOG_SERVICE_ROLE_MISSING` (ไม่คืนข้อมูลใด) |
| Migration safety | **PASS** | fingerprint/26/9 คงเดิม · history ยัง 0 · ไม่มี DDL ในรอบนี้ |
| เรียก Writer เดิม (จริง) | **BLOCKED** | ต้องเขียน Production DB ซึ่งถูกห้าม → ตรวจด้วย structural test + 401 เท่านั้น |

**แยกให้ชัด:** ผลข้างต้นเป็นการทดสอบบน **Local dev server ที่อ่าน Production DB (GET only)** + offline tests — **ไม่ใช่** ผลทดสอบบน Production deployment (prod ยัง 404 `/products/*` เพราะยังไม่ deploy)

### STEP 06 — เว็บต้นฉบับ
- 5/5 ไฟล์ครบ + SHA-256 (ดู `SITE-MAPPING.md`)
- ต้นฉบับ **ไม่มี** แคตตาล็อก/ช่องค้นหาสาธารณะ → mapping เป็นข้อเสนอ (CTA ฉาก 01 → `/products/catalog`), ยังไม่รวมโค้ด

---

## 03 RESULT

| # | รายการ | ผล |
|---|---|---|
| 1 | Schema ↔ Migration | **PASS** |
| 2 | แผนซ่อม history | **PASS (แผนพร้อม)** — การรัน = **BLOCKED รออนุมัติ** |
| 3 | Invalidation จุดเดียวจาก writer เดิม | **PASS (structural)** — วัดผลสด = **BLOCKED** (ต้องเผยแพร่จริง) |
| 4 | ตัด SWR 300s | **PASS** (header จริง `public, s-maxage=60`) |
| 5 | Soft 404 | **PASS** (404 จริงทั้ง withdrawn + unknown) |
| 6 | Evidence: trace/actor/ราคา | **PASS (โค้ด)** — ยังไม่มีข้อมูลใหม่ให้ตรวจเพราะห้ามเขียน DB |
| 7 | สถานะรายการทดสอบ | **PASS** (withdrawn/50/2 events ไม่เปลี่ยน) |
| 8 | เว็บต้นฉบับ + mapping | **PASS** (mapping เป็นข้อเสนอ) |
| 9 | Deploy | **BLOCKED** ตามคำสั่ง |

### ไฟล์ที่แก้ (local, ยังไม่ commit)
```
M services/public-catalog/reader.ts                     (+ invalidatePublicCatalog)
M app/api/admin/pits/[pitId]/materials/route.ts         (invalidate + audit_logs)
M app/api/admin/publications/route.ts                   (invalidate + revalidatePath)
M app/api/public/products/route.ts                      (ตัด stale-while-revalidate)
D app/products/loading.tsx → A app/products/catalog/loading.tsx
M scripts/public-catalog-policy-test.ts                 (+ หมวด 16)
M scripts/public-catalog-publish-e2e.ts                 (+ trace_id)
+ reports/publication-safety-audit-2026-10-25/{AUDIT,CLOSEOUT,MIGRATION-REPAIR-PLAN,SITE-MAPPING}.md
```

### งานที่ต้องได้อนุมัติก่อนทำบน Production
1. `supabase migration repair --linked --status applied 20261024000002` (ประวัติเท่านั้น)
2. จัดการ migration ค้าง 22 + remote-only 7 + version ซ้ำ (แยกใบสั่งงาน)
3. เปิดสิทธิ์เผยแพร่จริง 1 รายการ → วัด invalidation จริง + วัด latency หลังแก้
4. Deploy หน้าเว็บ (prod ยัง 404 `/products/*`)
5. พิจารณาลดสิทธิ์ `service_role` (DELETE/TRUNCATE) บนตารางเผยแพร่
6. ตัดสินใจจุดวางแคตตาล็อกบนหน้าแรกเดิม
