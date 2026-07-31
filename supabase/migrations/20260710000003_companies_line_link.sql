-- Direct LINE-contact-to-company link, since matching by display name alone
-- fails whenever someone's LINE name doesn't match their registered company
-- name (e.g. "PIYAKUN" is really บริษัท คชสิงห์ จำกัด (เฮียตุ้ม) — owner-confirmed
-- 2026-07-10, not something name-matching could ever have found). Nullable,
-- manually set — never auto-guessed.

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): public.companies has no CREATE
-- TABLE in any migration — legacy table, created directly against
-- production, off-record. Guarded so a fresh local bootstrap doesn't fail
-- here; real pg_dump import later brings in the actual table (and this
-- column, already present in production). No-op change in production.
do $$ begin
  if to_regclass('public.companies') is not null then
    alter table public.companies add column if not exists line_user_id text;
    create index if not exists companies_line_user_id_idx on public.companies (line_user_id);
  end if;
end $$;
