# DNA OS — DATA OWNERSHIP & AI CONTEXT AUTHORITY AUDIT
**โหมด:** READ-ONLY AUDIT — ไม่มีการเขียนฐานข้อมูล · ไม่มี migration · ไม่แก้ Source Code · ไม่ deploy
**วันที่ตรวจ:** 2026-10-25 · **โครงการ:** `xeytcavxejhyzxwevgto` (DNA OS Production)
**คำสั่งเจ้าของ:** ตรวจเจ้าของข้อมูลก่อนผูกองค์กรและเปิดให้ AI ใช้ข้อมูล
**ไฟล์ประกอบ:** `DNAOS_DATA_OWNERSHIP_RECORD_TABLE.csv` (86 แถว, รหัสระเบียน C-001…C-086)

---

## 01 OBJECTIVE

ตรวจว่า "ข้อมูลบริษัท ~86 รายการ" ใน Production ถูกเก็บในบริบทใด ใครเป็นผู้รวบรวม/สั่งนำเข้า องค์กรใดเป็นเจ้าของ มีข้อมูลอะไรถูกเพิ่มหลังนำเข้า ข้อมูลไหลไปยัง Reader/API/AI Tool ใด และ AI มีเส้นทางนำชุดข้อมูลของผู้ใช้หนึ่งไปตอบอีกองค์กรได้หรือไม่ — โดย **ไม่แก้ไขข้อมูลเดิม** และไม่สรุปเจ้าของจากชื่อบัญชีหรือบทบาทผู้ดูแลระบบ

ผลที่ต้องการ: ข้อเท็จจริงที่ตรวจได้ + ช่องว่าง Schema + ข้อเสนอ Mapping ให้เจ้าของระบบอนุมัติก่อน STEP 3

---

## 02 SOURCE EVIDENCE

### 2.1 วิธีตรวจจริง (อ่านอย่างเดียว)

| หัวข้อ | รายละเอียด |
|---|---|
| คำสั่งที่ยิง | HTTP **GET/HEAD เท่านั้น** ผ่าน PostgREST (ไม่มี insert/update/delete/rpc) |
| สิทธิ์ | service-role key อ่านจาก Supabase CLI ในหน่วยความจำ (ไม่พิมพ์/ไม่บันทึก) + anon key สำหรับทดสอบ RLS |
| ข้อมูลที่เก็บในรายงาน | count / flag / วันที่ / record id — **ไม่มีชื่อบริษัท เบอร์ อีเมล เลขผู้เสียภาษี เลขบัญชี หรือเนื้อหาเอกสาร** |
| ฐานข้อมูล | Production `xeytcavxejhyzxwevgto` ณ 2026-10-25 (อ่านสด รอบนี้) + snapshot เดิม `production-census-2026-10-25.json` |
| Git history | ใช้ไม่ได้ — object pack เสีย (`bad object refs/tags/ui-baseline-workspace-2026-10-08`) → ประวัติ commit/ผู้แก้ไข = **NOT VERIFIED** |

### 2.2 ตารางที่มีจริงใน Production (นับจริง)

| ตาราง | จำนวน | หมายเหตุ |
|---|---:|---|
| `companies` | **86** | 84 CUSTOMER · 1 SUPPLIER · 1 CORE |
| `organizations` | **1** | `1f52520a-39fa-448f-8455-9ee4c72b00b0` · created 2026-10-18 · created_by profile `33a80907…` |
| `org_members` | **2** | owner 1 · admin 1 (ทั้งคู่ super_admin profile) |
| `profiles` | 3 | super_admin 2 · customer 1 |
| `customer_sites` | 5 | 4 ขอนแก่น · 1 Bangkok |
| `pit_profiles` | **96** | มี `user_id` 15 · **source/source_place_id/source_verified_at = 0** · created_at NULL 73 |
| `pit_materials` | 41 | มีราคา 41 |
| `publication_records` | **1** | **withdrawn 1 · published 0** |
| `business_events` | 214 | `partner_id` 192 · source LINE 214 · metadata.written_by 42 |
| `audit_logs` | 4,860 | **entity_type = companies/company: 0 แถว** · **action มีคำว่า import: 0 แถว** |
| `connect_external_identities` | 12 | verified 8 · ผูก company 10 |
| `company_line_links` | 10 | ผูก 10 บริษัท |
| `authority_grants` (proposal) | **404** | ยังไม่ถูก apply — ตรงกับหมายเหตุในไฟล์ proposal |
| `import_jobs` / `data_imports` / `company_contacts` / `places` / `documents` / `relationship*` | **404** | ไม่มีตารางเหล่านี้ |

> `organizations` และ `org_members` **มีจริงใน Production** แต่ไม่มีใน `supabase/local-migration/full_schema.sql` → local schema ล้าสมัย (schema drift)

### 2.3 คอลัมน์จริงของ `companies` (อ่านจาก Production)

```
id, name, tax_id, address, phone, email, bank_name, bank_account_no,
type, status, created_at, updated_at, is_individual, line_user_id, organization_id
```

**ไม่มีคอลัมน์:** `source`, `source_place_id`, `source_url`, `created_by`, `updated_by`, `import_batch_id`, `collected_by`, `usage_purpose`, `disclosure_permission`, `ai_retrieval_scope`, `verification_status`, `verified_at`, `record_subject_type`

### 2.4 ตัวเลขจริงของชุด 86 รายการ

| ตัวชี้วัด | ค่า | หลักฐาน |
|---|---:|---|
| ทั้งหมด | 86 | `HEAD companies` |
| `organization_id` เป็น NULL | **86 (100%)** | `organization_id=is.null` → 86 · `not.is.null` → 0 |
| มี `tax_id` | 22 | — |
| มี `address` | 74 | — |
| มี `phone` | 72 | — |
| มี `email` | 3 | — |
| มี `line_user_id` | 1 | — |
| `is_individual = true` | 6 | — |
| มี `bank_account_no` | **4** | ข้อมูลการเงินปนอยู่ในแถวเดียวกับข้อมูลที่เผยแพร่ได้ |
| มี `bank_name` | 0 | — |
| ชื่อมีคำ บริษัท/จำกัด/หจก/บจก | 25 จาก 86 | ลักษณะชื่อแบบ listing ไม่ใช่ชื่อนิติบุคคลครบทุกแถว |
| `tax_id` ซ้ำกัน | **2 ค่า (4 ระเบียน: C-007+C-029, C-003+C-030)** | data quality |
| สร้าง 2026-05 | 24 | — |
| สร้าง 2026-06 | 1 | — |
| สร้าง 2026-07 | **61** | โดย 60 แถวสร้าง 2026-07-08…09 |
| `updated_at` = 2026-07-10 | **66** | แก้ไข/เติมข้อมูลแบบยกชุดหลังนำเข้า (66 แถว) |
| แถวที่ไม่มี linkage ใด ๆ เลย | **69** | มีเพียงแถวทะเบียน |
| แถวที่ปรากฏในบันทึกธุรกิจอย่างน้อย 1 ตาราง | **17** | ทั้ง 17 เป็น CUSTOMER; CORE/SUPPLIER ไม่มีธุรกรรม |

### 2.5 ตารางที่อ้างถึง `companies` (foreign-key จริง)

| ตาราง | คอลัมน์ | แถวทั้งตาราง | company ที่ถูกอ้าง |
|---|---|---:|---:|
| `invoices` | `customer_company_id` | 43 | 3 |
| `customer_orders` | `customer_company_id` | 2 | 2 |
| `projects` | `customer_company_id` | 3 | 3 |
| `standalone_documents` | `customer_company_id`, `partner_company_id` | 8 | 3 |
| `receipt_documents` | `customer_company_id` | 495 | 4 |
| `debt_snapshots` / `debt_events` | `customer_company_id` | 11 / 22 | 11 |
| `business_events` | `partner_id` | 214 | 9 |
| `customer_sites` | `customer_company_id` | 5 | 5 |
| `connect_external_identities` | `company_id` | 12 | 10 |
| `company_line_links` | `company_id` | 10 | 10 |
| `audit_logs` | `company_id` | 4,860 | 3 (120 จาก 1,000 แถวแรกผูก company) |

**ไม่มีคอลัมน์ company ใน `company_expenses`** (มีเพียง `receipt_document_id`, `submitted_by_line_user_id`) → ต้นทุน 149 แถวผูกกลับบริษัทได้ทางอ้อมเท่านั้น

### 2.6 หลักฐานเชิงโค้ด (file:line)

| # | ไฟล์:บรรทัด | ข้อเท็จจริง |
|---|---|---|
| E1 | `services/supabase/queries.ts:498` (`getPartners`) | `select id,name,type,phone,address,tax_id,email` จาก `companies` **ทั้งตาราง ไม่มี filter องค์กร** |
| E2 | `services/supabase/queries.ts:724` (`getPartnersWithDocumentSummary`) | เพิ่ม `total_invoiced`, `total_received`, `outstanding`, `document_count` ต่อบริษัท |
| E3 | `engines/validation/dispatcher.ts:75` | `"partner.list" → getPartnersWithDocumentSummary()` |
| E4 | `registry/command-registry.json` | `partner.list`, `partner.find`, `debt.list`, `invoice.list` = read command `requires_confirmation: false` (99 commands) |
| E5 | `app/api/v1/query/route.ts:146` | AI ภายนอกเรียก read command ผ่าน token (`X-DNA-Token`) → `dispatch(...)` ; token ต้องเป็น admin-tier |
| E6 | `app/api/command/route.ts:15,23` | `requireAuth()` **ไม่ระบุ tier = ANY_AUTHENTICATED (รวม customer/partner)** แล้วรัน `runCognitivePipeline` |
| E7 | `cognitive/pipeline.ts:1040,1061` | pipeline เรียก `dispatchList("partner.list")` เพื่อประกอบบริบทตอบ |
| E8 | `cognitive/pipeline.ts:918-935` | `answerWithAi()` ส่ง `contactContext` (ข้อความ fakt เกี่ยวกับผู้ติดต่อ) เข้า system prompt ของ AI Gateway |
| E9 | `supabase/functions/line-webhook-v2/engines/relationship-qa.ts:53-70` | ถ้าไม่พบ `company_line_links` จะ fallback **จับคู่ `companies.name = line_events.line_name` ตรงตัว** เพื่อตอบยอดหนี้ |
| E10 | `core/authority/resolve.ts` | authority resolver fail-closed (R1 role ≠ authority) — แต่ **ไม่มี reader ใดเรียก resolver นี้ก่อนอ่าน** |
| E11 | `engines/authority/load.ts:270` | อ่าน `companies.organization_id` เพื่อหา org เจ้าของ resource (คอลัมน์มีจริง; ค่า NULL ทั้งหมด → คืน null) |
| E12 | `services/public-catalog/reader.ts:143-215` | public catalog เลือกเฉพาะ `pit_name/address/geo` และ **ไม่ส่ง phone/address ดิบออก public** |
| E13 | `app/api/admin/backup/route.ts:6-20` | backup export `select("*")` ของ `companies` (รวม `bank_account_no`) ให้ super_admin |
| E14 | `services/ai/adapters.ts:131` + `registry/ai-adapter-registry.json` | มี external AI provider จริง (Gemini endpoint, Anthropic adapter) ; `system_health_status` = `anthropic: healthy` 2026-10-24T23:20Z |
| E15 | `supabase/migrations/20261025000002_authority_grants_proposal.sql` | ตาราง `authority_grants` เป็น **ข้อเสนอ ยังไม่ apply** (Production 404) |

### 2.7 ข้อจำกัดของหลักฐาน

1. Git history อ่านไม่ได้ (pack เสีย) → ไม่สามารถยืนยันผู้ commit/สคริปต์ที่เคยนำเข้าข้อมูล
2. ไม่มีสคริปต์ import/CSV ใน repo (`scripts/` ไม่มีไฟล์ CSV/import companies) และไม่มี `INSERT INTO companies` ใน migration ใด
3. `audit_logs` ไม่บันทึกการสร้าง/แก้อันดับบริษัท → ผู้สั่งนำเข้า **ยืนยันไม่ได้**
4. ไม่ได้อ่าน `auth.users` และไม่ได้อ่านเนื้อหาเอกสาร/สลิป
5. ตัวเลขทั้งหมดเป็น snapshot เดียว (แต่ละ GET ต่างเวลากันไม่กี่วินาที)

---

## 03 RESULT — เรียงตามความเสี่ยงที่ AI นำข้อมูลข้ามองค์กร

| # | ผล | ระดับ | ข้อค้นพบ | หลักฐาน |
|---|---|---|---|---|
| **R1** | **FAIL** | **CRITICAL** | `/api/command` เปิดให้ **ผู้ใช้ที่ล็อกอินทุก role (รวม `customer`)** รัน cognitive pipeline ซึ่งเรียก `partner.list` และโหลดข้อมูล **86 บริษัท (เบอร์/ที่อยู่/เลขผู้เสียภาษี/อีเมล + ยอด receivable)** ด้วย service role โดยไม่กรององค์กร — ข้อมูลเข้าสู่บริบทตอบของ pipeline; `/api/command` ตอบเป็น display state (TEXT = ข้อความ, BOARD = ผลลัพธ์เต็ม) จึงไม่ใช่การคืน JSON ดิบทุกครั้ง แต่การเข้าถึงข้อมูลยังไม่จำกัดสิทธิ์ — บัญชี `customer` 1 บัญชีมีอยู่จริง | E4,E6,E7,E1,E2 |
| **R2** | **FAIL** | **HIGH** | `/api/v1/query` (AI ภายนอกผ่าน token) เรียก `partner.list` / `partner.find` / `debt.list` ได้ทั้งหมด และ **คืน `result.data` เต็มแถว** (มี phone/address/tax_id/email + ยอดเงิน) ไม่มี tenant scope; token ทั้ง 4 เป็น `scopes:["read"]` ของ admin-tier (ตรวจ Production แล้ว) | E5,E3,E4 |
| **R3** | **FAIL** | **HIGH** | LINE debt Q&A จับคู่บริษัทจาก **ชื่อที่แสดงของ LINE ตรงกับ `companies.name`** เมื่อไม่มี link ที่ยืนยันแล้ว → ตั้งชื่อ LINE ให้ตรงชื่อบริษัทอื่นแล้วถามยอดหนี้ = ได้บริษัทนั้น (ยังถูกกันด้วย draft รอเจ้าหน้าที่เฉพาะกรณีมียอดหนี้) | E9 |
| **R4** | **RISK** | **HIGH** | AI Gateway ส่ง prompt ออก provider ภายนอกได้จริง (Anthropic healthy) และ `contactContext` เป็น free text ที่ไม่มี field-level disclosure check — **ยังไม่มีหลักฐานว่าเคยส่งชุด 86 บริษัทออกไป** แต่เส้นทางโค้ดเปิดอยู่ | E8,E14 |
| **R5** | **RISK** | MEDIUM | `/api/admin/backup` export `select("*")` ของ `companies` (มี `bank_account_no` 4 แถว) — super_admin เท่านั้น แต่ไม่มีขอบเขตองค์กร | E13 |
| **R6** | **FAIL** | MEDIUM | `pit_profiles` 96 แถว: `source`, `source_place_id`, `source_verified_at` = **0 ทั้งหมด**, `user_id` มีเพียง 15 → 81 แหล่งราคาไม่มีเจ้าของที่ยืนยัน; `publication_records` published = 0 | §2.2 |
| **R7** | **RISK** | MEDIUM | Schema drift: `organizations`/`org_members`/`companies.organization_id` มีใน Production แต่ไม่มีใน local schema dump → migration รอบหน้าอาจสร้างซ้ำ/ขัดกัน | §2.2 |
| **R8** | **RISK** | LOW-MEDIUM | Data quality: `tax_id` ซ้ำ 2 ค่า (4 ระเบียน), 12 แถวไม่มีทั้ง tax_id และ address, 66 แถวถูก update ยกชุด 2026-07-10 โดยไม่มี audit | §2.4 |
| **R9** | **UNKNOWN** | — | ผู้สั่ง/ผู้นำเข้าชุดข้อมูล: ไม่มีคอลัมน์ provenance, ไม่มี audit event, ไม่มีสคริปต์ใน repo, git อ่านไม่ได้ | §2.7 |
| **R10** | **NOT VERIFIED** | — | ไม่ยืนยันว่า AI เคยตอบข้อมูลบริษัทข้ามผู้ใช้จริงหรือไม่ (ไม่มี log ผูกคำตอบกับ record) | — |

### สิ่งที่ผ่าน (PASS)

| # | ผล | ข้อเท็จจริง |
|---|---|---|
| P1 | PASS | RLS deny-all ทำงาน: anon key อ่าน `companies`, `pit_profiles`, `customer_sites`, `invoices`, `profiles`, `audit_logs`, `business_events` ได้ **0 แถวทุกตาราง** |
| P2 | PASS | Public catalog ไม่ปล่อยเบอร์/ที่อยู่/พิกัดของเจ้าของ และต้องมี publication record + owner match; ปัจจุบัน published = 0, withdrawn = 1 |
| P3 | PASS | AI Gateway รับเฉพาะ `analysis/classification/draft` — ไม่มีสิทธิ์เขียน canonical (ไม่มีการเขียนจาก AI) |
| P4 | PASS | `core/authority/resolve.ts` fail-closed: role ไม่ใช่ authority, grant ต้องอยู่ใน window และไม่ถูก revoke |
| P5 | PASS | ไม่มีตาราง `authority_grants` ใน Production → delegation ทั้งหมดถูกปฏิเสธโดยธรรมชาติ (ไม่ widen access) |

---

## 04 RECORD CENSUS — 86 รายการ

ตารางเต็มอยู่ที่ `DNAOS_DATA_OWNERSHIP_RECORD_TABLE.csv` (86 แถว, ไม่มีชื่อ/เบอร์/อีเมล) คอลัมน์: รหัสระเบียน, UUID, type, status, วันที่สร้าง/แก้ไข, organization_id, flag ข้อมูลที่มี, จำนวน linkage ต่อตาราง, ผลการกำหนดเจ้าของ

สรุปการจำแนกตามหลักฐาน:

| กลุ่ม | จำนวน | นิยามที่ใช้ |
|---|---:|---|
| A. ทะเบียนเปล่า (ไม่มี linkage ใด ๆ) | **69** | มีเพียงแถวใน `companies` — ใช้เป็น directory ได้เท่านั้น ไม่มีหลักฐานความสัมพันธ์ทางธุรกิจ |
| B. มี 기록ธุรกิจจริง | **17** | ปรากฏใน invoice/order/project/document/receipt/debt/event/site/LINE identity อย่างน้อย 1 ครั้ง |
| C. มี LINE identity ที่ผูกแล้ว | 10 | `company_line_links` + `connect_external_identities` (verified 8) |
| D. ข้อมูลการเงินในทะเบียน | 4 | `bank_account_no` ไม่ว่าง (ไม่ถูกอ่านโดย reader ใดในโค้ด) |
| E. นิติบุคคล/บุคคล | 22 มี tax_id · 6 is_individual | ยังแยก record subject ไม่ได้ |

**ผลการกำหนดเจ้าของต่อระเบียน: UNKNOWN ทั้ง 86 แถว** — เพราะ `organization_id` เป็น NULL 100% และไม่มีหลักฐานผู้นำเข้า/แหล่งที่มาในฐานข้อมูล

---

## 05 IMPORT PROVENANCE — SOURCE → ACTOR → PROCESS → TABLE → RECORD → CHANGES

| ขั้น | ข้อเท็จจริงที่ตรวจได้ | สถานะ |
|---|---|---|
| SOURCE | ไม่มีคอลัมน์แหล่งที่มาใน `companies`; ไม่มี `source_place_id`; ไม่มี `source_url` | **UNKNOWN** |
| ACTOR (ผู้สั่ง/ผู้นำเข้า) | ไม่มี `created_by`; `audit_logs` entity_type companies = 0; action import = 0 | **UNKNOWN** |
| PROCESS | ไม่พบสคริปต์ import/CSV/seed ที่สร้าง companies ใน repo; `engines/place-discovery.ts` เป็น read-only (ไม่เขียนตาราง) และไม่พบ caller ในโค้ด (มีเพียง test/registry note) | **NOT FOUND** |
| TABLE | `companies` (86) | VERIFIED |
| RECORD | 24 แถว พ.ค. · 1 มิ.ย. · 61 แถว ก.ค. (60 แถวใน 2 วัน) | VERIFIED (จาก created_at) — **created_at เป็นเพียงวันบันทึกแถว ไม่ใช่วันที่นำเข้าที่พิสูจน์ได้** |
| SUBSEQUENT CHANGES | 66 แถวถูก update วันที่ 2026-07-10 (ยกชุด) โดยไม่มี audit | **PARTIAL / ผู้แก้ UNKNOWN** |
| หลักฐานแวดล้อม | `organizations` สร้าง **2026-10-18** หลังข้อมูลทั้งหมดถูกสร้าง → องค์กรไม่สามารถเป็นเจ้าของข้อมูลย้อนหลังได้โดยอัตโนมัติ | VERIFIED |

**สรุป:** ข้อเท็จจริงทางธุรกิจที่เจ้าของระบบแจ้ง (รวบรวมจาก Google Maps/Search/GPS ตามคำสั่งผู้ก่อตั้ง) **สอดคล้องกับลักษณะข้อมูล** (ชื่อแบบ listing, วันที่นำเข้ายกชุด, การเติมข้อมูลยกชุด) แต่ **ยังไม่มีหลักฐานในระบบที่ผูกชุดข้อมูลกับบัญชีหรือองค์กรใด** — ห้ามใช้ชื่ออีเมล/บทบาท super_admin แทนหลักฐาน

`pit_profiles` (96) มีสภาพเดียวกัน: คอลัมน์ `source` ออกแบบไว้แล้วแต่ **ว่างทั้งหมด** → จุดที่ควร ثبت provenance มีอยู่แล้วแต่ไม่เคยถูกใช้

---

## 06 READERS → AI CONTEXT MAP

```
ORIGINAL RECORD            READER / API                         TOOL                    AI CONTEXT                 DESTINATION
companies (86)  ──► services/supabase/queries.ts#getPartners ──► dispatcher partner.list ──► cognitive pipeline ──► /api/command (ANY auth)
                │                                              │                          │                        /api/chat (ADMIN_TIER)
                │                                              │                          └─► answerWithAi prompt ──► AI provider ภายนอก
                │                                              └─► /api/v1/query (token) ──► AI ภายนอก (MCP/OpenClaw)
                ├─► getPartnersWithDocumentSummary (+ยอดเงิน) ──► partner.list
                ├─► /api/admin/partners ──────────────────────► admin UI (ADMIN_TIER)
                ├─► /api/admin/backup (select *) ─────────────► super_admin export
                └─► relationship-qa (LINE) ── name match ─────► ตอบยอดหนี้ผ่าน LINE (draft)

pit_profiles (96) ──► public-catalog reader ──► publication_records (published 0) ──► /api/public/products
                  └─► admin pits / quote engines (service role)
```

### การตรวจสิทธิ์ก่อนอ่าน/ส่งให้ AI

| เส้นทาง | ตรวจตัวตน | ตรวจองค์กรเจ้าของข้อมูล | ตรวจวัตถุประสงค์/การเผยแพร่ | ผล |
|---|---|---|---|---|
| `/api/command` → pipeline | ใช่ (ล็อกอิน) | **ไม่** | **ไม่** | **FAIL** |
| `/api/v1/query` → token | ใช่ (token + role) | **ไม่** | **ไม่** | **FAIL** |
| `/api/chat` → pipeline | ใช่ (ADMIN_TIER) | **ไม่** | **ไม่** | **FAIL** (จำกัดด้วย role เท่านั้น) |
| LINE relationship-qa | ใช่ (LINE user) | ใช้ "ชื่อ" แทนหลักฐาน | ไม่ | **FAIL** |
| `/api/public/products` | ไม่ต้อง (public) | ใช่ (publication + owner key) | ใช่ (field allow-list) | **PASS** |
| `/api/admin/partners` | ใช่ (ADMIN_TIER) | **ไม่** | ไม่ | RISK (role เดียว) |

> **ความต่างของผลลัพธ์:** `/api/v1/query` คืน `result.data` เป็นแถวข้อมูลเต็ม (ฟิลด์ทั้งหมดที่ reader เลือก) — `/api/command` และ `/api/chat` คืนผลผ่าน display/response contract (ข้อความ/ตาราง) แต่ทั้งสามเส้นทางเรียก reader ตัวเดียวกันด้วย service role และไม่มี tenant scope

### การส่งข้อมูลออก AI Provider ภายนอก

| ข้อ | สถานะ |
|---|---|
| มี adapter/provider ภายนอกในโค้ด | YES — Anthropic, Gemini (`services/ai/adapters.ts`) |
| Production มี credential/provider จริง | YES — `system_health_status` service `anthropic` = healthy (2026-10-24T23:20Z), `dna_os_ai_gateway` ai_invocation healthy (2026-10-20) |
| มีหลักฐานส่ง "ชุด 86 บริษัท" ออกไป | **NOT PROVEN** — `ai_tasks` 385 (owner_cline_command 266), `worker_usage_events` 104 ส่วนใหญ่ benchmark; มี usage ลูกค้าจริงเพียง 2 ครั้ง (handle_text 1, classify_image 1) |
| เส้นทางที่เปิดอยู่ | `answerWithAi(contactContext)` — ข้อความบริบทที่ caller ส่งมาไม่ผ่าน disclosure filter |

---

## 07 AI CROSS-ORGANIZATION CASES (A–E)

| กรณี | ผลที่คาดหวัง | ผลจริง | สถานะ |
|---|---|---|---|
| **A** เจ้าของชุดข้อมูลถามรายชื่อบริษัทของตน | ค้นได้ภายใต้สิทธิ์เจ้าของ | ได้ **ทั้งหมด 86 + ยอดเงิน** ไม่จำกัดชุดของตน | **FAIL** (กว้างเกินสิทธิ์) |
| **B** องค์กรอื่นถามรายชื่อเดียวกัน | ห้ามหยิบชุดข้อมูลส่วนตัวของเจ้าของเดิม | `partner.list` คืนทุกแถวให้ทุก caller ที่ผ่าน requireAuth; ไม่มีการตรวจ org | **FAIL** |
| **C** องค์กรอื่นขอข้อมูลสาธารณะจากต้นทาง | ใช้ช่องทางสาธารณะที่ได้รับอนุญาต + อ้างอิงต้นทาง | มีเพียง `external_url` เปิด Google search (ไม่ใช้คลังข้อมูล) และ public catalog แยก publication ชัดเจน | **PARTIAL PASS** (สำหรับราคา) / ไม่มีกลไก directory สาธารณะ |
| **D** AI พบข้อมูลแต่ไม่พบเจ้าของ/สิทธิ์เผยแพร่ | ห้ามตอบข้ามองค์กรอัตโนมัติ | `organization_id` NULL 86 แถว แต่ reader ไม่สนใจ → ตอบได้ | **FAIL** |
| **E** ข้อมูลสาธารณะถูกเติมราคา/ผู้ติดต่อ/บันทึกภายใน | แยกส่วนเผยแพร่ได้ออกจากส่วนลับ | `companies` เก็บ `phone/address/tax_id/bank_account_no/line_user_id` ในแถวเดียว ไม่มี field-level classification | **FAIL** (schema) / PASS เฉพาะ public catalog ของราคา |

**จุดที่ AI ตอบข้ามองค์กรได้จริงในโค้ด:** `partner.list` → `dispatch` → `runCognitivePipeline` (ทั้ง `/api/command` และ `/api/chat`) และ `partner.list` ผ่าน `/api/v1/query` — ไม่มีจุดใดเรียก `resolveAuthority()` ก่อนอ่าน

---

## 08 OWNERSHIP & PERMISSION MAPPING (ข้อเสนอ — ยังไม่แก้ Schema)

### 8.1 แยกแนวคิดเจ้าของ (ต้องไม่เหมารวม)

| แนวคิด | วันนี้อยู่ที่ไหน | สถานะ | ข้อเสนอ (อนาคต) |
|---|---|---|---|
| Source Owner (เจ้าของต้นฉบับ) | ไม่มี | **MISSING** | `source_provider`, `source_ref`, `source_url` ในตารางข้อมูล + เก็บต้นฉบับอ้างอิง |
| Publisher (ผู้เผยแพร่ต้นฉบับ) | ไม่มี | **MISSING** | field เดียวกับ Source Owner + `source_published_at` |
| Collection Owner (ผู้รวบรวม/สั่งนำเข้า) | ไม่มี | **MISSING** | `companies.collected_by_profile_id` + ตาราง `import_batches` |
| Tenant / Organization Owner | `companies.organization_id` (มี แต่ NULL 100%) | **PARTIAL** | ใช้คอลัมน์เดิม + FK ไป `organizations` (เมื่อตัดสินใจ) |
| Record Subject (กิจการ/บุคคลที่ข้อมูลกล่าวถึง) | `companies` เอง + `is_individual` | **PARTIAL** | `record_subject_type` (business/individual/public_figure) |
| Import Provenance | ไม่มี (มีเพียง `created_at`) | **MISSING** | `import_batches(id, actor_profile_id, method, source, row_count, evidence_path, created_at)` + `companies.import_batch_id` |
| Usage Purpose | ไม่มี | **MISSING** | `usage_purpose` (directory / pricing / debt / marketing) ต่อชุดข้อมูล |
| Disclosure Permission | มีเฉพาะราคา (`publication_records`) | **PARTIAL** | ขยายแนวทาง publication record ให้ครอบ field ระดับบริษัท (โทร/อีเมล/เลขภาษี/เลขบัญชี) |
| AI Retrieval Scope | ไม่มี | **MISSING** | ใช้ `authority_grants` (proposal) โดยเพิ่ม resource_kind `company`/`directory` + scope `org` |
| Verification Status / Verified At | ไม่มี | **MISSING** | `verification_status`, `verified_at`, `verified_by_profile_id` |
| Updated provenance | `updated_at` | PARTIAL | `updated_by_profile_id` + audit event ต่อการแก้ |

### 8.2 จัดการ 86 แถวที่ `organization_id` เป็น NULL (ห้าม assign อัตโนมัติ)

**หลักการ: NULL คือคำตอบที่ถูกต้องจนกว่าจะมีหลักฐาน** — ห้าม assign ทั้งหมดให้ DNA OS หรือองค์กร `สำนักงานใหญ่`

| กลุ่ม | จำนวน | แนวทาง |
|---|---:|---|
| A. ทะเบียนเปล่า ไม่มีธุรกรรม | 69 | คง NULL; ตั้ง `ai_retrieval_scope = deny_cross_tenant`; ใช้ได้เฉพาะในนาม platform หลังเจ้าของระบบยืนยันชุดข้อมูลเป็นราย batch |
| B. มีธุรกรรม/identity จริง | 17 | ตรวจทีละรายกับหลักฐานธุรกรรม (invoice/order/identity) ก่อนผูก org — ต้องมีบันทึกการอนุมัติของเจ้าของระบบ |
| C. CORE/SUPPLIER (sentinel id `…0001`, `…0003`) | 2 | ห้ามผูกกับ org ของผู้ใช้; เป็นข้อมูล platform/seed (ต้องยืนยันว่าเป็นของ DNA OS จริงก่อน) |
| D. มี `bank_account_no` | 4 | แยกเป็นฟิลด์ความลับ (field-level) ก่อนพิจารณาเจ้าของ |
| E. `pit_profiles` 96 | 96 | ใช้ `source`/`source_place_id` ที่มีอยู่แล้ว: บันทึก provenance ก่อน แล้วจึงผูก `user_id`/org (15 มี owner, 81 ไม่มี) |

**รูปแบบการรับรองที่แนะนำ (ไม่ต้อง migrations รอบนี้):** เอกสาร attestation ต่อ batch ระบุ "batch วันที่ / จำนวนแถว / ผู้อ้างสิทธิ์ / วัตถุประสงค์ / ขอบเขตเผยแพร่" + hash ของไฟล์ต้นฉบับ → เมื่ออนุมัติแล้วจึงเขียน `organization_id` และ `collected_by_profile_id` พร้อม audit event เดียว

### 8.3 จุดที่ต้องใช้ Authority กลาง (ไม่สร้างระบบสิทธิ์คู่ขนาน)

- `resolveAuthority()` + `loadAuthorityContext()` ที่มีอยู่แล้ว → เรียกใน **reader** ก่อนคืนข้อมูล (วันนี้ไม่ได้เรียก)
- `publication_records` + `core/public-catalog/policy.ts` → ใช้เป็นโมเดล disclosure ของ field ที่เผยแพร่ได้
- `authority_grants` (proposal ที่ยังไม่ apply) → ใช้เป็นที่เก็บ AI retrieval scope/delegation เมื่อเจ้าของอนุมัติ

---

## 09 คำตอบสรุป (10 ข้อ)

1. **บริษัทแต่ละรายการถูกเก็บในบริบทใด?** เก็บเป็น "ทะเบียนบริษัท" (`companies`) แบบ flat ไม่มีเจ้าขององค์กร — 86/86 `organization_id = NULL`
2. **มีหลักฐานใดเชื่อมกับบัญชีผู้รวบรวม?** ไม่มี — ไม่มี `created_by`/`collected_by`, `audit_logs` 0 แถวสำหรับ companies, ไม่มีสคริปต์ import ใน repo, git อ่านไม่ได้
3. **ข้อมูลใดเป็นเพียงข้อมูลสาธารณะ?** 69 แถวไม่มี linkage ใด ๆ (มีเพียงชื่อ/ที่อยู่/เบอร์/บางส่วนมี tax_id) — ลักษณะเป็น public directory ที่รวบรวมไว้ แต่ **สิทธิ์เผยแพร่ซ้ำยังไม่มีหลักฐาน**
4. **ข้อมูลใดถูกจัดโครงสร้าง/เสริมโดยผู้ใช้?** 66 แถวถูก update ยกชุด 2026-07-10 (ผู้แก้ UNKNOWN); 17 แถวมีธุรกรรมจริง; 4 แถวมีเลขบัญชี
5. **ตารางใดสัมพันธ์กับบริษัท?** invoices, customer_orders, projects, standalone_documents, receipt_documents, debt_snapshots/events, business_events, customer_sites, connect_external_identities, company_line_links, audit_logs (§2.5)
6. **AI มีเส้นทางอ่านข้อมูลทั้งหมดหรือไม่?** มี — `partner.list`/`partner.find`/`debt.list` ผ่าน `/api/command` (ทุก role), `/api/chat` (admin tier), `/api/v1/query` (token คืนแถวเต็ม) และ LINE Q&A
7. **AI อาจตอบข้ามองค์กรจุดใด?** `partner.list` (ไม่มี org filter) · `/api/command` เปิดให้ customer · `/api/v1/query` token ไม่มี tenant scope · LINE name-match (R1–R3)
8. **ข้อมูลใดกำหนดเจ้าของได้จากหลักฐาน?** ไม่มีแถวใดกำหนดองค์กรเจ้าของได้; กำหนดได้เพียง "มีความสัมพันธ์ทางธุรกิจกับ platform" จาก 17 แถว
9. **ข้อมูลใดยังต้องยืนยันก่อนกำหนดเจ้าของ?** ทั้ง 86 แถว (และ 96 pit) — ต้องมี attestation/หลักฐานนำเข้า
10. **ต้องปรับอะไรก่อน STEP 3?** §10

---

## 10 GATE ก่อน STEP 3 (ยังไม่ดำเนินการในรอบนี้)

| ลำดับ | งาน | เหตุผล | ต้องอนุมัติ |
|---|---|---|---|
| G1 | ปิด `partner.list`/`partner.find`/`debt.*` ไม่ให้คืนข้อมูลนอก org ของ caller (หรือ deny เมื่อ org ไม่ชัด) | R1/R2/D | เจ้าของระบบ |
| G2 | เปลี่ยน `/api/command` จาก `requireAuth()` → `requireAuth(ADMIN_TIER)` | R1 (บัญชี customer มีจริง) | เจ้าของระบบ |
| G3 | ลบ name-match fallback ใน `relationship-qa` — ต้องมี verified `connect_external_identities` เท่านั้น | R3 | เจ้าของระบบ |
| G4 | ตัดสินนโยบาย: 86 แถวเป็น (ก) platform directory หรือ (ข) ชุดข้อมูลของ tenant ใด — ก่อนออกแบบ field | §8.2 | เจ้าของระบบ |
| G5 | อนุมัติ schema change ครั้งเดียว: provenance + ownership + disclosure + retrieval scope (ยังไม่ทำรอบนี้) | §8.1 | เจ้าของระบบ |
| G6 | เพิ่ม audit event สำหรับ create/update/import ของ companies และ pit_profiles | ปิดช่อง UNKNOWN | เจ้าของระบบ |
| G7 | ทบทวน `/api/admin/backup` (select * รวม bank_account_no) และ field-level classification | R5/E | เจ้าของระบบ |
| G8 | ซิงก์ local schema (`organizations`, `org_members`, `companies.organization_id`) ก่อน migration รอบถัดไป | R7 | เจ้าของระบบ |

**ห้ามเริ่ม STEP 3 / เปลี่ยนสิทธิ์ / assign `organization_id` / แก้ RLS / แก้ AI Gateway จนกว่าเจ้าของระบบจะอนุมัติ G1–G5**

---

## 11 ข้อห้ามที่ปฏิบัติตาม (หลักฐาน)

| ข้อห้าม | การปฏิบัติ |
|---|---|
| ห้ามแก้ Source Code | ไม่มีการแก้ไฟล์โค้ดในรอบนี้ — สร้างเฉพาะรายงาน + CSV |
| ห้ามแก้ Database / migration | ใช้ GET/HEAD เท่านั้น; ไม่มี DDL/DML |
| ห้าม Assign `organization_id` | ไม่มีการเขียน; รายงานเฉพาะข้อเสนอ |
| ห้ามย้าย/ลบข้อมูล / เปลี่ยน RLS / Role | ไม่ดำเนินการ |
| ห้ามแก้ AI Gateway | ไม่แก้ |
| ห้าม Commit/Push/Deploy | ไม่ดำเนินการ |
| ห้ามนำข้อมูลส่วนตัวไปทดสอบกับ AI ภายนอก | ไม่ได้ส่งข้อมูลใดออกภายนอก; รายงานไม่มีชื่อ/เบอร์/อีเมล/เลขภาษี/เลขบัญชี |
| ห้ามสรุปว่าข้อมูลสาธารณะเผยแพร่ซ้ำได้ทั้งหมด | ระบุชัดว่าสิทธิ์เผยแพร่ยังไม่มีหลักฐาน (§7 case C/E) |

---

## APPENDIX A — ไฟล์ตารางประกอบ

`reports/revenue-reverse-2026-10-25/DNAOS_DATA_OWNERSHIP_RECORD_TABLE.csv`
86 แถว · รหัส C-001…C-086 · UUID · type/status · วันที่สร้าง/แก้ไข · organization_id · flag ข้อมูล · จำนวน linkage ต่อตาราง · `owner_determination = UNKNOWN` · `source_evidence`

## APPENDIX B — ช่องว่างที่ยืนยันแล้ว (MISSING / GAP)

1. `companies`: ไม่มี source/created_by/import_batch/usage/disclosure/verification/AI scope
2. `pit_profiles`: มี `source` แต่ NULL 96/96; ไม่มี org column
3. `company_expenses`: ไม่มี company_id → ต้นทุนผูกบริษัทไม่ได้โดยตรง
4. ไม่มีตาราง import/attestation/history
5. `audit_logs`: ไม่มี event ประเภท company create/update/import
6. ไม่มีจุดใดใน reader ที่เรียก `resolveAuthority()` ก่อนอ่าน
7. `organizations`/`org_members` ยังไม่ถูกอ้างโดย resource ใด (org เดียว, สร้างหลังข้อมูล)
8. `publication_records`: ครอบเฉพาะราคา (`pit_materials`) ไม่ครอบ field บริษัท
9. Local schema drift: ตาราง org ไม่มีใน `full_schema.sql`
10. Git history ใช้งานไม่ได้ → ต้องเก็บหลักฐานนำเข้าเป็นไฟล์/attestation ไม่พึ่ง git
