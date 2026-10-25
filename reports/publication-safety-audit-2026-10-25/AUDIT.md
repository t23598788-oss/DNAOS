# DNA OS — PRODUCTION PUBLICATION SAFETY AUDIT
**วันที่ตรวจ:** 2026-10-24/25 (UTC) · **Project:** `xeytcavxejhyzxwevgto` (Production) · **โหมด:** read-only + ถอนเผยแพร่ผ่าน writer เดิมเท่านั้น
**ไม่อยู่ในขอบเขต (ไม่ได้ทำ):** แก้ราคา, สร้าง Writer/ตารางใหม่, แก้ schema, แก้ UI, deploy, commit/push, ลบหลักฐาน

---

## 01 OBJECTIVE

| # | สิ่งที่ตรวจ | เกณฑ์ PASS |
|---|---|---|
| 1 | สถานะข้อมูลทดสอบใน Production (pit_materials / publication_records / publication_events) | อ่านได้จริง ตรงกับที่รายงานไว้ และไม่มีการเผยแพร่ที่ไม่มีสิทธิ์โดยเจ้าของข้อมูล |
| 2 | Migration `20261024000002` เทียบ Source ↔ DB จริง | คอลัมน์/constraint/RLS/สิทธิ์ตรงกับไฟล์, anon+authenticated อ่านไม่ได้, service_role ตามขอบเขต, history ตรง |
| 3 | Data Provenance / Evidence Chain ของรายการที่เผยแพร่ | ย้อนกลับได้ครบทุกหัวข้อที่กำหนด และ event ที่เติมย้อนหลังต้องระบุชัด |
| 4 | Cache / ความสดของราคา | ระบุกลไก cache ทุกชั้น + มี/ไม่มี invalidation ที่ถูกต้อง |
| 5 | หน้าเว็บไซต์ต้นฉบับ `dna-os-maincheck` | ไฟล์ครบ + SHA-256 + mapping ไปยังตาราง/ช่องค้นหา |
| 6 | ผลลัพธ์ | PASS/FAIL/BLOCKED พร้อมงานที่ต้องแก้ก่อนเปิดสาธารณะ |

---

## 02 SOURCE EVIDENCE

### E1 — สถานะข้อมูลจริง (SQL read-only, `supabase db query --linked`)

`public.pit_materials` id `3c9f332b-cede-4ec5-8a2a-34e579a9907b`

| field | value |
|---|---|
| price | **50** (ค่าก่อนทดสอบ 50 → ระหว่างทดสอบ 55 → คืนค่า 50 แล้ว) |
| updated_at | `2026-10-24 18:13:42.902+00` (จากการคืนราคาผ่าน writer เดิม) |
| deleted_at | `NULL` |

`public.publication_records` id `59bc4af2-091c-475e-99cc-90e2ac130af0`

| field | value |
|---|---|
| status | **withdrawn** (เดิม `published` จนถึง `2026-10-24 18:23:34.211+00`) |
| organization_owner | `pit:36e4b0c9-611d-49db-aacb-852ac18d5d0f` |
| allowed_public_fields | `{name, price, supplier_name, service_area}` |
| authorized_by | `owner:change-order-2026-10-25` (ข้อความ ไม่ใช่บัญชีที่ยืนยันได้) |
| verified_by / verified_at | `NULL` / `NULL` |
| published_at | `2026-10-24 18:12:38.53+00` (คงเดิมหลังถอน) |
| expires_at | `NULL` (ถูกตั้งเป็น NULL ตอนถอน) |
| trace_id | `b1cfced4-ae26-4795-a35d-b06c606ba5f2` (trace ของการถอน — ทับ trace เดิมที่เป็น NULL) |

`public.publication_events` (2 แถว)

| id | from → to | actor | reason | created_at | trace_id | หมายเหตุ |
|---|---|---|---|---|---|---|
| `961197be-4515-4fef-ab67-021017214094` | `NULL → published` | `owner:change-order-2026-10-25` | `public_catalog_e2e_publish` | `18:12:38.53` | `NULL` | `evidence.backfilled = true` |
| `9a4f4af3-1cb7-4ba2-a3b8-c87a5ad0610d` | `published → withdrawn` | `t23598788@gmail.com` | `admin_publication_withdraw` | `2026-10-24 18:23:34.662289+00` | `b1cfced4-…` | เขียนสดโดย route |

### E2 — หลักฐานสิทธิ์ของเจ้าของข้อมูล (เหตุผลของการถอน)

```sql
select pp.id, pp.pit_name, pp.user_id,
       exists(select 1 from auth.users u where u.id = pp.user_id) as owner_identity_exists
from public.pit_profiles pp
where pp.id = '36e4b0c9-611d-49db-aacb-852ac18d5d0f';
-- user_id = 5004cf38-e437-472a-b8aa-ac84dc4702b5 · owner_identity_exists = false
```

- ไม่มีบัญชีจริงของผู้ประกอบการที่ผูกกับบ่อนี้ → ยืนยัน "เจ้าของข้อมูลอนุญาต" ไม่ได้
- `authorized_by` เป็นข้อความอิสระ ไม่ผูกกับบัญชี/ลายเซ็น และ `verified_by` ว่าง
- ผู้มีอำนาจในระบบ (`super_admin`) เป็นอำนาจของแพลตฟอร์ม ไม่ใช่หลักฐานว่าทรัพย์สินของบ่อนั้นอนุญาต

→ ตามคำสั่งงานข้อ 01: **ถอนเผยแพร่แบบ Fail-Closed ผ่านเส้นทางเดิม**

### E3 — การถอน (writer เดิมเท่านั้น)

| ขั้น | หลักฐาน |
|---|---|
| session | magic-link ผ่าน `/auth/confirm` (route เดียวของระบบ) — 200 |
| คำขอ | `POST /api/admin/publications` body `{action:"withdraw", source_table:"pit_materials", source_record_id:"3c9f332b…"}` |
| ผล | `200 {ok:true, status:"withdrawn", audit_event_written:true}` |
| หลังถอน | `GET /api/public/products` → `total:0, empty_reason:"no_published_records"` |
| หน้าเว็บ | `/products/mat-36e4b0c9-3c9f332b` → แสดงหน้า 404 (แต่ HTTP status 200 — ดู R4) |

ไฟล์เส้นทาง: `app/api/admin/publications/route.ts:293-301` (authorized_by / verified_by / trace_id), event append หลัง write

### E4 — Schema ↔ Migration

ไฟล์: `supabase/migrations/20261024000002_public_publication_registry.sql` (`create table` บรรทัด 34 และ 109)

| การตรวจ | ผล |
|---|---|
| คอลัมน์ `publication_records` | 17/17 ตรง (ชื่อ, ชนิด, nullability, default) |
| คอลัมน์ `publication_events` | 9/9 ตรง |
| Constraints | 9 ตัวตรงทั้งหมด (PK ×2, UNIQUE `publication_one_per_source`/`publication_slug_unique`, CHECK 4, FK cascade 1) |
| RLS | `relrowsecurity = true` ทั้งสองตาราง, policies = 0 (service_role bypass) |
| สิทธิ์ anon / authenticated | **ไม่มีสิทธิ์ใด ๆ** และ REST จริงตอบ `401 42501 permission denied` ทั้งสองตาราง |
| สิทธิ์ service_role | SELECT, INSERT, UPDATE, **DELETE, TRUNCATE**, REFERENCES, TRIGGER (กว้างกว่าที่โมดูลใช้) |

### E5 — Migration History ↔ DB จริง

| การตรวจ | ผล |
|---|---|
| `20261024000002` ใน `supabase_migrations.schema_migrations` | **ไม่มี** (schema มีจริง แต่ history ไม่บันทึก — apply ด้วย `db query` ไม่ใช่ `db push`) |
| local-only (ยังไม่ apply) | 22 รายการ รวม `20261024000001`, `20261024000002` |
| remote-only (มีใน DB ไม่มีในโฟลเดอร์) | 7 รายการ: `20261008000001`, `20261014000002/3/4`, `20261018000001/2/3` |
| version ซ้ำในโฟลเดอร์ | `20260804000007` (3 ไฟล์), `20260804000010` (2 ไฟล์) |
| ฟังก์ชัน `handle_new_user` ใน DB | เป็นเวอร์ชัน harden แล้ว ("No count(*) branch") แต่ **ไม่มีไฟล์ migration ใดใน repo มีข้อความนี้** → drift ที่มีมาก่อนรอบนี้ |

คำสั่งแก้ history ที่ถูกต้อง (ยังไม่รัน):
```bash
supabase migration repair --linked --status applied 20261024000002
```
ห้าม `supabase db push` เพราะจะพา 21 migration ที่เหลือ + remote-only drift ลง production พร้อมกัน

### E6 — Evidence Chain (ครบ/ไม่ครบ)

| ข้อที่กำหนด | สถานะ | หลักฐาน |
|---|---|---|
| องค์กรเจ้าของข้อมูล | มี | `organization_owner = pit:36e4b0c9…` |
| ตารางต้นทาง + Record ID | มี | `pit_materials` / `3c9f332b…` |
| ผู้มีอำนาจอนุญาต | **อ่อน** | `authorized_by` เป็นข้อความ ไม่ผูกบัญชี |
| หลักฐาน/ขอบเขตสิทธิ์ | มี | `allowed_public_fields` + `evidence` jsonb (price_at_publish 50) |
| ผู้ตรวจสอบราคา | **ไม่มี** | `verified_by = NULL` (หน้าจอแสดง "ยังไม่ได้รับการยืนยันราคา") |
| เวลาที่แก้ราคาจริง | มีบางส่วน | `pit_materials.updated_at 18:13:42.902Z` — ไม่มี audit row ของ writer ราคา |
| เวลาที่ Public API อ่าน | มีในรายงาน | `generated_at 18:13:41.161Z` / `18:14:41.887Z` |
| เวลาที่เว็บแสดงผล | มีในรายงาน | วัดสด 0.5–1.1s (บน) / 0.5s หน้า detail (ล่าง) |
| ผู้ดำเนินการ + Trace ID | **ไม่ครบ** | event publish `trace_id = NULL`; `authorized_by` ไม่ใช่ actor |
| สถานะสด/ล้าสมัย/ยังไม่ยืนยัน | มี | `price.verified=false` → หน้าเว็บแสดงสถานะ "ยังไม่ยืนยัน" |
| event ที่เติมย้อนหลัง | ระบุชัด | `evidence.backfilled=true` + note (แต่ `created_at` เป็นเวลาที่กระทำจริง ไม่ใช่เวลาที่ insert; ตารางไม่มีคอลัมน์แยก) |

รายงานเดิม `reports/public-catalog-2026-10-25/` ระบุสถานะ `published` ซึ่ง **ไม่ตรงกับ DB ปัจจุบัน (`withdrawn`)** — ถือเป็นหลักฐานที่ล้าสมัย ไม่ได้ถูกลบหรือแก้

### E7 — Cache / ความสด

| ชั้น | กลไก | ไฟล์ |
|---|---|---|
| Reader (ต่อ process) | `Map` memo, TTL 60s | `services/public-catalog/reader.ts:69,76,264,304` |
| Public API | `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` | `app/api/public/products/route.ts:32` |
| หน้า detail / catalog | ISR `export const revalidate = 60` | `app/products/[slug]/page.tsx:24`, `app/products/catalog/page.tsx:20` |
| Invalidation | **ไม่มีเลย** — ไม่มี `revalidatePath`/`revalidateTag` ในเส้นทางที่เกี่ยวข้อง | grep ทั้ง `app/api/admin/*`, `app/products`, `services/public-catalog`, `core/public-catalog` |
| Writer ราคาเดิม | เขียน DB แล้วจบ ไม่สั่ง invalidate | `app/api/admin/pits/[pitId]/materials/route.ts:39` |

ผลวัดจริงรอบก่อน: detail 0.5–1.1s, API สูงสุด 59.4s (ชน TTL 60s) · ส่วน `stale-while-revalidate=300` เปิดช่องให้ CDN เสิร์ฟราคาเก่าได้ถึง ~360s

### E8 — หน้าเว็บไซต์ต้นฉบับ `/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/`

| ไฟล์ | ขนาด | SHA-256 |
|---|---|---|
| `app/landing/DnaLanding.tsx` | 34,335 B | `3cc178d98355fb0cafe1b57763cc8e8e9e8d0de469a4267bf8c8f7cd06d8104e` |
| `app/landing/SystemOverview.tsx` | 16,963 B | `f987b90d32ca3c2617bd24260c15f6769008f56e0342e64f7ea9867cea17dd22` |
| `app/landing/LiveArchitectureDiagram.tsx` | 8,431 B | `6ec3fac23dfe1ef988e26bb6aeb4d8bfdbcd47610783b1eadd903b3e592027be` |
| `public/landing/scene-01-quarry.jpg` | 612,373 B | `ffb8ac925057dee7f80f153fa47475128438493bcce687b6d11252b654948281` |
| `public/landing/scene-02-manufacturing-clean.jpg` | 355,203 B | `3a1896b5c046d6cc695c7fdec22d1e4f0645a0e398b7451d5abc6ea3d46397c2` |

หมายเหตุ: การอ่านครั้งแรกของ `LiveArchitectureDiagram.tsx` คืน 0 ไบต์ (ไฟล์ยังไม่ถูก materialize — SHA ตรงกับ hash ของไฟล์ว่าง) หลังอ่านซ้ำได้เนื้อหาจริง 8,431 ไบต์ตาม hash ข้างต้น

Mapping (ยังไม่รวมโค้ด/ไม่แก้ดีไซน์):

| ฉาก/ส่วนเดิม | ทรัพยากรที่สัมพันธ์ | ช่องค้นหาสาธารณะ |
|---|---|---|
| ฉาก 01 "ทรัพยากรและการผลิต" (`DnaLanding.tsx:42-50`) | `pit_profiles` / `material_types` / `pit_materials` | **ไม่มีในต้นฉบับ** — ต้องสร้างใหม่หรือใช้ `/products/catalog` (งานใหม่ ไม่ใช่ของเดิม) |
| ฉาก 02 "ระบบใช้งานธุรกิจ" (`SystemOverview.tsx:56-87`) | บอร์ดการเงิน/เอกสารภายใน | ไม่ใช่ข้อมูลสาธารณะ |
| ฉาก 03 "บริการเซิร์ฟเวอร์" (`SystemOverview.tsx:101-114`) | system control graph (DEMO) | ไม่เกี่ยว |
| ฉาก 04 "ภาพรวมการเชื่อมโยง" (`LiveArchitectureDiagram.tsx`) | แผนผัง HTML ต้นฉบับ | ค้นหาโหนดในผัง (ไม่ใช่ค้นหาสินค้า) |
| `app/products/page.tsx` (ต้นฉบับ) | เป็น directory ของ portal ไม่ใช่แคตตาล็อกสินค้า | ไม่มี |

### E9 — พฤติกรรมหน้าไม่พบรายการ

`app/products/loading.tsx` (5 บรรทัด) เป็น loading boundary ของ segment `products` → หน้า `[slug]` ถูก stream shell ออกไปก่อน `notFound()` ถูกเรียก

| คำขอ | HTTP | เนื้อหา |
|---|---|---|
| `/products/mat-36e4b0c9-3c9f332b` (หลังถอน) | **200** | หน้า 404 ("This page could not be found") |
| `/products/does-not-exist-xyz` | **200** | หน้า 404 |

---

## 03 RESULT

| # | รายการ | ผล | ต้องแก้ | ผลกระทบ |
|---|---|---|---|---|
| R1 | ราคาทดสอบคืนค่า 50 ไม่มีการแก้ซ้ำ | **PASS** | — | ข้อมูลต้นทางถูกต้อง |
| R2 | การเผยแพร่ที่ไม่มีสิทธิ์เจ้าของข้อมูล | **PASS (แก้แล้ว)** | — | ถอนเป็น `withdrawn`, เว็บไม่แสดงแล้ว, หลักฐานเดิมครบ |
| R3 | Schema ↔ Migration | **PASS** | — | ตรง 17/9 คอลัมน์, constraint ครบ |
| R4 | anon/authenticated อ่านตารางภายใน | **PASS** | — | REST 401 `42501` ทั้งสองตาราง |
| R5 | service_role สิทธิ์ตามขอบเขต | **FAIL (กว้างเกิน)** | พิจารณา `REVOKE DELETE, TRUNCATE` (ต้องอนุมัติ schema change) | ถ้า key รั่ว ผู้โจมตีลบ audit trail ได้ |
| R6 | Migration History ↔ DB | **FAIL** | `supabase migration repair --linked --status applied 20261024000002` | `db push` ครั้งหน้าจะพยายามรันซ้ำ/พา migration อื่นไปด้วย |
| R7 | Migration ค้างอื่น | **FAIL (ค้าง 22 + remote-only 7 + version ซ้ำ)** | จัดลำดับ/รวม version ซ้ำก่อน `db push` | เสี่ยง apply พร้อมกันทั้งชุด |
| R8 | Evidence Chain ครบ | **FAIL บางข้อ** | เติม `trace_id`/actor ที่ผูกบัญชีในรอบถัดไป; เพิ่ม audit ของ writer ราคา | ตรวจย้อนหลังได้ไม่ครบ |
| R9 | event เติมย้อนหลังระบุชัด | **PASS** | — | `backfilled=true` + note |
| R10 | รายงานเดิมตรงกับ DB | **FAIL (ล้าสมัย)** | ออกรายงานฉบับนี้เป็นส่วนเพิ่ม (ไม่ลบของเดิม) | ผู้อ่านรายงานเก่าจะเข้าใจว่ายังเผยแพร่อยู่ |
| R11 | Cache invalidation | **FAIL (ไม่มีเลย)** | ดูข้อเสนอด้านล่าง | ราคาเก่าค้างได้ถึง ~60s (memo) / ~360s (CDN) |
| R12 | ไฟล์เว็บไซต์ต้นฉบับครบ | **PASS** | — | 5/5 ไฟล์ + hash บันทึกแล้ว |
| R13 | Mapping ไปยังช่องค้นหาสาธารณะ | **BLOCKED** | ต้นฉบับไม่มีแคตตาล็อก/ช่องค้นหา — ต้องตัดสินใจว่าจะวางส่วนค้นหาที่ใด | ยังไม่ได้เชื่อมหน้าแรกกับแคตตาล็อก |
| R14 | หน้าไม่พบรายการ | **FAIL (soft 404)** | ย้าย/ลบ `app/products/loading.tsx` หรือย้ายหน้ารายละเอียดออกจาก boundary นี้ | เสิร์ชเอนจินเก็บ URL ที่ถอนแล้วเป็น 200 |
| R15 | Production deploy ของหน้าเว็บ | **BLOCKED** | ยังไม่ deploy ตามคำสั่งห้าม | prod ยัง 404 `/products/*` |

### ข้อเสนอ Cache (จุดเดียว ไม่สร้าง Writer ใหม่)

1. export `invalidatePublicCatalog()` จาก `services/public-catalog/reader.ts` เพื่อล้าง memo (คีย์ตาม query)
2. เรียกใน **writer ราคาเดิม** `app/api/admin/pits/[pitId]/materials/route.ts` หลังเขียนสำเร็จ 1 บรรทัด พร้อม `revalidatePath("/products", "layout")` (ครอบทั้ง catalog และ detail)
3. ปรับ `stale-while-revalidate` ของ API จาก 300 → 0–30 และคง `s-maxage` = 60 ให้ตรงกับ ISR
4. ข้อจำกัดที่ต้องยอมรับ: memo เป็น per-instance — ถ้า scale หลาย instance ต้องลด TTL หรือตรวจ version จาก DB (ยังไม่ทำรอบนี้)

---

## สรุปท้ายรายงาน

1. **ราคาทดสอบ/การเผยแพร่:** ราคาคืนค่า **50** แล้ว (ไม่ได้แก้ซ้ำ) · publication `59bc4af2…` = **withdrawn** · event ครบ 2 แถว · เว็บไม่แสดงรายการนี้ (API total 0)
2. **Migration จริง:** schema ตรงไฟล์ 100% (17+9 คอลัมน์, 9 constraint, RLS เปิด, anon 401) แต่ **history ไม่บันทึก** `20261024000002`; ค้าง 22 รายการ, remote-only 7, version ซ้ำ 2 กลุ่ม
3. **Evidence Chain:** ครบเรื่องเจ้าของ/ต้นทาง/ขอบเขตสิทธิ์ แต่ **ขาด trace_id ของการเผยแพร่, ไม่มีผู้ตรวจราคา, ไม่มี audit ของการเปลี่ยนราคา** และรายงานเดิมล้าสมัย (published → withdrawn)
4. **ความสดของราคา:** ไม่มี invalidation ทุกชั้น (memo 60s, ISR 60s, CDN SWR 300s) — วัดได้ 59.4s ที่ API, 0.5–1.1s ที่หน้า detail
5. **เว็บไซต์ต้นฉบับ:** ไฟล์ครบ 5/5 พร้อม SHA-256 แต่ **ไม่มีแคตตาล็อกหรือช่องค้นหาสาธารณะ** → mapping ทำได้แค่เชิงแนวคิด (ฉาก 01 ↔ วัสดุ/บ่อ)
6. **ก่อนเปิดสาธารณะ:** (a) repair migration history (b) จัดการ migration ค้าง/version ซ้ำ (c) เพิ่ม invalidation จุดเดียว + ลด SWR (d) แก้ soft 404 (e) เติม trace/actor/audit ราคา (f) ตัดสินใจจุดวางแคตตาล็อกบนหน้าแรก (g) พิจารณาลดสิทธิ์ service_role (h) deploy เมื่อได้รับอนุญาต
