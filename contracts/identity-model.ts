/**
 * Identity / Account / Tenant / Software / BusinessDomain / Workspace —
 * meaning, defined before any database exists (Owner directive 2026-08-14,
 * point 8). Revised 2026-08-14 (second correction pass) per Owner:
 *
 *   1. Identity is an independent principal — never locked to one Account.
 *      Relationship to any Account/Tenant/Workspace goes through Membership.
 *   2. Account = ownership/responsibility boundary only. Account != Business
 *      Domain. Business Domain, Software, and Workspace are resources/scopes
 *      an Account can hold or be granted use of — not properties of Account.
 *   3. Account/Tenant/Workspace is an explicit, extensible RELATIONSHIP
 *      (AccountTenantAssignment below), not a hardcoded 1:1 assumption —
 *      and not over-built beyond what has a real use case today either.
 *
 * NOT_YET_BUILT: none of this is persisted anywhere. Types only.
 */

/**
 * Identity — the most granular "who is acting right now." One authenticated
 * principal: a human user, an AI agent, or an external program/service
 * credential.
 *
 * Corrected: an Identity is NOT scoped to a single Account. It is a
 * standalone principal that may hold Membership in zero, one, or many
 * Accounts/Tenants/Workspaces (see Membership below) without ever being
 * duplicated. "The same human logs into two different Business Domains"
 * is one Identity with two Memberships, not two Identities.
 */
export type IdentityKind = "human" | "ai_agent" | "external_program" | "service";

export interface Identity {
  identity_id: string;
  kind: IdentityKind;
  display_name: string;
}

/**
 * Membership — the relationship that actually grants an Identity a role or
 * scope inside an Account, a Tenant, or a Workspace. This is the ONE
 * mechanism for "Identity X can act as Account Y" — Identity itself never
 * says this directly.
 *
 * One Identity can hold many Memberships (many Accounts, or a Tenant-wide
 * role, or a specific Workspace role) simultaneously, without duplicating
 * the Identity record.
 */
export type MembershipScopeType = "account" | "tenant" | "workspace";

export interface Membership {
  membership_id: string;
  identity_id: string;
  scope_type: MembershipScopeType;
  scope_id: string; // an account_id, tenant_id, or workspace_id, depending on scope_type
  role: string; // scope-specific role/permission label — not enumerated here, owned by permissions/boundary.ts once real roles exist
  granted_at: string;
  revoked_at?: string; // membership history is kept, never deleted — matches this whole codebase's append-and-link discipline
}

/**
 * Account — the ownership/responsibility unit. "Who owns this data, who is
 * responsible for it, who it's billed to (if billing ever applies)." That
 * is ALL an Account means — it does not mean "a business domain," "a piece
 * of software," or "a workspace." Those are separate concepts an Account
 * can hold or be granted (see BusinessDomain, Software, AccountResourceGrant,
 * Workspace below).
 *
 * Which Identities can act for an Account is determined entirely by
 * Membership rows targeting this account_id — never a field on Account
 * itself.
 */
export interface Account {
  account_id: string;
  display_name: string;
  created_at: string;
}

/**
 * Tenant — the data-isolation boundary. Determines which physical/logical
 * data partition (which database, schema, or adapter target) an Account's
 * data lives in. Kept separate from Account so a group of Accounts can
 * later share a Tenant, or one Account's data can move to a different
 * Tenant, without changing what an Account means.
 */
export interface Tenant {
  tenant_id: string;
  display_name: string;
  data_residency_note?: string; // which real backend this tenant's data lives on — NOT_YET_BUILT, no real backend assigned yet
}

/**
 * Account <-> Tenant is an explicit relationship, not a field on either
 * type — this is what "Account/Tenant/Workspace is a relationship that can
 * expand later" (Owner, point 3) actually means at the type level.
 *
 * Today's real operating assumption (not a type-level constraint): each
 * Account resolves to exactly one ACTIVE assignment at a time — the
 * simplest thing that could work, with zero speculative multi-tenant
 * resolution logic built for a use case that doesn't exist yet. The type
 * itself does not forbid an Account having multiple assignments over time
 * (history is kept via ended_at, same discipline as Membership above); it
 * just doesn't build any machinery for "an Account active in two Tenants
 * at once" before that's a real requirement.
 */
export interface AccountTenantAssignment {
  account_id: string;
  tenant_id: string;
  assigned_at: string;
  ended_at?: string;
}

/**
 * Software — WHICH external program/product/system is making a call.
 * Distinct from Account (the specific owner instance) and Identity (the
 * specific credential/session): many different Accounts might all connect
 * via the same Software, and one Account might use several Software types.
 *
 * This is a RESOURCE an Account can be granted use of (see
 * AccountResourceGrant) — never a property baked into Account.
 */
export interface Software {
  software_id: string;
  name: string; // e.g. "kimi-code-cli", "future-erp-integration"
  vendor?: string;
}

/**
 * Business Domain — a distinct business line/operating area (e.g.
 * materials sales, equipment/pit operations, debt & finance —
 * dna-os-deadboard's real factory_app_role/business_app_role split is
 * live precedent that domains like this genuinely exist there). A
 * RESOURCE/scope an Account can hold, exactly like Software — never
 * assumed to equal an Account. Which real Business Domains
 * dna-os-deadboard has is still not decided in this file — that needs its
 * own evidence pass against the real codebase.
 */
export interface BusinessDomain {
  business_domain_id: string;
  name: string;
}

/**
 * The relationship "this Account holds/may use this resource" — generic
 * across the two resource kinds defined so far. Deliberately a plain,
 * flat grant (account_id + resource_type + resource_id) rather than a
 * separate join table per resource type, since nothing here has a real
 * use case yet for resource-type-specific grant fields.
 */
export type GrantableResourceType = "business_domain" | "software";

export interface AccountResourceGrant {
  grant_id: string;
  account_id: string;
  resource_type: GrantableResourceType;
  resource_id: string; // a business_domain_id or software_id, depending on resource_type
  granted_at: string;
  revoked_at?: string;
}

/**
 * Workspace — a scoped working context within an Account (e.g. a specific
 * integration/project/environment). Deliberately the least-specified
 * concept here — real shape should come from the first real Workspace use
 * case, not be guessed now. An Identity can hold Membership directly at
 * workspace scope (see Membership.scope_type) without that Membership
 * having to pass through the parent Account's own role.
 */
export interface Workspace {
  workspace_id: string;
  account_id: string;
  display_name: string;
}

/**
 * Relationships, stated explicitly:
 *
 *   Identity  (many) ── Membership ──►  Account | Tenant | Workspace  (scope, with a role)
 *   Account   (many) ── AccountTenantAssignment ──► Tenant  (today: one active at a time, not type-enforced)
 *   Account   (many) ── AccountResourceGrant ──►  BusinessDomain | Software  (resources it holds)
 *   Workspace (many) ── belongs to ──►  Account  (one)
 *
 * A Command or Event at the system boundary still needs to resolve to
 * exactly one Account's scope before it's authorized — but that Account is
 * whichever one the caller's current Membership says they're acting as for
 * THIS request, not a fixed property of their Identity. See
 * envelope.ts's EnvelopeIdentity for how a request declares which
 * Membership it's exercising.
 */
