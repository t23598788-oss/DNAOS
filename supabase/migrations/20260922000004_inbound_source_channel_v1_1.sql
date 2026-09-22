-- ============================================================================
-- Canonical v1.1 — Phase D6 addition: inbound source channel (ADDITIVE ONLY)
--
-- Phase D6 requires the real inbound channel to be recorded on the inbound record
-- (LINE / upload / email / bank / drive). `receipt_documents` had `line_event_id`
-- for LINE but no channel column, so the fact could not be stored at all.
-- This is an additive column + guarded constraint; nothing is dropped or renamed.
-- ============================================================================

alter table public.receipt_documents
  add column if not exists source_channel text null;

do $$
begin
  alter table public.receipt_documents
    add constraint receipt_documents_source_channel_chk
    check (source_channel is null or source_channel in ('line','upload','email','bank','drive'));
exception when duplicate_object then null;
end $$;

create index if not exists receipt_documents_source_channel_idx on public.receipt_documents (source_channel);
