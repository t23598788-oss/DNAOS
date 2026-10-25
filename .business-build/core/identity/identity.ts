import type { User } from "@supabase/supabase-js";

/**
 * Identity Layer — the ONE central module (owner, 2026-09-24).
 *
 * DESIGN: "1 human = 1 canonical user/profile; many linked identities":
 *   canonical user   = exactly ONE public.profiles row per human, enforced
 *                      DB-side by migration 20260927000001 (unique
 *                      lower(email) + handle_new_user keeps the ORIGINAL row
 *                      when the same email arrives via another provider camp);
 *   linked identities = Supabase Auth's native auth.identities, surfaced on
 *                      the session User as user.identities — read ONLY here
 *                      (single-reader invariant, enforced by
 *                      scripts/identity-layer-test.ts);
 *   resolution chain  = session → canonical profile (id first, EMAIL fallback
 *                      → same row, never a new one) → linked identities —
 *                      exactly what getAuthedUser delegates below;
 *   connections       = Connect credentials/tokens (LINE/GitHub/…) live
 *                      BEHIND this layer: runtime reaches them only via
 *                      core/connector-loader (server capability code). /login
 *                      must never reveal any of this complexity.
 *
 * PASSWORD RULE: a password is NEVER spread across providers. The system's
 * only password belongs to the local email identity (login maintenance
 * fallback); Google/Apple/Microsoft keep their own OAuth sessions/tokens,
 * handled entirely inside Supabase Auth — nothing to copy, nothing shared.
 *
 * No secrets are read, stored, or logged here: provider + provider id are
 * identifiers, never credentials.
 */

export interface LinkedIdentity {
  /** login provider camp: "email" | "google" | "apple" | "azure" | … */
  provider: string;
  /** provider-scoped subject id (UserIdentity.id — NOT a credential) */
  providerId: string;
  /** email this identity presented at link time, when available */
  email: string | null;
}

export interface CanonicalProfile {
  /** THE profiles row for this human (same row across every provider) */
  profileId: string;
  email: string;
  role: string;
  resolvedBy: "id" | "email";
}

export interface IdentityContext {
  canonical: CanonicalProfile;
  identities: LinkedIdentity[];
  primaryProvider: string | null;
}

/** Injectable profile lookup (query stays with the caller — core→gateway rule). */
export type ProfileLookup = (
  key: { field: "id" | "email"; value: string },
) => Promise<{ id: string; role: string } | null>;

/** The ONLY reader of user.identities in the system. */
export function extractLinkedIdentities(user: Pick<User, "identities">): LinkedIdentity[] {
  return (user.identities ?? []).map((i) => ({
    provider: i.provider,
    providerId: i.id,
    email: typeof i.identity_data?.email === "string" ? (i.identity_data.email as string) : null,
  }));
}

/**
 * session → canonical profile → linked identities. Tries the session's own id
 * first (normal linked case: one auth user serving every provider), then falls
 * back to the EMAIL match (separate-auth-user edge: same human, other camp →
 * THE original profiles row). Returns null when no canonical profile exists —
 * creation stays in the DB trigger; this layer never inserts.
 */
export async function resolveIdentityContext(
  user: Pick<User, "id" | "email" | "identities">,
  lookup: ProfileLookup,
): Promise<IdentityContext | null> {
  let row = await lookup({ field: "id", value: user.id });
  let resolvedBy: "id" | "email" = "id";
  if (!row && user.email) {
    row = await lookup({ field: "email", value: user.email });
    resolvedBy = "email";
  }
  if (!row) return null;

  const identities = extractLinkedIdentities(user);
  return {
    canonical: { profileId: row.id, email: user.email ?? "", role: row.role, resolvedBy },
    identities,
    primaryProvider: identities[0]?.provider ?? null,
  };
}
