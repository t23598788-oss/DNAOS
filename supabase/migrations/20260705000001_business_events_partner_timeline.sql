-- Partner Timeline: business_events table + link from documents
--
-- business_events คือ event จริงที่เกิดในความสัมพันธ์ธุรกิจ
-- เอกสารทุกใบเป็นแค่ "หลักฐาน" ของ event ไม่ใช่ตัว event เอง

CREATE TABLE IF NOT EXISTS public.business_events (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid         REFERENCES public.partners(id) ON DELETE SET NULL,
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
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS business_event_id uuid
    REFERENCES public.business_events(id) ON DELETE SET NULL;

-- indexes สำหรับ partner timeline query
CREATE INDEX IF NOT EXISTS idx_business_events_partner_id
  ON public.business_events(partner_id);

CREATE INDEX IF NOT EXISTS idx_business_events_event_date
  ON public.business_events(event_date DESC);

CREATE INDEX IF NOT EXISTS idx_documents_business_event_id
  ON public.documents(business_event_id)
  WHERE business_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_partner_id_date
  ON public.documents(partner_id, issue_date DESC)
  WHERE deleted_at IS NULL;
