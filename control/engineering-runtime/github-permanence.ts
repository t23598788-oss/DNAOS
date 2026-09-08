/**
 * หน้าที่: GitHub publication permanence. After DNA OS publishes a
 * commit, fetch that exact SHA and prove repository, branch, lineage,
 * expected files, then ingest Actions/check-run status. Workers never
 * supply this proof.
 *
 * Input: published SHA + registered destination + expected lineage.
 * Output: REMOTE_COMMIT_VERIFIED | CI_PENDING | CI_VERIFIED | CI_FAILED | REMOTE_MISMATCH.
 * Dependency ที่อนุญาต: connections/github read API, credential
 * resolution, ./persist.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never treat worker claimed_complete as proof.
 * never write GitHub. never mark VERIFIED on CI_FAILED.
 */

import { lookupConnection } from "../../connections/connection-registry/contract";
import { resolveGithubCredential } from "../../connections/github/credential-resolution";
import {
  getBranch,
  getCommit,
  listCheckRunsForCommit,
  listWorkflowRunsForHeadSha,
  type CheckRunsLookup,
  type CommitLookup,
  type WorkflowRunsLookup,
} from "../../connections/github/github-read-api";
import { persistGithubPublicationProof } from "./persist";
import type { EngineeringGateReason } from "./types";

export type GithubPermanenceStatus =
  | "REMOTE_COMMIT_VERIFIED"
  | "CI_PENDING"
  | "CI_VERIFIED"
  | "CI_FAILED"
  | "REMOTE_MISMATCH";

export type OwnerEngineeringFace =
  | "กำลังตรวจสอบบน GitHub"
  | "ตรวจสอบเรียบร้อย"
  | "ตรวจไม่ผ่านและกำลังแก้ไข"
  | "ต้องการการอนุมัติจาก Owner";

export interface GithubPermanenceProof {
  readonly work_id: string;
  readonly command_id: string;
  readonly status: GithubPermanenceStatus;
  readonly reason_code: EngineeringGateReason | "ADMITTED";
  readonly detail: string;
  readonly github_owner: string;
  readonly github_repository: string;
  readonly publish_branch: string;
  readonly remote_sha: string;
  readonly expected_sha: string;
  readonly lineage_verified: boolean;
  readonly expected_files_verified: boolean;
  readonly expected_files: readonly string[];
  readonly observed_files: readonly string[];
  readonly ci_required: boolean;
  readonly ci_run_ids: readonly string[];
  readonly recorded_at: string;
}

export interface GithubPermanenceDeps {
  readonly resolveCredential?: typeof resolveGithubCredential;
  readonly getCommit?: typeof getCommit;
  readonly getBranch?: typeof getBranch;
  readonly listCheckRuns?: typeof listCheckRunsForCommit;
  readonly listWorkflowRuns?: typeof listWorkflowRunsForHeadSha;
}

export interface GithubPermanenceInput {
  readonly work_id: string;
  readonly command_id: string;
  readonly manifest_id: string;
  readonly admission: "ALLOW";
  readonly integration: "INTEGRATED";
  readonly expected_sha: string;
  readonly expected_files: readonly string[];
  readonly github_owner: string;
  readonly github_repository: string;
  readonly publish_branch: string;
  readonly connection_id: string;
  readonly registered_owner: string;
  readonly registered_repository: string;
  readonly registered_branch: string;
}

function field(message: string, key: string): string | null {
  const match = message.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

export function parseEngineeringCommitMessage(message: string): {
  readonly command_id: string | null;
  readonly work_id: string | null;
  readonly manifest_id: string | null;
  readonly admission: string | null;
  readonly integration: string | null;
} {
  return {
    command_id: field(message, "command_id"),
    work_id: field(message, "work_id"),
    manifest_id: field(message, "manifest_id"),
    admission: field(message, "admission"),
    integration: field(message, "integration"),
  };
}

export function ownerFacingEngineeringResult(input: {
  readonly loop_status: string;
  readonly permanence_status?: GithubPermanenceStatus | null;
  readonly repairing?: boolean;
}): OwnerEngineeringFace {
  if (input.permanence_status === "CI_PENDING" || input.loop_status === "CI_PENDING") {
    return "กำลังตรวจสอบบน GitHub";
  }
  if (input.loop_status === "VERIFIED") {
    return "ตรวจสอบเรียบร้อย";
  }
  if ((input.permanence_status === "CI_FAILED" || input.repairing === true) && input.loop_status !== "FAILED" && input.loop_status !== "BLOCKED") {
    return "ตรวจไม่ผ่านและกำลังแก้ไข";
  }
  return "ต้องการการอนุมัติจาก Owner";
}

function failedConclusions(): ReadonlySet<string> {
  return new Set(["failure", "cancelled", "timed_out", "startup_failure", "action_required"]);
}

export function aggregateCiStatus(input: {
  readonly checks: readonly { readonly status: string; readonly conclusion: string | null }[];
  readonly workflows: readonly { readonly status: string; readonly conclusion: string | null }[];
}): { readonly status: "CI_PENDING" | "CI_VERIFIED" | "CI_FAILED"; readonly required: boolean; readonly run_ids: readonly string[] } {
  const rows = [
    ...input.checks.map((row, index) => ({ ...row, id: `check:${index}:${row.status}` })),
    ...input.workflows.map((row, index) => ({ ...row, id: `workflow:${index}:${row.status}` })),
  ];
  if (rows.length === 0) {
    return { status: "CI_VERIFIED", required: false, run_ids: [] };
  }
  if (rows.some((row) => row.status !== "completed")) {
    return { status: "CI_PENDING", required: true, run_ids: rows.map((row) => row.id) };
  }
  if (rows.some((row) => failedConclusions().has((row.conclusion ?? "").toLowerCase()))) {
    return { status: "CI_FAILED", required: true, run_ids: rows.map((row) => row.id) };
  }
  return { status: "CI_VERIFIED", required: true, run_ids: rows.map((row) => row.id) };
}

function proof(row: Omit<GithubPermanenceProof, "recorded_at">): GithubPermanenceProof {
  const recorded: GithubPermanenceProof = { ...row, recorded_at: new Date().toISOString() };
  persistGithubPublicationProof(recorded);
  return recorded;
}

export async function verifyGithubPublicationPermanence(
  input: GithubPermanenceInput,
  deps: GithubPermanenceDeps = {},
): Promise<GithubPermanenceProof> {
  const base = {
    work_id: input.work_id,
    command_id: input.command_id,
    github_owner: input.github_owner,
    github_repository: input.github_repository,
    publish_branch: input.publish_branch,
    remote_sha: input.expected_sha,
    expected_sha: input.expected_sha,
    expected_files: input.expected_files,
    observed_files: [] as readonly string[],
    ci_required: false,
    ci_run_ids: [] as readonly string[],
  };

  if (
    input.github_owner !== input.registered_owner
    || input.github_repository !== input.registered_repository
    || input.publish_branch !== input.registered_branch
  ) {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "REMOTE_IDENTITY_MISMATCH",
      detail: "published destination does not match the registered SOURCE_AUTHORITY repository/branch",
      lineage_verified: false,
      expected_files_verified: false,
    });
  }

  const connection = lookupConnection({ connection_id: input.connection_id });
  if (!connection) {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "UNREGISTERED_REMOTE",
      detail: "GitHub connection_id is not registered",
      lineage_verified: false,
      expected_files_verified: false,
    });
  }
  const resolveCredential = deps.resolveCredential ?? resolveGithubCredential;
  const credential = await resolveCredential(connection);
  if (!credential.ok) {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "CREDENTIAL_UNAVAILABLE",
      detail: "SOURCE_AUTHORITY credential could not be resolved for commit fetch",
      lineage_verified: false,
      expected_files_verified: false,
    });
  }

  const token = credential.token;
  const repo = { owner: input.registered_owner, repo: input.registered_repository };
  const fetchCommit = deps.getCommit ?? getCommit;
  const fetchBranch = deps.getBranch ?? getBranch;
  const commit: CommitLookup = await fetchCommit(token, { ...repo, sha: input.expected_sha });
  if (commit.kind !== "found") {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "REMOTE_NOT_FOUND",
      detail: commit.kind === "absent" ? "published SHA is not present on GitHub" : commit.reason,
      lineage_verified: false,
      expected_files_verified: false,
    });
  }
  if (commit.sha !== input.expected_sha) {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "REMOTE_MISMATCH",
      detail: `fetched SHA ${commit.sha} does not equal published SHA ${input.expected_sha}`,
      lineage_verified: false,
      expected_files_verified: false,
      remote_sha: commit.sha,
      observed_files: commit.files,
    });
  }

  const branch = await fetchBranch(token, { ...repo, branch: input.registered_branch });
  if (branch.kind !== "found" || branch.head_commit_sha !== input.expected_sha) {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "REMOTE_HEAD_MOVED",
      detail: `registered branch ${input.registered_branch} head is ${branch.kind === "found" ? branch.head_commit_sha : branch.kind}, expected ${input.expected_sha}`,
      lineage_verified: false,
      expected_files_verified: false,
      observed_files: commit.files,
    });
  }

  const lineage = parseEngineeringCommitMessage(commit.message);
  const lineageOk = lineage.work_id === input.work_id
    && lineage.command_id === input.command_id
    && lineage.manifest_id === input.manifest_id
    && lineage.admission === "ALLOW"
    && lineage.integration === "INTEGRATED";
  if (!lineageOk) {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "GITHUB_LINEAGE_MISMATCH",
      detail: "remote commit message does not carry DNA OS work/command/manifest/admission/integration lineage",
      lineage_verified: false,
      expected_files_verified: false,
      observed_files: commit.files,
    });
  }

  const missing = input.expected_files.filter((path) => !commit.files.includes(path));
  if (missing.length > 0) {
    return proof({
      ...base,
      status: "REMOTE_MISMATCH",
      reason_code: "EXPECTED_FILES_MISSING",
      detail: `remote commit is missing expected path(s): ${missing.join(",")}`,
      lineage_verified: true,
      expected_files_verified: false,
      observed_files: commit.files,
    });
  }

  const listChecks = deps.listCheckRuns ?? listCheckRunsForCommit;
  const listWorkflows = deps.listWorkflowRuns ?? listWorkflowRunsForHeadSha;
  const checks: CheckRunsLookup = await listChecks(token, { ...repo, sha: input.expected_sha });
  const workflows: WorkflowRunsLookup = await listWorkflows(token, { ...repo, sha: input.expected_sha });
  if (checks.kind === "failed" || workflows.kind === "failed") {
    return proof({
      ...base,
      status: "CI_PENDING",
      reason_code: "CI_PENDING",
      detail: checks.kind === "failed" ? checks.reason : workflows.kind === "failed" ? workflows.reason : "CI lookup failed",
      lineage_verified: true,
      expected_files_verified: true,
      observed_files: commit.files,
      ci_required: true,
    });
  }

  const ci = aggregateCiStatus({ checks: checks.runs, workflows: workflows.runs });
  const status: GithubPermanenceStatus = ci.status === "CI_PENDING"
    ? "CI_PENDING"
    : ci.status === "CI_FAILED"
      ? "CI_FAILED"
      : "CI_VERIFIED";
  return proof({
    ...base,
    status,
    reason_code: status === "CI_VERIFIED" ? "ADMITTED" : status,
    detail: status === "CI_VERIFIED"
      ? (ci.required ? "GitHub CI completed successfully" : "no GitHub Actions workflows on this commit")
      : status === "CI_PENDING"
        ? "GitHub CI is still running"
        : "GitHub CI failed",
    lineage_verified: true,
    expected_files_verified: true,
    observed_files: commit.files,
    ci_required: ci.required,
    ci_run_ids: ci.run_ids,
  });
}

export function permanenceReadDeps(input: {
  readonly sha: string;
  readonly message: string;
  readonly files: readonly string[];
  readonly branch_sha?: string;
  readonly checks?: CheckRunsLookup;
  readonly workflows?: WorkflowRunsLookup;
}): GithubPermanenceDeps {
  return {
    resolveCredential: async () => ({ ok: true, token: "test-token-not-logged", credential_source: "test-seam" }),
    getCommit: async () => ({
      kind: "found",
      http_status: 200,
      sha: input.sha,
      message: input.message,
      files: input.files,
      html_url: null,
    }),
    getBranch: async () => ({
      kind: "found",
      http_status: 200,
      head_commit_sha: input.branch_sha ?? input.sha,
      head_commit_at: null,
      branch_protected: false,
    }),
    listCheckRuns: async () => input.checks ?? { kind: "found", http_status: 200, total: 0, runs: [] },
    listWorkflowRuns: async () => input.workflows ?? { kind: "found", http_status: 200, runs: [] },
  };
}
