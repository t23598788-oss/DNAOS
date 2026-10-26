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

create unique index if not exists connector_webhook_events_connector_event_key
  on public.connector_webhook_events (connector_id, event_key)
  where event_key is not null;

comment on column public.connector_webhook_events.event_key is
  'Idempotency key: provider event id (config.event_id_path) or sha256 of the verified raw body. Unique per connector.';
