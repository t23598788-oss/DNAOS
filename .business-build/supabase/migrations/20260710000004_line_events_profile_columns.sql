-- line_name/line_picture were added ad-hoc via `supabase db query --linked` during
-- manual profile backfill on 2026-07-10 (never tracked in a migration file). Adding
-- here for reproducibility now that events/store.ts writes them on every save, not
-- just at manual-backfill time.

alter table public.line_events add column if not exists line_name text;
alter table public.line_events add column if not exists line_picture text;
