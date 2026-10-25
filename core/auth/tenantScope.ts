/**
 * Active organization resolution (2026-10-20). Pure: no I/O, no imports.
 *
 * Inputs MUST come from the server:
 *   - memberships: rows read from public.org_members for the authenticated user id
 *     (the session's user id, never a value from a request body or AI output)
 *   - selectedOrganizationId: the organization the user explicitly chose in this
 *     session (wired by the app later; until then callers pass null)
 *
 * Decisions (fail-closed, in this order):
 *   1. No membership at all                       -> NO_MEMBERSHIP
 *   2. Selected id given but not a membership     -> NOT_A_MEMBER
 *   3. Exactly one membership, none selected      -> that organization (single-org user)
 *   4. Several memberships, none selected         -> ORGANIZATION_SELECTION_REQUIRED
 *   5. Selected id is a membership                -> that organization
 *
 * The resolved organization is only a scope hint for the caller. The database
 * still re-checks membership for the event's own organization inside the RPC.
 */

export const ORGANIZATION_SELECTION_REQUIRED = "ORGANIZATION_SELECTION_REQUIRED";
export const TENANT_NO_MEMBERSHIP = "TENANT_NO_MEMBERSHIP";
export const TENANT_NOT_A_MEMBER = "TENANT_NOT_A_MEMBER";

export interface OrgMembership {
  organizationId: string;
  role: "owner" | "admin" | "member";
}

export type ActiveOrganizationDecision =
  | { ok: true; organizationId: string; role: OrgMembership["role"]; reason: "single_membership" | "selected" }
  | { ok: false; code: typeof ORGANIZATION_SELECTION_REQUIRED | typeof TENANT_NO_MEMBERSHIP | typeof TENANT_NOT_A_MEMBER };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveActiveOrganization(input: {
  memberships: readonly OrgMembership[];
  selectedOrganizationId: string | null;
}): ActiveOrganizationDecision {
  // Duplicate rows for one organization collapse to one membership.
  const byOrg = new Map<string, OrgMembership>();
  for (const m of input.memberships) {
    if (!UUID.test(m.organizationId)) continue; // malformed id is never a valid scope
    const prev = byOrg.get(m.organizationId);
    if (!prev || rank(m.role) > rank(prev.role)) byOrg.set(m.organizationId, m);
  }
  const memberships = [...byOrg.values()];

  if (memberships.length === 0) return { ok: false, code: TENANT_NO_MEMBERSHIP };

  if (input.selectedOrganizationId) {
    const hit = byOrg.get(input.selectedOrganizationId);
    if (!hit) return { ok: false, code: TENANT_NOT_A_MEMBER };
    return { ok: true, organizationId: hit.organizationId, role: hit.role, reason: "selected" };
  }

  if (memberships.length === 1) {
    const only = memberships[0];
    return { ok: true, organizationId: only.organizationId, role: only.role, reason: "single_membership" };
  }
  return { ok: false, code: ORGANIZATION_SELECTION_REQUIRED };
}

function rank(role: OrgMembership["role"]): number {
  return role === "owner" ? 3 : role === "admin" ? 2 : 1;
}
