/**
 * AI Connection Stage 2 — OAuth 2.1 core logic (RFC 8414/9728/7591/8707
 * compliant, per the real MCP Authorization spec, 2025-06-18). Server-only.
 *
 * Layering: services -> core only (dependency-graph.json) — no engines or
 * registry import here, same discipline as healthCheck.ts.
 *
 * Access tokens are stateless signed JWTs (HS256, jose) — never stored.
 * Refresh tokens and authorization codes reuse Stage 1's hash/Vault
 * storage pattern (services/ai-connection/hmac.ts, vault.ts).
 */
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "crypto"
import { SignJWT, jwtVerify } from "jose"
import { serviceClient } from "@/services/supabase/api-tokens"
import { hashToken, verifyTokenHash } from "./hmac"

const ACCESS_TOKEN_TTL_SECONDS = 30 * 60 // 30 minutes, per Stage 2 design default
const AUTH_CODE_TTL_SECONDS = 60
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

function signingSecret(): Uint8Array {
  const value = process.env.AI_CONNECTION_JWT_SIGNING_SECRET
  if (!value) throw new Error("AI_CONNECTION_JWT_SIGNING_SECRET is not set — refusing to sign/verify without a real key.")
  return new TextEncoder().encode(value)
}

// ── RFC 7591 Dynamic Client Registration ──

export interface RegisteredClient {
  client_id: string
}

export async function registerClient(clientName: string, redirectUris: string[]): Promise<RegisteredClient> {
  if (redirectUris.length === 0) throw new Error("at least one redirect_uri is required")
  for (const uri of redirectUris) {
    const parsed = new URL(uri)
    const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"
    if (!isLoopback && parsed.protocol !== "https:") {
      throw new Error(`redirect_uri must be https or a localhost/127.0.0.1 loopback: ${uri}`)
    }
  }

  const { data, error } = await serviceClient()
    .from("oauth_clients")
    .insert({ client_name: clientName, redirect_uris: redirectUris })
    .select("client_id")
    .single()

  if (error) throw new Error(`registerClient failed: ${error.message}`)
  return { client_id: (data as { client_id: string }).client_id }
}

async function findClient(clientId: string): Promise<{ client_id: string; redirect_uris: string[] } | null> {
  const { data, error } = await serviceClient()
    .from("oauth_clients")
    .select("client_id, redirect_uris")
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .maybeSingle()
  if (error) throw new Error(`findClient failed: ${error.message}`)
  return (data as { client_id: string; redirect_uris: string[] } | null) ?? null
}

/** Exact match only — no prefix/wildcard matching, per spec (prevents open redirect). */
export async function validateRedirectUri(clientId: string, redirectUri: string): Promise<boolean> {
  const client = await findClient(clientId)
  if (!client) return false
  return client.redirect_uris.includes(redirectUri)
}

// ── PKCE (RFC 7636, mandatory under OAuth 2.1) ──

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier, "ascii").digest("base64url")
  const a = Buffer.from(computed)
  const b = Buffer.from(codeChallenge)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ── Authorization endpoint support ──

export interface CreateAuthorizationCodeInput {
  clientId: string
  redirectUri: string
  codeChallenge: string
  resource: string
  approvedBy: string // profiles.id of the admin who approved
}

/** Returns the raw code exactly once — only the hash is ever stored. */
export async function createAuthorizationCode(input: CreateAuthorizationCodeInput): Promise<string> {
  const rawCode = randomBytes(32).toString("base64url")
  const { error } = await serviceClient().from("oauth_authorization_codes").insert({
    code_hash: hashToken(rawCode),
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    resource: input.resource,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
    approved_by: input.approvedBy,
  })
  if (error) throw new Error(`createAuthorizationCode failed: ${error.message}`)
  return rawCode
}

// ── Token endpoint: authorization_code grant ──

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: "Bearer"
  expires_in: number
}

interface ExchangeAuthorizationCodeInput {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
  resource: string
}

export async function exchangeAuthorizationCode(input: ExchangeAuthorizationCodeInput): Promise<TokenPair> {
  const client = serviceClient()

  // Codes are looked up by scanning unconsumed, unexpired rows for this
  // client and comparing the hash — HMAC is deterministic so a direct
  // eq() on hashToken(code) works and is O(1), same approach as api_tokens.
  const codeHash = hashToken(input.code)
  const { data: row, error } = await client
    .from("oauth_authorization_codes")
    .select("id, client_id, redirect_uri, code_challenge, resource, expires_at, consumed_at")
    .eq("code_hash", codeHash)
    .maybeSingle()

  if (error) throw new Error(`exchangeAuthorizationCode lookup failed: ${error.message}`)
  if (!row) throw new OAuthError("invalid_grant", "authorization code not found")

  const r = row as { id: string; client_id: string; redirect_uri: string; code_challenge: string; resource: string; expires_at: string; consumed_at: string | null }

  if (r.consumed_at) throw new OAuthError("invalid_grant", "authorization code already used")
  if (new Date(r.expires_at).getTime() < Date.now()) throw new OAuthError("invalid_grant", "authorization code expired")
  if (r.client_id !== input.clientId) throw new OAuthError("invalid_grant", "client_id mismatch")
  if (r.redirect_uri !== input.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri mismatch")
  if (r.resource !== input.resource) throw new OAuthError("invalid_target", "resource mismatch")
  if (!verifyPkce(input.codeVerifier, r.code_challenge)) throw new OAuthError("invalid_grant", "PKCE verification failed")

  // Mark consumed BEFORE issuing tokens — single-use enforced even under a
  // race (the update's own affected-row-count check below prevents a
  // double-issue if two requests hit this at once).
  const { data: consumedRows, error: consumeError } = await client
    .from("oauth_authorization_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", r.id)
    .is("consumed_at", null)
    .select("id")

  if (consumeError) throw new Error(`exchangeAuthorizationCode consume failed: ${consumeError.message}`)
  if (!consumedRows || consumedRows.length === 0) throw new OAuthError("invalid_grant", "authorization code already used (race)")

  return issueTokenPair({ clientId: input.clientId, resource: input.resource, familyId: randomUUID() })
}

// ── Token issuance (shared by both grant types) ──

interface IssueTokenPairInput {
  clientId: string
  resource: string
  familyId: string
}

async function issueTokenPair(input: IssueTokenPairInput): Promise<TokenPair> {
  const accessToken = await new SignJWT({ scope: "read" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.clientId)
    .setAudience(input.resource)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
    .sign(signingSecret())

  const rawRefreshToken = randomBytes(32).toString("base64url")
  const { error } = await serviceClient().from("oauth_refresh_tokens").insert({
    client_id: input.clientId,
    family_id: input.familyId,
    token_hash: hashToken(rawRefreshToken),
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new Error(`issueTokenPair refresh insert failed: ${error.message}`)

  return { access_token: accessToken, refresh_token: rawRefreshToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS }
}

// ── Token endpoint: refresh_token grant, with rotation + reuse detection ──

interface RefreshGrantInput {
  refreshToken: string
  clientId: string
  resource: string
}

export async function refreshTokenGrant(input: RefreshGrantInput): Promise<TokenPair> {
  const client = serviceClient()
  const tokenHash = hashToken(input.refreshToken)

  const { data: row, error } = await client
    .from("oauth_refresh_tokens")
    .select("id, client_id, family_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle()

  if (error) throw new Error(`refreshTokenGrant lookup failed: ${error.message}`)
  if (!row) throw new OAuthError("invalid_grant", "refresh token not found")

  const r = row as { id: string; client_id: string; family_id: string; expires_at: string; revoked_at: string | null }

  if (r.client_id !== input.clientId) throw new OAuthError("invalid_grant", "client_id mismatch")

  if (r.revoked_at) {
    // Reuse of an already-rotated refresh token — theft signal. Revoke the
    // WHOLE family, not just this row, per OAuth 2.1 Section 4.3.1 guidance.
    await client.from("oauth_refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("family_id", r.family_id).is("revoked_at", null)
    throw new OAuthError("invalid_grant", "refresh token reuse detected — entire token family revoked")
  }

  if (new Date(r.expires_at).getTime() < Date.now()) throw new OAuthError("invalid_grant", "refresh token expired")

  const newPair = await issueTokenPair({ clientId: input.clientId, resource: input.resource, familyId: r.family_id })

  // Look up the row just inserted by issueTokenPair to link replaced_by —
  // issueTokenPair doesn't return the row id, so fetch the newest row in
  // this family (created_at DESC) rather than changing its return shape
  // just for this internal bookkeeping.
  const { data: newestRow } = await client
    .from("oauth_refresh_tokens")
    .select("id")
    .eq("family_id", r.family_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  await client
    .from("oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString(), replaced_by: (newestRow as { id: string } | null)?.id ?? null })
    .eq("id", r.id)

  return newPair
}

// ── Resource server: access token verification ──

export interface VerifiedToken {
  clientId: string
  scope: string
}

export async function verifyAccessToken(jwt: string, expectedResource: string): Promise<VerifiedToken | null> {
  try {
    const { payload } = await jwtVerify(jwt, signingSecret(), { audience: expectedResource })
    if (typeof payload.sub !== "string") return null
    return { clientId: payload.sub, scope: typeof payload.scope === "string" ? payload.scope : "" }
  } catch {
    // Expired, bad signature, wrong audience, malformed — all collapse to
    // "not valid", never a detailed error back to the caller (avoids
    // leaking validation internals per OAuth 2.1 error handling guidance).
    return null
  }
}

// ── Error type carrying the OAuth error code the token/authorize endpoints need ──

export class OAuthError extends Error {
  constructor(public code: "invalid_grant" | "invalid_client" | "invalid_target" | "invalid_request", message: string) {
    super(message)
  }
}
