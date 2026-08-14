/**
 * Permission Boundary — the enforceable form of the Owner's stated
 * long-term rule (2026-08-14):
 *
 *   Owner controls platform
 *   Tenant controls tenant data
 *   Service accesses only required scope
 *   Cross-tenant access = denied by default
 *
 * Core distinction this whole file exists to enforce: Platform Owner ≠
 * Data Owner. The DNA OS Owner has ultimate authority over DNA OS's own
 * systems (source, infra, AI, deployment, policy, connectors, DNA OS's
 * own company data) — not automatic read access to every tenant's data,
 * even though that data runs on DNA OS's own infrastructure.
 *
 * NOT_YET_BUILT: nothing calls checkAccess() yet — this is the spec the
 * controller (see ../controller/README.md) must call before routing any
 * CommandEnvelope, once the controller itself exists.
 */

import type { CommandEnvelope } from "../contracts/envelope";

export type PlatformCapability =
  | "view_tenant_metadata" // which tenant uses what service, health, storage/billing volume — never content
  | "manage_infrastructure" // deploy, connector registration, source code, policy
  | "break_glass_read"; // see BreakGlassRequest below — never a standing right

/**
 * What the DNA OS Owner (Platform Owner) may do, listed exhaustively on
 * purpose — anything not in this list is NOT a platform-owner right,
 * specifically including "read a tenant's business data/documents/
 * messages."
 */
export const PLATFORM_OWNER_CAPABILITIES: readonly PlatformCapability[] = [
  "view_tenant_metadata",
  "manage_infrastructure",
  "break_glass_read",
] as const;

/**
 * Default authorization rule for any CommandEnvelope: an Identity may only
 * act within the Account scope it is currently exercising
 * (issued_by.acting_as_account_id) — never a fixed "home account," since
 * Identity now holds Membership across possibly many Accounts (see
 * identity-model.ts). Denied by default, no exceptions baked in here —
 * including for the Platform Owner, who must go through BreakGlassRequest
 * below instead of an ambient always-allow rule.
 *
 * This function only checks the envelope's OWN internal consistency
 * (does it claim to act as the account it's targeting). It does NOT
 * verify a real Membership row backs that claim — that lookup needs a
 * real registry/data source and belongs in the controller once one
 * exists (see ../controller/README.md), not in this pure function.
 */
export function isWithinOwnScope(envelope: CommandEnvelope, targetAccountId: string): boolean {
  return envelope.issued_by.acting_as_account_id === targetAccountId;
}

/**
 * Break-glass access — the ONLY path for the Platform Owner (or an
 * authorized support/security role) to read a tenant's actual data scope,
 * e.g. for a support incident, legal matter, recovery, or security event.
 * Not a standing permission: every real use must carry a reason, expire,
 * and be audited, and should require approval per policy — never silently
 * granted by role alone.
 *
 * NOT_YET_BUILT: no approval workflow, no expiry enforcement, no audit
 * sink wired up yet (see ../audit/README.md). This type exists so nothing
 * downstream can be built assuming an Owner has ambient tenant-data
 * access — the shape itself forces a reason and an expiry to exist.
 */
export interface BreakGlassRequest {
  request_id: string;
  requested_by_identity_id: string;
  target_account_id: string;
  reason: string; // required, never optional — no reason, no request
  expires_at: string; // required — a break-glass grant with no expiry is just a standing right by another name
  approved_by?: string; // NOT_YET_BUILT: approval policy not designed yet
  audit_event_id?: string; // links to ../audit/ once that exists
}
