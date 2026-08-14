/**
 * Registry schema — source-code-level model only (Owner directive point 5:
 * "สร้าง registry schema ในระดับ source-code model"). This is NOT a
 * database schema and nothing here is persisted anywhere. It exists so the
 * shape of "what would eventually need to be registered" is thought
 * through before any real database is created (point 8).
 *
 * NOT_YET_BUILT: no storage backend chosen, no migration, no table.
 */

import type { Account, Tenant, Software } from "../contracts/identity-model";

/**
 * A registered Account — an external program/AI/future customer that has
 * been given a scope. Distinct from Account in identity-model.ts: that
 * type is "what an Account is," this is "the record that says an Account
 * has been registered and is active."
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
