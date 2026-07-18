-- Auto-classified receipt/bill photos (owner, 2026-07-17): when a customer/
-- staff member sends a photo of a receipt, tax invoice, fuel bill, transfer
-- slip, weight slip etc. via LINE, AI reads it (OCR) and classifies it —
-- this table is the real, persisted result, one row per classified image.
-- Separate from `invoices`/`standalone_documents` (our own OUTGOING documents
-- to customers) — this is INCOMING documents customers/staff send to us.
create table if not exists public.receipt_documents (
  id               uuid primary key default gen_random_uuid(),
  line_event_id    uuid not null references public.line_events(id) on delete cascade,
  media_path       text not null,
  document_type    text not null default 'other', -- receipt | tax_invoice | invoice | fuel_bill | transfer_slip | weight_slip | other
  vendor_name      text,                            -- "บริษัท: ปตท." on the card
  amount           numeric,
  document_date    date,
  confidence       numeric,                          -- 0-1, how sure the classifier was
  status           text not null default 'ai_read',  -- ai_read | confirmed | rejected
  raw_ocr_text     text,                              -- full extracted text, kept for audit — never shown as the primary display, per Human Reality Timeline
  error_th         text,                              -- set when classification failed, so the card can say why instead of just being silently absent
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists receipt_documents_line_event_id_idx on public.receipt_documents (line_event_id);

alter table public.receipt_documents enable row level security;
drop policy if exists service_role_only on public.receipt_documents;
create policy service_role_only on public.receipt_documents for all using (false);
