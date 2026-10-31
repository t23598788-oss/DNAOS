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
 *   S1  `super_admin` is a PLATFORM operator scope (all records), because the
 *       platform must be able to operate unattributed data (86 companies have
 *       organization_id = NULL today). It is evidence, not ownership.
 *   S2  Every other role gets ORGANIZATION scope from `org_members` only. No
 *       organization membership ⇒ mode "none" ⇒ scoped reads are DENIED.
 *   S3  A caller cannot widen scope by supplying an organization id. Scope is
 *       built from the verified session/token actor only (never from input).
 *   S4  `mode: "none"` never means "no filter" — it means "no read".
 *   S5  Records with `organization_id = NULL` are visible only to PLATFORM
 *       scope. An organization scope can never claim them implicitly.
 *
 * Pure module: no I/O, no database, no environment.
 */
import type { AppRole } from "@/core/auth/session";

export type DataScopeMode = "platform" | "organization" | "none";

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

export const PLATFORM_ROLES: readonly string[] = ["super_admin"];

export function platformDataScope(input: {
  profileId?: string | null;
  role?: string | null;
  reason?: string;
} = {}): DataScope {
  return {
    mode: "platform",
    profileId: input.profileId ?? null,
    role: input.role ?? "super_admin",
    organizationIds: [],
    reason: input.reason ?? "PLATFORM_SUPER_ADMIN",
  };
}

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
  if (role && PLATFORM_ROLES.includes(role)) {
    return platformDataScope({ profileId: input.profileId ?? null, role, reason: input.reason });
  }
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

export type SessionRequestScopeIntent = "current-organization" | "platform-wide";

export function resolveRequestDataScope(input: {
  profileId?: string | null;
  role?: string | null;
  organizationIds?: string[] | null;
  sessionVerified: boolean;
  intent: SessionRequestScopeIntent;
}): DataScope {
  const role = typeof input.role === "string" && input.role.trim() ? input.role.trim() : null;
  const deny = (reason: string): DataScope => ({
    ...NO_DATA_SCOPE,
    profileId: input.profileId ?? null,
    role,
    reason,
  });

  if (!input.sessionVerified || !input.profileId) return deny("UNVERIFIED_SESSION");

  if (input.intent === "platform-wide") {
    if (!role || !PLATFORM_ROLES.includes(role)) return deny("PLATFORM_SCOPE_FORBIDDEN");
    return platformDataScope({
      profileId: input.profileId,
      role,
      reason: "EXPLICIT_PLATFORM_REQUEST",
    });
  }

  const organizationIds = Array.from(
    new Set((input.organizationIds ?? []).filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean)),
  );
  if (organizationIds.length !== 1) {
    return deny(organizationIds.length === 0 ? "ACTIVE_ORGANIZATION_UNAVAILABLE" : "ACTIVE_ORGANIZATION_AMBIGUOUS");
  }

  return organizationDataScope({
    profileId: input.profileId,
    role,
    organizationIds,
    reason: "VERIFIED_ACTIVE_ORGANIZATION",
  });
}

/** True only when this scope may read tenant-scoped business records. */
export function scopeCanReadTenantData(scope: DataScope | null | undefined): boolean {
  if (!scope) return false;
  if (scope.mode === "platform") return true;
  return scope.mode === "organization" && scope.organizationIds.length > 0;
}

/** A resource's organization is readable iff the scope is platform or matches. */
export function scopeCoversOrganization(
  scope: DataScope | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  if (!scope) return false;
  if (scope.mode === "platform") return true;
  if (scope.mode !== "organization") return false;
  if (!organizationId) return false; // S5 — NULL is platform-only
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
