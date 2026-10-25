-- ============================================================================
-- PROPOSED source_channel vocabulary expansion — Meta file/document receive
-- (owner channel-expansion, 2026-10-07) — **DRAFT / NOT APPLIED**
--
-- WHY: the required receive path for slips/documents from the new channels is
--   channel → adapter → Connect → canonical inbound writer → await review.
-- receipt_documents_source_channel_chk (20260922000004) only allows
-- ('line','upload','email','bank','drive'). 'facebook' and 'instagram' are NOT
-- in the vocabulary — per owner instruction the data must NOT be stamped
-- 'upload' to dodge the constraint; the contract is proposed for expansion
-- BEFORE any real DB use.
--
-- WHAT THIS UNLOCKS (only after owner applies it):
--   * the Meta document leg can call /api/internal/connect/inbound-source with
--     channel 'facebook'/'instagram' once a Meta Page/IG access token exists
--     to download the attachment (THAT credential is still missing — see
--     channel report 2026-10-07; without it the inbound leg stays NOT WIRED)
--   * backfill/local-machine files keep using 'upload' with media_path
--     local_backfill:<path> (origin preserved — already wired, no change)
--   * Google Drive watcher keeps 'drive' (already allowed — no change)
--
-- IMPACT:
--   * additive CHECK extension only — no column/table change, no data rewrite
--   * ALLOWED_CHANNELS arrays in
--       app/api/internal/connect/inbound-source/route.ts
--       app/api/admin/receipt-documents/route.ts
--     and InboundChannel in engines/canonical/inbound-write.ts must be extended
--     in the SAME release (code change rides with this migration — owner-
--     approved follow-up, not part of this draft)
--   * readers filtering source_channel by the old five values are unaffected
--     (new values simply do not match their filters)
--   * rollback: restore the previous CHECK value list
--
-- RELEASE ORDER: apply migration → extend the three allow-lists in code →
-- then wire the Meta document-download leg (which itself still needs Meta
-- Page/IG credentials). NOTHING writes the new values until all three land.
-- NOT APPLIED by this change — owner reviews and runs it explicitly.
-- ============================================================================

do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.receipt_documents'::regclass
      and contype = 'c'
      and conname like '%source_channel%'
  loop
    execute format('alter table public.receipt_documents drop constraint %I', c);
  end loop;
end $$;

alter table public.receipt_documents
  add constraint receipt_documents_source_channel_chk
  check (source_channel is null or source_channel in ('line','upload','email','bank','drive','facebook','instagram'));

comment on constraint receipt_documents_source_channel_chk on public.receipt_documents is
  'Inbound channel vocabulary for receipt_documents. ' ||
  'Proposed 2026-10-07 (facebook/instagram) — see 20261007000002_propose_source_channel_meta.sql BEFORE applying. ' ||
  'Original: 20260922000004_inbound_source_channel_v1_1.sql.';
