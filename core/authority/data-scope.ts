/**
 * Data access scope — WHO a server-side data read is allowed to see.
 *
 * This is deliberately separate from `core/authority/resolve.ts`:
 *   - resolve.ts answers "may this actor ACT on this resource" (write authority)
 *   - this module answers "may this actor SEE this tenant's records" (read scope)
 *
 * Owner directive (2026-10-25, STEP 1): AI must not read records outside the
 * caller's entitlement, while legitimate business commands must keep working.
 *
 * Rules (fail-closed):
 *   S1  Every role gets ORGANIZATION scope from `org_members` only. No
 *       organization membership ⇒ mode "none" ⇒ scoped reads are DENIED.
 *   S2  A caller cannot widen scope by supplying an organization id. Scope is
 *       built from the verified session/token actor only (never from input).
 *   S3  `mode: "none"` never means "no filter" — it means "no read".
 *   S4  Records with `organization_id = NULL` are not visible to business users.
 *
 * Pure module: no I/O, no database, no environment.
 */
import type { AppRole } from "@/core/auth/session";

export type DataScopeMode = "organization" | "none";

export interface DataScope {
  mode: DataScopeMode;
  /** canonical profiles.id of the actor (evidence only) */
  profileId: string | null;
  role: AppRole | string | null;
  /** organizations the actor actually belongs to (org_members) */
  organizationIds: string[];
  /** stable machine reason, persisted as evidence with a read decision */
  reason: string;
}

export const NO_DATA_SCOPE: DataScope = Object.freeze({
  mode: "none",
  profileId: null,
  role: null,
  organizationIds: [],
  reason: "NO_VERIFIED_ACTOR",
});

// Kept as an empty compatibility export for pure authorization consumers.
// No user role grants platform-wide data scope.
export const PLATFORM_ROLES: readonly string[] = Object.freeze([]);

export function organizationDataScope(input: {
  profileId: string;
  role?: string | null;
  organizationIds: string[];
  reason?: string;
}): DataScope {
  const organizationIds = Array.from(new Set(input.organizationIds.filter(Boolean)));
  if (organizationIds.length === 0) return NO_DATA_SCOPE;
  return {
    mode: "organization",
    profileId: input.profileId,
    role: input.role ?? null,
    organizationIds,
    reason: input.reason ?? "ORGANIZATION_MEMBERSHIP",
  };
}

/**
 * Build the scope from evidence already resolved by the authority layer.
 * Missing/unknown role or membership ⇒ "none" (DENY), never a default allow.
 */
export function resolveDataScope(input: {
  profileId?: string | null;
  role?: string | null;
  organizationIds?: string[] | null;
  reason?: string;
}): DataScope {
  const role = typeof input.role === "string" && input.role.trim() ? input.role.trim() : null;
  const organizationIds = (input.organizationIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  if (!input.profileId || organizationIds.length === 0) return NO_DATA_SCOPE;
  return organizationDataScope({
    profileId: input.profileId,
    role,
    organizationIds,
    reason: input.reason ?? "ORGANIZATION_MEMBERSHIP",
  });
}

/** True only when this scope may read tenant-scoped business records. */
export function scopeCanReadTenantData(scope: DataScope | null | undefined): boolean {
  if (!scope) return false;
  return scope.mode === "organization" && scope.organizationIds.length > 0;
}

/** A resource's organization is readable iff it matches an explicit membership. */
export function scopeCoversOrganization(
  scope: DataScope | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  if (!scope) return false;
  if (scope.mode !== "organization") return false;
  if (!organizationId) return false;
  return scope.organizationIds.includes(organizationId);
}

/**
 * Commands whose result contains tenant business records. The dispatcher
 * denies these when no scope is present and filters them by scope otherwise.
 * `material.list`, `business.calculate_tax` and `invoice.items` are excluded:
 * they read central/master data or pure calculation inputs, not records.
 */
export const TENANT_SCOPED_READ_COMMANDS: ReadonlySet<string> = new Set([
  "partner.list",
  "partner.find",
  "partner.profile",
  "partner.timeline",
  "debt.current",
  "debt.list",
  "debt.all",
  "debt.trackings",
  "invoice.list",
  "invoice.latest",
  "document.list",
  "document.boq",
  "document.po",
  "document.do",
  "document.receipt",
  "job.list",
  "job.active",
]);

export function isTenantScopedRead(command: string): boolean {
  return TENANT_SCOPED_READ_COMMANDS.has(command);
}
