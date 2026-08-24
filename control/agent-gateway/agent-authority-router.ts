/**
 * หน้าที่: the Authority Router (Owner, "Authority Assembly Phase 1F").
 * The ONE place a `RequestedAction` (an Agent's DATA, never authority)
 * is resolved to a real executor — or refused, with NO fallback, when
 * none is registered. Reuses the EXISTING chain every real file-write
 * path in this repo already uses
 * (`control/ai-write-control/contract.ts#submitWriteRequest` ->
 * `permissions/write-gate/contract.ts#evaluateWriteIntent` ->
 * `execution/file-write/contract.ts#executeFileWrite`) for
 * FILE_CREATE/FILE_MODIFY — no new write mechanism, no new gate.
 *
 * Input: a `RequestedAction` + the artifact's real content (read from the
 * Agent's own workspace, never trusted as already-approved).
 * Output: `AuthorityRouterOutcome` — `EXECUTED` (real write happened,
 * through the real gate), `DENIED` (gate refused), or
 * `EXECUTOR_NOT_AVAILABLE` (no registered executor for this operation —
 * the ONLY response for every operation this phase does not build).
 * Dependency ที่อนุญาต: ./agent-execution-contract.ts,
 * ../ai-write-control/contract.ts, ../../permissions/write-gate/contract.ts,
 * ../../execution/file-write/contract.ts,
 * ../../software/capability-registrar/contract.ts.
 * สิ่งที่ห้ามแตะ: never add a branch that performs a real GIT/GITHUB/
 * SUPABASE/VERCEL/PACKAGE/CREDENTIAL/APPLE_EVENT/NETWORK/PROCESS_EXECUTE
 * operation this phase did not build a real executor for — those must
 * return EXECUTOR_NOT_AVAILABLE, never a silent shell/CLI fallback.
 */

import { readFileSync } from "node:fs";
import { submitWriteRequest } from "../ai-write-control/contract";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { executeFileWrite } from "../../execution/file-write/contract";
import type { RequestedAction, RequestedActionOperation } from "./agent-execution-contract";
import { ERROR_CODES } from "./agent-execution-contract";

export type AuthorityRouterOutcome =
  | { status: "EXECUTED"; operation: RequestedActionOperation; detail: unknown }
  | { status: "DENIED"; operation: RequestedActionOperation; reason: string }
  | { status: "EXECUTOR_NOT_AVAILABLE"; operation: RequestedActionOperation; reason: string };

/**
 * Operations with a REAL registered executor today — additive only.
 * Every other `RequestedActionOperation` falls through to
 * EXECUTOR_NOT_AVAILABLE, with no fallback path of any kind.
 */
export const EXECUTOR_REGISTRY: Readonly<Record<RequestedActionOperation, boolean>> = {
  FILE_CREATE: true,
  FILE_MODIFY: true,
  FILE_DELETE: false,
  FILE_MOVE: false,
  PROCESS_EXECUTE: false,
  GIT_OPERATION: false,
  GITHUB_OPERATION: false,
  PACKAGE_OPERATION: false,
  CREDENTIAL_OPERATION: false,
  SUPABASE_OPERATION: false,
  VERCEL_OPERATION: false,
  NETWORK_OPERATION: false,
  APPLE_EVENT_OPERATION: false,
};

interface FileWriteExecutionInput {
  action: RequestedAction;
  requestingIdentity: { identity_id: string; acting_as_account_id: string; acting_as_tenant_id: string; software_id: string; kind: "ai_agent" };
}

/** Reuses control/agent-gateway/adapters/ai-write-adapter.ts's exact same chain — no reimplementation. */
async function executeFileWriteAction(input: FileWriteExecutionInput): Promise<AuthorityRouterOutcome> {
  const { action, requestingIdentity } = input;
  let content: string;
  try {
    const artifactPath = action.artifact_ref.startsWith("artifact://") ? action.artifact_ref.slice("artifact://".length) : action.artifact_ref;
    content = readFileSync(artifactPath, "utf-8");
  } catch (error) {
    return { status: "DENIED", operation: action.operation, reason: `ARTIFACT_UNREADABLE: ${error instanceof Error ? error.message : String(error)}` };
  }

  const intentResult = submitWriteRequest(
    { operation: action.operation === "FILE_CREATE" ? "CREATE" : "MODIFY", capability: "agent_requested_action", target_type: "FILE", target_path: action.target, requested_change: `Requested by Agent Host dispatch, operation=${action.operation}`, evidence: [] },
    requestingIdentity,
  );
  if (!intentResult.ok) return { status: "DENIED", operation: action.operation, reason: `INTENT_REJECTED:${intentResult.reason}` };

  const { getCapabilityIndex } = await import("../../software/capability-registrar/contract");
  const decision = evaluateWriteIntent(intentResult.intent, { registryIndex: getCapabilityIndex() });
  if (decision.decision !== "ALLOW_CREATE" && decision.decision !== "ALLOW_MODIFY") {
    return { status: "DENIED", operation: action.operation, reason: `WRITE_GATE_${decision.decision}` };
  }

  const write = executeFileWrite(
    { correlation_id: intentResult.intent.correlation_id, intent_id: intentResult.intent.intent_id, gate_decision_id: decision.decision_id, operation: intentResult.intent.operation, target_type: "FILE", target_path: action.target, content, requesting_identity_id: requestingIdentity.identity_id },
    decision,
  );
  if (write.status !== "completed") return { status: "DENIED", operation: action.operation, reason: `WRITE_${write.refusal_code}` };
  return { status: "EXECUTED", operation: action.operation, detail: { write_id: write.write_id, resolved_path: write.resolved_path, bytes_written: write.bytes_written } };
}

/**
 * The single entry point: requested_action -> policy -> permission ->
 * write gate (if state-changing) -> executor registry -> executor ->
 * result. No caller may bypass this function to perform a
 * RequestedAction directly.
 */
export async function routeRequestedAction(action: RequestedAction): Promise<AuthorityRouterOutcome> {
  if (!EXECUTOR_REGISTRY[action.operation]) {
    return { status: "EXECUTOR_NOT_AVAILABLE", operation: action.operation, reason: `${ERROR_CODES.EXECUTOR_NOT_AVAILABLE}: no registered executor for operation "${action.operation}" — no fallback to shell/CLI/raw tool exists or will be used` };
  }
  if (action.operation === "FILE_CREATE" || action.operation === "FILE_MODIFY") {
    return executeFileWriteAction({
      action,
      requestingIdentity: { identity_id: "agent-gateway-authority-router", acting_as_account_id: "account-dna-os-infrastructure", acting_as_tenant_id: "tenant-dna-os-infrastructure", software_id: "dna-os-agent-gateway", kind: "ai_agent" },
    });
  }
  return { status: "EXECUTOR_NOT_AVAILABLE", operation: action.operation, reason: `${ERROR_CODES.EXECUTOR_NOT_AVAILABLE}: registry inconsistency` };
}
