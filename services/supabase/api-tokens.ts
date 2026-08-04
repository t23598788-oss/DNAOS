/**
 * API Token management — ท่อเชื่อม AI ภายนอก
 *
 * ใช้ service role key เพื่อเข้าถึง api_tokens table
 * (anon key ถูก RLS บล็อกไว้)
 */

import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface ApiToken {
  id: string;
  user_email: string;
  token: string;
  label: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

// TEMPORARY DIAGNOSTIC (owner-approved, 2026-08-04) — API token UNAUTHORIZED
// root-cause audit. requestId is optional so every other caller of this
// function is unaffected. Logs shape only, never the raw token or a hash.
// Remove once root cause is confirmed from real Production logs.
export async function validateApiToken(token: string, requestId?: string): Promise<ApiToken | null> {
  const { data, error } = await serviceClient()
    .from("api_tokens")
    .select("id, user_email, token, label, scopes, last_used_at, created_at, revoked_at")
    .eq("token", token)
    .is("revoked_at", null)
    .single();

  if (requestId) {
    console.log("[validateApiToken][diag]", JSON.stringify({
      request_id: requestId,
      database_query_error_code: error?.code ?? null,
      matching_row_found: !!data,
      matched_row_revoked: data ? data.revoked_at !== null : null,
    }))
  }

  if (error || !data) return null;

  // อัพเดท last_used_at แบบ fire-and-forget
  const updatePromise = serviceClient()
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)

  if (requestId) {
    updatePromise.then(({ error: updateError }) => {
      console.log("[validateApiToken][diag]", JSON.stringify({
        request_id: requestId,
        last_used_update_success: !updateError,
      }))
    })
  } else {
    updatePromise.then(() => {})
  }

  return data as ApiToken;
}

export async function listTokensForEmail(email: string): Promise<ApiToken[]> {
  const { data, error } = await serviceClient()
    .from("api_tokens")
    .select("id, user_email, token, label, scopes, last_used_at, created_at, revoked_at")
    .eq("user_email", email)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ApiToken[];
}

export async function createApiToken(email: string, label: string): Promise<ApiToken> {
  const { data, error } = await serviceClient()
    .from("api_tokens")
    .insert({ user_email: email, label, scopes: ["read"] })
    .select("id, user_email, token, label, scopes, last_used_at, created_at, revoked_at")
    .single();

  if (error) throw new Error(error.message);
  return data as ApiToken;
}

export async function revokeApiToken(id: string, email: string): Promise<void> {
  const { error } = await serviceClient()
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_email", email); // guard: เจ้าของเท่านั้น

  if (error) throw new Error(error.message);
}
