/**
 * AI Connection Manager — the one service allowed to create/revoke a
 * connection_kind='system' row. Stage 1 scope (2026-08-04, owner-approved):
 * this file is a real, working skeleton — NOT invoked anywhere yet. No
 * route, script, or cron calls create()/rotate() in this commit. Creating
 * a real system credential is explicitly deferred until the migration
 * diff has been reviewed (per Stage 1 deliverable #8).
 *
 * Storage mechanism choice (Vault vs HMAC hash) is a per-call parameter,
 * not hardcoded — Stage 1's live capability check confirmed Vault works
 * end-to-end via the real service-role path, so callers should default to
 * 'vault'; 'hmac' remains available and fully implemented as the fallback
 * the CHECK constraint was built to support.
 */
import { randomBytes } from "crypto"
import { serviceClient } from "@/services/supabase/api-tokens"
import { vaultWriteSecret, vaultDeleteSecret } from "./vault"
import { hashToken } from "./hmac"
import { runHealthCheck, type HealthCheckDeps } from "./healthCheck"
import { getConnectionStatus } from "./statusRepository"

export type CredentialStorageMechanism = "vault" | "hmac"

interface CreateSystemConnectionInput {
  mechanism: CredentialStorageMechanism
  label?: string
}

interface CreateSystemConnectionResult {
  api_token_id: string
  // The raw token is returned exactly once, here, to the caller that
  // requested creation — never persisted in plaintext, never logged, never
  // re-derivable from storage afterward (Vault requires the wrapper
  // function + service-role key; HMAC is one-way by construction).
  raw_token: string
}

function generateRawToken(): string {
  // Same shape as the existing manual-token generator
  // (encode(gen_random_bytes(32), 'hex') in SQL) — 64 hex chars — kept
  // consistent so downstream code (length checks, display, etc.) doesn't
  // need to special-case system vs manual tokens.
  return randomBytes(32).toString("hex")
}

export async function createSystemConnection(input: CreateSystemConnectionInput): Promise<CreateSystemConnectionResult> {
  const rawToken = generateRawToken()
  const client = serviceClient()

  const insertPayload: Record<string, unknown> = {
    user_email: "ai-service@system.internal",
    label: input.label ?? "System AI Connection",
    scopes: ["read"],
    connection_kind: "system",
  }

  if (input.mechanism === "vault") {
    const secretId = await vaultWriteSecret(rawToken, `ai-connection-${Date.now()}`, "DNA OS system AI Connection credential")
    insertPayload.vault_secret_id = secretId
  } else {
    insertPayload.token_hash = hashToken(rawToken)
  }

  const { data, error } = await client
    .from("api_tokens")
    .insert(insertPayload)
    .select("id")
    .single()

  if (error) {
    // Roll back the Vault secret if the row insert failed (e.g. the
    // one-active-system-connection unique index rejected a concurrent
    // create) — don't leave an orphaned secret behind.
    if (input.mechanism === "vault" && insertPayload.vault_secret_id) {
      await vaultDeleteSecret(insertPayload.vault_secret_id as string).catch(() => {})
    }
    throw new Error(`createSystemConnection insert failed: ${error.message}`)
  }

  return { api_token_id: (data as { id: string }).id, raw_token: rawToken }
}

/**
 * validate + activate: run the health check immediately after create.
 * deps are injected by the caller (an app/gateway-layer route, not built in
 * Stage 1) — this file stays engines/registry-free, same reasoning as
 * healthCheck.ts itself.
 */
export async function validateAndActivate(deps: HealthCheckDeps): Promise<void> {
  await runHealthCheck(deps)
}

export async function getStatus() {
  return getConnectionStatus()
}

/**
 * rotate: PENDING, deliberately disabled (owner security review, 2026-08-04).
 *
 * A revoke-then-create implementation was drafted and removed from this
 * file, not just hidden behind a guard — it had a brief window with zero
 * live system connection, because the unique partial index
 * (api_tokens_one_active_system_connection) blocks inserting a second live
 * 'system' row while the old one is still active. That's not the atomic
 * create -> validate -> activate -> revoke-old flow this feature needs.
 * A true zero-window rotation needs the unique index relaxed to "at most
 * one CONNECTED row" instead of "at most one non-revoked row" — a real
 * schema change, to be designed together with the atomic flow, not before.
 */
export async function rotateSystemConnection(_mechanism: CredentialStorageMechanism, _deps: HealthCheckDeps): Promise<CreateSystemConnectionResult> {
  throw new Error(
    "rotateSystemConnection is not implemented yet — pending the atomic create->validate->activate->revoke-old " +
    "flow design (see this function's own comment)."
  )
}

export async function revokeSystemConnection(deps: HealthCheckDeps): Promise<void> {
  const client = serviceClient()
  const { error } = await client
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("connection_kind", "system")
    .is("revoked_at", null)
  if (error) throw new Error(`revokeSystemConnection failed: ${error.message}`)
  await runHealthCheck(deps) // re-checks, finds no live connection, status -> disconnected
}
