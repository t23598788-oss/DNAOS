-- One document structure for every non-invoice document type.
-- Existing standalone_documents remain valid; new and edited documents can
-- now preserve the same line-item form used by invoices and artifacts.
create table if not exists public.standalone_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.standalone_documents(id) on delete cascade,
  description text not null,
  qty numeric not null default 1,
  unit text not null default 'รายการ',
  unit_price numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists standalone_document_items_document_id_idx
  on public.standalone_document_items(document_id, sort_order);

alter table public.standalone_document_items enable row level security;
drop policy if exists service_role_only on public.standalone_document_items;
create policy service_role_only on public.standalone_document_items for all using (false);
