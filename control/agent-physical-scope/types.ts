/**
 * Types for agent physical-scope. Assignment identity comes from existing
 * source-workspace reservations and repository-registry rows.
 */

export const AGENT_PHYSICAL_SCOPE_ENFORCEMENT = "AGENT_PHYSICAL_SCOPE_ENFORCEMENT_V1" as const;
export const AGENT_EXECUTION_ID_ENV = "DNA_OS_AGENT_EXECUTION_ID";
export const AGENT_TASK_ID_ENV = "DNA_OS_AGENT_TASK_ID";
export const AGENT_SCOPE_STORE_ENV = "DNA_OS_AGENT_PHYSICAL_SCOPE_STORE";

export type AgentActionClass =
  | "SOURCE_DISCOVERY"
  | "SOURCE_READ"
  | "PATCH_PROPOSAL"
  | "SOURCE_MUTATION"
  | "RUNTIME_MUTATION"
  | "GIT_WRITE";

export type ScopeDenialReason =
  | "TASK_SCOPE_UNRESOLVED"
  | "PATH_SCOPE_DENIED"
  | "RUNTIME_SCOPE_DENIED"
  | "PORT_SCOPE_DENIED"
  | "GIT_SCOPE_DENIED"
  | "STALE_PATCH"
  | "SNAPSHOT_MUTATION_DENIED"
  | "TASK_ID_SPOOFED"
  | "REPOSITORY_ID_SPOOFED"
  | "BROAD_GIT_CREDENTIAL";

export type WorkspacePurpose = "ENGINEERING_ISOLATION" | "PUBLICATION_PROOF" | "RECOVERY_CHECKOUT";

export interface ReservationView {
  readonly reservation_id: string;
  readonly work_id: string;
  readonly repository_id: string;
  readonly worktree_path: string;
  readonly base_commit_sha: string;
  readonly purpose?: WorkspacePurpose;
}

export interface RepositoryView {
  readonly repository_id: string;
  readonly source_authority: string;
  readonly repository_root: string;
  readonly status: string;
}

export interface ProtectedRuntime {
  readonly runtime_id: string;
  readonly port: number;
  readonly protection_class: "OWNER_SURFACE" | "BUSINESS" | "MAIN" | "AUTH";
}

export interface PhysicalScopeRegistry {
  findReservationByWorkId(task_id: string): ReservationView | null;
  findReservationByWorktreePath?(worktree_path: string): ReservationView | null;
  getRepository(repository_id: string): RepositoryView | null;
  siblingWorktreePaths(except_path: string): readonly string[];
  protectedRuntimes(): readonly ProtectedRuntime[];
  now(): Date;
}

export interface ScopeResolutionInput {
  readonly task_id: string;
  readonly agent_execution_id: string;
  readonly claimed_repository_id?: string;
}

export interface CanonicalAgentScope {
  readonly task_id: string;
  readonly agent_execution_id: string;
  readonly repository_id: string;
  readonly repository_root: string;
  readonly worktree_path: string;
  readonly workspace_id: string;
  readonly base_revision: string;
  readonly allowed_paths: readonly string[];
  readonly write_allowed_paths: readonly string[];
  readonly read_allowed_paths: readonly string[];
  readonly allowed_actions: readonly AgentActionClass[];
  readonly allowed_runtime_ids: readonly string[];
  readonly allowed_ports: readonly number[];
  readonly git_scope: {
    readonly mode: "READ" | "PATCH_BRANCH" | "NONE";
    readonly remote_authority: string | null;
    readonly allowed_branch: string | null;
  };
  readonly write_allowed: boolean;
  readonly safe_for_current_execution: boolean;
  readonly sibling_worktrees_denied: readonly string[];
}

export type ScopeDecision =
  | { readonly ok: true; readonly scope: CanonicalAgentScope }
  | { readonly ok: false; readonly reason: ScopeDenialReason; readonly detail: string };

export interface PhysicalMutationAudit {
  readonly task_id: string | null;
  readonly agent_execution_id: string | null;
  readonly requested_action: string;
  readonly resolved_repository: string | null;
  readonly requested_resource: string;
  readonly denial_reason: ScopeDenialReason;
  readonly timestamp: string;
}

export interface PathGuardResult {
  readonly ok: boolean;
  readonly reason?: ScopeDenialReason;
  readonly detail?: string;
  readonly resolved_path?: string;
}
