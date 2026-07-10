-- Direct LINE-contact-to-company link, since matching by display name alone
-- fails whenever someone's LINE name doesn't match their registered company
-- name (e.g. "PIYAKUN" is really บริษัท คชสิงห์ จำกัด (เฮียตุ้ม) — owner-confirmed
-- 2026-07-10, not something name-matching could ever have found). Nullable,
-- manually set — never auto-guessed.

alter table public.companies add column if not exists line_user_id text;
create index if not exists companies_line_user_id_idx on public.companies (line_user_id);
