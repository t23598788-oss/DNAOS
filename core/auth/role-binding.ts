export type AppRole =
  | "super_admin"
  | "admin"
  | "employee"
  | "partner"
  | "customer"
  | "ai_service";

/**
 * Roles are authoritative only when the verified Supabase Auth subject owns
 * the profiles row. Email fallback can locate a canonical profile, but cannot
 * transfer its permissions to a different auth.users.id.
 */
export function effectiveSessionRole(
  profile: { role: string; resolvedBy: "id" | "email" } | null,
): AppRole | null {
  if (!profile) return null;
  return (profile.resolvedBy === "id" ? profile.role : "customer") as AppRole;
}
