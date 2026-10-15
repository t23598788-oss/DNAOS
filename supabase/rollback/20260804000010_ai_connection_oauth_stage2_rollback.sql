-- Rollback for 20260804000010_ai_connection_oauth_stage2.sql
-- Not auto-applied — run manually only if Stage 2 needs reverting.
-- Safe by construction: purely additive tables, no existing data touched.
-- Refuses if any non-revoked client or refresh token still exists, so a
-- live pairing isn't silently destroyed.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.oauth_clients WHERE revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Refusing to roll back: at least one non-revoked oauth_clients row exists. Revoke it first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.oauth_refresh_tokens WHERE revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Refusing to roll back: at least one non-revoked oauth_refresh_tokens row exists. Revoke it first.';
  END IF;
END $$;

DROP TABLE IF EXISTS public.oauth_refresh_tokens;
DROP TABLE IF EXISTS public.oauth_authorization_codes;
DROP TABLE IF EXISTS public.oauth_clients;
