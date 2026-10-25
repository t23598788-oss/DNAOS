/**
 * Repository for the ai_connection_status singleton row. Singleton-ness is
 * enforced by the table itself (singleton_key boolean PRIMARY KEY DEFAULT
 * true CHECK (singleton_key) — see the Stage 1 migration), not by this
 * code — this module always upserts on singleton_key=true, never inserts a
 * second row, and a second row is structurally impossible regardless.
 */
import { serviceClient } from "@/services/supabase/api-tokens"

export type ConnectionStatus = "disconnected" | "provisioning" | "connected" | "degraded" | "failed"
export type McpReachability = "applicable" | "not_applicable" | "reachable" | "unreachable"

export interface AiConnectionStatusRow {
  singleton_key: true
  api_token_id: string | null
  status: ConnectionStatus
  auth_ok: boolean | null
  read_command_ok: boolean | null
  write_blocked_ok: boolean | null
  mcp_reachability: McpReachability | null
  last_health_check_at: string | null
  last_success_at: string | null
  last_failure_code: string | null
  last_failure_reason_th: string | null
  updated_at: string
}

export type AiConnectionStatusUpdate = Partial<Omit<AiConnectionStatusRow, "singleton_key" | "updated_at">>

export async function getConnectionStatus(): Promise<AiConnectionStatusRow | null> {
  const { data, error } = await serviceClient()
    .from("ai_connection_status")
    .select("*")
    .eq("singleton_key", true)
    .maybeSingle()

  if (error) throw new Error(`getConnectionStatus failed: ${error.message}`)
  return (data as AiConnectionStatusRow | null) ?? null
}

export async function upsertConnectionStatus(update: AiConnectionStatusUpdate): Promise<AiConnectionStatusRow> {
  const { data, error } = await serviceClient()
    .from("ai_connection_status")
    .upsert(
      { singleton_key: true, ...update, updated_at: new Date().toISOString() },
      { onConflict: "singleton_key" }
    )
    .select("*")
    .single()

  if (error) throw new Error(`upsertConnectionStatus failed: ${error.message}`)
  return data as AiConnectionStatusRow
}
