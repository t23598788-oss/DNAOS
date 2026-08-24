import { randomUUID } from "node:crypto";
import type { RegistrationCandidate, RegistrationFingerprint } from "../../control/event-pipeline/contract";
import { classifyRegistrationDomain } from "../../control/event-pipeline/domain-classification";
import type { RegistryStore, ApprovedCandidateWrite } from "./store-port";
import type { ApprovedRegistrationCommand, DatabasePort, RegistrationResult } from "./database-port";
import type { RelationshipEntityType, RelationshipKind, RelationshipRow } from "./types";

/**
 * The six ingress relationship kinds always target to_type=SYSTEM_COMPONENT
 * with exactly this fixed to_id — naming DNA OS's own real, already-existing
 * pipeline endpoints (POST /command, POST /registry/candidates, GET
 * /task/:id, GET /registry/capabilities/:id, POST /handoff, GET
 * /runtime/inventory). Never a new registry — a validation allowlist
 * referencing what already exists.
 */
const SYSTEM_COMPONENT_TARGETS: Readonly<Record<string, string>> = {
  COMMAND_INGRESS: "command_ingress",
  REGISTRATION_INGRESS: "registration_ingress",
  TASK_LOOKUP: "task_lookup",
  CAPABILITY_LOOKUP: "capability_lookup",
  WORK_RESULT_RETURN: "work_result_return",
  SYSTEM_STATUS_READ: "system_status_read",
};

const VALID_RELATIONSHIP_KINDS: ReadonlySet<string> = new Set<RelationshipKind>([
  "FILE_TO_MODULE", "MODULE_TO_CAPABILITY", "CAPABILITY_TO_WORKER", "CAPABILITY_TO_API", "CAPABILITY_TO_TEST", "CAPABILITY_TO_DEPENDENCY", "CAPABILITY_TO_OWNER",
  "COMMAND_INGRESS", "REGISTRATION_INGRESS", "TASK_LOOKUP", "CAPABILITY_LOOKUP", "WORK_RESULT_RETURN", "SYSTEM_STATUS_READ",
  "MCP_TO_WORK_RESULT_INGRESS", "WORK_RESULT_TO_DOMAIN_CLASSIFIER", "DOMAIN_TO_REGISTRATION_GATE", "REGISTRATION_GATE_TO_REGISTRY_WRITER", "REGISTRY_WRITER_TO_ARTIFACT_DESTINATION", "ARTIFACT_DESTINATION_TO_TARGET_RESOLUTION",
  "TARGET_RESOLUTION_TO_PERMISSION_POLICY_RESOLUTION",
  "ORCHESTRATES_CAPABILITY", "INGRESS_DISPATCHES_TO_ORCHESTRATOR", "PERMISSION_POLICY_RESOLUTION_TO_ADMISSION", "ADMISSION_TO_SOURCE_EXECUTION", "EXECUTOR_USES_CONNECTION_REGISTRY", "PROVIDER_AUTHORIZATION_MANAGES_CONNECTION", "EXECUTOR_REQUIRES_PROVIDER_AUTHORIZATION", "SOURCE_EXECUTION_TO_POST_COMMIT_VERIFICATION", "POST_COMMIT_VERIFICATION_TO_DEPLOYABLE_ARTIFACT_READINESS",
]);
const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set<RelationshipEntityType>(["FILE", "MODULE", "CAPABILITY", "WORKER", "API", "TEST", "DEPENDENCY", "OWNER", "SYSTEM_COMPONENT"]);

/** The control-plane chain kinds plus the two orchestration kinds — see types.ts's RelationshipKind doc comment. Always CAPABILITY -> CAPABILITY, and the target must already be a real, registered capability (see requireExistingCapabilityTarget below). */
const CHAIN_RELATIONSHIP_KINDS: ReadonlySet<string> = new Set<RelationshipKind>([
  "MCP_TO_WORK_RESULT_INGRESS", "WORK_RESULT_TO_DOMAIN_CLASSIFIER", "DOMAIN_TO_REGISTRATION_GATE", "REGISTRATION_GATE_TO_REGISTRY_WRITER", "REGISTRY_WRITER_TO_ARTIFACT_DESTINATION", "ARTIFACT_DESTINATION_TO_TARGET_RESOLUTION",
  "TARGET_RESOLUTION_TO_PERMISSION_POLICY_RESOLUTION",
  "ORCHESTRATES_CAPABILITY", "INGRESS_DISPATCHES_TO_ORCHESTRATOR", "PERMISSION_POLICY_RESOLUTION_TO_ADMISSION", "ADMISSION_TO_SOURCE_EXECUTION", "EXECUTOR_USES_CONNECTION_REGISTRY", "PROVIDER_AUTHORIZATION_MANAGES_CONNECTION", "EXECUTOR_REQUIRES_PROVIDER_AUTHORIZATION", "SOURCE_EXECUTION_TO_POST_COMMIT_VERIFICATION", "POST_COMMIT_VERIFICATION_TO_DEPLOYABLE_ARTIFACT_READINESS",
]);

/** Exported for reuse by control/registration-update/ — the same closed relationship vocabulary applies whether a relationship is bound at CREATE time (here) or ADD_RELATIONSHIP time (there); this validation logic has exactly one owner regardless of caller. */
export type CandidateRelationshipInput = { to_type: string; to_id: string; relationship_kind: string };
export type ValidatedRelationships = { ok: true; rows: Omit<RelationshipRow, "relationship_id" | "created_at">[] } | { ok: false; reason: string };

/**
 * Validates every caller-supplied relationship before any write happens —
 * fail-closed: one invalid entry rejects the whole registration, never a
 * silent partial write. from_type/from_id is always this candidate's own
 * capability (relationships only make sense once a real capability_id
 * exists), auto-filled here, never caller-suppliable. For the six
 * control-plane chain kinds, the target must already be a real, existing
 * capability in `store` — never a floating id/name that was never
 * registered (STEP "Persist and Rebuild Canonical Control-Plane
 * Registration Chain", requirement #7/#8).
 */
export function validateCandidateRelationships(relationships: readonly CandidateRelationshipInput[] | undefined, capabilityId: string | null, store: RegistryStore): ValidatedRelationships {
  if (!relationships || relationships.length === 0) return { ok: true, rows: [] };
  if (!capabilityId) return { ok: false, reason: "RELATIONSHIP_REQUIRES_CAPABILITY_KIND" };
  const rows: Omit<RelationshipRow, "relationship_id" | "created_at">[] = [];
  for (const rel of relationships) {
    if (!VALID_RELATIONSHIP_KINDS.has(rel.relationship_kind)) return { ok: false, reason: `UNKNOWN_RELATIONSHIP_KIND:${rel.relationship_kind}` };
    if (!VALID_ENTITY_TYPES.has(rel.to_type)) return { ok: false, reason: `UNKNOWN_RELATIONSHIP_ENTITY_TYPE:${rel.to_type}` };
    const requiredTarget = SYSTEM_COMPONENT_TARGETS[rel.relationship_kind];
    if (requiredTarget !== undefined && (rel.to_type !== "SYSTEM_COMPONENT" || rel.to_id !== requiredTarget)) {
      return { ok: false, reason: `INVALID_SYSTEM_COMPONENT_TARGET:${rel.relationship_kind}` };
    }
    if (CHAIN_RELATIONSHIP_KINDS.has(rel.relationship_kind)) {
      if (rel.to_type !== "CAPABILITY") return { ok: false, reason: `CHAIN_RELATIONSHIP_REQUIRES_CAPABILITY_TARGET:${rel.relationship_kind}` };
      if (!store.findCapabilityById(rel.to_id)) return { ok: false, reason: `RELATIONSHIP_TARGET_NOT_FOUND:${rel.to_id}` };
    }
    rows.push({ from_type: "CAPABILITY", from_id: capabilityId, to_type: rel.to_type as RelationshipEntityType, to_id: rel.to_id, relationship_kind: rel.relationship_kind as RelationshipKind });
  }
  return { ok: true, rows };
}

/** The one truthful, caller-facing result of Candidate -> Gate -> Writer — see ./README.md "Registration Ingress Contract". Never a guess: every branch in `control/registration-pipeline/pipeline.ts` sets `status`/`reason_code`/`duplicate_of` from a real signal it already computed, nothing inferred after the fact. */
export type RegistrationIngressStatus = "REGISTERED" | "DUPLICATE" | "REJECTED" | "UNRESOLVED";

export interface DuplicateOf { candidate_id: string | null; resource_id: string | null; capability_id: string | null }

/**
 * The Registry Writer's own result — write-only, see
 * `commitRegisteredCandidate()`. This is NOT the full Registration
 * Ingress result (that 4-state `RegistrationIngressStatus` is assembled
 * by `control/registration-pipeline/pipeline.ts`, which is the only
 * place DUPLICATE/REJECTED/UNRESOLVED are ever decided — this writer
 * never produces them itself, since it is never even called for those
 * outcomes).
 */
export interface CommitResult {
  written: boolean;
  inserted: boolean;
  resource_id: string | null;
  capability_id: string | null;
  /** Set only when written=false — always RELATIONSHIP_INVALID:<reason>, the one thing this writer itself can still refuse. */
  reason_code: string | null;
}

/**
 * STEP "Refactor Registration Pipeline to Single-Owner Sequential
 * Stages", stage 5 (REGISTRY WRITER): writes exactly what it is told,
 * for a candidate the caller (`control/registration-pipeline/pipeline.ts`)
 * has ALREADY run through Classification and Duplicate Resolution and
 * approved. This function never re-derives domain/resource_type, never
 * re-checks for a duplicate, never consults `existing` — it has no
 * decision left to make except one purely structural, write-time
 * concern: are the caller-supplied relationship edges internally valid
 * (real kind, real entity type, and for the control-plane chain kinds, a
 * real already-registered target)? That is not classification and not
 * duplicate detection — it is "is this specific write I am about to
 * perform well-formed", the Writer's own, sole remaining responsibility.
 * `repositoryId` is write-only data threading, not a decision: the
 * caller (`control/registration-pipeline/repository-resolution.ts`) has
 * already independently resolved it against
 * `software/repository-registry/` before this function is ever called —
 * this function never resolves, re-resolves, or trusts a raw claim
 * itself, it only persists the value it was handed.
 */
export function commitRegisteredCandidate(candidate: RegistrationCandidate, fingerprint: RegistrationFingerprint, store: RegistryStore, repositoryId: string | null = null): CommitResult {
  const resourceId = `resource-${randomUUID()}`, capabilityId = candidate.kind === "capability" ? `capability-${randomUUID()}` : null;

  const relationshipValidation = validateCandidateRelationships(candidate.relationships, capabilityId, store);
  if (!relationshipValidation.ok) {
    store.appendRegistrationEvent({ candidate_id: candidate.candidate_id, decision: "RELATIONSHIP_INVALID", duplicate_result: null, evidence_ref: candidate.evidence_refs });
    return { written: false, inserted: false, resource_id: null, capability_id: null, reason_code: `RELATIONSHIP_INVALID:${relationshipValidation.reason}` };
  }

  const baseRelationships: Omit<RelationshipRow, "relationship_id" | "created_at">[] = capabilityId ? [{ from_type: "FILE", from_id: resourceId, to_type: "CAPABILITY", to_id: capabilityId, relationship_kind: "MODULE_TO_CAPABILITY" }] : [];
  const input: ApprovedCandidateWrite = { resource: { resource_id: resourceId, resource_type: candidate.kind, owner_id: candidate.owner, repository_id: repositoryId, source_location: candidate.source_location, module: null, version: candidate.version, content_hash: fingerprint.exact, status: "REGISTERED" }, capability: capabilityId ? { capability_id: capabilityId, canonical_name: candidate.name, capability_type: candidate.kind, purpose: candidate.behavior, input_contract: candidate.input, output_contract: candidate.output, side_effects: candidate.side_effects, semantic_fingerprint: fingerprint.semantic, ingress_metadata: candidate.ingress_metadata ?? null } : null, relationships: [...baseRelationships, ...relationshipValidation.rows], version: { resource_id: resourceId, version: candidate.version, commit_sha: null, hash: fingerprint.exact, source_location: candidate.source_location, evidence_ref: candidate.evidence_refs[0] ?? null }, evidence: candidate.evidence_refs.map((ref) => ({ evidence_ref: ref, evidence_type: "registration", related_resource_id: resourceId, related_capability_id: capabilityId } as any)) };
  const outcome = store.writeApprovedCandidate(input);
  store.appendRegistrationEvent({ candidate_id: candidate.candidate_id, decision: "REGISTERED", duplicate_result: null, evidence_ref: candidate.evidence_refs });
  return { written: true, inserted: outcome.inserted, resource_id: outcome.resource_id, capability_id: outcome.capability_id, reason_code: null };
}
export async function writeApprovedRegistration(command:ApprovedRegistrationCommand,db:DatabasePort):Promise<RegistrationResult>{
  if(command.status!=="APPROVED_FOR_REGISTRATION")throw Error("REGISTRATION_NOT_APPROVED");
  // Database Port layer (rule #3): reject any domain outside the pipeline
  // allowlist again here, independently of whatever the upstream gate or
  // Registry Writer already decided.
  const domainRouting = classifyRegistrationDomain({ domain: command.domain, resource_type: command.resource_type, source_system: command.source_system });
  if (domainRouting.routing_result !== "ACCEPT_SOFTWARE_REGISTRATION") throw Error(`DOMAIN_REJECTED:${domainRouting.reason_code ?? "BUSINESS_DATA_NOT_ALLOWED"}`);
  return db.writeRegistrationTransaction(command);
}
