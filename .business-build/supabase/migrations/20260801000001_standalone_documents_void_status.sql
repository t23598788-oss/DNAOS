-- Void support for standalone_documents (owner, 2026-08-01)
-- Real incident: a wrong-company invoice (INV-20260731-225) and a receipt
-- issued with zero real payment (REC-20260731-302) both need to be marked
-- void — Rule 113 (Document Immutability) says void + reissue, never
-- delete/edit, but standalone_documents had no status column at all to do
-- that with (a real, pre-existing gap CLAUDE.md's own Rule 113 note already
-- flagged honestly: no mechanical enforcement yet).
alter table public.standalone_documents
  add column if not exists status text not null default 'active',
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz;

alter table public.standalone_documents
  drop constraint if exists standalone_documents_status_check;
alter table public.standalone_documents
  add constraint standalone_documents_status_check check (status in ('active', 'void'));
