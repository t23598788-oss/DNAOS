# DNA OS — STEP 3: VERIFY 86 RECORDS AGAINST A COLLECTOR ACCOUNT
**โหมด:** READ-ONLY · **วันที่:** 2026-10-25 · **โครงการ:** `xeytcavxejhyzxwevgto`
**คำสั่งเจ้าของ:** ตรวจความสัมพันธ์ข้อมูลเดิมทั้ง 86 รายการกับบัญชีผู้รวบรวม (ลำดับงานข้อ 3)
**ไฟล์ประกอบ:** `DNAOS_DATA_OWNERSHIP_RECORD_TABLE.csv` (C-001…C-086, ไม่มีชื่อ/เบอร์/อีเมล/เลขภาษี)

> เป้าหมายของเอกสารนี้คือ **พิสูจน์หรือปฏิเสธ** ว่ามีบัญชีใดเป็นผู้รวบรวม/สั่งนำเข้าชุดข้อมูลนี้ — ไม่ใช่การกำหนดเจ้าของ และไม่มีการเขียนข้อมูลใด ๆ

---

## 01 วิธีการ

| หัวข้อ | รายละเอียด |
|---|---|
| คำสั่ง | HTTP GET/HEAD ผ่าน PostgREST (ไม่มี DML/DDL/RPC) |
| ตารางที่อ่าน | `companies`, `profiles`, `organizations`, `org_members`, `company_line_links`, `connect_external_identities`, `audit_logs`, ตารางธุรกรรมที่อ้าง company |
| สิ่งที่ไม่เก็บในรายงาน | ชื่อบริษัท, เบอร์, อีเมล, tax_id, เลขบัญชี — ใช้รหัสระเบียน C-xxx และ UUID เท่านั้น |
| ข้อจำกัด | ไม่ได้อ่าน `auth.users`; git history ใช้งานไม่ได้ (pack เสีย) |

---

## 02 TIMELINE — ข้อมูลเกิดก่อนบัญชี/องค์กรหรือไม่

| เหตุการณ์ | เวลาจริง | หลักฐาน |
|---|---|---|
| companies แถวแรก | **2026-05-10 14:27Z** | `companies.created_at` |
| companies แถวสุดท้าย | 2026-07-24 15:58Z | `companies.created_at` |
| profiles 2 แถวแรก (super_admin) | **2026-07-08 16:51Z / 17:12Z** | `profiles.created_at` |
| profile customer | 2026-10-15 | `profiles.created_at` |
| organization “สำนักงานใหญ่” | **2026-10-18** | `organizations.created_at` |
| company_line_links 10 แถว | 2026-07-10 → 2026-07-24 | `company_line_links.created_at` |
| connect_external_identities 12 แถว | **2026-10-08 ทั้งหมด** (`source = backfill:…`) | ตาราง identity |
| audit_logs แถวแรก | 2026-05-22 | `audit_logs.created_at` |

**ข้อสรุปจาก timeline (ระวังการตีความ):**
- แถว `profiles` ถูกสร้างหลัง companies ชุด พ.ค.–ก.ค. → **แถวโปรไฟล์ปัจจุบันไม่สามารถเป็นผู้สร้างชุดข้อมูลเดือน พ.ค. ได้**
- แต่ `auth.users` ไม่ได้ถูกอ่าน จึงยัง **ปฏิเสธไม่ได้** ว่าบัญชีเดียวกันมีอยู่ก่อนแล้วและเพิ่งสร้างแถว profiles ทีหลัง
- องค์กรถูกสร้างหลังข้อมูลทั้งหมด → การผูก `organization_id` ย้อนหลังไม่สามารถอ้าง “ระบบสร้างให้” ได้
- identity ทั้ง 12 แถวเป็น **backfill วันที่ 2026-10-08** (สร้างจาก line_profiles/company_line_links) ไม่ใช่หลักฐานการรวบรวมตอนนำเข้า

---

## 03 BATCHES — ข้อมูลเข้ามาเป็นรุ่น

| วันที่สร้าง | จำนวน | มี linkage | CORE/SUPPLIER | มี tax_id | org NULL |
|---|---:|---:|---:|---:|---:|
| 2026-05-10 | 2 | 1 | 0 | 2 | 2 |
| 2026-05-12 | 4 | 1 | 0 | 2 | 4 |
| 2026-05-13 | 1 | 0 | 0 | 1 | 1 |
| 2026-05-15 | 13 | 0 | 0 | 8 | 13 |
| **2026-05-23** | 4 | 1 | **CORE 1 + SUPPLIER 1** | 3 | 4 |
| 2026-06-11 | 1 | 1 | 0 | 0 | 1 |
| **2026-07-08** | 15 | **12** | 0 | 5 | 15 |
| **2026-07-09** | 45 | 0 | 0 | 0 | 45 |
| 2026-07-24 | 1 | 1 | 0 | 1 | 1 |
| **รวม** | **86** | **17** | 2 | 22 | **86** |

ข้อสังเกต:
1. วันที่ 2026-05-23 มี 4 แถวรวม CORE (id `…0001`) และ SUPPLIER (id `…0003`) พร้อม `updated_at` วันเดียวกัน → ลักษณะ **seed ระบบ** ไม่ใช่ listing ที่รวบรวมจากแผนที่
2. วันที่ 2026-07-08 มี 15 แถว แต่ **12 แถวมี linkage ธุรกิจ** — เป็นรุ่นที่ถูกใช้งานจริงมากที่สุด
3. วันที่ 2026-07-09 มี 45 แถว **ไม่มี linkage ใด ๆ** — เข้ามาทีหลังและไม่มีร่องรอยการใช้งาน
4. วันที่ 2026-07-10 มีการ update ยกชุด 66 แถว (ไม่ปรากฏในตารางนี้เพราะเป็น `updated_at`) โดยไม่มี audit

---

## 04 ACCOUNT EVIDENCE — มีหลักฐานผูกกับบัญชีใดหรือไม่

| หลักฐาน | ค่าจริง | ตีความได้ว่า |
|---|---|---|
| `companies.created_by` / `collected_by` | **ไม่มีคอลัมน์** | ผู้นำเข้าไม่ถูกบันทึก |
| `companies.import_batch_id` / `source` | **ไม่มีคอลัมน์** | แหล่งที่มา/รุ่นนำเข้าไม่ถูกบันทึก |
| `audit_logs` entity_type = companies | **0 แถว** (จาก 4,860) | ไม่มี event สร้าง/แก้บริษัท |
| `audit_logs` action มีคำว่า import | **0 แถว** | ไม่มี event นำเข้า |
| `org_members` | 2 แถว (owner/admin) สร้าง 2026-10-18 | สมาชิกภาพเกิดหลังข้อมูล |
| `companies.organization_id` | NULL 86/86 | ไม่มีบริษัทใดถูกผูกองค์กร |
| `company_line_links` | 10 แถว (07-10…07-24) | เป็น “ลิงก์ผู้ติดต่อ” ไม่ใช่ “ผู้นำเข้า” |
| `connect_external_identities` | 12 แถว, verified 8, backfill 2026-10-08 | เป็นความสัมพันธ์ผู้ติดต่อที่ยืนยันแล้ว ไม่ใช่ผู้นำเข้า |
| บริษัทที่มี identity verified | **7 แถว: C-001, C-004, C-025, C-029, C-030, C-034, C-040** (อีก 1 identity verified ไม่มี company) | ใช้ยืนยัน “ผู้ติดต่อ” ได้เฉพาะ 7 บริษัท |
| เอเจนซี/สคริปต์ import ใน repo | ไม่พบ (ไม่มี CSV/seed/`INSERT INTO companies`) | ไม่มีหลักฐานกระบวนการในโค้ด |

**ผล:** ไม่มีหลักฐานใดในฐานข้อมูลที่ระบุ “บัญชีผู้รวบรวม” — ทั้ง 86 ระเบียนจึงเป็น **UNKNOWN** ตามหลักฐาน (ไม่ใช่เพราะขาดการค้นหา แต่เพราะไม่มีฟิลด์/event ที่จะตอบคำถามนี้)

---

## 05 PER-RECORD RESULT

| กลุ่ม | จำนวน | รหัส |
|---|---:|---|
| มี linkage ธุรกิจอย่างน้อย 1 อย่าง | **17** | C-001, C-004, C-022, C-025, C-026, C-027, C-028, C-029, C-030, C-031, C-032, C-034, C-036, C-038, C-039, C-040, C-086 |
| มีเฉพาะแถวทะเบียน | **69** | รหัสที่เหลือ |
| มี identity verified (ผู้ติดต่อ) | 7 | C-001, C-004, C-025, C-029, C-030, C-034, C-040 |
| มี `tax_id` ซ้ำกัน | 4 | C-007+C-029 · C-003+C-030 |
| มี `bank_account_no` | 4 | ไม่ระบุรหัสในรายงาน (ข้อมูลการเงิน) |
| ไม่มีทั้ง tax_id และ address | 12 | ดูคอลัมน์ flag ใน CSV |

ตารางรายระเบียน (86 แถว) อยู่ใน `DNAOS_DATA_OWNERSHIP_RECORD_TABLE.csv` — คอลัมน์ `owner_determination` เป็น `UNKNOWN` ทุกแถว และ `source_evidence` ระบุเหตุผล

---

## 06 FINDINGS

| # | ข้อค้นพบ | สถานะ |
|---|---|---|
| F1 | ชุดข้อมูลเริ่มถูกบันทึกก่อนแถว `profiles`/`organizations` ที่ใช้อยู่ในปัจจุบัน | VERIFIED (created_at) |
| F2 | ไม่มีคอลัมน์/ตาราง/event ใดบันทึกผู้นำเข้าหรือแหล่งที่มา | VERIFIED (schema + audit count) |
| F3 | 45 แถววันที่ 2026-07-09 ไม่มี linkage ใด ๆ และไม่มี tax_id | VERIFIED |
| F4 | 12 จาก 15 แถววันที่ 2026-07-08 มี linkage ธุรกิจจริง → รุ่นนี้คือชุดที่ถูกใช้งาน | VERIFIED |
| F5 | identity ทั้ง 12 แถวเป็น backfill 2026-10-08 ไม่ใช่วงเวลานำเข้า | VERIFIED |
| F6 | ไม่มีหลักฐานว่าบัญชีใดเป็นผู้รวบรวม และไม่มีหลักฐานปฏิเสธข้อกล่าวอ้างของผู้ก่อตั้ง | **UNKNOWN** |
| F7 | `tax_id` ซ้ำ 2 ค่า (4 ระเบียน) สะท้อนการนำเข้าซ้ำ/ข้อมูลต้นทางซ้ำ ต้องไม่ใช้เป็นกุญแจเจ้าของ | VERIFIED |

---

## 07 สิ่งที่เจ้าของระบบต้องยืนยัน (Attestation) ก่อนผูกเจ้าของ

แบบฟอร์มขั้นต่ำต่อรุ่นข้อมูล (1 ใบต่อ batch):

```
BATCH ATTESTATION
batch_date:           2026-__-__
record_codes:         C-___ … C-___  (หรือจำนวนแถว)
claimed_collector:    <profile id / email ของผู้สั่งรวบรวม>
collection_method:    Google Maps / Google Search / GPS / CSV / manual / อื่น ๆ
source_reference:     ลิงก์/ชื่อไฟล์ต้นฉบับ + hash (ถ้ามี)
collection_purpose:   ใช้ภายใน / เผยแพร่ราคา / ค้นหา / อื่น ๆ
disclosure_scope:     ไม่เผยแพร่ / เผยแพร่เฉพาะฟิลด์สาธารณะ / อื่น ๆ
owner_decision:       ผูกกับ organization_id = ______  หรือ คงเป็น NULL
signed_by:            ______  วันที่ ______
```

หลักฐานอ่านอย่างเดียวที่เจ้าของใช้ประกอบได้ (ไม่มีการเขียน):

```sql
-- 1) ดูรุ่นข้อมูลตามวันที่ (ไม่ดึงชื่อ)
select date(created_at) as batch, count(*), count(tax_id), count(*) filter (where organization_id is null)
from public.companies group by 1 order by 1;

-- 2) ดูว่ามี event ในระบบที่เกี่ยวกับบริษัทหรือไม่ (คาดว่า 0)
select entity_type, action, count(*) from public.audit_logs
where entity_type ilike '%compan%' or action ilike '%import%' group by 1,2;

-- 3) ดูความสัมพันธ์ผู้ติดต่อที่ยืนยันแล้ว (ไม่ดึงชื่อ)
select provider, trust_level, count(*), count(company_id)
from public.connect_external_identities group by 1,2;
```

---

## 08 ข้อสรุปและข้อห้าม

1. **ยังไม่มีระเบียนใดกำหนดเจ้าขององค์กรได้** — 86/86 เป็น UNKNOWN
2. **ยังไม่มีหลักฐานผู้รวบรวม** — ต้องใช้ attestation ของเจ้าของระบบเท่านั้น
3. ห้าม assign `organization_id` ทั้งชุดให้ DNA OS, องค์กร `สำนักงานใหญ่`, หรือบัญชี super_admin
4. ห้ามใช้ `tax_id` ที่ซ้ำหรือชื่อที่ตรงกันเป็นหลักฐานเจ้าของ
5. ห้ามใช้ `connect_external_identities` (ซึ่งเป็น backfill) เป็นหลักฐาน “ผู้นำเข้า” — ใช้ได้เพียงยืนยันผู้ติดต่อ 7 บริษัท
6. หลังได้รับ attestation แล้วจึงดำเนินการผูกเจ้าของพร้อม audit event ทีละรุ่น (batch) — ยังไม่อยู่ในรอบนี้
