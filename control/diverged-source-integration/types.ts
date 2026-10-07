export const DNA_OS_DIVERGED_SOURCE_INTEGRATION = "DNA_OS_DIVERGED_SOURCE_INTEGRATION_V1" as const;
export const REMOTE_BASE_RECONCILIATION = "REMOTE_BASE_RECONCILIATION_V1" as const;
export const DNA_OS_SOURCE_RECONSTRUCTION = "DNA_OS_SOURCE_RECONSTRUCTION_V1" as const;

export const PATH_CLASSES = [
  "SOURCE_ELIGIBLE",
  "TEST_ELIGIBLE",
  "DOCUMENTATION_ELIGIBLE",
  "RUNTIME_DATA",
  "AUDIT_DATA",
  "CREDENTIAL_OR_SECRET_STATE",
  "CACHE_TEMP",
  "UNKNOWN",
] as const;
export type PathClass = typeof PATH_CLASSES[number];

export const INTEGRATION_STRATEGIES = ["MERGE_LINEAGE", "SELECTIVE_REPLAY", "TREE_RECONSTRUCTION", "MIXED"] as const;
export type IntegrationStrategy = typeof INTEGRATION_STRATEGIES[number];

export interface SourceFreezeV1 {
  readonly schema: "CURRENT_SOURCE_FREEZE_V1";
  readonly source_branch: string;
  readonly source_head: string;
  readonly merge_base: string;
  readonly live_remote_main: string;
  readonly tracked_diff_hash: string;
  readonly porcelain_hash: string;
  readonly untracked_source_manifest_hash: string;
  readonly changed_path_manifest_hash: string;
  readonly source_tree_identity: string;
  readonly porcelain_rows: number;
  readonly timestamp: string;
  readonly CURRENT_SOURCE_PRESERVED: true;
}

export interface ClassifiedPath {
  readonly path: string;
  readonly classification: PathClass;
  readonly admitted: boolean;
}

export interface LocalCommitAnalysis {
  readonly commit_sha: string;
  readonly subject: string;
  readonly changed_paths: readonly string[];
  readonly still_relevant: boolean;
  readonly already_present_remote: boolean;
  readonly conflicts_with_remote: boolean;
  readonly superseded_by_uncommitted_work: boolean;
  readonly required_for_current_tree: boolean;
}

export interface ConflictRecord {
  readonly path: string;
  readonly base_hash: string | null;
  readonly remote_hash: string | null;
  readonly local_committed_hash: string | null;
  readonly local_worktree_hash: string | null;
  readonly conflict_type: "CONTENT" | "ADD_ADD" | "MODIFY_DELETE";
  readonly resolution_basis: string;
  readonly chosen_side: "REMOTE" | "LOCAL_COMMITTED" | "LOCAL_WORKTREE";
  readonly evidence_refs: readonly string[];
}

export interface IntegrationAdmission {
  readonly schema: "DNA_OS_INTEGRATION_ADMISSION_V1";
  readonly decision: "ALLOW" | "DENY";
  readonly reason_code: string;
  readonly actor: "DNA_OS_INTEGRATION_AUTHORITY";
  readonly coding_client_self_approved: false;
  readonly GIT_ADD_ALL_USED: false;
  readonly FORCE_PUSH_USED: false;
}
