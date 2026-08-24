/**
 * หน้าที่: the real test for `../account-registry.ts` — the real,
 * in-memory Account STORE. Drives the module's own exports directly by
 * hand, the same convention as
 * `../../execution-policy/tests/grants.test.ts` and
 * `../../access-control/`'s sibling registries (this folder has no
 * `contract.ts` of its own yet — see `../account-registry.ts`'s header —
 * so this test imports the module directly, matching how
 * `../../access-control/identity-registry.ts` is imported directly
 * elsewhere in this repo before a contract.ts exists for it).
 *
 * How to run: npx tsx permissions/software-scope/tests/account-registry.test.ts
 *
 * Input: none (all fixtures constructed in this file).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: only ../account-registry.ts.
 * สิ่งที่ห้ามแตะ: never assert a specific ordering of `listAccounts()` —
 * only membership/shape.
 */

import { AccountRegistrationError, getAccount, listAccounts, registerAccount, suspendAccount, __debugAccountCount } from "../account-registry";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function check(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function uniqueId(label: string): string {
  return `${label}-${Math.random().toString(36).slice(2)}`;
}

check("registerAccount stores a real, retrievable, ACTIVE account", () => {
  const accountId = uniqueId("account");
  const record = registerAccount({ account_id: accountId });
  assert(record.account_id === accountId, "expected the returned record's account_id to match the input");
  assert(record.status === "ACTIVE", `expected a freshly registered account to be ACTIVE, got ${record.status}`);
  assert(typeof record.created_at === "string" && record.created_at.length > 0, "expected a real created_at timestamp");
  const fetched = getAccount(accountId);
  assert(fetched !== undefined && fetched.account_id === accountId, "expected the registered account to be retrievable by id");
});

check("registerAccount stores optional metadata", () => {
  const accountId = uniqueId("account");
  const record = registerAccount({ account_id: accountId, metadata: { plan: "enterprise" } });
  assert(record.metadata?.plan === "enterprise", "expected metadata to be stored on the real record");
});

check("registerAccount rejects an empty account_id (fails closed, never stores a partial record)", () => {
  let threw = false;
  try {
    registerAccount({ account_id: "" });
  } catch (error) {
    threw = true;
    assert(error instanceof AccountRegistrationError, `expected AccountRegistrationError, got ${String(error)}`);
  }
  assert(threw, "expected registerAccount to throw for an empty account_id");
});

check("registerAccount throws on a repeat account_id — no silent re-provision/reactivate backdoor", () => {
  const accountId = uniqueId("account");
  registerAccount({ account_id: accountId });
  let threw = false;
  try {
    registerAccount({ account_id: accountId });
  } catch (error) {
    threw = true;
    assert(error instanceof AccountRegistrationError, `expected AccountRegistrationError, got ${String(error)}`);
  }
  assert(threw, "expected a second registerAccount call for the same account_id to throw");
});

check("getAccount returns undefined for an account_id that was never registered — never synthesized", () => {
  const fetched = getAccount(uniqueId("never-registered"));
  assert(fetched === undefined, "expected undefined for an unregistered account_id");
});

check("listAccounts includes every real registered account", () => {
  const before = __debugAccountCount();
  const accountId = uniqueId("account");
  registerAccount({ account_id: accountId });
  const listed = listAccounts();
  assert(listed.length === before + 1, `expected listAccounts() to grow by exactly 1, got ${listed.length - before}`);
  assert(listed.some((a) => a.account_id === accountId), "expected the newly registered account to appear in listAccounts()");
});

check("suspendAccount sets status to SUSPENDED, never deletes the record", () => {
  const accountId = uniqueId("account");
  registerAccount({ account_id: accountId });
  const suspended = suspendAccount(accountId);
  assert(suspended.status === "SUSPENDED", `expected status SUSPENDED, got ${suspended.status}`);
  const fetched = getAccount(accountId);
  assert(fetched !== undefined && fetched.status === "SUSPENDED", "expected the suspended record to still be retrievable, never deleted");
});

check("suspendAccount on an unknown account_id fails closed (throws, never silently succeeds)", () => {
  let threw = false;
  try {
    suspendAccount(uniqueId("never-registered"));
  } catch (error) {
    threw = true;
    assert(error instanceof AccountRegistrationError, `expected AccountRegistrationError, got ${String(error)}`);
  }
  assert(threw, "expected suspendAccount to throw for an unknown account_id");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
