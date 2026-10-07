/**
 * หน้าที่: the real test for `permissions/execution-policy/`. Drives
 * `evaluateExecutionPermission()` directly by hand, the same way
 * ../../../connections/github/adapter.test.ts drives its adapter —
 * ../../../control/command-router/ is NOT_YET_BUILT, so there is no real
 * caller yet. Covers exactly the test matrix from Owner instruction
 * 2026-08-16 (STEP 6 of ../../../reports/EXECUTION_MIGRATION_PLAN.md).
 *
 * Fully offline — no network, no credential, no filesystem, no clock
 * reads (every call passes an explicit `nowIso`), so it is deterministic
 * on every run.
 *
 * How to run (no test framework and no package.json exist in this repo
 * yet; this file is a plain program with its own assertions):
 *   npx tsx permissions/execution-policy/tests/policy.test.ts
 *
 * Input: none (all fixtures constructed in this file).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: only ../contract.ts (the public contract) — this
 * test must never import ../rules.ts, ../policy.ts, or ../evidence.ts
 * directly, so it also proves the contract surface alone is sufficient
 * for a real caller.
 * สิ่งที่ห้ามแตะ: never assert a specific evidence array LENGTH as a
 * stand-in for checking WHICH rule denied — always assert on
 * decision.reason_codes / decision.denied_rules, so the test stays valid
 * if a future rule is inserted earlier in the sequence.
 */

import { evaluateExecutionPermission } from "../contract";
import type { ExecutionGrant, ExecutionPermissionDecision, ExecutionPermissionRequest, ExecutionPolicyContext } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const NOW = "2026-08-16T00:00:00.000Z";
const PAST = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

const IDENTITY = { identity_id: "identity-1", kind: "human" as const, display_name: "Test Identity" };

const ACCOUNT_MEMBERSHIP = {
  membership_id: "membership-account-1",
  identity_id: "identity-1",
  scope_type: "account" as const,
  scope_id: "account-1",
  role: "member",
  granted_at: PAST,
};

const WORKSPACE_MEMBERSHIP = {
  membership_id: "membership-workspace-1",
  identity_id: "identity-1",
  scope_type: "workspace" as const,
  scope_id: "workspace-1",
  role: "member",
  granted_at: PAST,
};

const COMMAND = {
  command_id: "command.run_build",
  required_capability: "execution.run",
  allowed_actions: ["run"],
  allowed_cwd_scope_prefixes: ["repo/"],
};

function baseRequest(overrides: Partial<ExecutionPermissionRequest> = {}): ExecutionPermissionRequest {
  return {
    identity_id: "identity-1",
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "command.run_build",
    action: "run",
    cwd_scope: "repo/app",
    requested_args: ["--flag"],
    correlation_id: "correlation-1",
    ...overrides,
  };
}

function baseAllowGrant(overrides: Partial<ExecutionGrant> = {}): ExecutionGrant {
  return {
    grant_id: "grant-allow-1",
    identity_id: "identity-1",
    account_id: "account-1",
    workspace_id: "workspace-1",
    capability: "execution.run",
    command_id: "command.run_build",
    action: "run",
    cwd_scope_prefix: "repo/",
    effect: "allow",
    granted_at: PAST,
    ...overrides,
  };
}

function baseContext(overrides: Partial<ExecutionPolicyContext> = {}): ExecutionPolicyContext {
  return {
    identity: IDENTITY,
    memberships: [ACCOUNT_MEMBERSHIP, WORKSPACE_MEMBERSHIP],
    grants: [baseAllowGrant()],
    command: COMMAND,
    ...overrides,
  };
}

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

function assertDecision(decision: ExecutionPermissionDecision, expected: ExecutionPermissionDecision["decision"], reasonCode?: string): void {
  assert(decision.decision === expected, `expected decision "${expected}", got "${decision.decision}" (reason_codes=${JSON.stringify(decision.reason_codes)})`);
  if (reasonCode) {
    assert(decision.reason_codes.includes(reasonCode as never), `expected reason_codes to include "${reasonCode}", got ${JSON.stringify(decision.reason_codes)}`);
  }
  assert(decision.evidence.length > 0, "expected at least one evidence entry — decisions must never be opaque");
  assert(typeof decision.decision_id === "string" && decision.decision_id.length > 0, "expected a non-empty decision_id");
  assert(decision.correlation_id === decision.correlation_id, "correlation_id must round-trip");
  for (const entry of decision.evidence) {
    assert(
      typeof entry.rule_id === "string" && typeof entry.input_field === "string" && typeof entry.expected === "string" && typeof entry.actual === "string",
      `evidence entry must be fully populated, got ${JSON.stringify(entry)}`,
    );
  }
}

check("valid allowed command -> ALLOW", () => {
  const decision = evaluateExecutionPermission(baseRequest(), baseContext(), NOW);
  assertDecision(decision, "ALLOW", "GRANTED");
  assert(decision.denied_rules.length === 0, "an ALLOW decision must have zero denied_rules");
});

check("explicit deny overrides an existing allow grant -> DENY", () => {
  const context = baseContext({
    grants: [baseAllowGrant(), baseAllowGrant({ grant_id: "grant-deny-1", effect: "deny" })],
  });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "EXPLICIT_DENY");
});

check("revoked allow grant -> DENY", () => {
  const context = baseContext({ grants: [baseAllowGrant({ revoked_at: PAST })] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "REVOKED_GRANT");
});

check("expired allow grant -> DENY", () => {
  const context = baseContext({ grants: [baseAllowGrant({ expires_at: PAST })] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "EXPIRED_GRANT");
});

check("unexpired allow grant (future expiry) -> ALLOW, decision carries expires_at", () => {
  const context = baseContext({ grants: [baseAllowGrant({ expires_at: FUTURE })] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "ALLOW", "GRANTED");
  assert(decision.expires_at === FUTURE, `expected decision.expires_at to be "${FUTURE}", got "${decision.expires_at}"`);
});

check("cross-account (no membership for the requested account) -> DENY", () => {
  const request = baseRequest({ account_id: "account-2" });
  const decision = evaluateExecutionPermission(request, baseContext(), NOW);
  assertDecision(decision, "DENY", "MISSING_ACCOUNT_MEMBERSHIP");
});

check("cross-workspace (no membership for the requested workspace) -> DENY", () => {
  const request = baseRequest({ workspace_id: "workspace-2" });
  const decision = evaluateExecutionPermission(request, baseContext(), NOW);
  assertDecision(decision, "DENY", "MISSING_WORKSPACE_MEMBERSHIP");
});

check("cross-capability (request capability does not match command's required_capability) -> DENY", () => {
  const request = baseRequest({ capability: "execution.deploy" });
  const decision = evaluateExecutionPermission(request, baseContext(), NOW);
  assertDecision(decision, "DENY", "CROSS_CAPABILITY");
});

check("unknown command -> DENY", () => {
  const context = baseContext({ command: undefined });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "UNKNOWN_COMMAND");
});

check("missing account membership -> DENY", () => {
  const context = baseContext({ memberships: [WORKSPACE_MEMBERSHIP] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "MISSING_ACCOUNT_MEMBERSHIP");
});

check("missing workspace membership -> DENY", () => {
  const context = baseContext({ memberships: [ACCOUNT_MEMBERSHIP] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "MISSING_WORKSPACE_MEMBERSHIP");
});

check("revoked account membership -> DENY", () => {
  const context = baseContext({ memberships: [{ ...ACCOUNT_MEMBERSHIP, revoked_at: PAST }, WORKSPACE_MEMBERSHIP] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "REVOKED_MEMBERSHIP");
});

check("action not in command's allowed_actions -> DENY", () => {
  const request = baseRequest({ action: "delete" });
  const decision = evaluateExecutionPermission(request, baseContext(), NOW);
  assertDecision(decision, "DENY", "ACTION_NOT_ALLOWED");
});

check("cwd_scope outside command's allowed prefixes -> DENY", () => {
  const request = baseRequest({ cwd_scope: "other/path" });
  const decision = evaluateExecutionPermission(request, baseContext(), NOW);
  assertDecision(decision, "DENY", "CWD_SCOPE_VIOLATION");
});

check("no matching grant at all -> DENY", () => {
  const context = baseContext({ grants: [] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "NO_MATCHING_GRANT");
});

check('unknown critical field (malformed grant.effect) -> non-ALLOW (OWNER_REVIEW)', () => {
  const malformedGrant = { ...baseAllowGrant(), effect: "sometimes" as unknown as "allow" };
  const context = baseContext({ grants: [malformedGrant] });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assert(decision.decision !== "ALLOW", `expected non-ALLOW for a malformed grant, got "${decision.decision}"`);
  assertDecision(decision, "OWNER_REVIEW", "AMBIGUOUS_GRANT_STATE");
});

check("malformed request (missing identity_id) -> non-ALLOW (DENY)", () => {
  const request = baseRequest({ identity_id: "" });
  const decision = evaluateExecutionPermission(request, baseContext(), NOW);
  assert(decision.decision !== "ALLOW", `expected non-ALLOW for a malformed request, got "${decision.decision}"`);
  assertDecision(decision, "DENY", "MALFORMED_REQUEST");
});

check("malformed request (requested_args not an array of strings) -> non-ALLOW (DENY)", () => {
  const request = baseRequest({ requested_args: [1, 2, 3] as unknown as string[] });
  const decision = evaluateExecutionPermission(request, baseContext(), NOW);
  assert(decision.decision !== "ALLOW", `expected non-ALLOW for malformed requested_args, got "${decision.decision}"`);
  assertDecision(decision, "DENY", "MALFORMED_REQUEST");
});

check("missing identity in context -> DENY", () => {
  const context = baseContext({ identity: undefined });
  const decision = evaluateExecutionPermission(baseRequest(), context, NOW);
  assertDecision(decision, "DENY", "UNKNOWN_IDENTITY");
});

check("policy evaluation exception -> fail closed (DENY, never throws)", () => {
  const poisonedContext = baseContext();
  Object.defineProperty(poisonedContext, "grants", {
    get() {
      throw new Error("simulated data-source failure");
    },
  });
  let decision: ExecutionPermissionDecision | undefined;
  let threw = false;
  try {
    decision = evaluateExecutionPermission(baseRequest(), poisonedContext, NOW);
  } catch {
    threw = true;
  }
  assert(!threw, "evaluateExecutionPermission must never throw — it must fail closed and return a DENY decision instead");
  assert(!!decision, "expected a decision object even when the context throws internally");
  assertDecision(decision!, "DENY", "POLICY_EVALUATION_ERROR");
});

check("same identity has different execution rights in different accounts", () => {
  const context = baseContext({
    memberships: [ACCOUNT_MEMBERSHIP, WORKSPACE_MEMBERSHIP, { ...ACCOUNT_MEMBERSHIP, membership_id: "membership-account-2", scope_id: "account-2" }],
    grants: [baseAllowGrant()],
  });
  const inGrantedAccount = evaluateExecutionPermission(baseRequest({ account_id: "account-1" }), context, NOW);
  const inUngrantedAccount = evaluateExecutionPermission(baseRequest({ account_id: "account-2", workspace_id: "workspace-1" }), context, NOW);
  assertDecision(inGrantedAccount, "ALLOW");
  assert(inUngrantedAccount.decision !== "ALLOW", "the same identity must not be ALLOWed in an account it has no grant for, even with valid membership there");
});

check("same identity has different execution rights in different workspaces", () => {
  const secondWorkspaceMembership = { ...WORKSPACE_MEMBERSHIP, membership_id: "membership-workspace-2", scope_id: "workspace-2" };
  const context = baseContext({
    memberships: [ACCOUNT_MEMBERSHIP, WORKSPACE_MEMBERSHIP, secondWorkspaceMembership],
    grants: [baseAllowGrant()],
  });
  const inGrantedWorkspace = evaluateExecutionPermission(baseRequest({ workspace_id: "workspace-1" }), context, NOW);
  const inUngrantedWorkspace = evaluateExecutionPermission(baseRequest({ workspace_id: "workspace-2" }), context, NOW);
  assertDecision(inGrantedWorkspace, "ALLOW");
  assert(inUngrantedWorkspace.decision !== "ALLOW", "the same identity must not be ALLOWed in a workspace it has no grant for, even with valid membership there");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
