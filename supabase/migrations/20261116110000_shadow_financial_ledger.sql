-- DNA OS adapter-scoped shadow financial ledger.
-- Draft migration only: do not apply to production until the accounting
-- contract, currency policy, and atomic write path have been reviewed.
-- This does not replace legacy invoices, settlements, transactions, or
-- company_expenses, and it is not by itself proof of bank/ERP reconciliation.
-- adapter_id is an opaque UUID for system.system_adapters and is validated by
-- the application boundary, consistent with the current cross-schema policy.

begin;

create table public.financial_accounts (
  account_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  external_account_key text not null
    check (length(btrim(external_account_key)) between 1 and 240),
  account_code text not null
    check (length(btrim(account_code)) between 1 and 80),
  account_name text not null
    check (length(btrim(account_name)) between 1 and 240),
  account_type text not null check (account_type in (
    'asset', 'liability', 'equity', 'revenue', 'expense', 'clearing', 'other'
  )),
  normal_balance text not null check (normal_balance in ('DR', 'CR')),
  parent_account_id uuid,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default now(),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  unique (adapter_id, external_account_key),
  unique (adapter_id, account_code),
  unique (account_id, adapter_id),
  constraint financial_accounts_parent_same_adapter_fk
    foreign key (parent_account_id, adapter_id)
    references public.financial_accounts (account_id, adapter_id)
    on update restrict on delete restrict,
  constraint financial_accounts_not_own_parent_ck
    check (parent_account_id is null or parent_account_id <> account_id)
);

create index financial_accounts_adapter_type_idx
  on public.financial_accounts (adapter_id, account_type, is_active);

create table public.financial_journal_entries (
  journal_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 240),
  external_transaction_key text not null
    check (length(btrim(external_transaction_key)) between 1 and 240),
  transaction_ref text,
  description text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source_event_id uuid,
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  unique (adapter_id, idempotency_key),
  unique (adapter_id, external_transaction_key),
  unique (journal_id, adapter_id)
);

create index financial_journal_entries_adapter_time_idx
  on public.financial_journal_entries (adapter_id, occurred_at desc);
create index financial_journal_entries_source_event_idx
  on public.financial_journal_entries (source_event_id)
  where source_event_id is not null;

create table public.financial_postings (
  posting_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  journal_id uuid not null,
  account_id uuid not null,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 240),
  external_line_key text not null
    check (length(btrim(external_line_key)) between 1 and 240),
  direction text not null check (direction in ('DR', 'CR')),
  amount numeric(19, 4) not null check (amount > 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  description text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  unique (adapter_id, idempotency_key),
  unique (adapter_id, external_line_key),
  constraint financial_postings_journal_adapter_fk
    foreign key (journal_id, adapter_id)
    references public.financial_journal_entries (journal_id, adapter_id)
    on update restrict on delete restrict,
  constraint financial_postings_account_adapter_fk
    foreign key (account_id, adapter_id)
    references public.financial_accounts (account_id, adapter_id)
    on update restrict on delete restrict
);

create index financial_postings_journal_idx
  on public.financial_postings (adapter_id, journal_id, currency_code);
create index financial_postings_account_time_idx
  on public.financial_postings (adapter_id, account_id, occurred_at desc);

-- This is a transactionally maintained balance projection table, rather than
-- a PostgreSQL MATERIALIZED VIEW: a materialized view cannot refresh itself
-- atomically after every posting without an explicit refresh operation.
create table public.financial_balances (
  adapter_id uuid not null,
  account_id uuid not null,
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  debit_total numeric(38, 4) not null default 0 check (debit_total >= 0),
  credit_total numeric(38, 4) not null default 0 check (credit_total >= 0),
  net_balance numeric(38, 4) generated always as (debit_total - credit_total) stored,
  updated_at timestamptz not null default now(),
  primary key (adapter_id, account_id, currency_code),
  constraint financial_balances_account_adapter_fk
    foreign key (account_id, adapter_id)
    references public.financial_accounts (account_id, adapter_id)
    on update restrict on delete restrict
);

create index financial_balances_account_idx
  on public.financial_balances (adapter_id, account_id);

create or replace function public.reject_financial_ledger_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception '% is append-only; insert a compensating journal instead',
    tg_table_name
    using errcode = '55000';
end;
$$;

create trigger financial_postings_append_only
before update or delete on public.financial_postings
for each row execute function public.reject_financial_ledger_mutation();

create trigger financial_journal_entries_append_only
before update or delete on public.financial_journal_entries
for each row execute function public.reject_financial_ledger_mutation();

create or replace function public.apply_financial_posting_to_balance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.financial_balances (
    adapter_id, account_id, currency_code, debit_total, credit_total, updated_at
  ) values (
    new.adapter_id,
    new.account_id,
    new.currency_code,
    case when new.direction = 'DR' then new.amount else 0 end,
    case when new.direction = 'CR' then new.amount else 0 end,
    now()
  )
  on conflict (adapter_id, account_id, currency_code) do update
  set debit_total = public.financial_balances.debit_total + excluded.debit_total,
      credit_total = public.financial_balances.credit_total + excluded.credit_total,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

create trigger financial_postings_update_balance
after insert on public.financial_postings
for each row execute function public.apply_financial_posting_to_balance();

create or replace function public.assert_financial_journal_balanced()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_journal_id uuid := new.journal_id;
  v_adapter_id uuid := new.adapter_id;
begin
  if not exists (
    select 1
    from public.financial_postings p
    where p.journal_id = v_journal_id
      and p.adapter_id = v_adapter_id
  ) then
    raise exception 'financial journal % must contain postings', v_journal_id
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.financial_postings p
    where p.journal_id = v_journal_id
      and p.adapter_id = v_adapter_id
    group by p.currency_code
    having count(*) < 2
       or coalesce(sum(p.amount) filter (where p.direction = 'DR'), 0)
          <> coalesce(sum(p.amount) filter (where p.direction = 'CR'), 0)
  ) then
    raise exception 'financial journal % must balance debit and credit per currency',
      v_journal_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

-- Header and all its postings must be written in one database transaction.
-- Deferred checks see the completed transaction and reject partial journals.
create constraint trigger financial_journal_entries_balanced_ck
after insert on public.financial_journal_entries
deferrable initially deferred
for each row execute function public.assert_financial_journal_balanced();

create constraint trigger financial_postings_balanced_ck
after insert on public.financial_postings
deferrable initially deferred
for each row execute function public.assert_financial_journal_balanced();

alter table public.financial_accounts enable row level security;
alter table public.financial_journal_entries enable row level security;
alter table public.financial_postings enable row level security;
alter table public.financial_balances enable row level security;

revoke all on public.financial_accounts from public, anon, authenticated;
revoke all on public.financial_journal_entries from public, anon, authenticated;
revoke all on public.financial_postings from public, anon, authenticated;
revoke all on public.financial_balances from public, anon, authenticated;
revoke all on function public.reject_financial_ledger_mutation() from public, anon, authenticated;
revoke all on function public.apply_financial_posting_to_balance() from public, anon, authenticated;
revoke all on function public.assert_financial_journal_balanced() from public, anon, authenticated;

grant select, insert, update on public.financial_accounts to service_role;
grant select, insert on public.financial_journal_entries to service_role;
grant select, insert on public.financial_postings to service_role;
grant select on public.financial_balances to service_role;

comment on table public.financial_accounts is
  'Adapter-scoped shadow chart of accounts; external_account_key is the source-system identity.';
comment on table public.financial_journal_entries is
  'Append-only journal headers; the header and all postings must be inserted atomically.';
comment on table public.financial_postings is
  'Append-only double-entry lines. DR and CR totals must balance per journal and currency.';
comment on table public.financial_balances is
  'Transactionally maintained projection of debit_total - credit_total; not a PostgreSQL materialized view.';
comment on column public.financial_accounts.adapter_id is
  'Opaque UUID corresponding to system.system_adapters.adapter_id; validated at the application boundary.';

commit;
