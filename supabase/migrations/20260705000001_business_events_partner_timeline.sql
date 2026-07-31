-- Partner Timeline: business_events table + link from documents
--
-- business_events คือ event จริงที่เกิดในความสัมพันธ์ธุรกิจ
-- เอกสารทุกใบเป็นแค่ "หลักฐาน" ของ event ไม่ใช่ตัว event เอง

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): public.partners is only really
-- CREATEd later (20260709000003). partner_id's FK is deferred to
-- 20260710000011_geom_columns_bootstrap_fix.sql instead of inline here, so
-- a fresh local bootstrap can create business_events at all. Also,
-- public.documents (below) has no CREATE TABLE anywhere — legacy,
-- off-record — guarded the same way it is everywhere else in this session.
CREATE TABLE IF NOT EXISTS public.business_events (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid,
  event_type    text         NOT NULL,
  -- event_type values: quotation_sent, po_received, delivery_made, invoice_issued,
  --   payment_received, credit_note_issued, line_chat, note
  event_date    date         NOT NULL DEFAULT CURRENT_DATE,
  title         text,
  description   text,
  metadata      jsonb        NOT NULL DEFAULT '{}',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- เชื่อม documents → business_events (nullable เพื่อ backward compat กับเอกสารเดิม)
DO $$ BEGIN
  IF to_regclass('public.documents') IS NOT NULL THEN
    ALTER TABLE public.documents
      ADD COLUMN IF NOT EXISTS business_event_id uuid
        REFERENCES public.business_events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- indexes สำหรับ partner timeline query
CREATE INDEX IF NOT EXISTS idx_business_events_partner_id
  ON public.business_events(partner_id);

CREATE INDEX IF NOT EXISTS idx_business_events_event_date
  ON public.business_events(event_date DESC);

DO $$ BEGIN
  IF to_regclass('public.documents') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_documents_business_event_id
      ON public.documents(business_event_id)
      WHERE business_event_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_documents_partner_id_date
      ON public.documents(partner_id, issue_date DESC)
      WHERE deleted_at IS NULL;
  END IF;
END $$;
