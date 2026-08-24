/**
 * หน้าที่: the WorkRequest contract — the INPUT half of the AI Worker
 * Gateway loop. Corrected 2026-08-18 against real field-by-field mapping
 * against Circuit's `CapabilityMetadata`
 * (software/capability-registrar/types.ts) and the Research & Evaluation
 * Engine's real `executions` table schema (see mapping verdict this
 * round: FAIL on the original shape, fixed here) — never re-guessed.
 *
 * Input: none (pure type definitions).
 * Output: `WorkRequestExecutionState`, `WorkRequest`.
 * Dependency ที่อนุญาต: `../identity/envelope-identity.ts` only.
 * สิ่งที่ห้ามแตะ: never add a field that lets a WorkRequest carry a
 * credential value. Never re-collapse provider_id/model_id/agent_id back
 * into one field — the real Research & Evaluation Engine schema
 * (`executions.provider`, `.model_id`, `.agent_id`) already tracks these
 * as three distinct real columns; collapsing them was the exact mistake
 * this correction pass exists to fix. Never claim NEW_CONTROL_FIELDS
 * below are mapped to a real runtime counterpart — they are not, as of
 * 2026-08-18.
 *
 * NOT_YET_BUILT: no AI Worker Gateway capability folder exists yet
 * (locked pending Owner's broader AI-execution-track reorg — see memory
 * `project-ai-execution-track-boundary`). This file is the contract that
 * folder will eventually implement against.
 */

import type { EnvelopeIdentity } from "../identity/envelope-identity";

/**
 * The lifecycle of ONE requested job — distinct from the other two state
 * machines in this loop (see ./state-machine-separation.ts for why they
 * are never merged): the Research & Evaluation Engine's real
 * `executions.status` (RUNNING/COMPLETED/FAILED/TIMEOUT, one finished
 * execution's runtime result) and `software/capability-registrar/`'s
 * `CapabilityStatus` (a capability's persistent registration readiness).
 */
export type WorkRequestExecutionState =
  | "RECEIVED"
  | "CONTEXT_RESOLVED"
  | "AUTHORIZED"
  | "ROUTED"
  | "VALIDATED"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "BLOCKED"
  | "REJECTED"
  | "FAILED";

export interface WorkRequest {
  work_id: string;

  /**
   * Three distinct real identities, matching the Research & Evaluation
   * Engine's real `executions` table columns exactly (`provider`,
   * `model_id`, `agent_id`) — never collapsed into one field. This
   * replaces the original `source_agent: WorkerBackend` field, which was
   * coarser than what Lab already tracks and lost real information a
   * mapping check caught 2026-08-18.
   */
  provider_id: string | null; // e.g. "anthropic" — null until resolved
  model_id: string | null; // e.g. "claude-code-sdk"'s reported model — null until resolved
  agent_id: string; // always known at request time — which gateway/worker identity is being asked to act

  /** Reused, not duplicated — same identity shape every CommandEnvelope/EventEnvelope already carries. */
  issued_by: EnvelopeIdentity; // NEW_CONTROL_FIELD — see this file's own header; no real runtime counterpart exists yet

  /**
   * OWNER_FOLDER-compatible — matches
   * `software/capability-registrar/types.ts`'s `CapabilityMetadata.OWNER_FOLDER`
   * field exactly, including its already-proven convention for encoding
   * an EXTERNAL repo inline (see the `local-qwen-semantic-check`
   * candidate: `"DNA-LAB-FILE-INTELLIGENCE/semantic-check/ (external
   * repo...)"`). Chosen over a split `target_repo`/`target_folder` pair
   * per Owner's own preference (2026-08-18): "Prefer matching existing
   * OWNER_FOLDER unless a real multi-repo requirement proves split
   * fields are necessary" — no such requirement has been proven yet.
   */
  target_owner_folder: string;

  /** Matches `CapabilityMetadata.CAPABILITY_ID` exactly — the one field from the original design that mapped cleanly with no changes needed. */
  capability: string;

  requested_action: string; // NEW_CONTROL_FIELD — no real runtime counterpart yet

  /** Explicit allowlist — a WorkRequest with an empty list authorizes nothing. NEW_CONTROL_FIELD — no real runtime counterpart yet. */
  allowed_files: readonly string[];
  forbidden_files: readonly string[]; // NEW_CONTROL_FIELD — no real runtime counterpart yet

  expected_output: string; // NEW_CONTROL_FIELD — no real runtime counterpart yet
  validation_required: boolean; // NEW_CONTROL_FIELD — no real runtime counterpart yet
  evidence_required: boolean; // NEW_CONTROL_FIELD — no real runtime counterpart yet
  return_to: string; // NEW_CONTROL_FIELD — no real runtime counterpart yet

  state: WorkRequestExecutionState;
}
