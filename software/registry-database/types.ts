/**
 * หน้าที่: the row/query type contracts for `software/registry-database/` —
 * the TypeScript mirror of `migrations/0001_create_software_registry_schema.sql`.
 * Every field here must have a corresponding column in that migration; the
 * two are meant to be read side by side.
 *
 * Input: none (pure type definitions).
 * Output: `ResourceRow`, `CapabilityRow`, `ResourceCapabilityRow`,
 * `RelationshipRow`, `RelationshipEdge`, `VersionRow`, `EvidenceRow`,
 * `RegistrationEventRow`, `CapabilityLookupQuery`, `CapabilityLookupResult`,
 * `IngressMetadataRow`.
 * Dependency ที่อนุญาต: none — a leaf contract, same discipline as
 * `contracts/identity/envelope-identity.ts`.
 * สิ่งที่ห้ามแตะ: never add a field here that stores business data
 * (company/customer/job/payment content) — see G-VAL-003 and this folder's
 * own `ARCHITECTURE_DECISIONS.md`. `evidence.evidence_ref` is a reference
 * (file path, test-run id, URL) — never a copy of the underlying log/source.
 */

export type ResourceStatus = "REGISTERED" | "SUPERSEDED" | "RETIRED";
export type CapabilityRegistryStatus = "REGISTERED" | "VERIFIED" | "SUPERSEDED" | "RETIRED";

export type RelationshipKind =
  | "FILE_TO_MODULE"
  | "MODULE_TO_CAPABILITY"
  | "CAPABILITY_TO_WORKER"
  | "CAPABILITY_TO_API"
  | "CAPABILITY_TO_TEST"
  | "CAPABILITY_TO_DEPENDENCY"
  | "CAPABILITY_TO_OWNER"
  /** A CAPABILITY (resource_type=AI_INGRESS) connecting to one of DNA OS's
   * own real pipeline stages. Each of these six always targets
   * to_type=SYSTEM_COMPONENT with one specific, fixed to_id — see
   * software/registry-database/registry-writer.ts's SYSTEM_COMPONENT_TARGETS
   * for the canonical (command_ingress/registration_ingress/task_lookup/
   * capability_lookup/work_result_return/system_status_read) mapping,
   * which names DNA OS's own already-real endpoints
   * (POST /command, POST /registry/candidates, GET /task/:id,
   * GET /registry/capabilities/:id, POST /handoff, GET /runtime/inventory)
   * — never a new registry, just a reference to what already exists. */
  | "COMMAND_INGRESS"
  | "REGISTRATION_INGRESS"
  | "TASK_LOOKUP"
  | "CAPABILITY_LOOKUP"
  | "WORK_RESULT_RETURN"
  | "SYSTEM_STATUS_READ"
  /** The canonical control-plane registration chain, one edge per real
   * pipeline handoff (dna-os-mcp -> work-result-ingress -> domain-classification
   * -> registration-gate -> registry-writer -> artifact-destination ->
   * target-resolution). Each of these always targets to_type=CAPABILITY
   * with a to_id that must already be a real, registered capability_id —
   * see registry-writer.ts's requireExistingCapabilityTarget. */
  | "MCP_TO_WORK_RESULT_INGRESS"
  | "WORK_RESULT_TO_DOMAIN_CLASSIFIER"
  | "DOMAIN_TO_REGISTRATION_GATE"
  | "REGISTRATION_GATE_TO_REGISTRY_WRITER"
  | "REGISTRY_WRITER_TO_ARTIFACT_DESTINATION"
  | "ARTIFACT_DESTINATION_TO_TARGET_RESOLUTION"
  /** Target Resolution's output feeds Permission/Policy Resolution — see
   * control/permission-policy-resolution/. Same CAPABILITY -> CAPABILITY,
   * existing-target-only discipline as the six chain kinds above. */
  | "TARGET_RESOLUTION_TO_PERMISSION_POLICY_RESOLUTION"
  /** ORCHESTRATION semantics — deliberately distinct from the "next step
   * in a sequential handoff" meaning every kind above carries.
   * ORCHESTRATES_CAPABILITY means "the from_id capability composes/owns
   * the to_id capability as one of its internal stages" — see
   * control/registration-pipeline/, which orchestrates
   * domain-classification/registration-gate/registry-writer without
   * replacing or standing in front of any of them in the existing
   * sequential chain. INGRESS_DISPATCHES_TO_ORCHESTRATOR means "the
   * from_id ingress hands a request to the to_id orchestrator to run" —
   * distinct from the sequential *_TO_* kinds above, which never carry an
   * orchestration meaning. Both still require the target to already be a
   * real, registered capability_id — same existing-target-only discipline
   * as every kind above. */
  | "ORCHESTRATES_CAPABILITY"
  | "INGRESS_DISPATCHES_TO_ORCHESTRATOR"
  /** Permission/Policy Resolution's output feeds Admission — see
   * control/admission/. Same sequential "next stage" meaning as the
   * chain kinds above (never orchestration), same CAPABILITY -> CAPABILITY,
   * existing-target-only discipline. */
  | "PERMISSION_POLICY_RESOLUTION_TO_ADMISSION"
  /** Admission's ADMITTED output feeds Source Execution — see
   * control/source-execution/. Same sequential "next stage" meaning,
   * same CAPABILITY -> CAPABILITY, existing-target-only discipline. */
  | "ADMISSION_TO_SOURCE_EXECUTION"
  /** DEPENDENCY semantics — deliberately distinct from both "sequential
   * next stage" and "orchestration" above. EXECUTOR_USES_CONNECTION_REGISTRY
   * means "the from_id capability resolves its real target/credential
   * through the to_id connection registry capability before it can act" —
   * see control/source-execution/ -> connections/github/ (executor) ->
   * connections/connection-registry/. Never implies from_id hands off
   * control to to_id (that's *_TO_* chain semantics) or that from_id
   * composes to_id as an internal stage (that's ORCHESTRATES_CAPABILITY).
   * Same CAPABILITY -> CAPABILITY, existing-target-only discipline as
   * every kind above. */
  | "EXECUTOR_USES_CONNECTION_REGISTRY"
  /** DEPENDENCY semantics, same family as EXECUTOR_USES_CONNECTION_REGISTRY
   * but naming a different real relationship — see
   * connections/provider-authorization/. PROVIDER_AUTHORIZATION_MANAGES_CONNECTION
   * means "the from_id authorization-lifecycle capability is the one that
   * attaches/rotates/revokes credential_ref on the to_id connection
   * registry's records" (from_id=provider-authorization, to_id=connection-registry).
   * EXECUTOR_REQUIRES_PROVIDER_AUTHORIZATION means "the from_id executor
   * capability cannot resolve a usable credential until the to_id
   * authorization capability has granted a CONNECTED authorization"
   * (from_id=github-source-executor, to_id=provider-authorization). Neither
   * implies sequential handoff (*_TO_*) or orchestration
   * (ORCHESTRATES_CAPABILITY) — both are dependency edges. Same
   * CAPABILITY -> CAPABILITY, existing-target-only discipline as every
   * kind above. */
  | "PROVIDER_AUTHORIZATION_MANAGES_CONNECTION"
  | "EXECUTOR_REQUIRES_PROVIDER_AUTHORIZATION"
  /** Sequential "next stage" semantics, same family as
   * ADMISSION_TO_SOURCE_EXECUTION — Source Execution's SUCCEEDED output
   * (a real commit_sha) feeds Post-Commit Verification next. See
   * control/post-commit-verification/. Same CAPABILITY -> CAPABILITY,
   * existing-target-only discipline as every kind above. */
  | "SOURCE_EXECUTION_TO_POST_COMMIT_VERIFICATION"
  /** Sequential "next stage" semantics, same family as
   * SOURCE_EXECUTION_TO_POST_COMMIT_VERIFICATION — Post-Commit
   * Verification's VERIFIED output feeds Deployable Artifact Readiness
   * next. See control/deployable-artifact-readiness/. Same
   * CAPABILITY -> CAPABILITY, existing-target-only discipline as every
   * kind above. */
  | "POST_COMMIT_VERIFICATION_TO_DEPLOYABLE_ARTIFACT_READINESS";

/** SYSTEM_COMPONENT = a real DNA OS pipeline stage referenced by one of the six ingress relationship kinds above — never a resource/capability row of its own. */
export type RelationshipEntityType = "FILE" | "MODULE" | "CAPABILITY" | "WORKER" | "API" | "TEST" | "DEPENDENCY" | "OWNER" | "SYSTEM_COMPONENT";

/** software_registry.resources — one row per registered artifact (file/module/repository entry). */
export interface ResourceRow {
  resource_id: string;
  resource_type: string;
  owner_id: string;
  repository_id: string | null;
  source_location: string;
  module: string | null;
  version: string;
  content_hash: string;
  status: ResourceStatus;
  created_at: string;
  updated_at: string;
}

/**
 * The AI_INGRESS Type Validation contract, mirrored here rather than
 * imported from control/event-pipeline/domain-classification.ts (this
 * file is a leaf contract, zero cross-folder dependency, matching this
 * repo's Capability Folder Law) — same shape as that file's
 * `IngressMetadata`, kept in sync by hand.
 */
export interface IngressMetadataRow {
  canonical_name: string;
  audience: "MACHINE_AGENT_ONLY";
  human_facing: boolean;
  transport: string;
  endpoint: string;
  accepted_callers: readonly string[];
  purpose: string;
}

/** software_registry.capabilities — one row per distinct, semantically-fingerprinted capability. */
export interface CapabilityRow {
  capability_id: string;
  canonical_name: string;
  capability_type: string;
  purpose: string;
  input_contract: readonly string[];
  output_contract: readonly string[];
  side_effects: readonly string[];
  semantic_fingerprint: string;
  status: CapabilityRegistryStatus;
  verified_at: string | null;
  /** Present only for capability_type=AI_INGRESS candidates — see IngressMetadataRow. */
  ingress_metadata: IngressMetadataRow | null;
}

/** software_registry.resource_capabilities — join table. */
export interface ResourceCapabilityRow {
  resource_id: string;
  capability_id: string;
}

/** software_registry.relationships. */
export interface RelationshipRow {
  relationship_id: string;
  from_type: RelationshipEntityType;
  from_id: string;
  to_type: RelationshipEntityType;
  to_id: string;
  relationship_kind: RelationshipKind;
  created_at: string;
}

/** software_registry.versions. */
export interface VersionRow {
  version_id: string;
  resource_id: string;
  version: string;
  commit_sha: string | null;
  hash: string;
  source_location: string;
  evidence_ref: string | null;
  created_at: string;
}

/** software_registry.evidence — a reference only, never a copy of the underlying log/source. */
export interface EvidenceRow {
  evidence_id: string;
  evidence_ref: string;
  evidence_type: string;
  related_resource_id: string | null;
  related_capability_id: string | null;
  created_at: string;
}

/**
 * software_registry.registration_events — append-only. Written for EVERY
 * `registerCandidate()` call regardless of outcome (approved, duplicate, or
 * rejected) — this is the audit trail of registration attempts, not only
 * successes. `duplicate_result` is the id of whatever existing row this
 * attempt matched, whether that match came from the upstream duplicate gate
 * (`DUPLICATE_EXACT`/`DUPLICATE_CANDIDATE`) or from the store's own
 * uniqueness check collapsing an "APPROVED" write into an existing row.
 */
export interface RegistrationEventRow {
  event_id: string;
  candidate_id: string;
  decision: string;
  duplicate_result: string | null;
  evidence_ref: readonly string[];
  created_at: string;
}

export interface CapabilityLookupQuery {
  capability_id?: string;
  canonical_name?: string;
  semantic_fingerprint?: string;
}

/** One persisted relationship edge, as read back from the registry — see RelationshipKind/RelationshipEntityType above. */
export interface RelationshipEdge {
  to_type: RelationshipEntityType;
  to_id: string;
  relationship_kind: RelationshipKind;
}

export interface CapabilityLookupResult {
  capability_id: string;
  resource_ids: readonly string[];
  source_location: readonly string[];
  version: readonly string[];
  status: CapabilityRegistryStatus;
  input_contract: readonly string[];
  output_contract: readonly string[];
  dependencies: readonly string[];
  eligible_workers: readonly string[];
  evidence_refs: readonly string[];
  /** Present only for capability_type=AI_INGRESS candidates. */
  ingress_metadata: IngressMetadataRow | null;
  /** Every relationship edge persisted for this capability — includes the six ingress kinds above alongside the pre-existing ones. */
  relationships: readonly RelationshipEdge[];
}
