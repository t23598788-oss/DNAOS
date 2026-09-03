import { createHash } from "node:crypto";
import { classifyRegistrationDomain, validateIngressMetadata, type DomainClassificationResult, type IngressMetadata, type RegistrationDomain, type RegistrationResourceType } from "./domain-classification";

/**
 * A caller-declared relationship edge from this candidate's own capability
 * to some other entity — kept as loose strings here (a leaf contract has
 * no dependency on software/registry-database/types.ts's closed
 * RelationshipKind/RelationshipEntityType enums) and validated against
 * those real enums downstream, in software/registry-database/registry-writer.ts,
 * the one place that vocabulary already lives.
 */
export interface CandidateRelationship {
  to_type: string;
  to_id: string;
  relationship_kind: string;
}

export interface RegistrationCandidate {
  candidate_id: string;
  name: string;
  kind: "resource" | "capability";
  source_location: string;
  owner: string;
  input: readonly string[];
  output: readonly string[];
  side_effects: readonly string[];
  dependencies: readonly string[];
  behavior: string;
  version: string;
  evidence_refs: readonly string[];
  /** Domain Classification boundary — see ./domain-classification.ts. `domain` is the caller's claim; `resource_type` is what evaluateRegistration actually classifies from. */
  domain: RegistrationDomain;
  resource_type: RegistrationResourceType;
  data_classification: string;
  source_system: string;
  scope: string;
  /** Required and validated only when resource_type is AI_INGRESS — see ./domain-classification.ts's validateIngressMetadata. */
  ingress_metadata?: IngressMetadata;
  /** Optional caller-supplied relationship edges — see software/registry-database/registry-writer.ts for validation and persistence. */
  relationships?: readonly CandidateRelationship[];
  /**
   * Why this resource is entering the network, supplied by the producer that
   * knows — which is the only moment anyone does. Added 2026-09-02 because its
   * absence was the measured cause of orphan birth: 494 of 620 resources carry
   * no relationship and 0 of 200 sampled can say why they exist, because a
   * producer that knew had nowhere to put it. Optional, so every existing caller
   * is unaffected; an omission is recorded as UNBOUND_UNKNOWN, never guessed.
   */
  origin?: {
    readonly origin_kind: string;
    /** A machine identity or pointer — never prose. */
    readonly origin_reference: string | null;
    readonly introduced_by: string | null;
  };
  /**
   * CLASSIFICATION, not lifecycle state (Owner, FIX_TEST_FIXTURE_OWNERSHIP).
   * Defaults to `kind` — every existing caller is unaffected. The one value
   * with machine meaning today is `"TEST_FIXTURE"`: a real registry record
   * whose only job is to own an isolated proof resource, and which
   * `software/capability-registrar/write-ownership-index.ts` refuses to let
   * own anything outside `tests/__sandbox__/`. It is deliberately a TYPE and
   * not a STATUS — `status` stays REGISTERED/VERIFIED/SUPERSEDED/RETIRED, so
   * a fixture is a normal, fully-registered record that simply cannot reach
   * production paths.
   */
  capability_type?: string;
  /**
   * A repository ownership CLAIM — never trusted directly as a
   * repository_id. Same field names/pattern as
   * control/agent-production-ingress/'s own requested_owner/
   * requested_repository, reused deliberately for consistency.
   * control/registration-pipeline/repository-resolution.ts independently
   * resolves this claim against software/repository-registry/ before the
   * Registry Writer ever persists a repository_id — see that file's own
   * header. Both fields absent is a legitimate NOT_APPLICABLE (no
   * repository claim made, e.g. an evidence-only row) — never a failure.
   * Exactly one present is always REJECTED (an incomplete claim).
   */
  requested_owner?: string | null;
  requested_repository?: string | null;
  canonical_ref?: { identity_type: string; identity_id: string };
  projection_kind?: string;
}

export interface RegistrationFingerprint {
  exact: string;
  semantic: string;
  normalized: Omit<RegistrationCandidate, "candidate_id" | "name" | "source_location" | "version">;
}

/**
 * This function's ONLY job is Domain / Resource Type Classification (STEP
 * "Refactor Registration Pipeline to Single-Owner Sequential Stages",
 * stage 2) — it answers "what is this resource / which domain" and
 * nothing else. It NEVER computes a fingerprint, NEVER checks duplicates
 * (that is Duplicate Resolution's exclusive job — see
 * `control/registration-pipeline/duplicate-resolution.ts`), and NEVER
 * writes to the registry. `control/registration-pipeline/pipeline.ts` is
 * the only caller — `software/registry-database/registry-writer.ts` no
 * longer re-derives domain/ingress-metadata validity itself, so this
 * check now runs exactly once per candidate, system-wide.
 */
export type ClassificationDecision = "ACCEPT" | "DOMAIN_REJECTED" | "UNRESOLVED_DOMAIN" | "INGRESS_METADATA_INVALID";

export type ClassificationResult =
  | { decision: "ACCEPT"; domain_routing: DomainClassificationResult }
  | { decision: "DOMAIN_REJECTED"; domain_routing: DomainClassificationResult; reason_code: string }
  | { decision: "UNRESOLVED_DOMAIN"; domain_routing: DomainClassificationResult; reason_code: string }
  | { decision: "INGRESS_METADATA_INVALID"; domain_routing: DomainClassificationResult; reason_code: string };

export function classifyCandidate(candidate: RegistrationCandidate): ClassificationResult {
  const domainRouting = classifyRegistrationDomain({ domain: candidate.domain, resource_type: candidate.resource_type, source_system: candidate.source_system });
  if (domainRouting.routing_result === "UNRESOLVED_DOMAIN") {
    return { decision: "UNRESOLVED_DOMAIN", domain_routing: domainRouting, reason_code: domainRouting.reason_code ?? "UNRESOLVED_DOMAIN" };
  }
  if (domainRouting.routing_result !== "ACCEPT_SOFTWARE_REGISTRATION") {
    return { decision: "DOMAIN_REJECTED", domain_routing: domainRouting, reason_code: domainRouting.reason_code ?? "DOMAIN_REJECTED" };
  }
  // Type Validation (AI_INGRESS-only, a no-op for every other
  // resource_type) is part of "what is this resource" — same stage,
  // still resource-type-scoped, still zero duplicate/write concern.
  const ingressValidation = validateIngressMetadata(candidate);
  if (!ingressValidation.ok) {
    return { decision: "INGRESS_METADATA_INVALID", domain_routing: domainRouting, reason_code: ingressValidation.reason ?? "INGRESS_METADATA_INVALID" };
  }
  return { decision: "ACCEPT", domain_routing: domainRouting };
}

function normalize(value: string): string { return value.toLowerCase().replace(/\b[a-z_$][\w$]*\b/g, (token) => /^[a-z_$][\w$]*$/.test(token) && token.length <= 2 ? token : "identifier").replace(/\s+/g, " ").trim(); }
function sorted(values: readonly string[]): string[] { return values.map(normalize).sort(); }

/**
 * Pure hashing utility — belongs to no stage on its own. Called exactly
 * once per candidate, by Duplicate Resolution only (the exclusive owner
 * of what "duplicate" means in this pipeline).
 */
export function fingerprintCandidate(candidate: RegistrationCandidate): RegistrationFingerprint {
  const normalized = {
    kind: candidate.kind,
    owner: normalize(candidate.owner),
    input: sorted(candidate.input), output: sorted(candidate.output),
    side_effects: sorted(candidate.side_effects), dependencies: sorted(candidate.dependencies), behavior: normalize(candidate.behavior),
    evidence_refs: [...candidate.evidence_refs].sort(),
    domain: candidate.domain, resource_type: candidate.resource_type, data_classification: candidate.data_classification, source_system: candidate.source_system, scope: candidate.scope,
  };
  const exact = createHash("sha256").update(JSON.stringify({ ...candidate, candidate_id: undefined })).digest("hex");
  const semantic = createHash("sha256").update(JSON.stringify({ ...normalized, evidence_refs: undefined })).digest("hex");
  return { exact, semantic, normalized };
}
