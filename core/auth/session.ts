import { getServerSupabaseClient } from "@/gateway/auth";
import permissions from "@/registry/permissions.json";
import { resolveIdentityContext, type ProfileLookup, type LinkedIdentity } from "@/core/identity/identity";

export type AppRole =
  | "super_admin"
  | "admin"
  | "employee"
  | "partner"
  | "customer"
  | "ai_service";

export interface AuthedUser {
  id: string;
  email: string;
  role: AppRole;
  /** linked provider identities (Identity Layer) — identifiers only, never credentials */
  identities?: LinkedIdentity[];
  /** THE profiles row for this human (=== id unless resolved via email fallback) */
  canonicalProfileId?: string;
}

export const ADMIN_TIER = permissions.role_tiers.admin_tier as AppRole[];
export const SUPER_ADMIN_ONLY = permissions.role_tiers.super_admin_only as AppRole[];
export const ANY_AUTHENTICATED = permissions.role_tiers.any_authenticated as AppRole[];
// Developer Workspace tier (owner directive 2026-10-15): แยกออกจาก admin_tier —
// employee/ผู้ใช้งานธุรกิจทั่วไปเข้า Developer Surface ไม่ได้. ยังอ่านจากไฟล์
// registry เดิม (permissions.json) ไม่มีระบบ auth/registry ที่สอง.
export const DEVELOPER_TIER = permissions.role_tiers.developer_tier as AppRole[];

// The one place that resolves "who is making this request" from the shared
// Supabase Auth session cookie (TASK-001) — every requireAuth/requireAuthPage
// call goes through this, so there is exactly one session-reading code path.
export async function getAuthedUser(): Promise<AuthedUser | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user) {
    console.log("[TRACE-AUTH] getAuthedUser: no user", { userError: userError?.message });
    return null;
  }

  // Identity Layer (core/identity/identity.ts, owner 2026-09-24): session →
  // canonical profile (id first, EMAIL fallback → same row, never a new one)
  // → linked provider identities — the CHAIN lives in the layer; this file
  // only keeps the query (core cannot import services — gateway pattern) and
  // delegates. Connections/credentials stay behind core/connector-loader
  // (server capability code only); /login reveals none of it.
  let lastProfileError: string | undefined;
  const lookup: ProfileLookup = async ({ field, value }) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role")
      .eq(field, value)
      .maybeSingle();
    lastProfileError = error?.message;
    return data ?? null;
  };
  const ctx = await resolveIdentityContext(user, lookup);

  console.log("[TRACE-AUTH] getAuthedUser", {
    userId: user.id,
    userEmail: user.email,
    profileFound: !!ctx,
    profileId: ctx?.canonical.profileId,
    profileRole: ctx?.canonical.role,
    profileResolvedBy: ctx?.canonical.resolvedBy,
    linkedProviders: ctx?.identities.map((i) => i.provider) ?? [],
    profileError: lastProfileError,
  });

  if (!ctx) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    role: ctx.canonical.role as AppRole,
    identities: ctx.identities,
    canonicalProfileId: ctx.canonical.profileId,
  };
}

// Access token for the rare call site (core/config/company-settings.ts) that
// needs to hand a user-scoped Supabase client to a function outside core/auth,
// so Postgres RLS checks auth.role()/auth.uid() as the real signed-in user.
export async function getAccessToken(): Promise<string | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}