/**
 * หน้าที่: Engineering Runtime coding-gate contracts. This folder is the
 * ENGINEERING write authority path only. Business READ / OPERATE /
 * DOCUMENTATION commands never share this type or this write scope.
 *
 * Input: none (pure types).
 * Output: coding intent, admission, completion, and run result shapes.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add commit/push/PR/deploy fields the worker can
 * set to ALLOW. never let the model supply repository_id, branch_ref,
 * worktree_path, GitHub owner/repo, or credential values as authority.
 */

export const ENGINEERING_AUTHORITY = "ENGINEERING" as const;
export const BUSINESS_AUTHORITY = "BUSINESS" as const;

export type RuntimeAuthority = typeof ENGINEERING_AUTHORITY | typeof BUSINESS_AUTHORITY;

export const WORKER_DENIED_OPERATIONS = {
  COMMIT: "DENY",
  PUSH: "DENY",
  PR: "DENY",
  DEPLOY: "DENY",
} as const;

export type WorkerDeniedOperations = typeof WORKER_DENIED_OPERATIONS;

export interface EngineeringCodingIntent {
  readonly authority: typeof ENGINEERING_AUTHORITY;
  readonly allowed_paths: readonly string[];
  readonly allowed_symbols: readonly string[];
  readonly required_tests: readonly string[];
  readonly forbidden_paths: readonly string[];
  readonly requested_function: string;
  readonly requested_change: string;
  readonly target_domain: string;
  readonly owner_intent: string;
}

export type EngineeringGateReason =
  | "ADMITTED"
  | "MISSING_CODING_SCOPE"
  | "REPOSITORY_ROOT_USED_AS_WRITE_SCOPE"
  | "MISSING_REQUIRED_TESTS"
  | "MISSING_FORBIDDEN_PATHS"
  | "REPOSITORY_IDENTITY_AMBIGUOUS"
  | "REPOSITORY_IDENTITY_MISSING"
  | "WORK_RESOLUTION_NOT_DISPATCHABLE"
  | "SCOPE_INTERSECTION_EMPTY"
  | "BUSINESS_CANNOT_ENTER_ENGINEERING_WRITE"
  | "PATH_TRAVERSAL"
  | "WRITE_OUT_OF_ALLOWED_SCOPE"
  | "WRITE_IN_FORBIDDEN_SCOPE"
  | "WRITE_OUTSIDE_WORKTREE"
  | "ISOLATION_FAILED"
  | "WORKER_FAILED"
  | "SCOPE_EXPANDED"
  | "UNDECLARED_FILE_CHANGE"
  | "FORBIDDEN_PATH_CHANGED"
  | "TEST_EVIDENCE_MISSING"
  | "MANIFEST_SCOPE_MISMATCH"
  | "REPOSITORY_IDENTITY_MISMATCH"
  | "BASE_REVISION_MISMATCH"
  | "DEFINITION_OF_DONE_INCOMPLETE"
  | "INTEGRATION_FAILED"
  | "CODING_INCOMPLETE"
  | "REMOTE_IDENTITY_MISMATCH"
  | "REMOTE_HEAD_MOVED"
  | "UNREGISTERED_REMOTE"
  | "BRANCH_POLICY_DENIED"
  | "CREDENTIAL_UNAVAILABLE"
  | "LOCAL_COMMIT_NOT_ADMITTED"
  | "UNRELATED_CHANGE_PRESENT"
  | "MANIFEST_HASH_MISMATCH"
  | "GITHUB_PUBLISH_BLOCKED"
  | "DNA_OS_PUBLISH_AUTHORITY_REQUIRED"
  | "WORKER_GITHUB_WRITE_DENIED"
  | "CREDENTIAL_INVALID"
  | "REPOSITORY_NOT_ACCESSIBLE"
  | "REMOTE_NOT_FOUND"
  | "SCOPE_LOCKED"
  | "DUPLICATE_LIFECYCLE"
  | "REPAIR_EXHAUSTED"
  | "WORKER_AUTHORITY_DENIED"
  | "REGISTRY_WRITE_FAILED"
  | "LIFECYCLE_ILLEGAL_TRANSITION"
  | "RECOVERY_UNSAFE"
  | "REMOTE_MISMATCH"
  | "GITHUB_LINEAGE_MISMATCH"
  | "EXPECTED_FILES_MISSING"
  | "CI_PENDING"
  | "CI_FAILED"
  | "UNMANAGED_WORKSPACE";

export interface EngineeringAdmission {
  readonly admitted: boolean;
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly repository_id: string | null;
  readonly repository_root: string | null;
  readonly allowed_paths: readonly string[];
  readonly allowed_symbols: readonly string[];
  readonly required_tests: readonly string[];
  readonly forbidden_paths: readonly string[];
  readonly work_resolution_decision: string | null;
  readonly work_id: string;
  readonly command_id: string;
}

export interface EngineeringLineage {
  readonly command_id: string;
  readonly work_id: string;
  readonly reservation_id: string | null;
  readonly branch_ref: string | null;
  readonly worktree_path: string | null;
  readonly base_commit_sha: string | null;
  readonly repository_id: string | null;
  readonly changed_path: string | null;
  readonly manifest_id?: string | null;
  readonly admission_decision?: "ALLOW" | "DENY" | null;
  readonly integration_status?: string | null;
  readonly dna_os_commit_sha?: string | null;
  readonly github_owner?: string | null;
  readonly github_repository?: string | null;
  readonly publish_branch?: string | null;
  readonly github_remote_url?: string | null;
  readonly credential_ref?: string | null;
  readonly pre_publish_remote_sha?: string | null;
  readonly post_publish_remote_sha?: string | null;
  readonly publish_status?: string | null;
}

export interface EngineeringRunResult {
  readonly status: "COMPLETED" | "BLOCKED" | "FAILED";
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly admission: EngineeringAdmission;
  readonly lineage: EngineeringLineage;
  readonly write_applied: boolean;
  readonly rejected_write: string | null;
}

export interface ProposedScopedWrite {
  readonly relative_path: string;
  readonly content: string;
}

export interface EngineeringTestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export interface EngineeringDefinitionOfDone {
  readonly code: boolean;
  readonly tests: boolean;
  readonly machine_readable_contract: boolean;
  readonly human_documentation: boolean;
  readonly registry_connection_update: boolean;
  readonly evidence: boolean;
}

export interface EngineeringResultManifest {
  readonly manifest_id: string;
  readonly produced_by: "control/engineering-runtime";
  readonly command_id: string;
  readonly work_id: string;
  readonly repository_id: string;
  readonly reservation_id: string;
  readonly base_commit_sha: string;
  readonly branch_ref: string;
  readonly worktree_path: string;
  readonly allowed_paths: readonly string[];
  readonly allowed_symbols: readonly string[];
  readonly changed_paths: readonly string[];
  readonly changed_symbols: readonly string[];
  readonly required_tests: readonly string[];
  readonly actual_test_results: readonly EngineeringTestResult[];
  readonly forbidden_paths: readonly string[];
  readonly produced_artifacts: readonly { readonly path: string; readonly sha256: string }[];
  readonly documentation_changed: readonly string[];
  readonly registry_connection_records_changed: readonly string[];
  readonly completion_timestamp: string;
  readonly evidence_refs: readonly string[];
  readonly worker_authority: WorkerDeniedOperations;
  readonly definition_of_done: EngineeringDefinitionOfDone;
}

export interface EngineeringResultAdmission {
  readonly decision: "ALLOW" | "DENY";
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly manifest_id: string | null;
}

export interface EngineeringIntegrationResult {
  readonly integrated: boolean;
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly integrated_paths: readonly string[];
  readonly registry_record_path: string | null;
}

export interface EngineeringCompletionResult {
  readonly status: "VERIFIED" | "BLOCKED" | "FAILED";
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly coding: EngineeringRunResult;
  readonly manifest: EngineeringResultManifest | null;
  readonly result_admission: EngineeringResultAdmission;
  readonly integration: EngineeringIntegrationResult | null;
  readonly lineage: EngineeringLineage;
}

export interface DnaOsCommitResult {
  readonly committed: boolean;
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly commit_sha: string | null;
  readonly parent_sha: string | null;
  readonly staged_paths: readonly string[];
}

export interface GithubPublishResult {
  readonly published: boolean;
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly commit_sha: string | null;
  readonly pre_publish_remote_sha: string | null;
  readonly post_publish_remote_sha: string | null;
  readonly github_owner: string | null;
  readonly github_repository: string | null;
  readonly publish_branch: string | null;
  readonly force_push_attempted: false;
}

export interface EngineeringPublicationResult {
  readonly status: "VERIFIED" | "BLOCKED" | "FAILED";
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly completion: EngineeringCompletionResult;
  readonly commit: DnaOsCommitResult | null;
  readonly publish: GithubPublishResult | null;
  readonly lineage: EngineeringLineage;
}
