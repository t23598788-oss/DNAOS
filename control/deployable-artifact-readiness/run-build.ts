/**
 * หน้าที่: BUILD EXECUTION — runs the ONE resolved build `command_id`
 * through the existing `execution/run/` engine (never a new shell/process
 * engine), gated by a real ALLOW `ExecutionPermissionDecision` from
 * `permissions/execution-policy/` — same reuse pattern as
 * `control/post-commit-verification/run-checks.ts`.
 *
 * Input: a `BuildRequirement` (must have `command_id` set — callers only
 * ever reach this when `status === "REQUIRED"` and a real
 * `execution/run/registry.ts` entry exists for it), a `commit_sha`,
 * `correlation_id`.
 * Output: `runBuildCommand` -> `BuildResult`.
 * Dependency ที่อนุญาต: ../../execution/run/contract.ts,
 * ../../permissions/execution-policy/contract.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never call `spawn`/`child_process` directly — every real
 * process goes through `execution/run/contract.ts`'s `startExecution`.
 */

import { evaluateExecutionPermission, issueExecutionGrant } from "../../permissions/execution-policy/contract";
import type { ExecutionGrant, ExecutionPolicyContext } from "../../permissions/execution-policy/contract";
import { getExecution, listCommandDescriptors, projectCommandPolicyDescriptor, startExecution, WORKSPACE_ROOT_CWD_SCOPE } from "../../execution/run/contract";
import type { ExecutionRequest, ExecutionResult } from "../../execution/run/contract";
import { newBuildId, nowIso } from "./host-runtime";
import type { BuildExecutionStatus, BuildRequirement, BuildResult } from "./types";

const IDENTITY_ID = "identity-deployable-artifact-readiness";
const ACCOUNT_ID = "account-dna-os-infrastructure";
const WORKSPACE_ID = "workspace-dna-os-infrastructure";
const CAPABILITY = "execution.run";

function mapExecutionStatus(result: ExecutionResult): BuildExecutionStatus {
  if (result.status === "passed") return "PASSED";
  if (result.status === "failed" || result.status === "timed_out" || result.status === "cancelled" || result.status === "output_limited") return "FAILED";
  return "UNRESOLVED";
}

function waitForTerminal(executionId: string, identityId: string, timeoutMs: number): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const current = getExecution(executionId, identityId);
      if (current.status !== "queued" && current.status !== "running") { resolve(current); return; }
      if (Date.now() > deadline) { reject(new Error(`execution ${executionId} did not reach a terminal state within ${timeoutMs}ms (status=${current.status})`)); return; }
      setTimeout(poll, 200);
    };
    poll();
  });
}

export interface RunBuildDeps {
  saveBuildEvidence: (result: BuildResult, requirement: BuildRequirement, correlationId: string) => string;
}

function issueGrantFor(commandId: string, now: string): ExecutionGrant {
  return issueExecutionGrant({ identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, capability: CAPABILITY, command_id: commandId, action: "run", cwd_scope_prefix: WORKSPACE_ROOT_CWD_SCOPE, effect: "allow", granted_at: now });
}

export async function runBuildCommand(requirement: BuildRequirement, commitSha: string, correlationId: string, deps: RunBuildDeps): Promise<BuildResult> {
  const commandReference = requirement.command_reference ?? "unknown";
  const descriptor = requirement.command_id ? listCommandDescriptors().find((d) => d.command_id === requirement.command_id) : undefined;

  if (!requirement.command_id || !descriptor) {
    const unresolved: BuildResult = { build_id: newBuildId(), commit_sha: commitSha, command_reference: commandReference, started_at: null, finished_at: null, exit_code: null, status: "UNRESOLVED", evidence_ref: "" };
    unresolved.evidence_ref = deps.saveBuildEvidence(unresolved, requirement, correlationId);
    return unresolved;
  }

  const now = nowIso();
  const context: ExecutionPolicyContext = {
    identity: { identity_id: IDENTITY_ID, kind: "service", display_name: "Deployable Artifact Readiness" },
    memberships: [
      { membership_id: `m-acct-${IDENTITY_ID}`, identity_id: IDENTITY_ID, scope_type: "account", scope_id: ACCOUNT_ID, role: "system", granted_at: now },
      { membership_id: `m-ws-${IDENTITY_ID}`, identity_id: IDENTITY_ID, scope_type: "workspace", scope_id: WORKSPACE_ID, role: "system", granted_at: now },
    ],
    grants: [issueGrantFor(requirement.command_id, now)],
    command: projectCommandPolicyDescriptor(requirement.command_id)!,
  };

  const permissionRequest = { identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, capability: CAPABILITY, command_id: requirement.command_id, action: "run", cwd_scope: WORKSPACE_ROOT_CWD_SCOPE, requested_args: [] as readonly string[], correlation_id: correlationId };
  const decision = evaluateExecutionPermission(permissionRequest, context, now);

  if (decision.decision !== "ALLOW") {
    const unresolved: BuildResult = { build_id: newBuildId(), commit_sha: commitSha, command_reference: commandReference, started_at: null, finished_at: null, exit_code: null, status: "UNRESOLVED", evidence_ref: "" };
    unresolved.evidence_ref = deps.saveBuildEvidence(unresolved, requirement, correlationId);
    return unresolved;
  }

  const executionRequest: ExecutionRequest = { correlation_id: correlationId, command_id: requirement.command_id, identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, capability: CAPABILITY, action: "run", cwd_scope: WORKSPACE_ROOT_CWD_SCOPE, requested_args: {}, permission_decision_id: decision.decision_id };
  const started = startExecution(executionRequest, decision);
  const finalResult = await waitForTerminal(started.execution_id, IDENTITY_ID, descriptor.timeoutMs + 30_000);

  const result: BuildResult = {
    build_id: finalResult.execution_id, commit_sha: commitSha, command_reference: commandReference,
    started_at: finalResult.startedAt, finished_at: finalResult.completedAt, exit_code: finalResult.exitCode,
    status: mapExecutionStatus(finalResult), evidence_ref: "",
  };
  result.evidence_ref = deps.saveBuildEvidence(result, requirement, correlationId);
  return result;
}
