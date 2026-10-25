-- Deterministic customer signals (owner, 2026-07-25 — "แยกย่อยลงไปอีก...
-- ต้องกรองให้แม่นก่อนถึง LLM...ช่วงเวลาทิ้งช่วง ความชอบการตอบ") — response
-- timing is a REAL, computable fact (real timestamp deltas in line_events),
-- not something an AI should guess/infer from reading a wall of text. This
-- is a separate, deterministic filtering stage that runs BEFORE any LLM
-- call, alongside the freeform AI-written `notes` (behavioral memory added
-- in 20260725000005) — two different kinds of "knowing a customer": one
-- computed and verified, one impressionistic and AI-written. Never conflate
-- the two; the LLM prompt cites both but only trusts the computed columns
-- as fact.
alter table public.line_customer_memory
  add column if not exists message_count integer not null default 0,
  add column if not exists avg_response_gap_minutes numeric,
  add column if not exists last_message_at timestamptz;
