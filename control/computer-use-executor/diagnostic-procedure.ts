/**
 * หน้าที่: let deterministic software answer "which registered procedure can
 * turn THIS unknown into a known fact?" — by contract match, never by
 * resemblance (Owner, 2026-09-02).
 *
 * THE SELECTION RULE THIS REPLACES. Before this file the only thing standing
 * between a FAILED effect and a diagnostic action was judgement: someone sees
 * "scroll failed", remembers scroll-diagnostic.ts exists, and runs it. That is
 * `FAILED → a model decides what to run`, and it is the last place in this
 * track where inference could still enter. Selection here is instead an
 * intersection: `classification.unknown_facts ∩ procedure.resolves_unknown`,
 * plus capability, operation, evidence preconditions, status and origination.
 * A procedure that does not declare the unknown it resolves cannot be selected
 * at all, however apt its name.
 *
 * WHY PROVENANCE IS CHECKED AND NOT ASSUMED. P-1 reads `wc` from an
 * observation. A field called `wc` in some other state contract would be a
 * different measurement wearing the same name, so a procedure declares the
 * state contract it understands and the selector verifies the observation
 * actually carries that contract's full key set from the expected source.
 * "There is a key named wc" is not sufficient and is not accepted.
 *
 * WHAT A PROCEDURE MAY NOT DO. Nothing here decides a classification, a next
 * state, or a cause. A procedure produces a DiagnosticFinding — one fact about
 * one observable — and the classification owner decides what, if anything,
 * that narrows. Keeping those apart is what stops a diagnostic from quietly
 * becoming a diagnosis.
 *
 * Input: registered procedures + one classification + its ExecutionEvidence.
 * Output: the procedure contract types, STATE_CONTRACTS, selectProcedures.
 * Dependency ที่อนุญาต: ./outcome-classification (types), ./executor (types), ./observation (types).
 * สิ่งที่ห้ามแตะ: ห้ามเลือก procedure ด้วยชื่อไฟล์/ความคล้าย/การอนุมาน, ห้ามให้
 * procedure ตัดสิน next_state, ห้ามยอมรับ observable ที่ provenance ไม่ตรงสัญญา.
 */
import type { ExecutionEvidence } from "./executor";
import type { Observation } from "./observation";
import type { UnknownFactKey } from "./outcome-classification";

/** Which boundary a procedure examines — distinct from where a failure is currently localized. */
export type DiagnosticBoundary = "DELIVERY" | "TARGET_RECEIPT" | "TARGET_EFFECT";

/** Who may originate a procedure run. SYSTEM means DNA OS may run it unattended. */
export type ProcedureOrigination = "SYSTEM" | "OWNER_ONLY";

export type ProcedureAuthorityRequirement = "NONE" | "COMPUTER_USE_LEASE" | "OWNER_SESSION";

export type ProcedureStatus = "REGISTERED" | "DISABLED";

export type ProcedureInputKind = "EXECUTION_EVIDENCE";
export type ProcedureOutputKind = "DIAGNOSTIC_FINDING";

/** Whether a procedure needs to touch the machine. NONE is what makes SYSTEM origination safe. */
export type PhysicalAction = "NONE" | "COMPUTER_USE_ACTION";

/** Where a required observable must be found. */
export type EvidenceLocation = "OBSERVATION_BEFORE" | "OBSERVATION_AFTER" | "ROUTING_CONTEXT";

export interface RequiredEvidence {
  observable: string;
  location: EvidenceLocation;
  must_be_acquired: boolean;
}

/**
 * The published state contracts a procedure can understand. A contract is
 * identified by the full key set its target publishes, so an observation can be
 * checked against it structurally rather than trusted.
 */
export type StateContractId = "DNAOS_SANDBOX_TITLE_V1";

export const STATE_CONTRACTS: Readonly<Record<StateContractId, { source: Observation["source"]; required_keys: readonly string[] }>> = Object.freeze({
  // Exactly the keys control/computer-use-executor/sandbox/acceptance-sandbox.html
  // writes into document.title. `wc` means that page's own wheel listener fired.
  DNAOS_SANDBOX_TITLE_V1: Object.freeze({
    source: "ACCESSIBILITY_WINDOW_TITLE" as const,
    required_keys: Object.freeze(["clicks", "dbls", "st", "in", "sy", "dl", "af", "mx", "wc", "wdy", "wdm", "wt"]),
  }),
});

export interface DiagnosticProcedure {
  procedure_id: string;
  canonical_name: string;
  /** The canonical capability whose executions this procedure can read. */
  capability_id: string;
  operation: string;
  /** The unknown facts this procedure is declared to resolve. Selection is an intersection with these. */
  resolves_unknown: readonly UnknownFactKey[];
  requires_evidence: readonly RequiredEvidence[];
  /**
   * The published state contract the required observables must come from. Null
   * for procedures whose inputs are not target-published state — routing
   * context is produced by this system's own recorded producers, and carries
   * its own provenance fields instead.
   */
  requires_state_contract: StateContractId | null;
  origination: ProcedureOrigination;
  diagnostic_boundary: DiagnosticBoundary;
  input_contract: readonly ProcedureInputKind[];
  output_contract: readonly ProcedureOutputKind[];
  authority_requirement: ProcedureAuthorityRequirement;
  physical_action: PhysicalAction;
  status: ProcedureStatus;
  registered_by: string;
  entry_point: string;
}

/** Why a procedure was not selected. Finite, so a rejection is readable without prose. */
export type SelectionRejection =
  | "STATUS_NOT_REGISTERED"
  | "ORIGINATION_NOT_PERMITTED"
  | "AUTHORITY_NOT_SATISFIED"
  | "NO_UNKNOWN_IN_COMMON"
  | "CAPABILITY_MISMATCH"
  | "OPERATION_MISMATCH"
  | "REQUIRED_EVIDENCE_UNAVAILABLE"
  | "STATE_CONTRACT_MISMATCH";

export interface SelectionResult {
  selected: DiagnosticProcedure | null;
  /** The unknown facts that caused the match — the reason, as data. */
  matched_unknown: readonly UnknownFactKey[];
  /** Every procedure considered and why it was not chosen. */
  rejected: readonly { procedure_id: string; rejection: SelectionRejection }[];
}

function observationAt(evidence: ExecutionEvidence, location: EvidenceLocation): Observation | undefined {
  return location === "OBSERVATION_BEFORE" ? evidence.observation_before : evidence.observation_after;
}

/**
 * Verifies the observation really carries the declared state contract: right
 * source, and every key that contract publishes. A lone `wc` on some other
 * source is a different measurement and is rejected here.
 */
export function stateContractSatisfied(observation: Observation | undefined, contract: StateContractId): boolean {
  const spec = STATE_CONTRACTS[contract];
  if (!spec || !observation || observation.acquired !== true || observation.state === null) return false;
  if (observation.source !== spec.source) return false;
  return spec.required_keys.every((key) => typeof observation.state![key] === "string");
}

/**
 * Chooses at most one procedure for one classified execution. Pure: the same
 * registry, classification and evidence always yield the same choice, and the
 * ordering tie-break is the procedure_id so registry order cannot change it.
 *
 * `permittedOrigination` is what the caller is allowed to originate — SYSTEM
 * for unattended DNA OS. An OWNER_ONLY procedure is never selected for a
 * SYSTEM caller, whatever else matches.
 */
export function selectProcedures(
  procedures: readonly DiagnosticProcedure[],
  unknownFacts: readonly UnknownFactKey[],
  evidence: ExecutionEvidence,
  permittedOrigination: ProcedureOrigination = "SYSTEM",
): SelectionResult {
  const rejected: { procedure_id: string; rejection: SelectionRejection }[] = [];
  const candidates: { procedure: DiagnosticProcedure; matched: UnknownFactKey[] }[] = [];

  for (const procedure of [...procedures].sort((a, b) => (a.procedure_id < b.procedure_id ? -1 : a.procedure_id > b.procedure_id ? 1 : 0))) {
    const reject = (rejection: SelectionRejection) => { rejected.push({ procedure_id: procedure.procedure_id, rejection }); };

    if (procedure.status !== "REGISTERED") { reject("STATUS_NOT_REGISTERED"); continue; }
    if (permittedOrigination === "SYSTEM" && procedure.origination !== "SYSTEM") { reject("ORIGINATION_NOT_PERMITTED"); continue; }
    // A SYSTEM caller holds no lease and no Owner session; only NONE is satisfiable unattended.
    if (permittedOrigination === "SYSTEM" && procedure.authority_requirement !== "NONE") { reject("AUTHORITY_NOT_SATISFIED"); continue; }

    const matched = procedure.resolves_unknown.filter((k) => unknownFacts.includes(k));
    if (matched.length === 0) { reject("NO_UNKNOWN_IN_COMMON"); continue; }
    if ((evidence.capability_id ?? null) !== procedure.capability_id) { reject("CAPABILITY_MISMATCH"); continue; }
    if (String(evidence.operation) !== procedure.operation) { reject("OPERATION_MISMATCH"); continue; }

    const evidenceOk = procedure.requires_evidence.every((need) => {
      // Routing context is a different shape from an observation: named fields
      // rather than a published key/value state, so presence is checked as a
      // non-null field on a capture that really succeeded.
      if (need.location === "ROUTING_CONTEXT") {
        const rc = evidence.routing_context as Record<string, unknown> | undefined;
        if (!rc) return false;
        if (need.must_be_acquired && rc["acquired"] !== true) return false;
        const value = rc[need.observable];
        return value !== undefined && value !== null;
      }
      const observation = observationAt(evidence, need.location);
      if (need.must_be_acquired && (!observation || observation.acquired !== true)) return false;
      return !observation || observation.state === null ? false : typeof observation.state[need.observable] === "string";
    });
    if (!evidenceOk) { reject("REQUIRED_EVIDENCE_UNAVAILABLE"); continue; }

    // Only procedures that declare a published state contract are checked
    // against one; the rest carry their provenance in their own fields and the
    // semantic owner verifies it.
    const contract = procedure.requires_state_contract;
    const provenanceOk = contract === null
      || procedure.requires_evidence.every((need) => need.location === "ROUTING_CONTEXT" || stateContractSatisfied(observationAt(evidence, need.location), contract));
    if (!provenanceOk) { reject("STATE_CONTRACT_MISMATCH"); continue; }

    candidates.push({ procedure, matched });
  }

  const chosen = candidates[0];
  return {
    selected: chosen?.procedure ?? null,
    matched_unknown: Object.freeze(chosen?.matched ?? []),
    rejected: Object.freeze(rejected),
  };
}
