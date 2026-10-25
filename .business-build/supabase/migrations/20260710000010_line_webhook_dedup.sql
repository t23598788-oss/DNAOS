-- LINE redelivers webhooks on any timeout/network hiccup. Without an
-- idempotency check, a redelivered event gets processed twice and the bot
-- repeats its reply to the customer (owner-reported bug 2026-07-10:
-- "แผ่นเสียงตกร่อง" — message spam). webhookEventId is LINE's own dedup key,
-- present on every event type (message, follow, postback, etc.), unlike
-- message.id which only exists on message events.

alter table public.line_events
  add column if not exists line_webhook_event_id text;

create unique index if not exists line_events_webhook_event_id_key
  on public.line_events (line_webhook_event_id)
  where line_webhook_event_id is not null;
