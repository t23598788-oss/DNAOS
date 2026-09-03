/**
 * หน้าที่: §5 — the single chained gate every Agent-originated filesystem
 * mutation must pass:
 *
 *   persisted ResolvedWorkContext
 *     -> enforceProposedWrite   (resolution scope + duplicate-symbol check)
 *     -> evaluateWriteIntent    (the EXISTING permissions/write-gate/)
 *     -> executeFileWrite       (the EXISTING execution/file-write/, by the caller)
 *
 * NO SECOND WRITE GATE. `permissions/write-gate/#evaluateWriteIntent` is
 * called unmodified and its decision is returned unmodified. This module
 * only adds the resolution-scope layer IN FRONT of it and fails closed if
 * either layer refuses.
 *
 * FAIL-CLOSED ORDER MATTERS: resolution enforcement runs FIRST. A duplicate
 * implementation inside an otherwise-permitted folder is invisible to the
 * Write Gate (which reasons about capability ownership, not about "you were
 * told to reuse this"), so checking it second would let a duplicate through
 * whenever the folder itself was legitimately writable.
 *
 * ⚠️ HONEST SCOPE — READ BEFORE BELIEVING "MANDATORY". This makes the gate
 * mandatory for every write that GOES THROUGH THIS CALL CHAIN. It does not,
 * and structurally cannot, stop a coding agent holding direct filesystem
 * tools (Write/Bash) from writing anywhere. That gap is pre-existing, is
 * documented by `execution/file-write/README.md` as
 * `BYPASS_STILL_EXISTS`, and was demonstrated live in this repo on
 * 2026-08-26 when a test harness destroyed the root `package.json` without
 * touching any gate. Closing it requires OS-level confinement of the agent
 * process (`control/agent-host/`), not another library.
 *
 * Input: a loaded `ResolvedWorkContext` + the proposed mutation.
 * Output: `guardAgentWrite` -> `MandatoryGateResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./resolver.ts,
 * ../../permissions/write-gate/contract.ts,
 * ../../software/capability-registrar/contract.ts.
 * สิ่งที่ห้ามแตะ: never return ALLOW when either layer refused, and never
 * call `executeFileWrite` from here — this module decides, the caller
 * executes, exactly as `permissions/write-gate/` and
 * `execution/file-write/` are already split.
 */

import { randomUUID } from "node:crypto";
import { enforceProposedWrite } from "./resolver";
import type { EnforcementResult, ResolvedWorkContext } from "./types";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import type { WriteGateDecision } from "../../contracts/write-intent/write-intent";

export interface ProposedMutation {
  /** Repo-relative path the Agent wants to write. */
  readonly target_path: string;
  readonly operation: "CREATE" | "MODIFY";
  readonly requested_change: string;
  /** Top-level symbols the new/changed file would define. Used for the duplicate check. */
  readonly defines_symbols?: readonly string[];
  readonly agent_identity_id: string;
}

export interface MandatoryGateResult {
  readonly allowed: boolean;
  /** Which layer refused, or ALL_PASSED. */
  readonly refused_by: "RESOLUTION_ENFORCEMENT" | "WRITE_GATE" | "NONE";
  readonly enforcement: EnforcementResult;
  /** Present only when resolution enforcement allowed the write through to the Write Gate. */
  readonly gate_decision: WriteGateDecision | null;
  readonly detail: string;
}

/**
 * The one entry point. Returns a decision; never performs a write.
 */
export function guardAgentWrite(context: ResolvedWorkContext, mutation: ProposedMutation): MandatoryGateResult {
  // --- LAYER 1: resolution scope + duplicate implementation -----------
  const enforcement = enforceProposedWrite(context, [mutation.target_path], mutation.defines_symbols ?? []);
  if (enforcement.verdict === "BLOCK_WRITE") {
    return {
      allowed: false,
      refused_by: "RESOLUTION_ENFORCEMENT",
      enforcement,
      gate_decision: null,
      detail: `${enforcement.reason_code}: ${enforcement.detail}. ${enforcement.allowed_next_action}`,
    };
  }

  // --- LAYER 2: the EXISTING Write Gate, unmodified -------------------
  const gateDecision = evaluateWriteIntent(
    {
      intent_id: `intent-${randomUUID()}`,
      operation: mutation.operation,
      capability: context.existing_capability_id,
      target_type: "FILE",
      target_path: mutation.target_path,
      requested_change: mutation.requested_change,
      requesting_agent: { identity_id: mutation.agent_identity_id, kind: "ai_agent", display_name: mutation.agent_identity_id },
      evidence: [
        { source: "control/work-resolution/persistence.ts", note: `resolved work_id=${context.work_id} decision=${context.decision}` },
        ...context.exact_source_paths.slice(0, 3).map((p) => ({ source: p, note: "existing implementation this work must reuse, not duplicate" })),
      ],
      correlation_id: context.work_id,
      submitted_at: new Date().toISOString(),
    },
    { registryIndex: getWriteOwnershipIndex() },
  );

  const gateAllowed = gateDecision.decision === "ALLOW_CREATE" || gateDecision.decision === "ALLOW_MODIFY";
  return {
    allowed: gateAllowed,
    refused_by: gateAllowed ? "NONE" : "WRITE_GATE",
    enforcement,
    gate_decision: gateDecision,
    detail: gateAllowed
      ? `both layers passed (${enforcement.reason_code} + ${gateDecision.decision})`
      : `resolution enforcement passed, but the Write Gate returned ${gateDecision.decision} — fail-closed`,
  };
}
