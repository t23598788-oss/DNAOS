/**
 * หน้าที่: P-1 — read an execution's already-captured observations and state
 * one fact: was the wheel event observed to reach the target application?
 * (Owner, 2026-09-02).
 *
 * WHY THIS PROCEDURE COSTS NOTHING. The acceptance sandbox increments `wc` from
 * its own `window.addEventListener('wheel', …)`, and the Step 3 observer
 * already captures every key that page publishes. So the signal that separates
 * "the target received the input" from "the target received it and did not act
 * on it" is ALREADY inside the evidence row. This procedure performs no
 * physical action, opens no browser, needs no authority lease and no Owner —
 * it only reads what was written at execution time.
 *
 * THE ONE FACT, AND THE MANY IT IS NOT. `after.wc > before.wc` means the
 * target's listener fired. `after.wc == before.wc` means it was NOT OBSERVED to
 * fire — and that is where this file stops. It does not mean the mouse helper
 * is broken, the browser rejected the input, the OS dropped the event, focus
 * was wrong, timing was wrong, or the scroll primitive is defective. Each of
 * those names a component this procedure never looked at. They stay UNKNOWN.
 *
 * NOT OBSERVED IS NOT THE SAME AS DID NOT HAPPEN. The finding is phrased as an
 * observation about the target's own counter, because that is exactly what the
 * evidence supports. Anything stronger would be inference wearing a
 * deterministic costume.
 *
 * WHAT IT MAY NOT TOUCH. It returns a DiagnosticFinding and nothing else — it
 * does not write, narrow, or choose `effect_verdict`, the outcome
 * classification, `next_state`, a root cause, or capability proof. `created_at`
 * is metadata and takes no part in the decision, which is why the same evidence
 * always yields the same finding.
 *
 * Input: the registered procedure + the persisted ExecutionEvidence it matched.
 * Output: DiagnosticFinding, TargetReceiptFinding, runWheelReceiptProcedure.
 * Dependency ที่อนุญาต: ./diagnostic-procedure, ./executor (types), ./outcome-classification (types).
 * สิ่งที่ห้ามแตะ: ห้ามสรุปสาเหตุ, ห้ามแปลง NOT_OBSERVED เป็น "ส่งไม่ถึง/พังที่ไหน",
 * ห้ามให้ clock มีผลต่อผลลัพธ์, ห้ามแก้ ExecutionEvidence.
 */
import { stateContractSatisfied, type DiagnosticProcedure } from "./diagnostic-procedure";
import type { ExecutionEvidence } from "./executor";
import type { UnknownFactKey } from "./outcome-classification";

export const P1_PROCEDURE_ID = "proc-wheel-receipt-from-existing-observation-v1";
export const P1_CANONICAL_NAME = "WHEEL_RECEIPT_FROM_EXISTING_OBSERVATION";
/** The one unknown P-1 is declared to resolve — the Step 6 canonical key, unchanged. */
export const P1_RESOLVES_UNKNOWN: UnknownFactKey = "input_reached_target_application";
const OBSERVABLE = "wc";

export type TargetReceiptFinding = "OBSERVED" | "NOT_OBSERVED" | "UNPROVEN";

/** Finite. There is no free-form explanation field on a finding. */
export type DiagnosticReasonCode =
  | "TARGET_COUNTER_INCREASED"
  | "TARGET_COUNTER_UNCHANGED"
  | "BEFORE_OBSERVATION_UNAVAILABLE"
  | "AFTER_OBSERVATION_UNAVAILABLE"
  | "OBSERVABLE_MISSING_IN_BEFORE"
  | "OBSERVABLE_MISSING_IN_AFTER"
  | "OBSERVABLE_NOT_COMPARABLE"
  | "STATE_CONTRACT_MISMATCH"
  | "COUNTER_DECREASED";

export interface DiagnosticFinding {
  diagnostic_finding_id: string;
  procedure_id: string;
  /** Back-references. The source row is read, never written. */
  source_execution_evidence_id: string;
  work_order_id: string;
  capability_id: string | null;
  operation: string;
  resolved_unknown_key: UnknownFactKey;
  observable: string;
  before_value: string | null;
  after_value: string | null;
  finding: TargetReceiptFinding;
  reason_code: DiagnosticReasonCode;
  /** Which published state contract the values were read from. */
  evidence_source: string;
  /** Metadata only — it takes no part in the decision above. */
  created_at: string;
}

/**
 * Runs P-1 against one evidence row. Pure apart from the id and timestamp the
 * caller supplies: every semantic branch depends only on the two observations.
 */
export function runWheelReceiptProcedure(
  procedure: DiagnosticProcedure,
  evidence: ExecutionEvidence,
  newFindingId: () => string,
  now: () => Date = () => new Date(),
): DiagnosticFinding {
  const before = evidence.observation_before;
  const after = evidence.observation_after;
  const beforeValue = before?.acquired === true && before.state !== null ? before.state[OBSERVABLE] ?? null : null;
  const afterValue = after?.acquired === true && after.state !== null ? after.state[OBSERVABLE] ?? null : null;

  const finish = (finding: TargetReceiptFinding, reason_code: DiagnosticReasonCode): DiagnosticFinding => ({
    diagnostic_finding_id: newFindingId(),
    procedure_id: procedure.procedure_id,
    source_execution_evidence_id: evidence.evidence_id,
    work_order_id: evidence.work_order_id,
    capability_id: evidence.capability_id ?? null,
    operation: String(evidence.operation),
    resolved_unknown_key: P1_RESOLVES_UNKNOWN,
    observable: OBSERVABLE,
    before_value: beforeValue,
    after_value: afterValue,
    finding,
    reason_code,
    evidence_source: procedure.requires_state_contract ?? "NO_STATE_CONTRACT_DECLARED",
    created_at: now().toISOString(),
  });

  // Preconditions first: an absent reading can never produce a finding about
  // the target, only about the evidence.
  if (!before || before.acquired !== true) return finish("UNPROVEN", "BEFORE_OBSERVATION_UNAVAILABLE");
  if (!after || after.acquired !== true) return finish("UNPROVEN", "AFTER_OBSERVATION_UNAVAILABLE");
  // P-1 reads a target-published observable, so a declared state contract is
  // mandatory here: without one there is no way to know the value means what
  // this procedure thinks it means.
  const contract = procedure.requires_state_contract;
  if (contract === null || !stateContractSatisfied(before, contract) || !stateContractSatisfied(after, contract)) {
    return finish("UNPROVEN", "STATE_CONTRACT_MISMATCH");
  }
  if (beforeValue === null) return finish("UNPROVEN", "OBSERVABLE_MISSING_IN_BEFORE");
  if (afterValue === null) return finish("UNPROVEN", "OBSERVABLE_MISSING_IN_AFTER");

  const b = Number(beforeValue), a = Number(afterValue);
  if (!Number.isFinite(b) || !Number.isFinite(a)) return finish("UNPROVEN", "OBSERVABLE_NOT_COMPARABLE");

  if (a > b) return finish("OBSERVED", "TARGET_COUNTER_INCREASED");
  if (a === b) return finish("NOT_OBSERVED", "TARGET_COUNTER_UNCHANGED");
  // A monotonic counter going backwards is not evidence of receipt or of its
  // absence — it says the two readings are not comparable as a pair.
  return finish("UNPROVEN", "COUNTER_DECREASED");
}

/** The registry row for P-1, so the registration and the semantics cannot drift apart. */
export const P1_REGISTRATION: DiagnosticProcedure = Object.freeze({
  procedure_id: P1_PROCEDURE_ID,
  canonical_name: P1_CANONICAL_NAME,
  capability_id: "capability-0de653bb-c968-4168-85c6-9d67beef2b5a",
  operation: "scroll",
  resolves_unknown: Object.freeze([P1_RESOLVES_UNKNOWN]),
  requires_evidence: Object.freeze([
    { observable: OBSERVABLE, location: "OBSERVATION_BEFORE", must_be_acquired: true },
    { observable: OBSERVABLE, location: "OBSERVATION_AFTER", must_be_acquired: true },
  ]),
  requires_state_contract: "DNAOS_SANDBOX_TITLE_V1",
  origination: "SYSTEM",
  diagnostic_boundary: "TARGET_RECEIPT",
  input_contract: Object.freeze(["EXECUTION_EVIDENCE"]),
  output_contract: Object.freeze(["DIAGNOSTIC_FINDING"]),
  authority_requirement: "NONE",
  physical_action: "NONE",
  status: "REGISTERED",
  registered_by: "control/computer-use-executor/diagnostic-wheel-receipt.ts",
  entry_point: "control/computer-use-executor/diagnostic-wheel-receipt.ts#runWheelReceiptProcedure",
}) as DiagnosticProcedure;
