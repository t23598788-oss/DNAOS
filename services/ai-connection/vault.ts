/**
 * Thin wrapper around the SECURITY DEFINER RPC functions added in
 * 20260804000007_ai_connection_stage1.sql (ai_connection_vault_write/read/
 * delete). vault schema itself is deliberately not exposed to PostgREST —
 * live-verified 2026-08-04 (406 "Invalid schema: vault" on a direct call) —
 * so these RPC calls are the real, only path to Vault from application code,
 * not a convenience shortcut around a simpler direct path.
 */
import { serviceClient } from "@/services/supabase/api-tokens"

export async function vaultWriteSecret(secret: string, name: string, description?: string): Promise<string> {
  const { data, error } = await serviceClient().rpc("ai_connection_vault_write", {
    p_secret: secret,
    p_name: name,
    p_description: description ?? null,
  })
  if (error) throw new Error(`vault write failed: ${error.message}`)
  return data as string
}

export async function vaultReadSecret(id: string): Promise<string | null> {
  const { data, error } = await serviceClient().rpc("ai_connection_vault_read", { p_id: id })
  if (error) throw new Error(`vault read failed: ${error.message}`)
  return (data as string | null) ?? null
}

export async function vaultDeleteSecret(id: string): Promise<void> {
  const { error } = await serviceClient().rpc("ai_connection_vault_delete", { p_id: id })
  if (error) throw new Error(`vault delete failed: ${error.message}`)
}
