-- ============================================================================
-- Seed DNA OS itself as a company of type CORE
-- ============================================================================
-- Why this exists: the schema has always had `CompanyType.CORE` and never had a
-- row (or any code) that used it, so "who issued this document?" had no possible
-- answer other than "the system". This inserts the platform as a real, addressable
-- party so that `issuer_company_id` (20261109181000) can point at it.
--
-- Reserved, fixed id: 00000000-0000-0000-0000-00000000d0a0
-- It is duplicated in exactly one code constant — core/party/platform-company.ts —
-- and nowhere else.
--
-- Idempotent twice over:
--   * `on conflict (id) do nothing`                → safe to re-run
--   * `where not exists (... type = 'CORE')`       → never creates a SECOND CORE company
--
-- Placeholders a human must complete later (all nullable, all identity/billing
-- data the platform's own legal entity owns — deliberately left unset rather
-- than invented):
--   tax_id, address, phone, email, bank_name, bank_account_no
--
-- `updated_at` has no default in the baseline and is NOT NULL, so it is set
-- explicitly to the seed time. `status` defaults to ACTIVE.
-- ============================================================================

insert into public.companies (id, name, type, status, created_at, updated_at)
select
  '00000000-0000-0000-0000-00000000d0a0'::uuid,
  'DNA OS',
  'CORE'::public."CompanyType",
  'ACTIVE'::public."CompanyStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
where not exists (
  select 1 from public.companies where type = 'CORE'::public."CompanyType"
)
on conflict (id) do nothing;
