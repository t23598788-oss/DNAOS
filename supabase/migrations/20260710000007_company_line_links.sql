-- One real person/company can have MORE THAN ONE LINE account (owner
-- instruction 2026-07-10: ช่างมิก added a second LINE account "mixkung civil"
-- — same person, same company เคที, but companies.line_user_id can only hold
-- one value, so the old link would've been overwritten and lost). A LINE
-- account still belongs to exactly one company (unique on line_user_id).

create table if not exists public.company_line_links (
  company_id    uuid not null references public.companies(id),
  line_user_id  text not null,
  created_at    timestamptz not null default now(),
  primary key (company_id, line_user_id)
);

create unique index if not exists company_line_links_line_user_id_uidx on public.company_line_links (line_user_id);

alter table public.company_line_links enable row level security;
drop policy if exists service_role_only on public.company_line_links;
create policy service_role_only on public.company_line_links for all using (false);

-- Backfill from the existing single-value column so nothing already linked breaks.
insert into public.company_line_links (company_id, line_user_id)
select id, line_user_id from public.companies where line_user_id is not null
on conflict do nothing;
