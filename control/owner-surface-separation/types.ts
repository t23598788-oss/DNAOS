export const STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION = "STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION_V1" as const;
export const OWNER_BIOMETRIC_DEVELOPMENT_GATE = "OWNER_BIOMETRIC_DEVELOPMENT_GATE_V1" as const;

export type AuthorityDomain = "OPERATIONAL" | "DEVELOPMENT";
export type SurfaceId = "OPERATIONAL_OWNER_SURFACE" | "DEVELOPMENT_CONTROL_SURFACE";

export const OPERATIONAL_ACTIONS = [
  "SEARCH", "READ", "CREATE", "WRITE", "COPY", "MOVE", "RENAME", "DELETE",
  "IMPORT", "EXPORT", "UPLOAD", "DOWNLOAD", "SHARE", "ARCHIVE", "UNARCHIVE",
  "CONVERT", "COMPARE", "SUMMARIZE", "EXTRACT", "SYNC", "OPEN", "RUN_REGISTERED_CAPABILITY",
] as const;

export const DEVELOPMENT_MUTATION_TOOLS = [
  "modify_source",
  "create_worktree",
  "invoke_coding_worker",
  "commit_source",
  "publish_source",
  "dna_os.modify_source",
  "dna_os.create_worktree",
  "dna_os.invoke_coding_worker",
  "dna_os.commit_source",
  "dna_os.publish_source",
] as const;

export const SECURITY_SENSITIVE_DOMAINS = [
  "OWNER_AUTHORITY",
  "AUTHENTICATION",
  "CREDENTIAL_POLICY",
  "SECURITY_ENFORCEMENT",
  "PRODUCTION_AUTHORITY",
  "PAYMENT_CONTROL",
  "FINANCIAL_MUTATION_POLICY",
] as const;

export type SecuritySensitiveDomain = typeof SECURITY_SENSITIVE_DOMAINS[number];
export type LeaseOperation = "READ_SOURCE" | "CREATE_SOURCE" | "MODIFY_SOURCE" | "DELETE_SOURCE" | "CREATE_TEST" | "MODIFY_TEST" | "BUILD" | "TEST" | "ASSEMBLE";
export type PrechangeVerdict = "EXISTING_CAPABILITY_FOUND" | "PARTIAL_EXISTING_CAPABILITY" | "NEW_CAPABILITY_REQUIRED" | "INSUFFICIENT_CONTEXT";
export type BiometricAvailability = "AVAILABLE" | "NOT_AVAILABLE" | "FAILED" | "OWNER_CANCELLED";

export interface OwnerSurfaceSessionV1 {
  readonly schema: "OWNER_SURFACE_SESSION_V1";
  readonly session_id: string;
  readonly owner_id: string;
  readonly surface_id: SurfaceId;
  readonly authority_domain: AuthorityDomain;
  readonly created_at: string;
  readonly pending_action_authority: null;
  readonly development_lease_id: null;
}

export interface DevelopmentAuthorityLeaseV1 {
  readonly schema: "DEVELOPMENT_AUTHORITY_LEASE_V1";
  readonly lease_id: string;
  readonly owner_id: string;
  readonly biometric_verified_at: string;
  readonly work_id: string;
  readonly work_order_id: string;
  readonly repository_id: string;
  readonly base_revision: string;
  readonly allowed_paths: readonly string[];
  readonly allowed_components: readonly string[];
  readonly allowed_operations: readonly LeaseOperation[];
  readonly forbidden_paths: readonly string[];
  readonly risk_class: string;
  readonly expires_at: string;
  readonly max_scope: string;
  readonly authority_evidence_ref: string;
  readonly surface_session_id: string;
  readonly cancelled: boolean;
  readonly completed: boolean;
  readonly base_revision_valid: boolean;
}

export interface DevelopmentChangeProposalV1 {
  readonly schema: "DEVELOPMENT_CHANGE_PROPOSAL_V1";
  readonly proposal_id: string;
  readonly work_id: string;
  readonly work_order_id: string;
  readonly WHAT_WILL_CHANGE: string;
  readonly WHY: string;
  readonly EXISTING_CAPABILITY: string;
  readonly NEW_OR_EXTENSION: string;
  readonly TARGET_REPOSITORY: string;
  readonly TARGET_COMPONENTS: readonly string[];
  readonly LIKELY_FILES: readonly string[];
  readonly DEPENDENCIES: readonly string[];
  readonly RISK_CLASS: string;
  readonly EXPECTED_RUNTIME_EFFECT: string;
  readonly TEST_PLAN: string;
  readonly PRODUCTION_PATH: string;
  readonly source_modified: false;
  readonly PROPOSAL_READY: true;
}

export interface DevelopmentPrechangeAnalysisV1 {
  readonly schema: "DEVELOPMENT_PRECHANGE_ANALYSIS_V1";
  readonly verdict: PrechangeVerdict;
  readonly existing_capability: string | null;
  readonly owning_module: string | null;
  readonly duplicates_existing: boolean;
  readonly affected_dependencies: readonly string[];
  readonly extend_instead: string | null;
}
