/**
 * หน้าที่: the type contracts for the Work Result Ingress — the canonical
 * path a submitted work result takes: validate task/worker/session ->
 * classify result contents -> split into candidate(s) -> Registration
 * Pipeline -> Registry -> handoff/evidence reference -> next decision.
 * The handoff record this produces is evidence that a delivery happened,
 * never the destination of the work itself — see ./ingress.ts.
 *
 * Input: none (pure type definitions).
 * Output: `CapabilityIntroduced`, `WorkResultInput`,
 * `WorkResultIngressStatus`, `RegisteredArtifact`, `WorkResultIngressResult`.
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts (HandoffStatus, NextDecision types only).
 * สิ่งที่ห้ามแตะ: never add a field here that lets a caller specify a
 * resource_id/capability_id directly — every artifact is only ever
 * identified after it passes through the real Registration Pipeline.
 */

import type { HandoffStatus, NextDecision } from "../agent-gateway/contract";

/** A new capability the submitting agent explicitly declares it introduced — never inferred/guessed from files_changed. */
export interface CapabilityIntroduced {
  name: string;
  source_location: string;
  purpose: string;
}

export interface WorkResultInput {
  task_id: string;
  agent_id: string;
  role: string;
  input_reference: string;
  files_read: readonly string[];
  files_changed: readonly string[];
  tests_run: readonly string[];
  status: HandoffStatus;
  evidence_refs: readonly string[];
  blockers: readonly string[];
  next_action: string | null;
  /** Optional — only capabilities the agent explicitly names are ever registered as such. */
  capabilities_introduced?: readonly CapabilityIntroduced[];
}

export type WorkResultIngressStatus = "REGISTERED" | "PARTIALLY_REGISTERED" | "REJECTED";

/** The real outcome of registering ONE split artifact — never fabricated, always the real registerCandidate() decision. */
export interface RegisteredArtifact {
  candidate_id: string;
  resource_type: string;
  decision: string;
  resource_id: string | null;
  capability_id: string | null;
}

export interface WorkResultIngressResult {
  status: WorkResultIngressStatus;
  task_id: string;
  handoff_id: string | null;
  dna_os_decision: string | null;
  artifacts: readonly RegisteredArtifact[];
  next_decision: NextDecision | null;
  blocker: string | null;
}
