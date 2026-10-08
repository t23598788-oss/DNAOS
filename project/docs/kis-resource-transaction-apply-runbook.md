# KIS Resource-Transaction — Production Apply Runbook

**สถานะ: NOT APPLIED · NOT DEPLOYED — ห้ามทำ step ใด ๆ จนกว่า Owner จะ approve**
**(BATCH 21/22 — baseline main 4992001)**

ที่มา: canonical path ของ machinery/resource transactions
(engines/canonical/resource-transaction-write.ts) — edge function
(supabase/functions/kis-webhook) ไม่เขียน DB ตรงอีกต่อไป

## 0. ก่อนเริ่ม — สิ่งที่ Owner ต้องยืนยัน

### 0.1 ค่า app_configs["machinery_rates"] (JSON — ยังไม่ถูกสร้างในระบบ)

| field | ค่าอ้างอิงจากโค้ดเดิม (git cf49144) | ยืนยัน? |
|---|---|---|
| base_rate_per_hour | 600.00 | ⬜ |
| fuel_consumption_lph | 8.5 (เดิม label: Kubota U-55) | ⬜ |
| markup_margin | 0.25 (25%) | ⬜ |

- fuel price ไม่ต้องตั้งเอง — authority คือ app_configs["fuel-price"]
  (เขียนโดย fuel-price-sync cron ทุกวัน 06:00)
- ไม่มีค่า = ทุก write ถูก reject ด้วย CONFIG_AUTHORITY_MISSING
  (fail-closed — ไม่มี fallback 600/35 ในโค้ด)
- ตัวอย่างเมื่อ fuel-price = 37.19:
  unit_cost = round2(600 + 8.5*37.19) = 916.12 · unit_price ≈ 1145.15

### 0.2 Secrets 3 ตัว (ดู .env.local.example — ค่าทั้งหมดว่าง)

| secret | ฝั่งที่ต้องตั้ง |
|---|---|
| KIS_WEBHOOK_TOKEN | Supabase function secret + ใส่ใน SendGrid destination URL (?token=) |
| KIS_SENDER_ALLOWLIST | Supabase function secret (comma list ของอีเมล KIS) |
| RESOURCE_TRANSACTION_INTERNAL_SECRET | Next .env.local + Supabase function secret — ค่าเดียวกันทั้งสองฝั่ง |

- ไม่ตรง/ไม่มีค่า = 401/503 fail-closed ทุก request
- โค้ดไม่มีการ print/log ค่า secret ใด ๆ (probe ยืนยัน BATCH 21)
- ห้าม commit ค่าจริง

### 0.3 SendGrid Inbound Parse
destination URL = https://<project-ref>.supabase.co/functions/v1/kis-webhook?token=<KIS_WEBHOOK_TOKEN>
ต้องยืนยันว่า KIS ยังส่งอีเมลจริง (delivery log บน SendGrid console + กล่องเมล KIS)

## 1. Production apply runbook (หลัง Owner approve เท่านั้น)

Migration: supabase/migrations/20261008000000_resource_transactions_canonical.sql
Scope: ตารางเดียว public.resource_transactions (+ unique index + RLS)
ไม่มี ALTER/CREATE/DROP ตารางอื่น · ไม่แตะ 20260620000000_clearinghouse_upgrade.sql
ไม่มี FK ไป public.partners แล้ว (BATCH 22 — production ไม่มีตารางนั้น)

### Step 1 — Schema snapshot (rollback point)
ผ่าน SQL editor ของ Supabase dashboard (project ref xeytcavxejhyzxwevgto):

    -- ควรตอบ relation does not exist (ยืนยัน baseline)
    -- SELECT to_regclass('public resource_transactions');
    -- หรือ pg_dump --schema-only เก็บเป็นไฟล์ถ้ามี access

### Step 2 — Apply migration
รัน SQL ทั้งก้อนในไฟล์ migration (หรือ supabase db push หลัง supabase link)

### Step 3 — Verify ทุกข้อต้องผ่าน (SQL)

    -- 3.1 table exists: SELECT to_regclass (ตอบ resource_transactions ไม่ใช่ null)
    -- 3.2 job FK: pg_constraint contype=f บนตาราง = resource_transactions_job_id_fkey
    --     (อ้าง jobs เท่านั้น — ต้องไม่มี constraint ชื่อ partner)
    -- 3.3 unique: pg_indexes มี ux_resource_transactions_source_event (unique)
    -- 3.4 RLS: pg_class.relrowsecurity = t
    --     pg_policies = resource_transactions_no_public | roles {anon,authenticated}
    --     | cmd ALL | qual false | with_check false
    -- 3.5 row count = 0 ก่อน deploy (รักษา rollback window)

### Step 4 — ตั้ง config + secrets
- machinery_rates ใส่ผ่าน settings/admin path ของแอป (ค่าจากข้อ 0.1 — เจ้าของยืนยันก่อน)
- secrets ทั้ง 3 ตัว (ข้อ 0.2) — ห้าม commit · Next .env.local รีสตาร์ทให้อ่านค่าใหม่

### Step 5 — Deploy + SendGrid + live proof
- supabase functions deploy kis-webhook (หลัง verify ทุกข้อ)
- ตั้ง destination URL ใน SendGrid Inbound Parse (ข้อ 0.3)
- ส่ง test email 1 ฉบับ → verify row ในตาราง (source_event_id ตรง + audit
  transaction.created ใน audit_logs)

## 2. Rollback / Backup summary

| ช่วง | rollback | data risk |
|---|---|---|
| apply แล้ว ยังไม่ deploy | DROP TABLE IF EXISTS public.resource_transactions CASCADE | ไม่มี (row=0) |
| deploy แล้ว (มี row) | ห้าม drop — แก้เฉพาะ policy/constraint | สูง |
| ก่อน apply | pg_dump --schema-only = rollback point | ไม่มี (ตารางยังไม่มี) |

สร้าง: BATCH 22 · ห้าม apply/deploy/ตั้ง secret จริง/เขียน machinery_rates production ใน batch นี้
