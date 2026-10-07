/**
 * หน้าที่: the real, in-memory Account STORE — registration, suspend, and
 * query. Built 2026-08-16 specifically so `control/entry-context/` can
 * resolve a real, independently-registered Account, never trust a bare
 * `account_id` string or a Membership row alone as proof an account exists
 * (see `../../control/entry-context/resolver.ts`'s header for the gap
 * this closes).
 *
 * DISTINCT FROM `./account.ts` / `./account-registration.ts`: those are
 * older (2026-08-14), pure type-only definitions with a different field
 * shape (`display_name`, lowercase status enum
 * `"pending" | "active" | "suspended" | "revoked"`) and explicitly
 * `NOT_YET_BUILT` — no real store, no registration function. This file is
 * a separate, purpose-built registry matching the newer real-store
 * pattern `../access-control/identity-registry.ts`,
 * `../access-control/membership-registry.ts`, and
 * `../execution-policy/grants.ts` established the same day. Reconciling
 * the two Account concepts into one is a separate, later decision — not
 * assumed or attempted here.
 *
 * REAL, IN-MEMORY, NOT A MOCK: every function does real work against a
 * real `Map`. Durable cross-process persistence is `NOT_YET_BUILT` — the
 * same honest gap `../access-control/identity-registry.ts`,
 * `../access-control/membership-registry.ts`, and
 * `../execution-policy/grants.ts` already document for the same reason.
 *
 * Input: `RegisterAccountInput` (register), an `account_id` (get/suspend).
 * Output: `AccountRecord`, `AccountStatus`, `RegisterAccountInput`,
 * `registerAccount`, `getAccount`, `listAccounts`, `suspendAccount`,
 * `AccountRegistrationError`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never let `getAccount` return a record for an
 * `account_id` that was never registered — absence must be `undefined`,
 * never synthesized. Never delete a record on suspend —
 * `suspendAccount` mutates `status` in place on the same record, matching
 * this repo's append-and-link discipline (see
 * `../access-control/identity-registry.ts`'s,
 * `../access-control/membership-registry.ts`'s same rule). Never add a
 * reactivate/un-suspend/retire operation here speculatively — only
 * `registerAccount`/`getAccount`/`listAccounts`/`suspendAccount` were
 * asked for this round. For that same reason, unlike
 * `../access-control/identity-registry.ts`'s `registerIdentity` (which
 * re-provisions and resets status to "active" on a repeat call),
 * `registerAccount` here THROWS on a repeat `account_id` rather than
 * silently re-registering — a silent re-register would otherwise be an
 * undocumented backdoor reactivate path for a SUSPENDED/RETIRED account,
 * which this round deliberately does not build.
 *
 * NOT_YET_BUILT: no durable storage backend (see header) — real logic,
 * process-local state only. No reactivate/un-suspend/retire operation.
 */

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "RETIRED";

export interface AccountRecord {
  account_id: string;
  status: AccountStatus;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterAccountInput {
  account_id: string;
  metadata?: Record<string, unknown>;
}

export class AccountRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountRegistrationError";
  }
}

const accounts = new Map<string, AccountRecord>();

function nowIsoDefault(): string {
  return new Date().toISOString();
}

/** A fresh registration is always born "ACTIVE". Registering the same account_id twice throws — see this file's header for why that is deliberate, not a missing feature. */
export function registerAccount(input: RegisterAccountInput, createdAt: string = nowIsoDefault()): AccountRecord {
  if (!input.account_id || input.account_id.length === 0) {
    throw new AccountRegistrationError("account_id must be a non-empty string");
  }
  if (accounts.has(input.account_id)) {
    throw new AccountRegistrationError(`account "${input.account_id}" is already registered`);
  }
  const record: AccountRecord = { account_id: input.account_id, status: "ACTIVE", created_at: createdAt, metadata: input.metadata };
  accounts.set(input.account_id, record);
  return record;
}

export function getAccount(accountId: string): AccountRecord | undefined {
  return accounts.get(accountId);
}

export function listAccounts(): readonly AccountRecord[] {
  return [...accounts.values()];
}

export function suspendAccount(accountId: string): AccountRecord {
  const existing = accounts.get(accountId);
  if (!existing) {
    throw new AccountRegistrationError(`no account registered with id "${accountId}"`);
  }
  const updated: AccountRecord = { ...existing, status: "SUSPENDED" };
  accounts.set(accountId, updated);
  return updated;
}

/** Test-only introspection — never imported by any future route. */
export function __debugAccountCount(): number {
  return accounts.size;
}
