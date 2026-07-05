-- Transaction State Machine
--
-- transactions คือ lifecycle ของงาน 1 ชิ้นกับ partner คนนึง
-- เอกสารทุกใบในงานนั้นผูกกับ transaction เดียวกัน
-- state ของ transaction บอกว่างานไปถึงขั้นไหนแล้ว
--
-- state flow:
--   initiated → delivered → invoiced → paid → receipted → closed
--   initiated → invoiced (กรณีไม่มีการส่งของ เช่น บริการ)

CREATE TABLE IF NOT EXISTS public.transactions (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid         REFERENCES public.partners(id) ON DELETE SET NULL,
  title            text,
  state            text         NOT NULL DEFAULT 'initiated',
  -- state: initiated | delivered | invoiced | paid | receipted | closed
  state_changed_at timestamptz  NOT NULL DEFAULT now(),
  net_amount       numeric(14,2),
  metadata         jsonb        NOT NULL DEFAULT '{}',
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Link documents → transaction (nullable เพื่อ backward compat)
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS transaction_id uuid
    REFERENCES public.transactions(id) ON DELETE SET NULL;

-- Link business_events → transaction
ALTER TABLE public.business_events
  ADD COLUMN IF NOT EXISTS transaction_id uuid
    REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_partner_id
  ON public.transactions(partner_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_state
  ON public.transactions(state)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_transaction_id
  ON public.documents(transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_events_transaction_id
  ON public.business_events(transaction_id)
  WHERE transaction_id IS NOT NULL;
