/**
 * หน้าที่: RUN REQUIRED CHECKS + COLLECT RESULTS — for one resolved
 * requirement (./requirement-resolution.ts), builds a real ALLOW
 * `ExecutionPermissionDecision` (`permissions/execution-policy/`) and
 * runs the real, already-registered command through the existing
 * `execution/run/` engine (never a new shell execution engine — see
 * `execution/run/registry.ts`'s `npm.typecheck`/`npm.test_integration`
 * entries added this round). Polls until the process reaches a real
 * terminal state; never fabricates a status.
 *
 * Input: a `ResolvedCheckRequirement`, `identity_id/account_id/workspace_id`.
 * Output: `runOneCheck` -> `CheckResult`.
 * Dependency ที่อนุญาต: ../../execution/run/contract.ts,
 * ../../permissions/execution-policy/contract.ts, ./requirement-resolution.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never call `spawn`/`child_process` directly here — every
 * real process this file causes to run goes through
 * `execution/run/contract.ts`'s `startExecution`, never a shortcut.
 */

import { evaluateExecutionPermission, issueExecutionGrant } from "../../permissions/execution-policy/contract";
import type { ExecutionGrant, ExecutionPolicyContext } from "../../permissions/execution-policy/contract";
import { getExecution, listCommandDescriptors, projectCommandPolicyDescriptor, startExecution, WORKSPACE_ROOT_CWD_SCOPE } from "../../execution/run/contract";
import type { ExecutionRequest, ExecutionResult } from "../../execution/run/contract";
import type { ResolvedCheckRequirement } from "./requirement-resolution";
import type { CheckResult, CheckStatus } from "./types";

const IDENTITY_ID = "identity-post-commit-verification";
const ACCOUNT_ID = "account-dna-os-infrastructure";
const WORKSPACE_ID = "workspace-dna-os-infrastructure";
const CAPABILITY = "execution.run";

function mapExecutionStatus(result: ExecutionResult): CheckStatus {
  if (result.status === "passed") return "PASSED";
  if (result.status === "failed" || result.status === "timed_out" || result.status === "cancelled" || result.status === "output_limited") return "FAILED";
  return "UNRESOLVED"; // "permission_denied", "queued"/"running" (should never reach here — see waitForTerminal), anything else — fail closed, never PASSED.
}

function waitForTerminal(executionId: string, identityId: string, timeoutMs: number): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const current = getExecution(executionId, identityId);
      if (current.status !== "queued" && current.status !== "running") {
        resolve(current);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`execution ${executionId} did not reach a terminal state within ${timeoutMs}ms (status=${current.status})`));
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

export interface RunOneCheckDeps {
  saveCheckEvidence: (check: CheckResult, requirement: ResolvedCheckRequirement, correlationId: string) => string;
}

export async function runOneCheck(requirement: ResolvedCheckRequirement, correlationId: string, deps: RunOneCheckDeps): Promise<CheckResult> {
  const descriptor = listCommandDescriptors().find((d) => d.command_id === requirement.command_id);
  const commandReference = `npm run ${requirement.npm_script}`;
  if (!descriptor) {
    const unresolved: CheckResult = { check_id: `check-${requirement.check_type}-${Date.now()}`, check_type: requirement.check_type, command_reference: commandReference, started_at: null, finished_at: null, exit_code: null, status: "UNRESOLVED", evidence_ref: "" };
    unresolved.evidence_ref = deps.saveCheckEvidence(unresolved, requirement, correlationId);
    return unresolved;
  }

  const now = new Date().toISOString();
  const context: ExecutionPolicyContext = {
    identity: { identity_id: IDENTITY_ID, kind: "service", display_name: "Post-Commit Verification" },
    memberships: [
      { membership_id: `m-acct-${IDENTITY_ID}`, identity_id: IDENTITY_ID, scope_type: "account", scope_id: ACCOUNT_ID, role: "system", granted_at: now },
      { membership_id: `m-ws-${IDENTITY_ID}`, identity_id: IDENTITY_ID, scope_type: "workspace", scope_id: WORKSPACE_ID, role: "system", granted_at: now },
    ],
    grants: [issueGrantFor(requirement.command_id, now)],
    command: projectCommandPolicyDescriptor(requirement.command_id)!,
  };

  const permissionRequest = {
    identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID,
    capability: CAPABILITY, command_id: requirement.command_id, action: "run",
    cwd_scope: WORKSPACE_ROOT_CWD_SCOPE, requested_args: [] as readonly string[], correlation_id: correlationId,
  };
  const decision = evaluateExecutionPermission(permissionRequest, context, now);

  if (decision.decision !== "ALLOW") {
    const unresolved: CheckResult = { check_id: `check-${requirement.check_type}-${Date.now()}`, check_type: requirement.check_type, command_reference: commandReference, started_at: null, finished_at: null, exit_code: null, status: "UNRESOLVED", evidence_ref: "" };
    unresolved.evidence_ref = deps.saveCheckEvidence(unresolved, requirement, correlationId);
    return unresolved;
  }

  const executionRequest: ExecutionRequest = {
    correlation_id: correlationId, command_id: requirement.command_id, identity_id: IDENTITY_ID, account_id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID, capability: CAPABILITY, action: "run", cwd_scope: WORKSPACE_ROOT_CWD_SCOPE,
    requested_args: {}, permission_decision_id: decision.decision_id,
  };
  const started = startExecution(executionRequest, decision);
  const finalResult = await waitForTerminal(started.execution_id, IDENTITY_ID, descriptor.timeoutMs + 30_000);

  const check: CheckResult = {
    check_id: finalResult.execution_id, check_type: requirement.check_type, command_reference: commandReference,
    started_at: finalResult.startedAt, finished_at: finalResult.completedAt, exit_code: finalResult.exitCode,
    status: mapExecutionStatus(finalResult), evidence_ref: "",
  };
  check.evidence_ref = deps.saveCheckEvidence(check, requirement, correlationId);
  return check;
}

function issueGrantFor(commandId: string, now: string): ExecutionGrant {
  return issueExecutionGrant({
    identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID,
    capability: CAPABILITY, command_id: commandId, action: "run", cwd_scope_prefix: WORKSPACE_ROOT_CWD_SCOPE,
    effect: "allow", granted_at: now,
  });
}
