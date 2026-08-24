/**
 * หน้าที่: `evaluateExecutionPermission()` — the single public entrypoint
 * of this capability. Runs every rule from ./rules.ts in the fixed order
 * below, stops at the first terminal outcome, and always returns a fully
 * evidenced `ExecutionPermissionDecision` — never throws to the caller.
 * This is the deterministic boundary required between command routing and
 * execution per ../../reports/EXECUTION_MIGRATION_PLAN.md STEP 9: Identity
 * / Membership context -> Execution Permission Request -> execution-policy
 * -> ALLOW / DENY / OWNER_REVIEW -> only ALLOW may later reach EXECUTION.
 *
 * Input: `ExecutionPermissionRequest`, `ExecutionPolicyContext`, and an
 * optional `nowIso` (defaults to the real current time; tests always pass
 * an explicit value so expiry checks are deterministic).
 * Output: `ExecutionPermissionDecision` — always, even on internal error
 * (fail-closed: caught exceptions become a DENY decision with reason_code
 * POLICY_EVALUATION_ERROR, never a thrown error the caller might
 * mishandle as "unknown, so allow").
 * Dependency ที่อนุญาต: ./types.ts, ./rules.ts, ./evidence.ts.
 * สิ่งที่ห้ามแตะ: never reorder rules 1-8 after the grant-resolution rule
 * (resolveGrant) — grant matching must only run once the request is known
 * well-formed, the identity is known, memberships are valid, and the
 * command/capability/action/cwd are all in scope, otherwise a grant could
 * appear to justify an ALLOW for a request that was never structurally
 * valid to begin with. Never call this from ../../execution/run/ or
 * ../../control/command-router/ yet — both are NOT_YET_BUILT; wiring
 * either one is explicitly out of scope for this round (Owner, 2026-08-16).
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/policy.test.ts for
 * the only current caller, which drives this module directly by hand.
 */

import {
  resolveGrant,
  ruleAccountMembershipValid,
  ruleActionScope,
  ruleCapabilityScope,
  ruleCommandKnown,
  ruleCwdScope,
  ruleIdentityKnown,
  ruleWellFormedRequest,
  ruleWorkspaceMembershipValid,
} from "./rules";
import type { ExecutionDecisionValue, ExecutionPermissionDecision, ExecutionPermissionRequest, ExecutionPolicyContext, ExecutionReasonCode, RuleEvidence } from "./types";

declare const require: (id: string) => unknown;
interface NodeCryptoModule { randomUUID(): string }
const nodeCrypto = require("node:crypto") as NodeCryptoModule;

function nowIsoDefault(): string {
  return new Date().toISOString();
}

function terminalDecision(
  request: ExecutionPermissionRequest,
  decision: ExecutionDecisionValue,
  reasonCode: ExecutionReasonCode,
  evidenceTrail: RuleEvidence[],
  ruleId: string,
  expiresAt: string | undefined,
): ExecutionPermissionDecision {
  const matched = evidenceTrail.filter((e) => e.result === "pass").map((e) => e.rule_id);
  const denied = evidenceTrail.filter((e) => e.result !== "pass").map((e) => e.rule_id);
  return {
    decision,
    reason_codes: decision === "ALLOW" ? ["GRANTED"] : [reasonCode],
    matched_rules: matched,
    denied_rules: decision === "ALLOW" ? denied : Array.from(new Set([...denied, ruleId])),
    scope: {
      account_id: request.account_id,
      workspace_id: request.workspace_id,
      capability: request.capability,
      command_id: request.command_id,
    },
    expires_at: decision === "ALLOW" ? expiresAt : undefined,
    evidence: evidenceTrail,
    decision_id: nodeCrypto.randomUUID(),
    correlation_id: request.correlation_id,
    decided_at: nowIsoDefault(),
  };
}

export function evaluateExecutionPermission(
  request: ExecutionPermissionRequest,
  context: ExecutionPolicyContext,
  nowIso: string = nowIsoDefault(),
): ExecutionPermissionDecision {
  const evidenceTrail: RuleEvidence[] = [];

  try {
    const step1 = ruleWellFormedRequest(request);
    evidenceTrail.push(step1.evidence);
    if (step1.kind !== "continue") return terminalDecision(request, step1.kind, step1.reason_code, evidenceTrail, step1.evidence.rule_id, undefined);

    const step2 = ruleIdentityKnown(request, context);
    evidenceTrail.push(step2.evidence);
    if (step2.kind !== "continue") return terminalDecision(request, step2.kind, step2.reason_code, evidenceTrail, step2.evidence.rule_id, undefined);

    const step3 = ruleAccountMembershipValid(request, context);
    evidenceTrail.push(step3.evidence);
    if (step3.kind !== "continue") return terminalDecision(request, step3.kind, step3.reason_code, evidenceTrail, step3.evidence.rule_id, undefined);

    const step4 = ruleWorkspaceMembershipValid(request, context);
    evidenceTrail.push(step4.evidence);
    if (step4.kind !== "continue") return terminalDecision(request, step4.kind, step4.reason_code, evidenceTrail, step4.evidence.rule_id, undefined);

    const step5 = ruleCommandKnown(request, context);
    evidenceTrail.push(step5.evidence);
    if (step5.kind !== "continue") return terminalDecision(request, step5.kind, step5.reason_code, evidenceTrail, step5.evidence.rule_id, undefined);

    // From here on, context.command is guaranteed defined by ruleCommandKnown having passed.
    const command = context.command!;

    const step6 = ruleCapabilityScope(request, command);
    evidenceTrail.push(step6.evidence);
    if (step6.kind !== "continue") return terminalDecision(request, step6.kind, step6.reason_code, evidenceTrail, step6.evidence.rule_id, undefined);

    const step7 = ruleActionScope(request, command);
    evidenceTrail.push(step7.evidence);
    if (step7.kind !== "continue") return terminalDecision(request, step7.kind, step7.reason_code, evidenceTrail, step7.evidence.rule_id, undefined);

    const step8 = ruleCwdScope(request, command);
    evidenceTrail.push(step8.evidence);
    if (step8.kind !== "continue") return terminalDecision(request, step8.kind, step8.reason_code, evidenceTrail, step8.evidence.rule_id, undefined);

    const step9 = resolveGrant(request, context, nowIso);
    evidenceTrail.push(step9.evidence);
    if (step9.kind === "ALLOW") {
      return terminalDecision(request, "ALLOW", "GRANTED", evidenceTrail, step9.evidence.rule_id, step9.expires_at);
    }
    return terminalDecision(request, step9.kind, step9.reason_code, evidenceTrail, step9.evidence.rule_id, undefined);
  } catch (error) {
    evidenceTrail.push({
      rule_id: "policy_evaluation",
      input_field: "internal",
      expected: "no exception",
      actual: error instanceof Error ? error.message : String(error),
      result: "fail",
    });
    return terminalDecision(request, "DENY", "POLICY_EVALUATION_ERROR", evidenceTrail, "policy_evaluation", undefined);
  }
}
