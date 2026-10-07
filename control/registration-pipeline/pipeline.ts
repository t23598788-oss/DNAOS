/**
 * หน้าที่: `runRegistrationPipeline()` — the ONE real entry point for
 * Candidate -> Validation -> Classification -> Duplicate Resolution ->
 * Registration Decision -> Repository Resolution -> Registry Writer.
 * Every stage runs exactly once, in order, each owned by exactly one file:
 *
 *   1. VALIDATION             -> ./validation.ts
 *   2. CLASSIFICATION         -> ../event-pipeline/contract.ts (classifyCandidate)
 *   3. DUPLICATE RESOLUTION   -> ./duplicate-resolution.ts
 *   4. REGISTRATION DECISION  -> ./decision.ts (pure combinator, no recompute)
 *   5. REPOSITORY RESOLUTION  -> ./repository-resolution.ts (real,
 *                                independent resolution of the candidate's
 *                                owner/repository CLAIM against
 *                                software/repository-registry/ — only for
 *                                a candidate about to be written; never for
 *                                REJECTED/UNRESOLVED/DUPLICATE)
 *   6. REGISTRY WRITER        -> ../../software/registry-database/contract.ts
 *                                (commitRegisteredCandidate — write-only,
 *                                persists the resolved repository_id)
 *
 * Real callers (verified 2026-08-21, via repo-wide grep — this comment
 * previously undercounted them): `transport/owner-command-http/server.ts`,
 * `control/work-result-ingress/ingress.ts`,
 * `control/external-system-lifecycle/pipeline.ts`, and
 * `control/duplicate-reservation/resolver.ts` (reached via
 * `control/agent-production-ingress/`). None of them calls Classification,
 * Duplicate Resolution, Repository Resolution, or the Writer directly —
 * every one of them calls this one function instead.
 *
 * UNRESOLVED at any stage never guesses, never falls back, never invents
 * a capability — it returns the full structured result the STEP that
 * built this folder specified and creates one real EXPLAIN_RESOURCE Work
 * Item (./explain-resource.ts) for an Agent to add evidence to. The
 * Agent's response re-enters through this exact same function — see
 * ./README.md.
 *
 * Input: `RegistrationCandidate`, a real `RegistryStore`, `correlation_id`.
 * Output: `runRegistrationPipeline` -> `PipelineResult`.
 * Dependency ที่อนุญาต: ./validation.ts, ./duplicate-resolution.ts,
 * ./decision.ts, ./repository-resolution.ts, ./explain-resource.ts,
 * ./types.ts, ../event-pipeline/contract.ts,
 * ../../software/registry-database/contract.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate, fingerprintCandidate,
 * resolveDuplicate, resolveRepositoryOwnership, or commitRegisteredCandidate
 * more than once each per candidate. Never let a stage catch and
 * reinterpret another stage's result — pass it through decideRegistration()
 * unchanged. Never let Repository Resolution run before Duplicate
 * Resolution has already passed — a DUPLICATE must never re-touch an
 * existing resource's real repository_id.
 */

import { classifyCandidate, fingerprintCandidate } from "../event-pipeline/contract";
import type { RegistrationCandidate } from "../event-pipeline/contract";
import { commitRegisteredCandidate } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { validateCandidateShape } from "./validation";
import { resolveDuplicate } from "./duplicate-resolution";
import { decideRegistration } from "./decision";
import { resolveRepositoryOwnership } from "./repository-resolution";
import { createExplainResourceWorkItem } from "./explain-resource";
import { checkExecutableAdmission } from "./executable-admission";
import type { PipelineResult, PipelineStage } from "./types";
import { admitResource } from "../durable-meaning/contract";
import { appendAdmission, appendOrigin } from "../durable-meaning/store";

export function runRegistrationPipeline(candidate: RegistrationCandidate, store: RegistryStore, correlationId: string): PipelineResult {
  // 1. VALIDATION — shape only.
  const shape = validateCandidateShape(candidate);
  if (!shape.ok) {
    return { status: "REJECTED", failed_stage: "VALIDATION", reason_code: shape.reason_code, candidate_id: candidate.candidate_id };
  }

  // 2. CLASSIFICATION — exactly once.
  const classification = classifyCandidate(candidate);

  // 2b. EXECUTABLE ADMISSION — ต้องอยู่ก่อน fingerprintCandidate() เสมอ
  // candidate ที่ประกาศเจตนา executable ต้องประกาศ contract ครบตั้งแต่แรก
  // เพื่อให้ input/output เข้าไปอยู่ใน semantic_fingerprint ตามกฎเดิม
  // candidate ที่ไม่ประกาศเจตนา จะได้ applicable=false และผ่านไปเหมือนเดิมทุกประการ
  const admission = checkExecutableAdmission(candidate);
  if (!admission.ok) {
    return { status: "REJECTED", failed_stage: "VALIDATION",
      reason_code: `EXECUTABLE_CONTRACT_REQUIRED:${admission.reasons.join(",")}`,
      candidate_id: candidate.candidate_id };
  }

  // 3. DUPLICATE RESOLUTION — exactly once, real store reads only.
  const fingerprint = fingerprintCandidate(candidate);
  const duplicate = resolveDuplicate(candidate, fingerprint, store);

  // 4. REGISTRATION DECISION — combines 2+3, recomputes neither.
  const outcome = decideRegistration(classification, duplicate);

  if (outcome.decision === "REJECTED") {
    return { status: "REJECTED", failed_stage: outcome.failed_stage, reason_code: outcome.reason_code, candidate_id: candidate.candidate_id };
  }

  function unresolvedAt(failedStage: PipelineStage, reasonCode: string): PipelineResult {
    const unresolved = {
      status: "UNRESOLVED" as const,
      failed_stage: failedStage,
      reason_code: reasonCode,
      resource_id: null,
      candidate_id: candidate.candidate_id,
      known_facts: { canonical_name: candidate.name, source_location: candidate.source_location, domain: candidate.domain, resource_type: candidate.resource_type, kind: candidate.kind, version: candidate.version },
      missing_information: failedStage === "CLASSIFICATION" ? ["resource_type", "domain"] : failedStage === "REPOSITORY_RESOLUTION" ? ["requested_owner", "requested_repository"] : [],
      evidence_refs: candidate.evidence_refs,
      correlation_id: correlationId,
    };
    const workItem = createExplainResourceWorkItem(unresolved);
    return { ...unresolved, work_item_task_id: workItem.task_id };
  }

  if (outcome.decision === "UNRESOLVED") {
    return unresolvedAt(outcome.failed_stage, outcome.reason_code);
  }

  if (outcome.decision === "DUPLICATE") {
    return { status: "DUPLICATE", reason_code: outcome.reason_code, duplicate_of: outcome.duplicate_of, candidate_id: candidate.candidate_id };
  }

  // 5. REPOSITORY RESOLUTION — real, independent resolution of the
  // candidate's owner/repository CLAIM against software/repository-registry/;
  // never trusts the claim directly. Runs only here, after Classification
  // and Duplicate Resolution both already passed — a DUPLICATE never
  // reaches this stage, so an existing resource's real repository_id is
  // never re-touched by a later resubmission.
  const repository = resolveRepositoryOwnership(candidate);
  if (repository.status === "UNRESOLVED") {
    return unresolvedAt("REPOSITORY_RESOLUTION", repository.reason_code ?? "REPOSITORY_RESOLUTION_FAILED");
  }
  if (repository.status === "REJECTED") {
    return { status: "REJECTED", failed_stage: "REPOSITORY_RESOLUTION", reason_code: repository.reason_code ?? "REPOSITORY_RESOLUTION_FAILED", candidate_id: candidate.candidate_id };
  }

  // 6. REGISTRY WRITER — write-only, given an already-approved, already-unique candidate.
  const commit = commitRegisteredCandidate(candidate, fingerprint, store, repository.repository_id);
  if (!commit.written) {
    return { status: "REJECTED", failed_stage: "REGISTRY_WRITER", reason_code: commit.reason_code ?? "WRITE_FAILED", candidate_id: candidate.candidate_id };
  }
  // 7. DURABLE MEANING — mandatory, not optional. Identity has just been made
  // permanent; this is the only moment the producer's context still exists, and
  // before 2026-09-02 nothing captured it, which is why 494 of 620 resources
  // have no relationship and none can say why it exists. Admission never blocks
  // registration: a candidate that carried no origin is recorded as
  // UNBOUND_UNKNOWN, so orphan birth becomes visible instead of silent.
  const meaningAdmission = admitResource({
    resource_id: commit.resource_id!,
    resource_kind: candidate.kind,
    origin: candidate.origin ? { origin_kind: candidate.origin.origin_kind as never, origin_reference: candidate.origin.origin_reference, introduced_by: candidate.origin.introduced_by } : undefined,
    supported_relationships: (candidate.relationships ?? []).map((r) => ({
      relationship_kind: String((r as { relationship_kind?: string }).relationship_kind ?? ""),
      to_id: String((r as { to_id?: string }).to_id ?? ""),
      evidence_ref: candidate.evidence_refs[0] ?? "",
    })),
    evidence_refs: candidate.evidence_refs,
    provenance: {
      produced_by: "REGISTRATION_PIPELINE",
      source: "control/registration-pipeline/pipeline.ts",
      under_contract: "control/durable-meaning/contract.ts#admitResource",
      verified_by: "control/registration-pipeline/pipeline.ts#runRegistrationPipeline",
      observed_at: new Date().toISOString(),
      canonical_identity: commit.resource_id!,
    },
  });
  appendAdmission(meaningAdmission);
  if (meaningAdmission.origin) appendOrigin(meaningAdmission.origin);

  return { status: "REGISTERED", resource_id: commit.resource_id!, capability_id: commit.capability_id, candidate_id: candidate.candidate_id, evidence_refs: candidate.evidence_refs, repository_id: repository.repository_id };
}
