/**
 * หน้าที่: the real test for `../grants.ts` — the `ExecutionGrant` source
 * of truth. Drives `../contract.ts` directly by hand, the same way
 * `./policy.test.ts` does — this file never imports `../grants.ts`
 * directly, proving `../contract.ts`'s re-exports alone are sufficient
 * for a real caller (matching the "อ่านผ่าน contract เท่านั้น"
 * requirement).
 *
 * How to run: npx tsx permissions/execution-policy/tests/grants.test.ts
 *
 * Input: none (all fixtures constructed in this file).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: only ../contract.ts.
 * สิ่งที่ห้ามแตะ: never assert a specific `grant_id` value (it's a real
 * random UUID) — assert on shape/fields only.
 */

import { evaluateExecutionPermission, getExecutionGrant, GrantValidationError, issueExecutionGrant, listExecutionGrantsForIdentity, revokeExecutionGrant } from "../contract";
import type { ExecutionPolicyContext } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const PAST = "2026-01-01T00:00:00.000Z";
const NOW = "2026-08-16T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

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

check("issueExecutionGrant stores a real, retrievable grant", () => {
  const identityId = uniqueId("identity");
  const grant = issueExecutionGrant({
    identity_id: identityId,
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "workspace.pwd",
    action: "run",
    cwd_scope_prefix: "workspace_root/",
    effect: "allow",
    granted_at: PAST,
  });
  assert(typeof grant.grant_id === "string" && grant.grant_id.length > 0, "expected a real, non-empty grant_id");
  assert(grant.revoked_at === undefined, "a freshly issued grant must not be revoked");
  const fetched = getExecutionGrant(grant.grant_id);
  assert(fetched !== undefined && fetched.grant_id === grant.grant_id, "expected the issued grant to be retrievable by id");
  const listed = listExecutionGrantsForIdentity(identityId);
  assert(listed.some((g) => g.grant_id === grant.grant_id), "expected the issued grant to appear in listExecutionGrantsForIdentity");
});

check("issuance rejects a missing required field (fails closed, never stores a partial grant)", () => {
  let threw = false;
  try {
    issueExecutionGrant({
      identity_id: "",
      account_id: "account-1",
      workspace_id: "workspace-1",
      capability: "execution.run",
      command_id: "workspace.pwd",
      action: "run",
      cwd_scope_prefix: "workspace_root/",
      effect: "allow",
    });
  } catch (error) {
    threw = true;
    assert(error instanceof GrantValidationError, `expected GrantValidationError, got ${String(error)}`);
  }
  assert(threw, "expected issueExecutionGrant to throw for an empty identity_id");
});

check("issuance rejects a malformed effect value (fails closed, never stores it)", () => {
  let threw = false;
  try {
    issueExecutionGrant({
      identity_id: uniqueId("identity"),
      account_id: "account-1",
      workspace_id: "workspace-1",
      capability: "execution.run",
      command_id: "workspace.pwd",
      action: "run",
      cwd_scope_prefix: "workspace_root/",
      effect: "sometimes" as unknown as "allow",
    });
  } catch (error) {
    threw = true;
    assert(error instanceof GrantValidationError, `expected GrantValidationError, got ${String(error)}`);
  }
  assert(threw, "expected issueExecutionGrant to reject a malformed effect value");
});

check("issuance rejects an unparseable expires_at", () => {
  let threw = false;
  try {
    issueExecutionGrant({
      identity_id: uniqueId("identity"),
      account_id: "account-1",
      workspace_id: "workspace-1",
      capability: "execution.run",
      command_id: "workspace.pwd",
      action: "run",
      cwd_scope_prefix: "workspace_root/",
      effect: "allow",
      expires_at: "not-a-real-date",
    });
  } catch (error) {
    threw = true;
    assert(error instanceof GrantValidationError, `expected GrantValidationError, got ${String(error)}`);
  }
  assert(threw, "expected issueExecutionGrant to reject an unparseable expires_at");
});

check("revokeExecutionGrant sets revoked_at, never deletes the grant", () => {
  const identityId = uniqueId("identity");
  const grant = issueExecutionGrant({
    identity_id: identityId,
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "workspace.pwd",
    action: "run",
    cwd_scope_prefix: "workspace_root/",
    effect: "allow",
    granted_at: PAST,
  });
  const revoked = revokeExecutionGrant(grant.grant_id, NOW);
  assert(revoked.revoked_at === NOW, `expected revoked_at to be set to "${NOW}", got ${revoked.revoked_at}`);
  const stillListed = listExecutionGrantsForIdentity(identityId);
  assert(stillListed.some((g) => g.grant_id === grant.grant_id), "a revoked grant must still be listed (never deleted) — revocation is a state, not an erasure");
});

check("revokeExecutionGrant is idempotent — revoking twice preserves the original revoked_at", () => {
  const grant = issueExecutionGrant({
    identity_id: uniqueId("identity"),
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "workspace.pwd",
    action: "run",
    cwd_scope_prefix: "workspace_root/",
    effect: "allow",
    granted_at: PAST,
  });
  const firstRevoke = revokeExecutionGrant(grant.grant_id, "2026-02-01T00:00:00.000Z");
  const secondRevoke = revokeExecutionGrant(grant.grant_id, "2026-03-01T00:00:00.000Z");
  assert(secondRevoke.revoked_at === firstRevoke.revoked_at, "expected a second revoke call to leave the original revoked_at untouched");
});

check("revokeExecutionGrant on an unknown grant_id fails closed (throws, never silently succeeds)", () => {
  let threw = false;
  try {
    revokeExecutionGrant("grant-id-that-was-never-issued");
  } catch (error) {
    threw = true;
    assert(error instanceof GrantValidationError, `expected GrantValidationError, got ${String(error)}`);
  }
  assert(threw, "expected revokeExecutionGrant to throw for an unknown grant_id");
});

check("listExecutionGrantsForIdentity never returns another identity's grants", () => {
  const identityA = uniqueId("identity-a");
  const identityB = uniqueId("identity-b");
  issueExecutionGrant({
    identity_id: identityA,
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "workspace.pwd",
    action: "run",
    cwd_scope_prefix: "workspace_root/",
    effect: "allow",
    granted_at: PAST,
  });
  const listedForB = listExecutionGrantsForIdentity(identityB);
  assert(listedForB.length === 0, "expected an identity with no issued grants to see an empty list, never another identity's grants");
});

check("end-to-end: a revoked grant issued through the real store denies through the real policy evaluation", () => {
  const identityId = uniqueId("identity");
  const grant = issueExecutionGrant({
    identity_id: identityId,
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "workspace.pwd",
    action: "run",
    cwd_scope_prefix: "workspace_root/",
    effect: "allow",
    granted_at: PAST,
  });
  revokeExecutionGrant(grant.grant_id, PAST);

  const context: ExecutionPolicyContext = {
    identity: { identity_id: identityId, kind: "human", display_name: "Grants Test Identity" },
    memberships: [
      { membership_id: "m-acct", identity_id: identityId, scope_type: "account", scope_id: "account-1", role: "member", granted_at: PAST },
      { membership_id: "m-ws", identity_id: identityId, scope_type: "workspace", scope_id: "workspace-1", role: "member", granted_at: PAST },
    ],
    grants: listExecutionGrantsForIdentity(identityId),
    command: { command_id: "workspace.pwd", required_capability: "execution.run", allowed_actions: ["run"], allowed_cwd_scope_prefixes: ["workspace_root/"] },
  };
  const decision = evaluateExecutionPermission(
    {
      identity_id: identityId,
      account_id: "account-1",
      workspace_id: "workspace-1",
      capability: "execution.run",
      command_id: "workspace.pwd",
      action: "run",
      cwd_scope: "workspace_root/",
      requested_args: [],
      correlation_id: "corr-grants-e2e",
    },
    context,
    NOW,
  );
  assert(decision.decision === "DENY", `expected a real revoked grant (via the real store) to DENY through real policy evaluation, got ${decision.decision}`);
  assert(decision.reason_codes.includes("REVOKED_GRANT"), `expected reason_codes to include REVOKED_GRANT, got ${JSON.stringify(decision.reason_codes)}`);
});

check("end-to-end: an active, unexpired grant issued through the real store allows through the real policy evaluation", () => {
  const identityId = uniqueId("identity");
  issueExecutionGrant({
    identity_id: identityId,
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "workspace.pwd",
    action: "run",
    cwd_scope_prefix: "workspace_root/",
    effect: "allow",
    granted_at: PAST,
    expires_at: FUTURE,
  });

  const context: ExecutionPolicyContext = {
    identity: { identity_id: identityId, kind: "human", display_name: "Grants Test Identity" },
    memberships: [
      { membership_id: "m-acct", identity_id: identityId, scope_type: "account", scope_id: "account-1", role: "member", granted_at: PAST },
      { membership_id: "m-ws", identity_id: identityId, scope_type: "workspace", scope_id: "workspace-1", role: "member", granted_at: PAST },
    ],
    grants: listExecutionGrantsForIdentity(identityId),
    command: { command_id: "workspace.pwd", required_capability: "execution.run", allowed_actions: ["run"], allowed_cwd_scope_prefixes: ["workspace_root/"] },
  };
  const decision = evaluateExecutionPermission(
    {
      identity_id: identityId,
      account_id: "account-1",
      workspace_id: "workspace-1",
      capability: "execution.run",
      command_id: "workspace.pwd",
      action: "run",
      cwd_scope: "workspace_root/",
      requested_args: [],
      correlation_id: "corr-grants-e2e-allow",
    },
    context,
    NOW,
  );
  assert(decision.decision === "ALLOW", `expected a real active grant (via the real store) to ALLOW through real policy evaluation, got ${decision.decision}`);
  assert(decision.expires_at === FUTURE, `expected the decision to carry the real grant's expires_at, got ${decision.expires_at}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
