import type { NextRequest } from "next/server";
import type { AuthedUser } from "@/core/auth/session";
import { NO_DATA_SCOPE, organizationDataScope, type DataScope } from "@/core/authority/data-scope";
import { assertRequestedOrganizationAllowed, loadAuthorityContext } from "@/engines/authority/load";
import { supabaseAdmin } from "@/services/supabase/queries";

export const ACTIVE_BUSINESS_ORG_COOKIE = "dnaos_active_business_org";

function sessionInput(user: AuthedUser) {
  return {
    profileId: user.canonicalProfileId ?? user.id,
    role: user.role,
    sessionAccountId: user.id,
    resolvedBy: user.resolvedBy ?? null,
    emailConfirmed: user.emailConfirmed ?? null,
  } as const;
}

/** Resolve organizations from the authenticated account, never from email or role. */
export async function listBusinessOrganizations(user: AuthedUser) {
  const authority = await loadAuthorityContext(sessionInput(user));
  const organizationIds = authority.actor.organizationIds ?? [];
  if (!authority.organizationScope.eligible || organizationIds.length === 0) {
    return { organizations: [], reason: authority.organizationScope.reason };
  }
  const { data, error } = await supabaseAdmin()
    .from("organizations")
    .select("id, name")
    .in("id", organizationIds)
    .order("name");
  if (error) return { organizations: [], reason: "ORGANIZATION_LOOKUP_FAILED" };
  return { organizations: data ?? [], reason: authority.organizationScope.reason };
}

/** Business scope is always one verified organization, including for super_admin. */
export async function resolveBusinessOrganizationScope(
  user: AuthedUser,
  requestedOrganizationId: unknown,
): Promise<{ scope: DataScope; allowed: boolean; reason: string }> {
  const authority = await loadAuthorityContext(sessionInput(user));
  const decision = assertRequestedOrganizationAllowed(authority.actor, requestedOrganizationId);
  if (!authority.organizationScope.eligible) {
    return { scope: NO_DATA_SCOPE, allowed: false, reason: authority.organizationScope.reason };
  }
  if (!decision.allowed) return { scope: NO_DATA_SCOPE, allowed: false, reason: decision.reason };
  return {
    scope: organizationDataScope({
      profileId: authority.actor.profileId,
      role: user.role,
      organizationIds: [String(requestedOrganizationId)],
      reason: "VERIFIED_ACTIVE_BUSINESS_ORGANIZATION",
    }),
    allowed: true,
    reason: "VERIFIED_ACTIVE_BUSINESS_ORGANIZATION",
  };
}

export function activeOrganizationClaim(request: NextRequest): string | null {
  return request.cookies.get(ACTIVE_BUSINESS_ORG_COOKIE)?.value ?? null;
}
