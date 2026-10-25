# STEP 01 — แผนซ่อมประวัติ Migration (`20261024000002`) — ยังไม่รัน

## 1. หลักฐานว่า Schema ตรงกับ Migration (ตรวจซ้ำ 2026-10-25)

| การตรวจ | ผล | ค่าจริง |
|---|---|---|
| คอลัมน์รวมสองตาราง | ตรง | **26** (publication_records 17 + publication_events 9) |
| ชนิด/nullability/default | ตรงทุกคอลัมน์ | fingerprint `bc5c51ac8fa4d005c8c25bb469b15415` |
| Constraints | ตรง | **9** (PK×2, UNIQUE×2, CHECK×4, FK cascade×1) |
| RLS | เปิด | `relrowsecurity = true` ทั้งสองตาราง, policies = 0 |
| anon/authenticated | ไม่มีสิทธิ์ | REST ตอบ `401 42501` |

## 2. สภาพก่อนซ่อม (จริง)

| รายการ | ค่า |
|---|---|
| `supabase_migrations.schema_migrations` มี `20261024000002` | **0 แถว** (ไม่มี) |
| local-only (pending) | **22** (รวม `20261024000001`, `20261024000002`) |
| remote-only | 7 (`20261008000001`, `20261014000002/3/4`, `20261018000001/2/3`) |
| version ซ้ำในโฟลเดอร์ | `20260804000007` (3 ไฟล์), `20260804000010` (2 ไฟล์) |
| วิธีที่ใช้ apply จริง | `supabase db query --linked -f` (BEGIN…COMMIT) — ไม่ผ่านตัวติดตามของ CLI |

## 3. คำสั่งซ่อม (เฉพาะรายการเดียว — ต้องได้รับอนุมัติก่อนรัน)

```bash
# ซ่อม "ประวัติ" ให้ตรงกับ schema ที่มีอยู่แล้ว — ไม่แตะ schema, ไม่รัน SQL ใด ๆ
supabase migration repair --linked --status applied 20261024000002
```

**ก่อนรัน ต้องยืนยันซ้ำ 3 ข้อนี้ (read-only):**
```sql
select to_regclass('public.publication_records'), to_regclass('public.publication_events');
select count(*) from information_schema.columns
 where table_schema='public' and table_name in ('publication_records','publication_events');  -- 26
select count(*) from supabase_migrations.schema_migrations where version='20261024000002';   -- 0
```

**หลังรัน ต้องเห็น:**
```sql
select version, name from supabase_migrations.schema_migrations
 where version='20261024000002';                       -- 1 แถว, name = public_publication_registry
-- และ `supabase migration list` แสดงคอลัมน์ local + remote ตรงกัน
-- pending ลดจาก 22 → 21
```

**ย้อนกลับ (ถ้าซ่อมผิด):**
```bash
supabase migration repair --linked --status reverted 20261024000002
```
(ไม่มีผลกับข้อมูล/ตาราง — เป็นการแก้แถวประวัติเท่านั้น)

## 4. ขอบเขตที่ "ไม่ทำ"

- **ห้าม `supabase db push`** — จะพา 21 migration ที่เหลือ + remote-only drift ลง Production พร้อมกัน
- **ไม่ซ่อม `20261024000001`** — ยังไม่ได้ apply จริง (ไม่มีในประวัติ) และไฟล์ไม่ได้ตรงกับฟังก์ชันที่รันอยู่ใน DB
- **ไม่แตะ version ซ้ำ / remote-only 7 รายการ** — เป็น drift ที่มีมาก่อนรอบนี้ ต้องแยกใบสั่งงาน
- **ไม่แก้ schema, ไม่รัน DDL ใด ๆ** ในรอบนี้

## 5. ความเสี่ยงถ้าไม่ซ่อม

| ความเสี่ยง | ผล |
|---|---|
| `db push` ครั้งหน้า | CLI จะถือว่า `20261024000002` ยังไม่ apply → พยายามรันซ้ำ (idempotent แต่จะพา migration อื่นไปด้วยถ้าไม่ระวัง) |
| การตรวจสอบย้อนหลัง | Schema กับประวัติไม่ตรงกัน ทำให้ audit ถามไม่ได้ว่า "ใคร/เมื่อไรสร้างตารางนี้" |
| Automation ในอนาคต | CI ที่เช็ค `migration list` จะรายงาน drift ปลอมทุกครั้ง |
