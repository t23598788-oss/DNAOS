/**
 * หน้าที่: the real test for `../workspace-registry.ts` — the real,
 * in-memory Workspace STORE. Drives the module's own exports directly by
 * hand, the same convention as `./account-registry.test.ts`.
 *
 * How to run: npx tsx permissions/software-scope/tests/workspace-registry.test.ts
 *
 * Input: none (all fixtures constructed in this file).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: only ../workspace-registry.ts.
 * สิ่งที่ห้ามแตะ: never assert a specific ordering of
 * `listWorkspacesForAccount()` — only membership/shape. Never import
 * ../account-registry.ts here — this file specifically proves
 * ../workspace-registry.ts's own documented design decision (no
 * cross-check against Account at this layer), not the resolver's
 * cross-check (that's proved in ../../../control/entry-context/tests/).
 */

import { WorkspaceRegistrationError, getWorkspace, listWorkspacesForAccount, registerWorkspace, suspendWorkspace, __debugWorkspaceCount } from "../workspace-registry";

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

check("registerWorkspace stores a real, retrievable, ACTIVE workspace", () => {
  const workspaceId = uniqueId("workspace");
  const accountId = uniqueId("account");
  const record = registerWorkspace({ workspace_id: workspaceId, account_id: accountId });
  assert(record.workspace_id === workspaceId, "expected the returned record's workspace_id to match the input");
  assert(record.account_id === accountId, "expected the returned record's account_id to match the input");
  assert(record.status === "ACTIVE", `expected a freshly registered workspace to be ACTIVE, got ${record.status}`);
  assert(typeof record.created_at === "string" && record.created_at.length > 0, "expected a real created_at timestamp");
  const fetched = getWorkspace(workspaceId);
  assert(fetched !== undefined && fetched.workspace_id === workspaceId, "expected the registered workspace to be retrievable by id");
});

check("registerWorkspace succeeds even when account_id was never registered in any Account store — structural check only, by design (see this file's header and ../workspace-registry.ts's own header)", () => {
  const workspaceId = uniqueId("workspace");
  const danglingAccountId = uniqueId("account-never-registered-anywhere");
  const record = registerWorkspace({ workspace_id: workspaceId, account_id: danglingAccountId });
  assert(record.account_id === danglingAccountId, "expected registration to succeed structurally, with no existence cross-check performed here");
});

check("registerWorkspace rejects an empty workspace_id", () => {
  let threw = false;
  try {
    registerWorkspace({ workspace_id: "", account_id: uniqueId("account") });
  } catch (error) {
    threw = true;
    assert(error instanceof WorkspaceRegistrationError, `expected WorkspaceRegistrationError, got ${String(error)}`);
  }
  assert(threw, "expected registerWorkspace to throw for an empty workspace_id");
});

check("registerWorkspace rejects an empty account_id", () => {
  let threw = false;
  try {
    registerWorkspace({ workspace_id: uniqueId("workspace"), account_id: "" });
  } catch (error) {
    threw = true;
    assert(error instanceof WorkspaceRegistrationError, `expected WorkspaceRegistrationError, got ${String(error)}`);
  }
  assert(threw, "expected registerWorkspace to throw for an empty account_id");
});

check("registerWorkspace throws on a repeat workspace_id — no silent re-provision/reactivate backdoor", () => {
  const workspaceId = uniqueId("workspace");
  const accountId = uniqueId("account");
  registerWorkspace({ workspace_id: workspaceId, account_id: accountId });
  let threw = false;
  try {
    registerWorkspace({ workspace_id: workspaceId, account_id: accountId });
  } catch (error) {
    threw = true;
    assert(error instanceof WorkspaceRegistrationError, `expected WorkspaceRegistrationError, got ${String(error)}`);
  }
  assert(threw, "expected a second registerWorkspace call for the same workspace_id to throw");
});

check("getWorkspace returns undefined for a workspace_id that was never registered — never synthesized", () => {
  const fetched = getWorkspace(uniqueId("never-registered"));
  assert(fetched === undefined, "expected undefined for an unregistered workspace_id");
});

check("listWorkspacesForAccount returns only the real workspaces for that account, never another account's", () => {
  const accountA = uniqueId("account-a");
  const accountB = uniqueId("account-b");
  const workspaceA = registerWorkspace({ workspace_id: uniqueId("workspace"), account_id: accountA });
  registerWorkspace({ workspace_id: uniqueId("workspace"), account_id: accountB });
  const listedForA = listWorkspacesForAccount(accountA);
  assert(listedForA.length === 1 && listedForA[0].workspace_id === workspaceA.workspace_id, "expected only account A's workspace to be listed for account A");
});

check("listWorkspacesForAccount returns an empty list for an account with no workspaces, never fabricated", () => {
  const listed = listWorkspacesForAccount(uniqueId("account-with-none"));
  assert(listed.length === 0, "expected an empty list for an account with no registered workspaces");
});

check("suspendWorkspace sets status to SUSPENDED, never deletes the record", () => {
  const workspaceId = uniqueId("workspace");
  registerWorkspace({ workspace_id: workspaceId, account_id: uniqueId("account") });
  const suspended = suspendWorkspace(workspaceId);
  assert(suspended.status === "SUSPENDED", `expected status SUSPENDED, got ${suspended.status}`);
  const fetched = getWorkspace(workspaceId);
  assert(fetched !== undefined && fetched.status === "SUSPENDED", "expected the suspended record to still be retrievable, never deleted");
});

check("suspendWorkspace on an unknown workspace_id fails closed (throws, never silently succeeds)", () => {
  let threw = false;
  try {
    suspendWorkspace(uniqueId("never-registered"));
  } catch (error) {
    threw = true;
    assert(error instanceof WorkspaceRegistrationError, `expected WorkspaceRegistrationError, got ${String(error)}`);
  }
  assert(threw, "expected suspendWorkspace to throw for an unknown workspace_id");
});

check("__debugWorkspaceCount reflects real store growth", () => {
  const before = __debugWorkspaceCount();
  registerWorkspace({ workspace_id: uniqueId("workspace"), account_id: uniqueId("account") });
  assert(__debugWorkspaceCount() === before + 1, "expected the debug count to grow by exactly 1 after one registration");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
