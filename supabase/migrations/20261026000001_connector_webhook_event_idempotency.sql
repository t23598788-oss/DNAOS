-- Webhook redelivery must never create a second event row.
--
-- Before this migration `recordWebhookEvent` did a plain INSERT, so any provider
-- that retries (all of them do, on timeout or non-2xx) produced duplicate rows
-- and no dedup was possible (owner security audit 2026-10-26, finding C5).
--
-- `event_key` is derived by app/api/connectors/webhook/[slug]/_lib/webhookGate.ts:
-- the provider's own event id when the connector declares `config.event_id_path`,
-- otherwise the SHA-256 of the signature-verified raw body. Rows written before
-- this migration keep event_key = NULL and are exempt from the unique index.

alter table public.connector_webhook_events
  add column if not exists event_key text;

-- NOTE: this index must NOT be partial. `recordWebhookEvent` upserts with
-- ON CONFLICT (connector_id, event_key), and Postgres cannot infer a partial
-- index for that clause (first attempt was partial and every verified webhook
-- answered 500 "no unique or exclusion constraint matching the ON CONFLICT
-- specification" on the 2026-10-26 deploy). Legacy rows have event_key NULL and
-- NULLs are distinct in a unique index, so no predicate is needed.
drop index if exists public.connector_webhook_events_connector_event_key;

create unique index connector_webhook_events_connector_event_key
  on public.connector_webhook_events (connector_id, event_key);

comment on column public.connector_webhook_events.event_key is
  'Idempotency key: provider event id (config.event_id_path) or sha256 of the verified raw body. Unique per connector.';
