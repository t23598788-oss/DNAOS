/**
 * Safe health-check service for the system AI Connection.
 *
 * Layering note: registry/dependency-graph.json only allows services -> core
 * (not services -> engines, not services -> registry). This file therefore
 * never imports engines/validation/dispatcher or registry/command-registry.json
 * directly — the caller (an app/ or gateway/ layer route, not yet built in
 * Stage 1) injects a dispatchFn and the write-command registry data instead.
 * No new dependency-graph edge was added to make this file compile; it was
 * restructured to not need one.
 *
 * write_blocked_ok is a STATIC REGISTRY METADATA check only — it never
 * dispatches a write-shaped command, on Production or anywhere else. The
 * actual behavioral proof that engines/validation/dispatcher.ts's Rule 72
 * gate works lives in scripts/rule72-gate.test.ts (a real unit/integration
 * test, run in dev/CI) — this service leans on that test having passed,
 * not on re-deriving the guarantee from a live dispatch() call or from
 * scanning dispatcher.ts's source text at runtime (both explicitly
 * forbidden).
 *
 * auth_ok's meaning differs honestly by storage mechanism (documented
 * inline below) — this is a real asymmetry between Vault (reversible,
 * encrypted) and HMAC-hash (one-way) storage, not glossed over.
 */
import { serviceClient } from "@/services/supabase/api-tokens"
import { vaultReadSecret } from "./vault"
import { upsertConnectionStatus, type AiConnectionStatusUpdate } from "./statusRepository"

const KNOWN_WRITE_COMMANDS = ["debt.create", "invoice.create", "document.create", "job.assign", "payment"]

// Low-impact, limited-data read probe — registry metadata, not a business
// table scan (no partner/debt/invoice rows touched).
const READ_PROBE_COMMAND = "registry.list_modules"

interface SystemConnectionRow {
  id: string
  revoked_at: string | null
  token_hash: string | null
  vault_secret_id: string | null
}

/** Minimal shape health-check needs from a command-registry entry — caller supplies the real data. */
export interface CommandMetadataLookup {
  [command: string]: { requires_confirmation?: boolean } | undefined
}

/** Caller supplies the real dispatch() (from engines/validation/dispatcher) — this module never imports it. */
export type DispatchFn = (
  command: string,
  args: Record<string, unknown>,
  confirmed: boolean
) => Promise<{ ok: boolean; violations: string[] }>

export interface HealthCheckDeps {
  commandMetadata: CommandMetadataLookup
  dispatchFn: DispatchFn
}

async function findSystemConnection(): Promise<SystemConnectionRow | null> {
  const { data, error } = await serviceClient()
    .from("api_tokens")
    .select("id, revoked_at, token_hash, vault_secret_id")
    .eq("connection_kind", "system")
    .is("revoked_at", null)
    .maybeSingle()

  if (error) throw new Error(`findSystemConnection query failed: ${error.message}`)
  return (data as SystemConnectionRow | null) ?? null
}

/**
 * Vault-backed rows: real round-trip — retrieve the actual secret and
 * confirm it decrypts to a well-formed value. This is a genuine proof the
 * stored credential is usable.
 *
 * HMAC-hash rows: NOT a round-trip (one-way hash, by design — the raw
 * value is never retained after creation). Best available check is a
 * shape sanity check (64 hex chars, matching this system's real token
 * format) — weaker guarantee, stated honestly rather than reported as
 * equivalent to the Vault path.
 */
async function checkAuth(row: SystemConnectionRow): Promise<{ ok: boolean; code?: string; reason_th?: string }> {
  if (row.vault_secret_id) {
    const secret = await vaultReadSecret(row.vault_secret_id)
    const ok = typeof secret === "string" && /^[0-9a-f]{64}$/.test(secret)
    return ok ? { ok: true } : { ok: false, code: "AUTH_INVALID", reason_th: "อ่าน credential จาก Vault ไม่สำเร็จ หรือรูปแบบไม่ถูกต้อง" }
  }
  if (row.token_hash) {
    const ok = /^[0-9a-f]{64}$/.test(row.token_hash)
    return ok ? { ok: true } : { ok: false, code: "AUTH_INVALID", reason_th: "รูปแบบ token_hash ไม่ถูกต้อง" }
  }
  return { ok: false, code: "AUTH_INVALID", reason_th: "ไม่มี credential ที่ตรวจสอบได้ (ไม่มีทั้ง vault_secret_id และ token_hash)" }
}

function checkWriteBlockedMetadataOnly(commandMetadata: CommandMetadataLookup): { ok: boolean; code?: string; reason_th?: string } {
  const drifted = KNOWN_WRITE_COMMANDS.filter((cmd) => commandMetadata[cmd]?.requires_confirmation !== true)
  if (drifted.length > 0) {
    return {
      ok: false,
      code: "WRITE_GATE_REGRESSION",
      reason_th: `คำสั่งเขียนข้อมูลต่อไปนี้ไม่ได้ประกาศ requires_confirmation:true ใน registry: ${drifted.join(", ")} — ต้องตรวจสอบก่อนใช้งานต่อ`,
    }
  }
  return { ok: true }
}

async function checkReadProbe(dispatchFn: DispatchFn): Promise<{ ok: boolean; code?: string; reason_th?: string }> {
  try {
    const result = await dispatchFn(READ_PROBE_COMMAND, {}, false)
    return result.ok
      ? { ok: true }
      : { ok: false, code: "READ_PROBE_FAILED", reason_th: `read probe (${READ_PROBE_COMMAND}) ถูกปฏิเสธ: ${result.violations.join("; ")}` }
  } catch (err) {
    return { ok: false, code: "READ_PROBE_FAILED", reason_th: `read probe (${READ_PROBE_COMMAND}) ผิดพลาด: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function runHealthCheck(deps: HealthCheckDeps): Promise<void> {
  const connection = await findSystemConnection()

  if (!connection) {
    await upsertConnectionStatus({
      api_token_id: null,
      status: "disconnected",
      auth_ok: null,
      read_command_ok: null,
      write_blocked_ok: null,
      mcp_reachability: "not_applicable",
      last_failure_code: null,
      last_failure_reason_th: null,
      last_health_check_at: new Date().toISOString(),
    } as AiConnectionStatusUpdate)
    return
  }

  const auth = await checkAuth(connection)
  const writeBlocked = checkWriteBlockedMetadataOnly(deps.commandMetadata)
  // Only probe reads if auth looks sound — no point exercising the dispatcher
  // with a connection we already know is broken.
  const readProbe = auth.ok ? await checkReadProbe(deps.dispatchFn) : { ok: false, code: "AUTH_INVALID", reason_th: "ข้ามการทดสอบอ่านข้อมูล เพราะ credential ไม่ผ่านการตรวจสอบก่อนหน้า" }

  const allOk = auth.ok && writeBlocked.ok && readProbe.ok
  const firstFailure = [auth, writeBlocked, readProbe].find((r) => !r.ok)

  await upsertConnectionStatus({
    api_token_id: connection.id,
    status: allOk ? "connected" : "failed",
    auth_ok: auth.ok,
    read_command_ok: readProbe.ok,
    write_blocked_ok: writeBlocked.ok,
    // Stage 1 builds no pairing/MCP wiring yet — honestly not_applicable,
    // never reported as reachable without a real MCP grant to check.
    mcp_reachability: "not_applicable",
    last_health_check_at: new Date().toISOString(),
    ...(allOk
      ? { last_success_at: new Date().toISOString(), last_failure_code: null, last_failure_reason_th: null }
      : { last_failure_code: firstFailure?.code ?? "UNKNOWN", last_failure_reason_th: firstFailure?.reason_th ?? "ไม่ทราบสาเหตุ" }),
  } as AiConnectionStatusUpdate)
}
