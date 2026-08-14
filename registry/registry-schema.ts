/**
 * Registry schema — source-code-level model only (Owner directive point 5:
 * "สร้าง registry schema ในระดับ source-code model"). This is NOT a
 * database schema and nothing here is persisted anywhere. It exists so the
 * shape of "what would eventually need to be registered" is thought
 * through before any real database is created (point 8).
 *
 * NOT_YET_BUILT: no storage backend chosen, no migration, no table.
 */

import type { Account, Tenant, Software, Identity, BusinessDomain } from "../contracts/identity-model";

/**
 * Membership, AccountResourceGrant, and AccountTenantAssignment
 * (identity-model.ts) are already registry-shaped records — each carries
 * its own granted_at/assigned_at + revoked_at/ended_at lifecycle fields —
 * so they are re-exported here for discoverability rather than wrapped in
 * a redundant *Registration type. No behavior added, just a single place
 * to find every registrable record.
 */
export type { Membership, AccountResourceGrant, AccountTenantAssignment } from "../contracts/identity-model";

/**
 * A registered Identity — a real, known principal (human/ai_agent/
 * external_program/service). Distinct from Identity in identity-model.ts
 * the same way every *Registration type here is: that type is "what it
 * is," this is "the record that says it's been registered."
 */
export interface IdentityRegistration {
  identity: Identity;
  status: "active" | "suspended" | "revoked";
  registered_at: string;
}

/**
 * A registered Account — an ownership/responsibility boundary that has
 * been given a scope. Says nothing about what the Account IS for
 * (business domain vs external program vs anything else) — that's what
 * AccountResourceGrant records against it.
 */
export interface AccountRegistration {
  account: Account;
  status: "pending" | "active" | "suspended" | "revoked";
  registered_at: string;
}

/** A registered Tenant — a real data partition that has been provisioned (or, today, declared but not provisioned — see Tenant.data_residency_note). */
export interface TenantRegistration {
  tenant: Tenant;
  status: "declared" | "provisioned"; // "provisioned" is NOT_YET_BUILT — no real backend exists for any tenant yet
}

/** A registered Software type — a known kind of external caller. */
export interface SoftwareRegistration {
  software: Software;
  registered_at: string;
}

/** A registered Business Domain — a known business line/operating area an Account may be granted (see AccountResourceGrant). Which real domains dna-os-deadboard has is still not decided here (NOT_YET_BUILT — needs an evidence pass, not a guess). */
export interface BusinessDomainRegistration {
  business_domain: BusinessDomain;
  registered_at: string;
}

/**
 * A registered connection: which Account is using which Software, via
 * which destination adapter (see ../connectors/README.md), holding only a
 * REFERENCE to where the real credential lives — never the credential
 * itself. Directly reuses the pattern proven and verified in
 * dna-os-deadboard's TASK-172 (connectors.config.secret_env_var): the
 * database/registry never holds a token, only the name of where to find
 * one.
 */
export interface ConnectionRegistration {
  connection_id: string;
  account_id: string;
  software_id: string;
  adapter: string; // e.g. "github", "vercel", "supabase" — matches a real adapter in ../connectors/ once one exists
  credential_ref: { kind: "env_var"; name: string } | { kind: "not_yet_built" };
  status: "disconnected" | "connecting" | "connected" | "error";
}
