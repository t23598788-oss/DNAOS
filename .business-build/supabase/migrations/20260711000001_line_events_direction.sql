-- line_events only ever logged INBOUND customer messages — everything the
-- bot itself replied via ResponseGateway (response.ts) was sent straight to
-- the LINE API and never written to the DB. That means no screen could ever
-- show a real two-sided conversation (owner request 2026-07-11: make the
-- admin chat view look like the real LINE app, both sides visible).

alter table public.line_events
  add column if not exists direction text not null default 'in';

alter table public.line_events
  add constraint line_events_direction_check check (direction in ('in', 'out'));

create index if not exists line_events_direction_idx on public.line_events (direction);
