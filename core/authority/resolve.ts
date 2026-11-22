/**
 * Central authority resolver (WAVE 2, 2026-10-25) — PURE, no I/O.
 *
 * The one definition this system uses for:
 *
 *   Actor → Organization → Resource → Granted Scope → Allowed Action
 *
 * Non-negotiable rules (owner directive, WAVE 2 §02):
 *   R1  An admin/system role alone NEVER authorises an action on someone
 *       else's resource. `ADMIN_TIER` is a system-role fact, not ownership.
 *       It only authorises "platform" actions (no resource at all).
 *   R2  Identity provider data (LINE link order, display name, company name)
 *       is NOT authority. This module has no input for it, so a caller
 *       cannot accidentally reintroduce first-link / name matching.
 *   R3  Ownership is explicit: resource.ownerProfileId === actor.profileId.
 *   R4  Delegation is explicit: a grant row with the action, inside its valid
 *       window, not revoked, and matching the same resource/organization.
 *   R5  Anything missing/ambiguous/expired → DENY (fail-closed).
 *
 * The caller (canonical writer / internal boundary) must stop on DENY; this
 * module never performs a write and never reads the database.
 */

/** Closed action vocabulary — adding an action is an explicit decision, not a free-form string. */
export const AUTHORITY_ACTIONS = [
  "price.write", // change a central (published) material price
  "price.offer.record", // record a seller's quoted offer from a channel
  "site.create", // create a customer site
  "authority.claim", // open a delegation/authorisation request
  "authority.decide", // approve/deny a delegation request
] as const;
export type AuthorityAction = (typeof AUTHORITY_ACTIONS)[number];

export type ResourceKind = "pit" | "site" | "company" | "transaction";

export interface ActorContext {
  /** the real profile id (never an email or a LINE id) */
  profileId: string;
  /** system role — informational; never sufficient on its own (R1) */
  role?: string | null;
  /** organizations the actor belongs to (org_members today) */
  organizationIds?: string[];
}

export interface ResourceRef {
  kind: ResourceKind;
  id: string;
  /** explicit owner of the resource, when known (pit_profiles.user_id today) */
  ownerProfileId?: string | null;
  /** organization that owns the resource, when known */
  organizationId?: string | null;
}

/** An explicit delegation row (authority_grants is the proposed home; existing rows can be adapted). */
export interface ScopeGrant {
  id: string;
  subjectProfileId: string;
  organizationId?: string | null;
  resourceKind: ResourceKind;
  /** exact resource id, or "*" for every resource of this kind inside the organization */
  resourceId?: string | null;
  actions: AuthorityAction[];
  validFrom?: string | null;
  validTo?: string | null;
  revokedAt?: string | null;
}

export interface AuthorityDecision {
  allowed: boolean;
  /** stable machine reason — logged as evidence, shown to the caller */
  reason: string;
  via: "owner" | "grant" | "platform" | "none";
  grantId: string | null;
}

export interface ResolveAuthorityInput {
  actor: ActorContext | null;
  action: AuthorityAction | string;
  /** null = a platform action that is not scoped to a resource */
  resource?: ResourceRef | null;
  grants?: ScopeGrant[];
  /** ISO timestamp used for the validity window (defaults to now) */
  at?: string;
}

const deny = (reason: string, via: AuthorityDecision["via"] = "none"): AuthorityDecision => ({
  allowed: false,
  reason,
  via,
  grantId: null,
});

const isKnownAction = (a: string): a is AuthorityAction => (AUTHORITY_ACTIONS as readonly string[]).includes(a);

const parseTime = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Actions an owner may take on their own resource without a delegation row. */
const OWNER_ACTIONS: readonly AuthorityAction[] = ["price.write", "price.offer.record", "site.create"];

/** Actions that are platform-level (no resource) — the ONLY place a role is enough. */
const PLATFORM_ACTIONS: readonly AuthorityAction[] = [];

export function resolveAuthority(input: ResolveAuthorityInput): AuthorityDecision {
  const { actor, action, resource, grants = [] } = input;

  // R5 — no actor, no authority.
  if (!actor || !actor.profileId) return deny("ACTOR_REQUIRED");
  if (!isKnownAction(action)) return deny("ACTION_NOT_ALLOWED");

  const atMs = parseTime(input.at ?? new Date().toISOString());
  if (atMs === null) return deny("INVALID_TIME");

  // No resource: only a declared platform action may pass (R1/R5).
  if (!resource) {
    if (PLATFORM_ACTIONS.includes(action)) {
      return { allowed: true, reason: "PLATFORM_ACTION", via: "platform", grantId: null };
    }
    return deny("RESOURCE_REQUIRED");
  }

  if (!resource.id) return deny("RESOURCE_ID_REQUIRED");

  // R3 — explicit ownership.
  if (OWNER_ACTIONS.includes(action) && resource.ownerProfileId && resource.ownerProfileId === actor.profileId) {
    return { allowed: true, reason: "RESOURCE_OWNER", via: "owner", grantId: null };
  }

  // R4 — explicit delegation, evaluated in a deterministic order (first valid wins).
  const orgIds = new Set(actor.organizationIds ?? []);
  for (const grant of grants) {
    if (!grant || grant.subjectProfileId !== actor.profileId) continue;
    if (grant.revokedAt) continue;
    if (!grant.actions.includes(action)) continue;
    if (grant.resourceKind !== resource.kind) continue;
    const scopeId = grant.resourceId ?? "*";
    if (scopeId !== "*" && scopeId !== resource.id) continue;
    // Organization must match when either side declares one — never "unknown means yes".
    if (grant.organizationId || resource.organizationId) {
      if (!grant.organizationId || !resource.organizationId) continue;
      if (grant.organizationId !== resource.organizationId) continue;
      if (!orgIds.has(grant.organizationId)) continue;
    }
    if (grant.validFrom) {
      const from = parseTime(grant.validFrom);
      if (from === null || atMs < from) continue;
    }
    if (grant.validTo) {
      const to = parseTime(grant.validTo);
      // validTo is inclusive; an unparseable date denies (never "no expiry by accident").
      if (to === null || atMs > to) continue;
    }
    return { allowed: true, reason: "DELEGATED_SCOPE", via: "grant", grantId: grant.id };
  }

  // R1 — a system role is never a substitute for ownership/delegation.
  if (actor.role === "admin") {
    return deny("ROLE_IS_NOT_AUTHORITY");
  }

  return deny("NO_MATCHING_SCOPE");
}

/** Convenience: the exact evidence shape every caller should persist with the write. */
export function authorityEvidence(decision: AuthorityDecision) {
  return {
    authority_allowed: decision.allowed,
    authority_reason: decision.reason,
    authority_via: decision.via,
    authority_grant_id: decision.grantId,
  };
}
