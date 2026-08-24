/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of execution-policy. `policy.ts` (orchestration),
 * `rules.ts` (individual checks) and `evidence.ts` (evidence
 * constructors) are private implementation; a future
 * ../../control/command-router/ or ../../execution/run/ must depend on
 * this file only, never reach past it into ./rules.ts or ./policy.ts
 * directly. Mirrors this repo's existing pattern of one contract file per
 * capability (see e.g. ../../connections/github/adapter-contract.ts).
 *
 * Input: re-exports only.
 * Output: `evaluateExecutionPermission`, `issueExecutionGrant`,
 * `revokeExecutionGrant`, `getExecutionGrant`,
 * `listExecutionGrantsForIdentity`, `GrantValidationError`, and every
 * type a caller needs to build a request/context or read a decision —
 * `ExecutionPermissionRequest`, `ExecutionPermissionDecision`,
 * `ExecutionDecisionValue`, `ExecutionReasonCode`, `RuleEvidence`,
 * `CommandPolicyDescriptor`, `ExecutionGrant`, `ExecutionPolicyContext`,
 * `IssueExecutionGrantInput`.
 * Dependency ที่อนุญาต: ./policy.ts, ./grants.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export anything from ./rules.ts or ./evidence.ts
 * here — those stay private so the rule-evaluation order and evidence
 * construction can change without breaking callers, matching STEP 4 of
 * ../../reports/EXECUTION_MIGRATION_PLAN.md (PUBLIC_CONTRACT /
 * PRIVATE_IMPLEMENTATION separation). `./grants.ts` is the real source of
 * truth for `ExecutionGrant` (Owner, 2026-08-16) — every reader of it,
 * inside or outside this folder, must go through the functions re-exported
 * here, never import `./grants.ts` directly.
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/policy.test.ts,
 * ./tests/grants.test.ts.
 */

export { evaluateExecutionPermission } from "./policy";
export { getExecutionGrant, GrantValidationError, issueExecutionGrant, listExecutionGrantsForIdentity, revokeExecutionGrant } from "./grants";
export type { IssueExecutionGrantInput } from "./grants";
export type {
  CommandPolicyDescriptor,
  ExecutionDecisionValue,
  ExecutionGrant,
  ExecutionPermissionDecision,
  ExecutionPermissionRequest,
  ExecutionPolicyContext,
  ExecutionReasonCode,
  RuleEvidence,
} from "./types";
