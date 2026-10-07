/**
 * หน้าที่: the record that says a given Identity has been registered and
 * is active — distinct from identity.ts's Identity, which only defines
 * what an Identity IS. Now also the real, in-memory registration STORE
 * (Owner, 2026-08-16 — needed so `control/entry-context/` can resolve a
 * real Identity, never a fabricated one).
 *
 * REAL, IN-MEMORY, NOT A MOCK: `registerIdentity`/`setIdentityStatus`
 * really store/mutate a real `Map`; `getIdentityRegistration` reads that
 * same real state back. What's still `NOT_YET_BUILT` is durable
 * cross-process persistence — this is a source-code-level model only, do
 * not wire a real database to this file as part of any "just add
 * persistence" change without an explicit Owner-approved migration step
 * (unchanged from this file's original constraint).
 *
 * Input: an `Identity` (see ./identity.ts) to register; an `identity_id`
 * to look up or change status.
 * Output: `IdentityRegistration`, `registerIdentity`,
 * `getIdentityRegistration`, `setIdentityStatus`,
 * `listIdentityRegistrations`, `IdentityRegistrationError`.
 * Dependency ที่อนุญาต: ./identity.ts.
 * สิ่งที่ห้ามแตะ: never let `getIdentityRegistration` return a registration
 * for an `identity_id` that was never registered — absence must be
 * `undefined`, never synthesized. Never delete a registration on status
 * change — `setIdentityStatus` mutates `status` in place on the same
 * record, matching this repo's append-and-link discipline (see
 * ./membership-registry.ts's, ../execution-policy/grants.ts's same rule).
 *
 * NOT_YET_BUILT: no durable storage backend (see header) — real logic,
 * process-local state only.
 */

import type { Identity } from "./identity";

export interface IdentityRegistration {
  identity: Identity;
  status: "active" | "suspended" | "revoked";
  registered_at: string;
}

export class IdentityRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityRegistrationError";
  }
}

const registrations = new Map<string, IdentityRegistration>();

function nowIsoDefault(): string {
  return new Date().toISOString();
}

/** Registering the same identity_id twice re-registers it (status reset to "active", registered_at updated) rather than throwing — matches a real "re-provision" use case; the caller decides if that's appropriate. */
export function registerIdentity(identity: Identity, registeredAt: string = nowIsoDefault()): IdentityRegistration {
  if (!identity.identity_id || identity.identity_id.length === 0) {
    throw new IdentityRegistrationError("identity.identity_id must be a non-empty string");
  }
  const registration: IdentityRegistration = { identity, status: "active", registered_at: registeredAt };
  registrations.set(identity.identity_id, registration);
  return registration;
}

export function getIdentityRegistration(identityId: string): IdentityRegistration | undefined {
  return registrations.get(identityId);
}

export function setIdentityStatus(identityId: string, status: IdentityRegistration["status"]): IdentityRegistration {
  const existing = registrations.get(identityId);
  if (!existing) {
    throw new IdentityRegistrationError(`no identity registered with id "${identityId}"`);
  }
  const updated: IdentityRegistration = { ...existing, status };
  registrations.set(identityId, updated);
  return updated;
}

export function listIdentityRegistrations(): readonly IdentityRegistration[] {
  return [...registrations.values()];
}

/** Test-only introspection — never imported by any future route. */
export function __debugIdentityRegistrationCount(): number {
  return registrations.size;
}
