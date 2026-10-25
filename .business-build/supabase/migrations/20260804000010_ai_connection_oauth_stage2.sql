-- AI Connection Management — Stage 2: OAuth 2.1 pairing for Remote HTTP MCP.
-- Owner-approved (2026-08-04), built against the real MCP Authorization spec
-- (2025-06-18: OAuth 2.1 draft-ietf-oauth-v2-1-13 + RFC 8414 + RFC 9728 +
-- RFC 7591 + RFC 8707), not an ad-hoc scheme. DNA OS acts as both Resource
-- Server and Authorization Server on the same origin (spec explicitly
-- permits this).
--
-- Purely additive on top of Stage 1 (20260804000007) — no existing table,
-- column, or row is altered. Reuses Stage 1's token_hash/vault_secret_id
-- storage pattern for refresh tokens (never both, never neither).
--
-- Access tokens are NOT stored anywhere — stateless signed JWT (HS256,
-- AI_CONNECTION_JWT_SIGNING_SECRET, server-only), short-lived (~30 min),
-- containing aud (canonical resource URI), sub (client_id), scope
-- (always "read" — Stage 2 issues no write scope, same Rule 72 posture as
-- every other surface built in this project).

CREATE TABLE public.oauth_clients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  client_name    text NOT NULL,
  redirect_uris  text[] NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);
COMMENT ON TABLE public.oauth_clients IS
  'RFC 7591 Dynamic Client Registration — public clients only (no client secret; PKCE is the protection). redirect_uris are matched EXACTLY at /oauth/authorize, never by prefix/wildcard.';

CREATE TABLE public.oauth_authorization_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash        text NOT NULL UNIQUE,
  client_id        text NOT NULL REFERENCES public.oauth_clients(client_id),
  redirect_uri     text NOT NULL,
  code_challenge   text NOT NULL,
  resource         text NOT NULL,
  expires_at       timestamptz NOT NULL,
  approved_by      uuid REFERENCES public.profiles(id),
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.oauth_authorization_codes IS
  'Single-use (consumed_at) authorization codes, ~60s TTL. code_hash not the raw code (HMAC via services/ai-connection/hmac.ts) — the raw code only ever exists in the redirect URL and the immediate token-exchange request.';

CREATE INDEX idx_oauth_authorization_codes_client ON public.oauth_authorization_codes(client_id);

CREATE TABLE public.oauth_refresh_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        text NOT NULL REFERENCES public.oauth_clients(client_id),
  family_id        uuid NOT NULL,
  token_hash       text,
  vault_secret_id  uuid,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  replaced_by      uuid REFERENCES public.oauth_refresh_tokens(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (token_hash IS NOT NULL AND vault_secret_id IS NULL)
    OR
    (token_hash IS NULL AND vault_secret_id IS NOT NULL)
  )
);
COMMENT ON TABLE public.oauth_refresh_tokens IS
  'Rotating refresh tokens, grouped by family_id. On each use the presented token is revoked and replaced_by points to the new row. Reuse of an already-revoked token in the same family is a theft signal — the caller must revoke the entire family (all rows sharing family_id), not just the one row.';

CREATE INDEX idx_oauth_refresh_tokens_family ON public.oauth_refresh_tokens(family_id);
CREATE INDEX idx_oauth_refresh_tokens_client ON public.oauth_refresh_tokens(client_id);

ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.oauth_clients USING (false);

ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.oauth_authorization_codes USING (false);

ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.oauth_refresh_tokens USING (false);
