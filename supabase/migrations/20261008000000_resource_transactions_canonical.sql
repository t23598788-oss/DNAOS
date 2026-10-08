-- BATCH 20/22 — resource_transactions canonical table + idempotency (SCOPE-LIMITED).
--
-- แยกจาก 20260620000000_clearinghouse_upgrade.sql โดยเจตนา: migration นั้น
-- มี jobs bootstrap + geom functions/triggers/index ที่ไม่เกี่ยว — ห้าม apply
-- ทั้งก้อน (DIFF PLAN BATCH 19) · migration นี้แตะเฉพาะตารางเดียว
--
-- NOT APPLIED YET — ต้องได้รับอนุมัติก่อน run (see
-- project/docs/kis-resource-transaction-apply-runbook.md).
--
-- Schema: ลอกจาก 20260620 line107-131 + source_event_id (idempotency key ของ
-- canonical writer engines/canonical/resource-transaction-write.ts) + UNIQUE
-- index + RLS deny-all (service-role only — ไม่ expose anon/authenticated).
--
-- BATCH 22 DECISION — partner_id คงเป็น nullable column เปล่า ๆ โดยไม่มี FK:
--   · production ปัจจุบันไม่มีตาราง partners legacy อีกต่อไป (มีแค่ companies —
--     PGRST205 x3 ยืนยัน BATCH 21) — FK จะทำให้ migration ทั้งก้อน fail
--   · canonical writer ส่ง partner_id: null เสมอ — ยังไม่มี code path ใช้ relation
--   · ห้ามเปลี่ยนไปอ้าง companies ใน batch นี้ จนกว่าจะมี evidence ว่า
--     company = partner semantics ทุกกรณี

CREATE TABLE IF NOT EXISTS public.resource_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
    partner_id UUID,
    resource_type VARCHAR NOT NULL,
    resource_label VARCHAR NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0,
    unit VARCHAR NOT NULL,
    unit_cost NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    markup_margin NUMERIC NOT NULL DEFAULT 0,
    total_cost NUMERIC NOT NULL DEFAULT 0,
    total_price NUMERIC NOT NULL DEFAULT 0,
    note TEXT,
    meta JSONB DEFAULT '{}'::jsonb,
    -- Idempotency key ของ canonical writer (BATCH 19 design): แถวเดียวต่อ
    -- source event เดียว — duplicate email/SendGrid retry ไม่มีวัน insert ซ้ำ
    source_event_id TEXT NOT NULL
);

-- Idempotency ระดับ DB (canonical writer ยิงค่าเดียวกันซ้ำ = unique violation
-- ที่ writer แปลงเป็น duplicate:return-existing เอง)
CREATE UNIQUE INDEX IF NOT EXISTS ux_resource_transactions_source_event
    ON public.resource_transactions (source_event_id);

-- RLS deny-all: ตารางนี้มีเฉพาะ service-role (canonical writer เท่านั้น)
ALTER TABLE public.resource_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'resource_transactions' AND policyname = 'resource_transactions_no_public'
    ) THEN
        CREATE POLICY resource_transactions_no_public ON public.resource_transactions
            FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
    END IF;
END $$;
