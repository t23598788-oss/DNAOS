-- supabase/functions/line-webhook-v2/events/store.ts has always written to this
-- table (single save point for every inbound LINE event) but it was never
-- created — every webhook call would have failed at saveEvent(). Schema
-- matches store.ts's insert exactly (2026-07-09).

create table if not exists public.line_events (
  id               uuid primary key default gen_random_uuid(),
  line_user_id     text,
  group_id         text,
  raw_type         text not null,
  raw_text         text,
  reply_token      text,
  line_message_id  text,
  event_timestamp  timestamptz,
  status           text not null default 'new',
  extracted        jsonb,
  raw_json         jsonb,
  admin_note       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists line_events_line_user_id_idx on public.line_events (line_user_id);
create index if not exists line_events_status_idx on public.line_events (status);

alter table public.line_events enable row level security;
drop policy if exists service_role_only on public.line_events;
create policy service_role_only on public.line_events for all using (false);
