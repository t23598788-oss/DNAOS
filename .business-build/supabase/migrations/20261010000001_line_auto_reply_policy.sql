-- Central Customer Auto-Reply Policy row (owner mission 2026-10-10,
-- "RESTORE LINE WEBHOOK, CONNECT AND AUTO-RESPONSE" item 5: allow replies to
-- general LINE users VIA THE CENTRAL POLICY — not by deleting the security).
--
-- Who reads it: supabase/functions/line-webhook-v2/engines/response.ts
-- #loadAutoReplyPolicy — the single recipient gate every reply/push/loading
-- funnels through. Values:
--   'owner_only' -> legacy behaviour (hardcoded gate semantics, fail-closed default)
--   'allow_all'  -> every LINE user may receive bot replies/pushes
--
-- The Edge code fails CLOSED to 'owner_only' when this row is missing or
-- unreadable, so this migration is safe to re-run and its value is the Owner's
-- runtime switch (app_configs is admin-editable in the existing settings UI):
-- flipping back to 'owner_only' restores the old posture without a deploy.
--
-- on conflict DO NOTHING on purpose: re-applying the migration must never
-- clobber an Owner's later runtime choice.

insert into public.app_configs (title, data)
values ('line-auto-reply-policy', 'allow_all')
on conflict (title) do nothing;
