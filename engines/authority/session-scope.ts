/**
 * DataScope resolution for the two real actor kinds (STEP 1, 2026-10-25):
 *
 *   browser session → core/auth/session.getAuthedUser() → org_members
 *   API token      → token email → profiles.id → org_members
 *
 * Nothing here accepts an organization id from the request. Missing evidence
 * (no profile, no membership, unverified session) resolves to mode "none",
 * which the dispatcher treats as DENY, never as "unfiltered".
 */
import type { AuthedUser } from "@/core/auth/session";
import {
  NO_DATA_SCOPE,
  platformDataScope,
  resolveDataScope,
  type DataScope,
} from "@/core/authority/data-scope";
import { loadAuthorityContext, loadOrganizationMembership } from "./load";

function isPlatformRole(role: string | null | undefined): boolean {
  return role === "super_admin";
}

export async function resolveSessionDataScope(user: AuthedUser): Promise<DataScope> {
  const profileId = user.canonicalProfileId ?? user.id;
  const loaded = await loadAuthorityContext({
    profileId,
    role: user.role,
    sessionAccountId: user.id,
    resolvedBy: user.resolvedBy ?? null,
    emailConfirmed: user.emailConfirmed ?? null,
  });
  return resolveDataScope({
    profileId: loaded.actor.profileId,
    role: user.role,
    organizationIds: loaded.actor.organizationIds,
    reason: loaded.organizationScope.reason,
  });
}

/**
 * A token's email is the identity that created it (createApiToken is
 * admin-tier + own-email only). The profile row is re-read on every request,
 * so demoting/removing the account revokes the scope immediately.
 */
export async function resolveTokenDataScope(
  profile: { id: string; role: string | null } | null,
): Promise<DataScope> {
  if (!profile?.id) return NO_DATA_SCOPE;
  if (isPlatformRole(profile.role)) {
    return platformDataScope({ profileId: profile.id, role: profile.role, reason: "TOKEN_PLATFORM_SUPER_ADMIN" });
  }
  const membership = await loadOrganizationMembership(profile.id);
  if (membership.error) return NO_DATA_SCOPE;
  return resolveDataScope({
    profileId: profile.id,
    role: profile.role,
    organizationIds: membership.organizations,
    reason: "TOKEN_ORGANIZATION_MEMBERSHIP",
  });
}

/**
 * Owner-only internal bridges (LINE remote control / OpenClaw) are secret-gated
 * server-to-server calls made by the platform owner's own channels. They are
 * the ONE explicit platform scope, recorded with a distinct reason.
 */
export function ownerBridgeDataScope(): DataScope {
  return platformDataScope({ reason: "OWNER_INTERNAL_BRIDGE" });
}
