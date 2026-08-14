/**
 * Identity / Account / Tenant / Software / Workspace — meaning, defined
 * before any database exists (Owner directive 2026-08-14, point 8: define
 * these first, don't put every field on every record just to future-proof).
 *
 * These are five DIFFERENT axes, not five names for the same thing. A
 * record only carries the ones it actually needs — see the per-type notes
 * below and CommandEnvelope/EventEnvelope in ./envelope.ts for the one
 * place all five legitimately appear together (the boundary object, by
 * design, since that's the one place that needs to know all of them at
 * once to authorize and route).
 *
 * NOT_YET_BUILT: none of this is persisted anywhere. These are TypeScript
 * types only — the source-code-level model requested, not a real schema.
 */

/**
 * Identity — the most granular "who is acting right now." One authenticated
 * principal: a human user, an AI agent, or an external program/service
 * credential. Always belongs to exactly one Account.
 *
 * Two Identities under the same Account are NOT interchangeable — e.g.
 * "the GitHub PAT credential" and "a human clicking a button in a Settings
 * page" are two different Identities even when acting for the same Account,
 * because they have different real capabilities and different evidence
 * trails.
 */
export type IdentityKind = "human" | "ai_agent" | "external_program" | "service";

export interface Identity {
  identity_id: string;
  account_id: string; // the one Account this Identity belongs to — never many
  kind: IdentityKind;
  display_name: string;
}

/**
 * Account — the ownership/responsibility unit. "Who owns this data, who is
 * responsible for it, who it's billed to (if billing ever applies)." Can
 * have multiple Identities (e.g. several human users, or a human plus a
 * service credential, all acting for the same Account).
 *
 * Corrected 2026-08-14 (Owner): this is NOT "one Account per company" —
 * "DNA OS's own operational system" is not itself a single Account. The
 * real unit is the Business Domain: a distinct business line/operating
 * area (e.g. materials sales, equipment/pit operations, debt & finance —
 * dna-os-deadboard already has a real precedent for exactly this split,
 * its `factory_app_role` vs `business_app_role` Postgres roles). Each real
 * Business Domain gets its own Account here, with its own scope, even
 * when every domain ultimately has the same human Owner — ownership by
 * the same person does not mean the domains' data/permissions should flow
 * into each other automatically. Which concrete domains dna-os-deadboard
 * actually has is NOT decided in this file — that needs its own
 * evidence-based pass against the real codebase, not a guess made here.
 *
 * "Kimi Code" (an external connecting program) is a different KIND of
 * Account than a Business Domain, but the same TYPE — both are just
 * Accounts with their own scope. Neither is a "master account" with
 * rights over the others (see permissions/boundary.ts).
 */
export interface Account {
  account_id: string;
  tenant_id: string; // which data partition this Account's data lives in
  display_name: string;
  created_at: string;
}

/**
 * Tenant — the data-isolation boundary. Determines which physical/logical
 * data partition (which database, schema, or adapter target) an Account's
 * data lives in. This is what makes "move this group of Accounts to a
 * different database/server without changing the client's command shape"
 * possible (Owner's stated long-term goal) — the client only ever knows
 * its account_id; which tenant/backend that resolves to is this system's
 * job, not the client's.
 *
 * Default assumption, not yet tested against a real second tenant: one
 * Tenant per Account (1:1) until there's a real reason to group several
 * Accounts under one Tenant (e.g. shared infra placement). Don't build
 * multi-account tenants speculatively — this type allows it (Account has
 * its own tenant_id, not the reverse), but nothing here assumes it's
 * needed yet.
 */
export interface Tenant {
  tenant_id: string;
  display_name: string;
  data_residency_note?: string; // e.g. which real backend this tenant's data lives on — NOT_YET_BUILT, no real backend assigned yet
}

/**
 * Software — WHICH external program/product/system is making the call.
 * Distinct from Account (the specific customer/owner instance) and
 * Identity (the specific credential/session): many different Accounts
 * might all connect via the same Software (e.g. many different external
 * accounts all happen to use "Kimi Code CLI"), and one Account might use
 * several different Software types over time.
 *
 * This is what answers "what kind of thing is talking to us," which
 * matters for capability negotiation (a GitHub PAT integration and a
 * chat-based AI agent have different real capabilities) independent of
 * who owns the call.
 */
export interface Software {
  software_id: string;
  name: string; // e.g. "kimi-code-cli", "dna-os-operational", "future-erp-integration"
  vendor?: string;
}

/**
 * Workspace — a scoped working context WITHIN an Account/Tenant. Maps
 * loosely to "which specific integration/project/environment is active"
 * (e.g. a specific sync-path config, a specific dev/staging/prod
 * environment). Optional by design — most Commands/Events won't need one.
 *
 * Deliberately the least-specified concept here (Owner's own caution
 * against premature future-proofing applies hardest to this one) — real
 * shape should be derived from the first real Workspace use case, not
 * guessed now. Left as an id-only reference so other contracts can point
 * at it without this file overcommitting to its internal shape.
 */
export interface WorkspaceRef {
  workspace_id: string;
  account_id: string;
}

/**
 * Relationships, stated explicitly so nothing here is ambiguous:
 *
 *   Tenant   (1) ── contains ──►  Account   (many)
 *   Account  (1) ── has ──►       Identity  (many)
 *   Account  (1) ── uses ──►      Software  (many, via a registered connection — see registry/registry-schema.ts)
 *   Account  (1) ── organizes work into ──► Workspace (many, optional)
 *
 * A Command or Event at the system boundary carries identity_id +
 * account_id + tenant_id + software_id + its own event_or_command_id
 * (see envelope.ts) because the boundary is the one place that must
 * resolve "who, whose data, which partition, via what, and which specific
 * action" all at once before anything is authorized or routed. Internal
 * records past that boundary only carry the subset they actually need —
 * e.g. an adapter-level log only needs account_id + the id of the
 * command/event it's evidence for, not the full five fields.
 */
