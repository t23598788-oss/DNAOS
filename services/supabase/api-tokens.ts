/**
 * API Token management — ท่อเชื่อม AI ภายนอก
 *
 * ใช้ service role key เพื่อเข้าถึง api_tokens table
 * (anon key ถูก RLS บล็อกไว้)
 */

import { createClient } from "@supabase/supabase-js";

// Exported (2026-08-04, AI Connection Stage 1) so services/ai-connection/*
// reuses this exact client construction instead of duplicating it — same
// service-role posture, one definition.
export class MissingServiceRoleKeyError extends Error {
  constructor() {
    super("SUPABASE_SERVICE_ROLE_KEY is not set — api_tokens table is unreachable");
    this.name = "MissingServiceRoleKeyError";
  }
}

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Fail LOUD but typed (2026-10-24 real-incident fix): when the service-role
  // key is absent (local dev without .env.local secret, drained runtime), the
  // old `!` hand-fed `undefined` into createClient which threw an opaque
  // error the caller surfaced to AI clients as a raw 500. Now the ONE miss
  // is a typed, catchable error every route can translate into a clean 503.
  if (!url || !key) throw new MissingServiceRoleKeyError();
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

/**
 * Scopes the system ACTUALLY enforces today. Explicit allow-list, derived from
 * the only consumers that exist:
 *   - "read"                 → app/api/v1/mcp/governance/_lib/auth.ts (read tier) + every read-only MCP tool
 *   - "governance:read"      → same auth helper's read tier (accepted synonym)
 *   - "governance:propose"   → session-proposals / registry-proposals / contractor.task.claim / contractor.evidence.submit
 * Deliberately ABSENT: "write" (supabase/migrations/20260705000006_api_tokens.sql
 * documents it as "ยังไม่รองรับ" — no runtime implements it), any wildcard, and
 * any admin scope. Adding one of those requires the runtime to exist first.
 */
export const ALLOWED_API_TOKEN_SCOPES = ["read", "governance:read", "governance:propose"] as const;
export type ApiTokenScope = (typeof ALLOWED_API_TOKEN_SCOPES)[number];

// TODO (contractor/MCP runtime activation — PAUSED, Owner 2026-09-23, TASK-082):
// Runtime activation intentionally deferred until DNA OS Owner Settings / Credential
// Authorization surface is available. Do not create alternate token/credential path.
// Issuing a contractor token ([read, governance:propose]) and activating the
// contractor runtime must go through that canonical Owner-authorised surface later —
// not through an ad-hoc call, temporary UI, or a new issuer introduced here.

/**
 * Validate a REQUESTED scope set. The requester here is always the
 * admin-authenticated issuer (POST /api/admin/api-tokens); a contractor/MCP
 * client can never supply scopes — its routes never read such a field.
 * `read` is implied whenever any higher scope is granted, and omitting the
 * argument keeps the historical default exactly as it was: ["read"].
 */
export function validateApiTokenScopes(
  input: unknown,
): { ok: true; scopes: ApiTokenScope[] } | { ok: false; rejected: string[] } {
  if (input === undefined || input === null) return { ok: true, scopes: ["read"] };
  if (!Array.isArray(input)) return { ok: false, rejected: [String(input)] };
  const requested = [...new Set(input.map((s) => String(s).trim()).filter((s) => s.length > 0))];
  const rejected = requested.filter((s) => !ALLOWED_API_TOKEN_SCOPES.includes(s as ApiTokenScope));
  if (rejected.length > 0) return { ok: false, rejected };
  if (requested.length === 0) return { ok: true, scopes: ["read"] };
  return {
    ok: true,
    scopes: (requested.includes("read") ? requested : ["read", ...requested]) as ApiTokenScope[],
  };
}

export async function createApiToken(email: string, label: string, scopes?: string[]): Promise<ApiToken> {
  const validated = validateApiTokenScopes(scopes);
  if (!validated.ok) {
    // fail-closed: an unknown/wildcard/admin scope never reaches the database
    throw new Error(`API_TOKEN_SCOPE_NOT_ALLOWED:${validated.rejected.join(",")}`);
  }

  const { data, error } = await serviceClient()
    .from("api_tokens")
    .insert({ user_email: email, label, scopes: validated.scopes })
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

/**
 * Token → caller PROFILE ROLE (server-side authority, 2026-10-24).
 *
 * พิสูจน์แล้วจาก source เดิม: POST /api/admin/api-tokens ใช้ requireAuth(ADMIN_TIER)
 * และ createApiToken(auth.email, …) — token ถูกออกให้อีเมลเจ้าของตัวเองเท่านั้น
 * ดังนั้น caller ของ token ที่ถูกต้องต้องมี profiles row และ role อยู่ใน admin tier
 * เสมอ แต่เดิม /api/v1/query ไม่เคยตรวจข้อนี้เลย: ถ้า profiles.role ของอีเมลนั้น
 * ถูกลดสิทธิ์ภายหลัง (ผ่าน /admin/users) หรือ profile ถูกลบ token ยังคงอ่าน
 * ข้อมูลธุรกิจทุก command ต่อไปได้ = ช่องโหว่สิทธิ์ข้ามองค์กร จึงบังคับที่นี่
 * (canonical reader เดิม — serviceClient + profiles select; ไม่สร้าง engine ใหม่)
 */
export async function getApiTokenCallerRole(email: string): Promise<string | null> {
  const profile = await getApiTokenCallerProfile(email);
  return profile?.role ?? null;
}

/**
 * The token's canonical profile (id + current role). Used to build the read
 * scope — the role alone is not enough once reads are organization-scoped
 * (STEP 1, 2026-10-25). Missing profile ⇒ null ⇒ no scope ⇒ DENY.
 */
export async function getApiTokenCallerProfile(
  email: string,
): Promise<{ id: string; role: string | null } | null> {
  const { data, error } = await serviceClient()
    .from("profiles")
    .select("id, role")
    .ilike("email", email)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  return { id: String(data.id), role: (data.role as string | null) ?? null };
}
