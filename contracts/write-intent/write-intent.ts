/**
 * หน้าที่: the shared shape for the AI Write-Control path — Owner,
 * 2026-08-19: "OWNER → External AI/Agent → DNA OS Control API → Internal
 * Control Agent → WriteIntent → Existing Registry → Deterministic Write
 * Gate → Execution". `WriteIntent` is what an Internal Control Agent
 * (`control/ai-write-control/`) is allowed to produce; `WriteGateDecision`
 * is what a deterministic Write Gate (`permissions/write-gate/`) is
 * allowed to produce. Neither module owns its own copy of these shapes —
 * both depend on this one leaf contract, same discipline as
 * `permissions/execution-policy/types.ts` / `contracts/command/
 * routing-result.ts` ("never collapse a decision into a bare boolean").
 *
 * Input: none (pure type definitions).
 * Output: `WriteOperation`, `WriteTargetType`, `WriteIntentEvidenceRef`,
 * `WriteIntent`, `WriteGateDecisionValue`, `WriteGateEvidence`,
 * `WriteGateCanonicalReference`, `WriteGateDecision`.
 * Dependency ที่อนุญาต: none — leaf contract, zero imports.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller assert its own
 * `WriteGateDecision` — a decision is only ever produced by
 * `permissions/write-gate/`'s real `evaluateWriteIntent`. Never widen
 * `WriteGateDecisionValue` beyond the 5 Owner-specified values
 * (`ALLOW_CREATE`/`ALLOW_MODIFY`/`REUSE_EXISTING`/`DENY`/`UNKNOWN`) — a 6th
 * "maybe allow" value would defeat the fail-closed guarantee `UNKNOWN`
 * exists to provide.
 *
 * NOT_YET_BUILT: nothing consumed this before 2026-08-19 — see
 * `control/ai-write-control/` and `permissions/write-gate/`, both new
 * this round.
 */

export type WriteOperation = "CREATE" | "MODIFY" | "DELETE" | "MOVE" | "RENAME";

export type WriteTargetType = "FILE" | "MODULE" | "FUNCTION" | "API" | "TABLE" | "CONTRACT" | "CAPABILITY";

/** A reference the requesting agent supplied to justify its request — carried, never trusted as fact by the Gate (the Gate re-derives its own evidence from the real registry, see permissions/write-gate/rules.ts). */
export interface WriteIntentEvidenceRef {
  source: string;
  note: string;
}

/**
 * The ONLY thing `control/ai-write-control/` is allowed to produce — never
 * a decision, never an execution result. Owner's required minimum fields
 * (2026-08-19): operation, capability, target_type, target_path,
 * requested_change, requesting_agent, evidence.
 */
export interface WriteIntent {
  intent_id: string;
  operation: WriteOperation;
  /** The capability_id the requester CLAIMS this write belongs to — never trusted; permissions/write-gate/ re-derives the real answer from the registry index, this field is carried for evidence/audit only. */
  capability: string;
  target_type: WriteTargetType;
  /** Repo-relative path (FILE/MODULE/CONTRACT/CAPABILITY) or a dotted symbol reference (FUNCTION/API/TABLE) — never invented, always what the requester asserts it wants to touch. */
  target_path: string;
  /** Human-readable description of the change — never executable content itself; content (for FILE writes) travels separately, see execution/file-write/types.ts's FileWriteRequest. */
  requested_change: string;
  requesting_agent: {
    identity_id: string;
    kind: "ai_agent" | "external_program";
    display_name: string;
  };
  evidence: readonly WriteIntentEvidenceRef[];
  correlation_id: string;
  submitted_at: string;
}

/** Owner's exact 5 machine-readable outcomes (2026-08-19) — no 6th value, ever. */
export type WriteGateDecisionValue = "ALLOW_CREATE" | "ALLOW_MODIFY" | "REUSE_EXISTING" | "DENY" | "UNKNOWN";

/** Same no-bare-boolean discipline as permissions/execution-policy/types.ts's RuleEvidence. */
export interface WriteGateEvidence {
  rule_id: string;
  input_field: string;
  expected: string;
  actual: string;
  result: "pass" | "fail" | "skipped";
}

/** Set only when decision is REUSE_EXISTING or ALLOW_MODIFY — the real existing capability record the requester must use/modify instead of (or in addition to) proceeding. */
export interface WriteGateCanonicalReference {
  software_id: string;
  owner_folder: string;
  evidence_source: readonly string[];
}

export interface WriteGateDecision {
  decision: WriteGateDecisionValue;
  intent_id: string;
  reason_codes: readonly string[];
  evidence: readonly WriteGateEvidence[];
  canonical: WriteGateCanonicalReference | null;
  decision_id: string;
  correlation_id: string;
  decided_at: string;
}
