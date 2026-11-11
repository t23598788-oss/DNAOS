-- Rollback for 20260804000007_ai_connection_stage1.sql
-- Not an auto-applied migration (no timestamp-ordered filename collision
-- risk intended) — kept alongside the forward migration per the requested
-- deliverable, run manually only if Stage 1 needs to be reverted.
--
-- Safe by construction: this migration was purely additive, so rollback is
-- purely subtractive of the same additions — no 'manual' row's token,
-- label, scopes, or any other pre-existing column/data is touched.
--
-- Explicit required cleanup order, if a system connection was ever created
-- (Stage 1 itself never creates one — see the parent migration's header):
--   1. Revoke the api_tokens row (connection_kind='system') via the app's
--      normal revoke path — do NOT hard-delete the row directly.
--   2. Delete the underlying Vault secret via
--      ai_connection_vault_delete(vault_secret_id) (or raw
--      `delete from vault.secrets` if the wrapper is already gone) BEFORE
--      running this rollback — once this rollback drops the wrapper
--      functions, the app has no remaining path to reach vault.secrets at
--      all, so an un-deleted secret becomes permanently orphaned (not
--      unreadable — vault.secrets rows persist independently of these
--      functions — just unreachable through any code this repo ships).
--   3. THEN run this rollback script.
--
-- Both guards below are independent and both must pass:
--   - no api_tokens row (revoked or not) with connection_kind='system'
--   - no vault.secrets row matching this feature's naming convention
--     ('ai-connection-%', per services/ai-connection/manager.ts's
--     vaultWriteSecret call) — checked directly against vault.secrets,
--     not just inferred from the api_tokens side, since the two could in
--     principle drift out of sync (e.g. a row deleted instead of revoked).

DO $$
DECLARE
  orphaned_secret_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.api_tokens WHERE connection_kind = 'system') THEN
    RAISE EXCEPTION 'Refusing to roll back: at least one connection_kind=system row exists (revoked or not). Revoke it and delete its Vault secret first, then re-run this rollback.';
  END IF;

  SELECT count(*) INTO orphaned_secret_count
  FROM vault.secrets
  WHERE name LIKE 'ai-connection-%';

  IF orphaned_secret_count > 0 THEN
    RAISE EXCEPTION 'Refusing to roll back: % Vault secret(s) matching ai-connection-%% still exist. Delete them via ai_connection_vault_delete() first (rollback removes that function), then re-run this rollback.', orphaned_secret_count;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.ai_connection_vault_delete(uuid);
DROP FUNCTION IF EXISTS public.ai_connection_vault_read(uuid);
DROP FUNCTION IF EXISTS public.ai_connection_vault_write(text, text, text);

DROP TABLE IF EXISTS public.ai_connection_status;

DROP INDEX IF EXISTS public.api_tokens_one_active_system_connection;

ALTER TABLE public.api_tokens
  DROP CONSTRAINT IF EXISTS api_tokens_connection_kind_shape;

ALTER TABLE public.api_tokens
  DROP COLUMN IF EXISTS vault_secret_id,
  DROP COLUMN IF EXISTS token_hash,
  DROP COLUMN IF EXISTS connection_kind;

-- Restoring NOT NULL on token is safe only if no NULL-token rows exist
-- (true after the above, since only connection_kind=system rows could have
-- had a null token, and none exist per the guard above).
ALTER TABLE public.api_tokens
  ALTER COLUMN token SET NOT NULL;
