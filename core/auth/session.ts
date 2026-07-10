import { createServerSupabase } from "@/services/supabase/server";
import permissions from "@/registry/permissions.json";

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
}

export const ADMIN_TIER = permissions.role_tiers.admin_tier as AppRole[];
export const SUPER_ADMIN_ONLY = permissions.role_tiers.super_admin_only as AppRole[];
export const ANY_AUTHENTICATED = permissions.role_tiers.any_authenticated as AppRole[];

// The one place that resolves "who is making this request" from the shared
// Supabase Auth session cookie (TASK-001) — every requireAuth/requireAuthPage
// call goes through this, so there is exactly one session-reading code path.
export async function getAuthedUser(): Promise<AuthedUser | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user) {
    console.log("[TRACE-AUTH] getAuthedUser: no user", { userError: userError?.message });
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  console.log("[TRACE-AUTH] getAuthedUser", {
    userId: user.id,
    userEmail: user.email,
    profileFound: !!profile,
    profileRole: profile?.role,
    profileError: profileError?.message,
    profileErrorCode: profileError?.code,
  });

  if (!profile) return null;

  return { id: user.id, email: user.email ?? "", role: profile.role as AppRole };
}

// Access token for the rare call site (core/config/company-settings.ts) that
// needs to hand a user-scoped Supabase client to a function outside core/auth,
// so Postgres RLS checks auth.role()/auth.uid() as the real signed-in user.
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}