/**
 * หน้าที่: the type contracts for Source Execution — the layer after
 * Admission:
 *
 * ADMITTED SOURCE -> EXECUTION DISPATCH -> GITHUB SOURCE EXECUTOR
 *   -> WRITE/COMMIT/PUSH -> EXECUTION RESULT -> EVIDENCE/VERSION REFERENCE
 *   -> RETURN TO DNA OS -> STOP
 *
 * Answers exactly one question: "given an ADMITTED work item, perform
 * the one authorized GitHub write it was admitted for." Never
 * reclassifies, never re-checks duplicates, never re-resolves a
 * destination/target, never re-decides policy — see ./resolver.ts.
 *
 * Input: none (pure type definitions).
 * Output: `ExecutionStatus`, `ExecutionReasonCode`,
 * `SourceExecutionInput`, `SourceExecutionResult`.
 * Dependency ที่อนุญาต: ../target-resolution/contract.ts (ResolvedTarget
 * type only), ../../contracts/connector/connection.ts (ConnectionRegistration
 * type only).
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply a
 * `commit_sha`/`execution_status` — every field here is only ever
 * produced by ./resolver.ts running the real checks and the real GitHub
 * write. Never add a `repo`/`branch`/`owner` DEFAULT anywhere — those are
 * always caller-supplied `repository_reference` data.
 */

import type { ResolvedTarget } from "../target-resolution/contract";
import type { ConnectionRegistration } from "../../contracts/connector/connection";

export type ExecutionStatus = "SUCCEEDED" | "FAILED" | "UNRESOLVED";

export type ExecutionReasonCode =
  | "ADMISSION_NOT_FOUND"
  | "NOT_ADMITTED"
  | "IDENTITY_MISMATCH"
  | "TARGET_MISMATCH"
  | "EXECUTION_NOT_SUPPORTED"
  | "INVALID_SOURCE_PATH"
  | "GITHUB_CONNECTION_NOT_REGISTERED"
  | "CREDENTIAL_NOT_RESOLVED"
  | "REPOSITORY_NOT_FOUND"
  | "GITHUB_WRITE_FAILED"
  | "DNA_OS_PUBLISH_AUTHORITY_REQUIRED"
  | "SUCCEEDED";

export interface GithubRepositoryReference {
  owner: string;
  repo: string;
  branch: string;
}

/**
 * Exactly the finished result of Admission, plus what only the caller
 * (the Agent, via the existing DNA OS MCP — never a direct GitHub
 * credential holder) can supply: the actual file bytes to write, and
 * which real, already-registered GitHub connection/repository to use.
 * Nothing here is a default — every identity-bearing field must be real,
 * caller-supplied data (STEP "Build Minimal Source Execution to GitHub").
 */
export interface SourceExecutionInput {
  admission_id: string;
  artifact_resource_id: string;
  task_id: string;
  correlation_id: string;
  authorized_action: string;
  resolved_target: ResolvedTarget;
  source_location: string;
  source_content: string;
  /** The real connection this execution should use — null when none is registered (honest, never fabricated). */
  connection: ConnectionRegistration | null;
  /** The real repository/branch this execution targets — null when not known (honest, never a default). */
  repository_reference: GithubRepositoryReference | null;
  commit_message: string;
  evidence_refs: readonly string[];
}

export interface SourceExecutionResult {
  execution_id: string;
  admission_id: string;
  artifact_resource_id: string;
  target_capability_id: string | null;
  repository_reference: GithubRepositoryReference | null;
  branch: string | null;
  source_path: string;
  commit_sha: string | null;
  execution_status: ExecutionStatus;
  reason_code: ExecutionReasonCode;
  evidence_refs: readonly string[];
  correlation_id: string;
  created_at: string;
}
