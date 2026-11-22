/**
 * Authority context loader (WAVE 3, 2026-10-25 · STEP 1 hardening, 2026-10-25)
 * — the only place that reads "who is this actor, inside which organizations,
 * holding which grants".
 *
 * STEP 1 (owner directive) binds organization authority to the VERIFIED
 * session identity, never to a client-supplied id and never to a matching
 * email:
 *
 *   auth.users.id ──(same row)──▶ profiles.id ──org_members.user_id──▶ organization_id
 *
 * Rules enforced here (all fail-closed):
 *   B1  `org_members` is read by its REAL column `user_id`. The previous
 *       `profile_id` column does not exist in this schema, so every lookup
 *       errored and returned zero organizations (silently inert).
 *   B2  No `deleted_at` filter — that column does not exist on `org_members`
 *       (real columns: organization_id, user_id, role, created_at).
 *   B3  Organization scope is granted ONLY when the canonical profile IS the
 *       authenticated account (profileId === sessionAccountId), the profile was
 *       resolved by id (not by the email fallback in core/identity), and the
 *       session email is confirmed. Any other case ⇒ zero organizations.
 *   B4  A requested/id-targeted organization is never trusted from the caller:
 *       `assertRequestedOrganizationAllowed` only accepts ids already in the
 *       actor's own membership list, and `loadResourceOrganizationId` reads the
 *       resource's owner organization from the DATABASE (allow-listed tables).
 *   B5  Every error/timeout/missing row ⇒ empty, never "allow".
 *
 * The decision itself stays pure in core/authority/resolve.ts; this module only
 * supplies inputs. Role is passed through for evidence only and the resolver
 * denies a role-only actor by design (ROLE_IS_NOT_AUTHORITY).
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import type { ActorContext, ResourceKind, ScopeGrant } from "@/core/authority/resolve";

export interface AuthorityQueryResult {
  data: unknown;
  error: { message?: string } | null;
}

/** PostgREST builder subset this module needs (tests inject a double). */
export interface AuthorityQueryChain extends PromiseLike<AuthorityQueryResult> {
  is(column: string, value: null): PromiseLike<AuthorityQueryResult>;
  maybeSingle(): PromiseLike<AuthorityQueryResult>;
}

export interface AuthorityLoaderDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): AuthorityQueryChain;
    };
  };
}

const RESOURCE_KINDS: readonly ResourceKind[] = ["pit", "site", "company", "transaction"];
const ACTIONS = ["price.write", "price.offer.record", "site.create", "authority.claim", "authority.decide"] as const;

const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Why organization scope was granted or withheld — persisted as evidence. */
export type OrganizationScopeReason =
  | "MEMBERSHIP_LOADED"
  | "MEMBERSHIP_EMPTY"
  | "MEMBERSHIP_LOOKUP_FAILED"
  | "SESSION_ACCOUNT_REQUIRED"
  | "SESSION_ACCOUNT_MISMATCH"
  | "EMAIL_FALLBACK_IS_NOT_AUTHORITY"
  | "EMAIL_NOT_CONFIRMED";

export interface OrganizationMembership {
  organizations: string[];
  roles: Array<{ organizationId: string; role: string }>;
  error: string | null;
}

/**
 * Organization memberships for the AUTHENTICATED account id.
 *
 * `accountId` must be the auth.users id (which IS profiles.id — the profiles
 * table references auth.users(id)). Never an organization the caller chose,
 * never an email, never a LINE id.
 */
export async function loadOrganizationMembership(
  accountId: string,
  db: AuthorityLoaderDb = supabaseAdmin() as unknown as AuthorityLoaderDb,
): Promise<OrganizationMembership> {
  if (!accountId) return { organizations: [], roles: [], error: "ACCOUNT_REQUIRED" };
  try {
    const { data, error } = await db
      .from("org_members")
      .select("organization_id, role")
      .eq("user_id", accountId); // B1 — the real column (no deleted_at on this table, B2)
    if (error) return { organizations: [], roles: [], error: error.message ?? "QUERY_FAILED" };
    if (!Array.isArray(data)) return { organizations: [], roles: [], error: "UNEXPECTED_SHAPE" };
    const roles = data.flatMap((row) => {
      const item = row as { organization_id?: unknown; role?: unknown };
      const organizationId = asString(item.organization_id);
      const role = asString(item.role);
      return organizationId && role ? [{ organizationId, role }] : [];
    });
    const organizations = Array.from(new Set(roles.map((membership) => membership.organizationId)));
    return { organizations, roles, error: null };
  } catch (e) {
    return { organizations: [], roles: [], error: e instanceof Error ? e.message : "THREW" };
  }
}

/** Backwards-compatible thin wrapper — same fail-closed behaviour, ids only. */
export async function loadOrganizationIds(
  accountId: string,
  db: AuthorityLoaderDb = supabaseAdmin() as unknown as AuthorityLoaderDb,
): Promise<string[]> {
  const { organizations } = await loadOrganizationMembership(accountId, db);
  return organizations;
}

/** Explicit delegations for a profile. Missing table/error ⇒ [] (fail-closed). */
export async function loadScopeGrants(
  profileId: string,
  db: AuthorityLoaderDb = supabaseAdmin() as unknown as AuthorityLoaderDb,
): Promise<ScopeGrant[]> {
  if (!profileId) return [];
  try {
    const { data, error } = await db
      .from("authority_grants")
      .select("id, subject_profile_id, organization_id, resource_kind, resource_id, actions, valid_from, valid_to, revoked_at")
      .eq("subject_profile_id", profileId)
      .is("revoked_at", null);
    if (error) return [];
    if (!Array.isArray(data)) return [];

    const grants: ScopeGrant[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      const id = asString(row.id);
      const subject = asString(row.subject_profile_id);
      const kind = asString(row.resource_kind) as ResourceKind | null;
      if (!id || !subject || subject !== profileId) continue;
      if (!kind || !RESOURCE_KINDS.includes(kind)) continue;
      // An unknown/empty action set can never match a requested action, so it is
      // skipped rather than passed through as a partially-trusted row.
      const actions = Array.isArray(row.actions)
        ? row.actions.filter((a): a is (typeof ACTIONS)[number] => typeof a === "string" && (ACTIONS as readonly string[]).includes(a))
        : [];
      if (actions.length === 0) continue;
      grants.push({
        id,
        subjectProfileId: subject,
        organizationId: asString(row.organization_id),
        resourceKind: kind,
        resourceId: asString(row.resource_id),
        actions,
        validFrom: asString(row.valid_from),
        validTo: asString(row.valid_to),
        revokedAt: null,
      });
    }
    return grants;
  } catch {
    return [];
  }
}

/** A session-derived identity — the ONLY acceptable input for org authority. */
export interface SessionAuthorityInput {
  /** canonical profiles id (core/identity) */
  profileId: string;
  role?: string | null;
  /** auth.users.id from the live session — required for any organization scope */
  sessionAccountId?: string | null;
  /** how the canonical profile was resolved ("id" = same auth user) */
  resolvedBy?: "id" | "email" | null;
  /** GoTrue-confirmed email for this session */
  emailConfirmed?: boolean | null;
}

export interface LoadedAuthority {
  actor: ActorContext;
  grants: ScopeGrant[];
  organizationScope: {
    /** true only when membership was read for the verified session account */
    eligible: boolean;
    reason: OrganizationScopeReason;
    lookupError: string | null;
  };
}

/**
 * Build the resolver input for an authenticated session user.
 *
 * B3 is enforced here, in one place: organization scope requires
 * profileId === sessionAccountId AND resolvedBy === "id" AND a confirmed email.
 * Missing fields (legacy callers) are treated as UNVERIFIED, which yields zero
 * organizations — a caller cannot opt into wider scope by omission.
 */
export async function loadAuthorityContext(
  user: SessionAuthorityInput,
  db: AuthorityLoaderDb = supabaseAdmin() as unknown as AuthorityLoaderDb,
): Promise<LoadedAuthority> {
  const profileId = asString(user.profileId) ?? "";
  const sessionAccountId = asString(user.sessionAccountId);

  const ineligible = (reason: OrganizationScopeReason, lookupError: string | null = null): LoadedAuthority => ({
    actor: { profileId, role: user.role ?? null, organizationIds: [], organizationRoles: [] },
    grants: [],
    organizationScope: { eligible: false, reason, lookupError },
  });

  if (!sessionAccountId) return ineligible("SESSION_ACCOUNT_REQUIRED");
  if (profileId !== sessionAccountId) return ineligible("SESSION_ACCOUNT_MISMATCH");
  if (user.resolvedBy !== "id") return ineligible("EMAIL_FALLBACK_IS_NOT_AUTHORITY");
  if (user.emailConfirmed !== true) return ineligible("EMAIL_NOT_CONFIRMED");

  const [membership, grants] = await Promise.all([
    loadOrganizationMembership(sessionAccountId, db),
    loadScopeGrants(profileId, db),
  ]);

  return {
    actor: {
      profileId,
      role: user.role ?? null,
      organizationIds: membership.organizations,
      organizationRoles: membership.roles,
    },
    grants,
    organizationScope: membership.error
      ? { eligible: true, reason: "MEMBERSHIP_LOOKUP_FAILED", lookupError: membership.error }
      : {
          eligible: true,
          reason: membership.organizations.length ? "MEMBERSHIP_LOADED" : "MEMBERSHIP_EMPTY",
          lookupError: null,
        },
  };
}

export interface OrganizationDecision {
  allowed: boolean;
  reason: string;
}

/**
 * B4 — a requested organization is only valid if it is already in the actor's
 * own membership list. `requestedOrganizationId` may come from anywhere
 * (body/query/header): it is treated as a CLAIM to be checked, never as proof.
 */
export function assertRequestedOrganizationAllowed(
  actor: Pick<ActorContext, "profileId" | "organizationIds"> | null,
  requestedOrganizationId: unknown,
): OrganizationDecision {
  const requested = asString(requestedOrganizationId);
  if (!actor || !actor.profileId) return { allowed: false, reason: "ACTOR_REQUIRED" };
  if (!requested) return { allowed: false, reason: "ORGANIZATION_REQUIRED" };
  const memberships = actor.organizationIds ?? [];
  if (memberships.length === 0) return { allowed: false, reason: "ORGANIZATION_MEMBERSHIP_REQUIRED" };
  if (!memberships.includes(requested)) return { allowed: false, reason: "ORGANIZATION_NOT_MEMBER" };
  return { allowed: true, reason: "ORGANIZATION_MEMBER" };
}

/**
 * B4 — resolve the organization that OWNS an existing resource, from the
 * database (allow-listed tables only), never from the caller.
 *
 * `pit` is deliberately unmapped: pit_profiles has no organization column in
 * this schema (only user_id/owner_type), so its organization is UNKNOWN and the
 * caller must fall back to explicit ownership (resolve.ts R3) or deny.
 */
export async function loadResourceOrganizationId(
  kind: ResourceKind,
  resourceId: string,
  db: AuthorityLoaderDb = supabaseAdmin() as unknown as AuthorityLoaderDb,
): Promise<{ organizationId: string | null; reason: string }> {
  const id = asString(resourceId);
  if (!id) return { organizationId: null, reason: "RESOURCE_ID_REQUIRED" };

  try {
    if (kind === "company") {
      const res = await db.from("companies").select("organization_id").eq("id", id).maybeSingle();
      if (res.error) return { organizationId: null, reason: "LOOKUP_FAILED" };
      const row = (res.data ?? {}) as { organization_id?: unknown };
      const organizationId = asString(row.organization_id);
      return { organizationId, reason: organizationId ? "COMPANY_ORGANIZATION" : "COMPANY_HAS_NO_ORGANIZATION" };
    }

    if (kind === "site" || kind === "transaction") {
      const table = kind === "site" ? "customer_sites" : "customer_orders";
      const res = await db.from(table).select("customer_company_id").eq("id", id).maybeSingle();
      if (res.error) return { organizationId: null, reason: "LOOKUP_FAILED" };
      const ownerCompany = asString(((res.data ?? {}) as { customer_company_id?: unknown }).customer_company_id);
      if (!ownerCompany) return { organizationId: null, reason: "RESOURCE_HAS_NO_OWNER_COMPANY" };
      // one hop: owning company → its organization
      const company = await db.from("companies").select("organization_id").eq("id", ownerCompany).maybeSingle();
      if (company.error) return { organizationId: null, reason: "LOOKUP_FAILED" };
      const organizationId = asString(((company.data ?? {}) as { organization_id?: unknown }).organization_id);
      return { organizationId, reason: organizationId ? "RESOURCE_OWNER_ORGANIZATION" : "OWNER_COMPANY_HAS_NO_ORGANIZATION" };
    }

    if (kind === "pit") {
      // PIT ownership is already connected through the canonical partner
      // profile and company link; resolve the tenant from the database rather
      // than treating pit_profiles.user_id or the request as organization proof.
      const partner = await db
        .from("partner_business_profiles")
        .select("company_id")
        .eq("pit_profile_id", id)
        .maybeSingle();
      if (partner.error) return { organizationId: null, reason: "PIT_PARTNER_LOOKUP_FAILED" };
      const companyId = asString(((partner.data ?? {}) as { company_id?: unknown }).company_id);
      if (!companyId) return { organizationId: null, reason: "PIT_HAS_NO_COMPANY_LINK" };
      const company = await db.from("companies").select("organization_id").eq("id", companyId).maybeSingle();
      if (company.error) return { organizationId: null, reason: "PIT_COMPANY_LOOKUP_FAILED" };
      const organizationId = asString(((company.data ?? {}) as { organization_id?: unknown }).organization_id);
      return {
        organizationId,
        reason: organizationId ? "PIT_PARTNER_COMPANY_ORGANIZATION" : "PIT_COMPANY_HAS_NO_ORGANIZATION",
      };
    }
    return { organizationId: null, reason: "UNSUPPORTED_RESOURCE_KIND" };
  } catch {
    return { organizationId: null, reason: "LOOKUP_THREW" };
  }
}
