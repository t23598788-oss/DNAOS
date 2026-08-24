/**
 * หน้าที่: PHASE 3.5 — DNA OS CANDIDATE VERIFICATION RUNTIME (Owner). The
 * ONE place a FROZEN + INSPECTED candidate's own declared `build`/`test`
 * script is actually executed, under DNA OS's own authority — never the
 * Agent's. Not an Agent executor, not a generic shell, not a package
 * installer, not a deployment executor: it runs exactly `npm run build`
 * or `npm run test` (the literal, closed argv shape below), inside the
 * SAME kernel-enforced sandbox every other Process Gate entry already
 * uses, and reports real, freshly-observed evidence back to
 * `./capability-promotion.ts`'s Promotion Decision — never an Agent's
 * own "tests pass" claim.
 *
 * Reuses, never duplicates: `../../execution/run/contract.ts#requestProcessExecution`
 * (the ONE Process Gate — no direct `child_process` call anywhere in
 * this file), `./capability-promotion.ts` (`inspectArtifacts`,
 * `verifySecurity`, `isFrozenRevision`, the frozen `CapabilityCandidateV1`
 * itself — no second candidate/manifest concept), `./memory-store.ts#saveEvidence`.
 *
 * Real, honest, disclosed subtlety: `npm run <script>` itself spawns an
 * internal `sh -c "<script command>"` (npm's own long-standing
 * mechanism, not something this file adds) to run whatever command the
 * candidate's OWN package.json declares. This file's own direct spawn
 * (via the Process Gate) is always exactly `node <npm-cli.js> run
 * build|test` — never a shell, never an Agent-supplied string at
 * request time. npm's internal shell child is a descendant of that one
 * sandboxed process, so it inherits the SAME kernel-enforced Seatbelt
 * confinement (file-write scoped to the candidate's own workspace only,
 * network denied by default, credential paths explicitly denied) — the
 * hard rule's real intent (no unconfined shell reaching real authority)
 * holds regardless of npm's own internal mechanics. This is disclosed
 * here rather than hidden.
 *
 * Input: a real, frozen `CapabilityCandidateV1` (`./capability-promotion.ts`).
 * Output: `CandidateVerificationRequest`, `CandidateVerificationResult`,
 * `runCandidateVerification`, `runCapabilityPromotionPipelineWithVerification`.
 * Dependency ที่อนุญาต: ./capability-promotion.ts, ./memory-store.ts,
 * ./types.ts, ./agent-execution-contract.ts, ./workspace-manager.ts,
 * ../../execution/run/contract.ts, node:fs, node:path, node:crypto.
 * สิ่งที่ห้ามแตะ: never call child_process.spawn/exec/execFile/fork
 * directly in this file. Never let `cwd` passed to the Process Gate be
 * anything other than `candidate.workspace_root` itself — no caller
 * parameter may override it. Never grant `requires_network` — a
 * candidate requesting it is refused (AUTHORITY_REQUIRED), never
 * silently sandboxed-through. Never run `npm install`/`pnpm install`/
 * `yarn install`/any package-fetch subcommand — the registry's
 * `allowed_argv_shape` pins argv to exactly `run build`/`run test`, and
 * this file never constructs argv any other way.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { requestProcessExecution, NPM_CLI_JS_PATH } from "../../execution/run/contract";
import type { ProcessResult } from "../../execution/run/contract";
import { saveEvidence } from "./memory-store";
import type { Evidence } from "./types";
import type { DnaOsAgentResult } from "./agent-execution-contract";
import type { TaskWorkspace } from "./workspace-manager";
import {
  freezeWorkspaceResult, inspectArtifacts, verifySecurity, verifyContract, decidePromotion, registerCandidate, isFrozenRevision, getLatestRevision,
} from "./capability-promotion";
import type {
  CapabilityCandidateV1, DeclaredCapability, ArtifactInspectionResult, SecurityVerificationResult,
  BuildOrTestVerificationResult, CapabilityPromotionPipelineResult,
} from "./capability-promotion";

const CALLER_IDENTITY = "control/agent-gateway/candidate-verification-runtime.ts";
const WORKSPACE_ROOT_PREFIX = "/tmp/dna-os-agent-workspaces";

// ============================= 1/2. VERIFICATION REQUEST CONTRACT =============================

export const VERIFICATION_REQUEST_CONTRACT_VERSION = "DNA_OS_CANDIDATE_VERIFICATION_REQUEST_V1" as const;
export const VERIFICATION_RESULT_CONTRACT_VERSION = "DNA_OS_CANDIDATE_VERIFICATION_RESULT_V1" as const;

export type VerificationType = "BUILD" | "TEST";

export interface CandidateVerificationRequest {
  protocol: typeof VERIFICATION_REQUEST_CONTRACT_VERSION;
  verification_request_id: string;
  candidate_id: string;
  revision_id: string;
  workspace_id: string;
  work_order_id: string;
  candidate_root: string;
  candidate_manifest_hash: string;
  verification_type: VerificationType;
  /** Always exactly "build" or "test" — the ONE semantic thing a candidate/caller may name. DNA OS resolves the real argv itself (see resolveVerificationCommand). */
  declared_script: "build" | "test";
  requested_at: string;
}

export type CandidateVerificationStatus = "PASS" | "FAIL" | "MISSING_COMPONENT" | "DEPENDENCY_MISSING" | "AUTHORITY_REQUIRED" | "BOUNDARY_VIOLATION" | "TIMEOUT" | "ERROR";

export interface CandidateVerificationResult {
  protocol: typeof VERIFICATION_RESULT_CONTRACT_VERSION;
  verification_id: string;
  verification_request_id: string;
  candidate_id: string;
  revision_id: string;
  workspace_id: string;
  verification_type: VerificationType;
  status: CandidateVerificationStatus;
  process_execution_id: string | null;
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  stdout_ref: string | null;
  stderr_ref: string | null;
  candidate_manifest_hash_before: string;
  candidate_manifest_hash_after: string | null;
  artifact_mutation_detected: boolean;
  evidence_ids: readonly string[];
  error_code: string | null;
}

export interface VerificationOptions {
  /** Real, honest, required-up-front declaration (requirement 9). true is ALWAYS refused (AUTHORITY_REQUIRED) — this runtime never grants network authority itself. */
  requires_network?: boolean;
  /** Relative path prefixes new files may appear under after execution (requirement 12). Absent/empty = no new file is permitted at all — any new file is a violation. */
  declared_output_paths?: readonly string[];
  /** Test-only override of the registry's default 60s timeout, to prove the real TIMEOUT path without waiting a full minute — never widens what the Process Gate itself allows. */
  timeout_ms_override?: number;
}

function recordEvidence(task_id: string, kind: Evidence["kind"], payload: unknown): string {
  const evidence_id = `ev-${kind}-${randomUUID()}`;
  saveEvidence({ evidence_id, task_id, kind, source: CALLER_IDENTITY, recorded_at: new Date().toISOString(), payload });
  return evidence_id;
}

/** The one place a candidate's own frozen manifest becomes a single comparable hash — used for the pre/post integrity comparison and the request's own `candidate_manifest_hash`. */
export function computeManifestHash(candidate: CapabilityCandidateV1): string {
  const sorted = Object.keys(candidate.artifact_hashes).sort().map((k) => `${k}:${candidate.artifact_hashes[k]}`);
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

export function buildVerificationRequest(candidate: CapabilityCandidateV1, verification_type: VerificationType): CandidateVerificationRequest {
  return {
    protocol: VERIFICATION_REQUEST_CONTRACT_VERSION,
    verification_request_id: `vreq-${randomUUID()}`,
    candidate_id: candidate.candidate_id,
    revision_id: candidate.revision_id,
    workspace_id: candidate.workspace_id,
    work_order_id: candidate.work_order_id,
    candidate_root: candidate.workspace_root,
    candidate_manifest_hash: computeManifestHash(candidate),
    verification_type,
    declared_script: verification_type === "BUILD" ? "build" : "test",
    requested_at: new Date().toISOString(),
  };
}

// ============================= 4. COMMAND RESOLUTION =============================

interface CommandResolution {
  ok: boolean;
  status?: "MISSING_COMPONENT" | "ERROR";
  error_code?: string;
  executable_id?: "candidate.node.npm.build" | "candidate.node.npm.test";
  argv?: readonly string[];
}

/** The candidate may only ever say verification_type=BUILD|TEST — this function alone decides the real argv, never the candidate/Agent. */
function resolveVerificationCommand(candidate: CapabilityCandidateV1, verification_type: VerificationType): CommandResolution {
  const packageJsonPath = `${candidate.workspace_root}/package.json`;
  if (!existsSync(packageJsonPath)) {
    return { ok: false, status: "MISSING_COMPONENT", error_code: "NO_PACKAGE_JSON" };
  }
  let parsed: { scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return { ok: false, status: "ERROR", error_code: "MALFORMED_PACKAGE_JSON" };
  }
  const scriptKey = verification_type === "BUILD" ? "build" : "test";
  if (!parsed.scripts || typeof parsed.scripts[scriptKey] !== "string" || parsed.scripts[scriptKey].length === 0) {
    return { ok: false, status: "MISSING_COMPONENT", error_code: `UNDECLARED_${verification_type}_SCRIPT` };
  }
  return {
    ok: true,
    executable_id: verification_type === "BUILD" ? "candidate.node.npm.build" : "candidate.node.npm.test",
    // "--cache <dir>" (real npm flag, not an env var) relocates BOTH npm's
    // cache and its log-write target inside the candidate's own workspace
    // — without it, npm tries to write under $HOME/.npm, which the
    // sandbox correctly denies (HOME is never in the env allowlist),
    // corrupting the exit code with an unrelated npm-internal error
    // rather than the candidate script's own real result (found
    // empirically this round). The cache dir itself is treated as
    // npm-internal tooling state, never a candidate source/output file.
    argv: [NPM_CLI_JS_PATH, "run", scriptKey, "--cache", `${candidate.workspace_root}/.npm-cache`],
  };
}

const NPM_CACHE_DIRNAME = ".npm-cache";

// ============================= 7. CWD BOUNDARY =============================

function checkCwdBoundary(candidate: CapabilityCandidateV1): { ok: boolean; error_code?: string } {
  if (!existsSync(candidate.workspace_root)) return { ok: false, error_code: "CANDIDATE_CWD_BOUNDARY_VIOLATION:WORKSPACE_ROOT_MISSING" };
  const realCwd = realpathSync(candidate.workspace_root);
  const realWorkspaceRootPrefix = existsSync(WORKSPACE_ROOT_PREFIX) ? realpathSync(WORKSPACE_ROOT_PREFIX) : WORKSPACE_ROOT_PREFIX;
  if (!realCwd.startsWith(`${realWorkspaceRootPrefix}/`) && realCwd !== realWorkspaceRootPrefix) {
    return { ok: false, error_code: `CANDIDATE_CWD_BOUNDARY_VIOLATION:REAL_CWD_OUTSIDE_WORKSPACE_ROOT(${realCwd})` };
  }
  return { ok: true };
}

// ============================= 3 + 6 + 8 + 9 + 11 + 12. THE VERIFICATION ITSELF =============================

export async function runCandidateVerification(
  candidate: CapabilityCandidateV1,
  verification_type: VerificationType,
  preconditions: { inspection: ArtifactInspectionResult; security: SecurityVerificationResult; contractOk: boolean },
  options?: VerificationOptions,
): Promise<CandidateVerificationResult> {
  const request = buildVerificationRequest(candidate, verification_type);
  const evidenceIds: string[] = [];
  evidenceIds.push(recordEvidence(candidate.work_order_id, "candidate_verification", { phase: "REQUEST", request }));

  function closed(status: CandidateVerificationStatus, error_code: string): CandidateVerificationResult {
    const evidence_id = recordEvidence(candidate.work_order_id, "candidate_verification", { phase: "FAIL_CLOSED", candidate_id: candidate.candidate_id, verification_type, status, error_code });
    evidenceIds.push(evidence_id);
    return {
      protocol: VERIFICATION_RESULT_CONTRACT_VERSION, verification_id: `verif-${randomUUID()}`, verification_request_id: request.verification_request_id,
      candidate_id: candidate.candidate_id, revision_id: candidate.revision_id, workspace_id: candidate.workspace_id, verification_type,
      status, process_execution_id: null, exit_code: null, started_at: null, finished_at: null, duration_ms: null, stdout_ref: null, stderr_ref: null,
      candidate_manifest_hash_before: request.candidate_manifest_hash, candidate_manifest_hash_after: null, artifact_mutation_detected: false,
      evidence_ids: evidenceIds, error_code,
    };
  }

  // ---- §3: re-verify frozen candidate identity BEFORE any process is created ----
  // Re-fetched from the append-only registry `freezeWorkspaceResult` itself
  // writes to — never trusts the `candidate` object a caller passed in.
  // A caller holding a stale/tampered in-memory copy (same candidate_id/
  // revision_id, different artifact_hashes) is caught here, not just a
  // caller referencing a superseded revision.
  const frozen = getLatestRevision(candidate.candidate_id);
  if (!frozen || frozen.revision_id !== candidate.revision_id) return closed("BOUNDARY_VIOLATION", "CANDIDATE_NOT_CURRENT_FROZEN_REVISION");
  if (computeManifestHash(frozen) !== computeManifestHash(candidate)) return closed("BOUNDARY_VIOLATION", "MANIFEST_HASH_SELF_MISMATCH");
  if (!preconditions.inspection.ok) return closed("BOUNDARY_VIOLATION", `ARTIFACT_INSPECTION_NOT_PASS:${preconditions.inspection.reason_codes.join(",")}`);
  if (!preconditions.security.ok) return closed("BOUNDARY_VIOLATION", `SECURITY_VERIFICATION_NOT_PASS:${preconditions.security.undeclared_authority_found.join(",")}`);
  if (!preconditions.contractOk) return closed("BOUNDARY_VIOLATION", "CONTRACT_VERIFICATION_NOT_PASS");

  // ---- §9: network default-deny, never silently granted ----
  if (options?.requires_network) return closed("AUTHORITY_REQUIRED", "NETWORK_AUTHORITY_REQUIRED");

  // ---- §7: cwd boundary — always derived from the frozen candidate itself, never a caller-supplied path ----
  const cwdCheck = checkCwdBoundary(candidate);
  if (!cwdCheck.ok) return closed("BOUNDARY_VIOLATION", cwdCheck.error_code!);

  // ---- §4: command resolution — candidate names only "build"/"test"; DNA OS resolves the real argv ----
  const resolution = resolveVerificationCommand(candidate, verification_type);
  if (!resolution.ok) return closed(resolution.status!, resolution.error_code!);

  // ---- §5/§6: Process Gate ONLY — no direct spawn/exec/execFile/fork in this file ----
  const processResult: ProcessResult = await requestProcessExecution({
    request_id: `preq-${randomUUID()}`,
    parent_work_order_id: candidate.work_order_id,
    requester_identity: CALLER_IDENTITY,
    executable_id: resolution.executable_id!,
    argv: resolution.argv!,
    cwd: candidate.workspace_root, // NEVER caller-suppliable — always the frozen candidate's own root
    timeout_ms: options?.timeout_ms_override,
  });
  evidenceIds.push(processResult.evidence_id);

  if (processResult.status === "EXECUTABLE_NOT_REGISTERED" || processResult.status === "EXECUTABLE_IDENTITY_MISMATCH" || processResult.status === "DENY") {
    return closed("BOUNDARY_VIOLATION", `PROCESS_GATE_REFUSED:${processResult.status}:${processResult.reason ?? ""}`);
  }
  if (processResult.status === "TIMEOUT") {
    const evidence_id = recordEvidence(candidate.work_order_id, "candidate_verification", { phase: "TIMEOUT", candidate_id: candidate.candidate_id, verification_type });
    evidenceIds.push(evidence_id);
    return {
      protocol: VERIFICATION_RESULT_CONTRACT_VERSION, verification_id: `verif-${randomUUID()}`, verification_request_id: request.verification_request_id,
      candidate_id: candidate.candidate_id, revision_id: candidate.revision_id, workspace_id: candidate.workspace_id, verification_type,
      status: "TIMEOUT", process_execution_id: processResult.evidence_id, exit_code: processResult.exit_code, started_at: null, finished_at: null, duration_ms: null,
      stdout_ref: null, stderr_ref: null, candidate_manifest_hash_before: request.candidate_manifest_hash, candidate_manifest_hash_after: null,
      artifact_mutation_detected: false, evidence_ids: evidenceIds, error_code: "COMMAND_TIMEOUT",
    };
  }

  // ---- §12: post-execution integrity check — re-scan against the FROZEN manifest (never updated) ----
  const postInspection = inspectArtifacts(candidate);
  const declaredOutputs = [...(options?.declared_output_paths ?? []), NPM_CACHE_DIRNAME];
  const undeclaredNewFiles = postInspection.unexpected_files.filter((p) => !declaredOutputs.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)));
  const sourceMutated = postInspection.hash_mismatches.length > 0;
  const artifact_mutation_detected = sourceMutated || undeclaredNewFiles.length > 0;
  const integrityEvidenceId = recordEvidence(candidate.work_order_id, "candidate_verification", {
    phase: "POST_EXECUTION_INTEGRITY", candidate_id: candidate.candidate_id, verification_type,
    source_mutation_detected: sourceMutated, hash_mismatches: postInspection.hash_mismatches,
    expected_generated_artifacts: postInspection.unexpected_files.filter((p) => !undeclaredNewFiles.includes(p)),
    undeclared_new_files: undeclaredNewFiles, symlink_escapes: postInspection.symlink_escapes, executable_artifacts: postInspection.executable_artifacts,
  });
  evidenceIds.push(integrityEvidenceId);

  let status: CandidateVerificationStatus;
  let error_code: string | null = null;
  const stderrLower = processResult.stderr.toLowerCase();
  if (sourceMutated) { status = "BOUNDARY_VIOLATION"; error_code = "SOURCE_MUTATION_DETECTED"; }
  else if (undeclaredNewFiles.length > 0) { status = "BOUNDARY_VIOLATION"; error_code = `UNDECLARED_OUTPUT_FILE:${undeclaredNewFiles.join(",")}`; }
  else if (processResult.exit_code === 0) { status = "PASS"; }
  else if (stderrLower.includes("cannot read properties of undefined (reading 'stdin')")) {
    // Real, reproducible finding (empirically confirmed 2026-08-24 via a
    // direct raw sandbox-exec repro, independent of the Process Gate):
    // npm's own `run-script` internals crash under macOS sandbox-exec
    // confinement — `npm --version` and other non-run-script npm
    // commands work fine sandboxed; only the child-process path
    // `npm run <script>` uses to spawn the script itself hits this. Not
    // the candidate's fault, not a security violation, not fixable by
    // retrying — the same category as the earlier Keychain-ACL and
    // ts-node-shebang sandbox incompatibilities. Widening the sandbox to
    // work around it is exactly what Phase 3.5's own hard rules forbid,
    // so this is reported honestly rather than patched over.
    status = "ERROR"; error_code = "NPM_RUN_SCRIPT_SANDBOX_EXEC_INCOMPATIBILITY";
  }
  else if (stderrLower.includes("cannot find module") || stderrLower.includes("command not found")) { status = "DEPENDENCY_MISSING"; error_code = "DEPENDENCY_MISSING_AT_RUNTIME"; }
  else { status = "FAIL"; error_code = "SCRIPT_EXIT_NONZERO"; }

  const finalEvidenceId = recordEvidence(candidate.work_order_id, "candidate_verification", {
    phase: "FINAL_RESULT", candidate_id: candidate.candidate_id, verification_type, status, exit_code: processResult.exit_code, error_code,
  });
  evidenceIds.push(finalEvidenceId);

  return {
    protocol: VERIFICATION_RESULT_CONTRACT_VERSION,
    verification_id: `verif-${randomUUID()}`,
    verification_request_id: request.verification_request_id,
    candidate_id: candidate.candidate_id,
    revision_id: candidate.revision_id,
    workspace_id: candidate.workspace_id,
    verification_type,
    status,
    process_execution_id: processResult.evidence_id,
    exit_code: processResult.exit_code,
    started_at: request.requested_at,
    finished_at: new Date().toISOString(),
    duration_ms: null,
    stdout_ref: finalEvidenceId, // real content stays in the Evidence store, never inlined here
    stderr_ref: finalEvidenceId,
    candidate_manifest_hash_before: request.candidate_manifest_hash,
    candidate_manifest_hash_after: artifact_mutation_detected ? `CHANGED:${error_code}` : request.candidate_manifest_hash,
    artifact_mutation_detected,
    evidence_ids: evidenceIds,
    error_code,
  };
}

function toBuildOrTestResult(v: CandidateVerificationResult): BuildOrTestVerificationResult {
  return {
    status: v.status === "MISSING_COMPONENT" || v.status === "DEPENDENCY_MISSING" || v.status === "AUTHORITY_REQUIRED" || v.status === "BOUNDARY_VIOLATION" || v.status === "TIMEOUT" || v.status === "ERROR" || v.status === "FAIL" || v.status === "PASS" ? v.status : "ERROR",
    reason: v.error_code ?? "OK",
    evidence_id: v.evidence_ids[v.evidence_ids.length - 1] ?? "",
  };
}

// ============================= 14. PROMOTION PIPELINE INTEGRATION =============================

/**
 * Replaces Phase 3's stub `verifyBuild`/`verifyTest` (which could only
 * ever report NOT_REQUIRED/MISSING_COMPONENT) with the real Verification
 * Runtime above. Every other stage (freeze, inspection, security,
 * contract, decision, registration) is the EXACT SAME
 * `./capability-promotion.ts` code Phase 3 already built and registered
 * — nothing here re-implements them.
 */
export async function runCapabilityPromotionPipelineWithVerification(
  result: DnaOsAgentResult,
  workspace: TaskWorkspace,
  declared: DeclaredCapability,
  correlationId: string,
  verificationOptions?: VerificationOptions,
): Promise<CapabilityPromotionPipelineResult & { buildVerification: CandidateVerificationResult; testVerification: CandidateVerificationResult }> {
  const candidate = freezeWorkspaceResult(result, workspace, declared);
  const inspection = inspectArtifacts(candidate);
  const security = verifySecurity(candidate, inspection);
  const contract = verifyContract(candidate, result);
  const preconditions = { inspection, security, contractOk: contract.ok };

  const buildVerification = await runCandidateVerification(candidate, "BUILD", preconditions, verificationOptions);
  const testVerification = await runCandidateVerification(candidate, "TEST", preconditions, verificationOptions);
  const build = toBuildOrTestResult(buildVerification);
  const test = toBuildOrTestResult(testVerification);

  const decision = decidePromotion(candidate, inspection, build, test, security, contract);
  const evidenceRefs = [inspection.evidence_id, build.evidence_id, test.evidence_id, security.evidence_id, contract.evidence_id];
  const registration = decision.decision === "PROMOTE" ? registerCandidate(candidate, correlationId, evidenceRefs) : null;

  return {
    candidate, inspection, build, test, security, contract, decision, registration,
    installation_status: "MISSING_COMPONENT", activation_status: "MISSING_COMPONENT",
    buildVerification, testVerification,
  };
}
