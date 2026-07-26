-- receipt_documents assumed every real receipt originates from a LINE
-- message (line_event_id NOT NULL) — found false live 2026-07-25 while
-- backfilling 375 real slip images from local folders (K PLUS/K BIZ/
-- TrueMoney screenshots) that were never sent through LINE. Real receipts
-- can legitimately arrive from other real sources (local backfill today;
-- possibly direct upload/other channels later) — line_event_id records
-- provenance when it IS from LINE, not a universal requirement.
alter table public.receipt_documents alter column line_event_id drop not null;
