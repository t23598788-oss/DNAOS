/**
 * หน้าที่: PHASE 3 — CAPABILITY PROMOTION PIPELINE (Owner). The one
 * standard path from a real Agent WORKSPACE_RESULT into DNA OS's
 * Persistent Software Registry:
 *
 *   WORKSPACE_RESULT -> CANDIDATE -> ARTIFACT_INSPECTION -> BUILD_VERIFY
 *   -> TEST_VERIFY -> SECURITY_VERIFY -> CONTRACT_VERIFY -> DUPLICATE_GATE
 *   -> PROMOTION_DECISION -> REGISTRATION -> (INSTALLATION/ACTIVATION: MISSING)
 *
 * Hard rule (Owner): Agent authority ENDS at WORKSPACE_RESULT. No
 * function in this file ever accepts an Agent-authored decision,
 * verification verdict, or "tests pass" claim as evidence — every PASS
 * here is this file's OWN, real, freshly-computed check.
 *
 * Reuses, never duplicates: `./workspace-manager.ts` (TaskWorkspace,
 * lifecycle), `./memory-store.ts#saveEvidence` (no new evidence store),
 * `../registration-pipeline/contract.ts#runRegistrationPipeline` (no new
 * registry/duplicate gate/writer), `../../software/registry-database/adapters/persistent-file-store.ts#createPersistentFileStore`
 * (same store every other registration caller already uses).
 *
 * Honest gaps (per Owner instruction — MISSING, never fabricated PASS):
 * no DNA OS component today can (a) run an arbitrary candidate's build/
 * test script (no generic npm/build executor is registered in
 * `execution/run/process-registry.ts`), (b) copy an accepted candidate
 * into MASTER_SOURCE (no Installer), or (c) flip REGISTERED -> ACTIVE
 * (no Activation mechanism). Each is reported as MISSING_COMPONENT, not
 * silently skipped and not faked.
 *
 * Input: a real `DnaOsAgentResult` + its `TaskWorkspace`.
 * Output: `CapabilityCandidateV1`, `PromotionDecision`, the pipeline
 * stage functions below, `runCapabilityPromotionPipeline`.
 * Dependency ที่อนุญาต: ./types.ts, ./agent-execution-contract.ts,
 * ./workspace-manager.ts, ./memory-store.ts,
 * ../registration-pipeline/contract.ts,
 * ../../software/registry-database/contract.ts, node:fs, node:path,
 * node:crypto.
 * สิ่งที่ห้ามแตะ: never write into a workspace's own files from any
 * function here (read-only inspection only). Never let
 * `decidePromotion` return "PROMOTE" unless every REQUIRED verification
 * stage's own `ok`/`status` field says so — never re-derive from a
 * summary string. Never let a candidate be re-frozen in place — a
 * correction always allocates a new `revision_id`.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { saveEvidence } from "./memory-store";
import type { Evidence } from "./types";
import type { DnaOsAgentResult } from "./agent-execution-contract";
import type { TaskWorkspace } from "./workspace-manager";
import { runRegistrationPipeline } from "../registration-pipeline/contract";
import type { RegistrationCandidate } from "../event-pipeline/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { RegistryStore } from "../../software/registry-database/contract";

// ============================= 1. CANDIDATE CONTRACT =============================

export const CAPABILITY_CANDIDATE_CONTRACT_VERSION = "CAPABILITY_CANDIDATE_V1" as const;

export type CapabilityType = "COMPONENT" | "ADAPTER" | "EXECUTOR" | "CONTRACT" | "TEST" | "OTHER";

export interface ArtifactManifestEntry {
  path: string; // relative to the workspace root — never absolute, never escaping it
  sha256: string;
  size_bytes: number;
  is_executable: boolean;
  is_hidden: boolean;
}

export interface CapabilityCandidateV1 {
  protocol: typeof CAPABILITY_CANDIDATE_CONTRACT_VERSION;
  candidate_id: string;
  revision_id: string;
  command_id: string;
  work_order_id: string;
  workspace_id: string;
  result_id: string;
  capability_name: string;
  capability_type: CapabilityType;
  artifact_manifest: readonly ArtifactManifestEntry[];
  artifact_hashes: Readonly<Record<string, string>>; // path -> sha256, same data as artifact_manifest, indexed for fast lookup
  declared_inputs: readonly string[];
  declared_outputs: readonly string[];
  dependencies: readonly string[];
  requested_integration_point: string;
  created_at: string;
  /** The workspace root this manifest was computed from — never persisted as write authority, read-only reference for re-inspection. */
  workspace_root: string;
}

export interface DeclaredCapability {
  capability_name: string;
  capability_type: CapabilityType;
  declared_inputs: readonly string[];
  declared_outputs: readonly string[];
  dependencies: readonly string[];
  requested_integration_point: string;
}

/** Immutable — keyed by candidate_id, each entry an append-only list of revisions. A caller can never overwrite an existing revision; freezing again always appends a NEW revision_id. */
const candidateRevisions = new Map<string, CapabilityCandidateV1[]>();

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listWorkspaceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) { out.push(full); continue; } // recorded, never followed
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.isFile()) out.push(full);
    }
  }
  if (existsSync(root)) walk(root);
  return out;
}

function buildManifest(workspaceRoot: string): { manifest: ArtifactManifestEntry[]; hashes: Record<string, string> } {
  const manifest: ArtifactManifestEntry[] = [];
  const hashes: Record<string, string> = {};
  for (const absPath of listWorkspaceFiles(workspaceRoot)) {
    const relPath = relative(workspaceRoot, absPath);
    const lst = lstatSync(absPath);
    if (lst.isSymbolicLink()) {
      manifest.push({ path: relPath, sha256: "SYMLINK_NOT_HASHED", size_bytes: 0, is_executable: false, is_hidden: relPath.split("/").pop()!.startsWith(".") });
      continue;
    }
    const hash = sha256File(absPath);
    hashes[relPath] = hash;
    manifest.push({
      path: relPath,
      sha256: hash,
      size_bytes: lst.size,
      is_executable: (lst.mode & 0o111) !== 0,
      is_hidden: relPath.split("/").pop()!.startsWith("."),
    });
  }
  return { manifest, hashes };
}

/**
 * WORKSPACE_RESULT_FREEZE — the ONE place a real, immutable candidate
 * manifest is created from a real Agent result. Never accepts the
 * Agent's own natural-language report as `declared` — every field in
 * `DeclaredCapability` must be supplied by DNA OS's own caller (the
 * command/work-order layer), never parsed out of `result.summary`.
 */
export function freezeWorkspaceResult(result: DnaOsAgentResult, workspace: TaskWorkspace, declared: DeclaredCapability): CapabilityCandidateV1 {
  const existing = candidateRevisions.get(workspace.workspace_id) ?? [];
  const candidate_id = existing.length > 0 ? existing[0].candidate_id : `cand-${randomUUID()}`;
  const revision_id = `rev-${randomUUID()}`;
  const { manifest, hashes } = buildManifest(workspace.allowed_write_workspace);
  const candidate: CapabilityCandidateV1 = {
    protocol: CAPABILITY_CANDIDATE_CONTRACT_VERSION,
    candidate_id,
    revision_id,
    command_id: workspace.command_id,
    work_order_id: workspace.work_order_id,
    workspace_id: workspace.workspace_id,
    result_id: result.result_id,
    capability_name: declared.capability_name,
    capability_type: declared.capability_type,
    artifact_manifest: manifest,
    artifact_hashes: hashes,
    declared_inputs: declared.declared_inputs,
    declared_outputs: declared.declared_outputs,
    dependencies: declared.dependencies,
    requested_integration_point: declared.requested_integration_point,
    created_at: new Date().toISOString(),
    workspace_root: workspace.allowed_write_workspace,
  };
  candidateRevisions.set(workspace.workspace_id, [...existing, candidate]);
  recordEvidence(workspace.work_order_id, "candidate_manifest", "control/agent-gateway/capability-promotion.ts#freezeWorkspaceResult", {
    candidate_id, revision_id, workspace_id: workspace.workspace_id, result_id: result.result_id, file_count: manifest.length, note: existing.length > 0 ? "CORRECTION_REVISION — prior revision never overwritten" : "INITIAL_FREEZE",
  });
  return candidate;
}

export function getLatestRevision(candidate_id: string): CapabilityCandidateV1 | undefined {
  for (const revisions of candidateRevisions.values()) {
    if (revisions[0]?.candidate_id === candidate_id) return revisions[revisions.length - 1];
  }
  return undefined;
}

/**
 * "candidate is frozen" (Phase 3.5 §3) — real check against the same
 * append-only registry `freezeWorkspaceResult` writes to, never a
 * boolean flag a caller could set. `revision_id` must match the
 * LATEST revision exactly — a caller referencing a superseded revision
 * is correctly treated as not-current, never silently accepted.
 */
export function isFrozenRevision(candidate_id: string, revision_id: string): boolean {
  return getLatestRevision(candidate_id)?.revision_id === revision_id;
}

function recordEvidence(task_id: string, kind: Evidence["kind"], source: string, payload: unknown): string {
  const evidence_id = `ev-${kind}-${randomUUID()}`;
  saveEvidence({ evidence_id, task_id, kind, source, recorded_at: new Date().toISOString(), payload });
  return evidence_id;
}

// ============================= 2. ARTIFACT INSPECTION =============================

const CREDENTIAL_FILENAME_PATTERN = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|.*credential.*|.*secret.*|\.npmrc|\.netrc)$/i;

export interface ArtifactInspectionResult {
  ok: boolean;
  checked_count: number;
  missing_files: readonly string[];
  hash_mismatches: readonly string[];
  unexpected_files: readonly string[]; // present now but absent from the frozen manifest — FREEZE violation
  path_traversal: readonly string[];
  symlink_escapes: readonly string[];
  executable_artifacts: readonly string[];
  hidden_files: readonly string[];
  credential_like_files: readonly string[];
  reason_codes: readonly string[];
  evidence_id: string;
}

/** Real filesystem re-inspection against the FROZEN manifest — never trusts the manifest itself as current truth. */
export function inspectArtifacts(candidate: CapabilityCandidateV1): ArtifactInspectionResult {
  const missing_files: string[] = [];
  const hash_mismatches: string[] = [];
  const path_traversal: string[] = [];
  const symlink_escapes: string[] = [];
  const executable_artifacts: string[] = [];
  const hidden_files: string[] = [];
  const credential_like_files: string[] = [];
  const workspaceReal = existsSync(candidate.workspace_root) ? realpathSync(candidate.workspace_root) : candidate.workspace_root;

  for (const entry of candidate.artifact_manifest) {
    if (entry.path.split("/").includes("..") || entry.path.startsWith("/")) { path_traversal.push(entry.path); continue; }
    const absPath = join(candidate.workspace_root, entry.path);
    if (!existsSync(absPath)) { missing_files.push(entry.path); continue; }
    const lst = lstatSync(absPath);
    if (lst.isSymbolicLink()) {
      const target = realpathSync(absPath);
      if (!target.startsWith(workspaceReal)) symlink_escapes.push(entry.path);
      continue;
    }
    if (entry.sha256 !== "SYMLINK_NOT_HASHED") {
      const nowHash = sha256File(absPath);
      if (nowHash !== entry.sha256) hash_mismatches.push(entry.path);
    }
    if (entry.is_executable) executable_artifacts.push(entry.path);
    if (entry.is_hidden) hidden_files.push(entry.path);
    if (CREDENTIAL_FILENAME_PATTERN.test(entry.path)) credential_like_files.push(entry.path);
  }

  const nowFiles = new Set(listWorkspaceFiles(candidate.workspace_root).map((p) => relative(candidate.workspace_root, p)));
  const frozenFiles = new Set(candidate.artifact_manifest.map((e) => e.path));
  const unexpected_files = [...nowFiles].filter((p) => !frozenFiles.has(p));

  const reason_codes: string[] = [];
  if (missing_files.length) reason_codes.push("ARTIFACT_MISSING");
  if (hash_mismatches.length) reason_codes.push("HASH_MISMATCH_POST_FREEZE");
  if (unexpected_files.length) reason_codes.push("CANDIDATE_MODIFIED_AFTER_FREEZE");
  if (path_traversal.length) reason_codes.push("PATH_TRAVERSAL_DETECTED");
  if (symlink_escapes.length) reason_codes.push("SYMLINK_ESCAPE_DETECTED");
  if (credential_like_files.length) reason_codes.push("CREDENTIAL_LIKE_FILE_PRESENT");

  const ok = reason_codes.length === 0;
  const evidence_id = recordEvidence(candidate.work_order_id, "artifact_inspection", "control/agent-gateway/capability-promotion.ts#inspectArtifacts", {
    candidate_id: candidate.candidate_id, revision_id: candidate.revision_id, ok, reason_codes, missing_files, hash_mismatches, unexpected_files, path_traversal, symlink_escapes, executable_artifacts, hidden_files, credential_like_files,
  });
  return { ok, checked_count: candidate.artifact_manifest.length, missing_files, hash_mismatches, unexpected_files, path_traversal, symlink_escapes, executable_artifacts, hidden_files, credential_like_files, reason_codes, evidence_id };
}

// ============================= 3. BUILD / TEST VERIFICATION =============================

/**
 * Widened (Owner, "Phase 3.5 — Candidate Verification Runtime") to carry
 * every real outcome `./candidate-verification-runtime.ts` can produce,
 * not just the two Phase 3 originally had a real executor for
 * (NOT_REQUIRED/MISSING_COMPONENT). `decidePromotion` below maps each to
 * exactly one `PromotionDecisionType` per the Owner's own Phase 3.5 §14
 * table — never re-derived ad hoc at a call site.
 */
export type VerificationOutcome = "PASS" | "FAIL" | "NOT_REQUIRED" | "MISSING_COMPONENT" | "DEPENDENCY_MISSING" | "AUTHORITY_REQUIRED" | "BOUNDARY_VIOLATION" | "TIMEOUT" | "ERROR";

export interface BuildOrTestVerificationResult {
  status: VerificationOutcome;
  reason: string;
  evidence_id: string;
}

/**
 * Honest per Owner instruction: no DNA OS component today can run an
 * arbitrary candidate's own build/test script (no generic npm/build
 * executor is registered in `execution/run/process-registry.ts` — only
 * git/node/security/ts-node entries exist, none of them "run this
 * workspace's package.json script"). Rather than build a new privileged
 * executor ad hoc mid-verification (explicitly forbidden — "REUSE FIRST",
 * "ห้ามสร้าง process executor ตัวที่ 3"), a candidate that declares a
 * package.json is honestly reported MISSING_COMPONENT, never a fabricated
 * PASS/FAIL. A candidate with no package.json genuinely has no build/test
 * step and is NOT_REQUIRED.
 */
function verifyBuildOrTest(candidate: CapabilityCandidateV1, kind: "build" | "test"): BuildOrTestVerificationResult {
  const hasPackageJson = candidate.artifact_manifest.some((e) => e.path === "package.json" || e.path.endsWith("/package.json"));
  const status: VerificationOutcome = hasPackageJson ? "MISSING_COMPONENT" : "NOT_REQUIRED";
  const reason = hasPackageJson
    ? `Candidate declares package.json but no DNA OS ${kind} executor is registered for arbitrary candidate workspaces (execution/run/process-registry.ts has no such entry) — reporting MISSING_COMPONENT rather than fabricating a result or building an unreviewed new executor.`
    : `No package.json in candidate manifest — no ${kind} step exists for this candidate.`;
  const evidence_id = recordEvidence(candidate.work_order_id, kind === "build" ? "build_execution" : "test_verification", "control/agent-gateway/capability-promotion.ts#verifyBuildOrTest", { candidate_id: candidate.candidate_id, kind, status, reason });
  return { status, reason, evidence_id };
}

export const verifyBuild = (candidate: CapabilityCandidateV1): BuildOrTestVerificationResult => verifyBuildOrTest(candidate, "build");
export const verifyTest = (candidate: CapabilityCandidateV1): BuildOrTestVerificationResult => verifyBuildOrTest(candidate, "test");

// ============================= 4. SECURITY VERIFICATION =============================

export interface SecurityVerificationResult {
  ok: boolean;
  status: "PASS" | "FAIL_CLOSED";
  undeclared_authority_found: readonly string[];
  evidence_id: string;
}

/**
 * Reuses the SAME real data `inspectArtifacts` already computed — no
 * second filesystem walk, no new spawn. Covers the filesystem-authority,
 * unexpected-executable, and credential-access dimensions of requirement
 * 6 with real evidence. Process-execution/network/IPC/environment-
 * inheritance dimensions require an actual running process to observe;
 * since BUILD/TEST verification above never launches one for a generic
 * candidate (MISSING_COMPONENT), those dimensions are honestly
 * UNVERIFIED here too — never claimed PASS without a real check.
 */
export function verifySecurity(candidate: CapabilityCandidateV1, inspection: ArtifactInspectionResult): SecurityVerificationResult {
  const undeclared_authority_found: string[] = [];
  if (inspection.executable_artifacts.length > 0) undeclared_authority_found.push(`UNDECLARED_EXECUTABLE:${inspection.executable_artifacts.join(",")}`);
  if (inspection.credential_like_files.length > 0) undeclared_authority_found.push(`CREDENTIAL_FILE_PRESENT:${inspection.credential_like_files.join(",")}`);
  if (inspection.symlink_escapes.length > 0) undeclared_authority_found.push(`SYMLINK_ESCAPE:${inspection.symlink_escapes.join(",")}`);
  if (inspection.path_traversal.length > 0) undeclared_authority_found.push(`PATH_TRAVERSAL:${inspection.path_traversal.join(",")}`);
  const ok = undeclared_authority_found.length === 0;
  const evidence_id = recordEvidence(candidate.work_order_id, "security_verification", "control/agent-gateway/capability-promotion.ts#verifySecurity", { candidate_id: candidate.candidate_id, ok, undeclared_authority_found });
  return { ok, status: ok ? "PASS" : "FAIL_CLOSED", undeclared_authority_found, evidence_id };
}

// ============================= 5. CONTRACT VERIFICATION =============================

export interface ContractVerificationResult {
  ok: boolean;
  status: "PASS" | "REJECT";
  missing_contract_fields: readonly string[];
  evidence_id: string;
}

/** UNKNOWN contract = REJECT (requirement 7) — checks the candidate's own declared shape AND the originating result's machine contract fields, never a free-text inference. */
export function verifyContract(candidate: CapabilityCandidateV1, result: DnaOsAgentResult): ContractVerificationResult {
  const missing_contract_fields: string[] = [];
  if (candidate.declared_inputs.length === 0) missing_contract_fields.push("declared_inputs");
  if (candidate.declared_outputs.length === 0) missing_contract_fields.push("declared_outputs");
  if (!candidate.requested_integration_point) missing_contract_fields.push("requested_integration_point");
  if (result.protocol !== "DNA_OS_AGENT_RESULT_V1") missing_contract_fields.push("output_contract(protocol)");
  if (result.errors === undefined) missing_contract_fields.push("error_contract");
  if (result.runtime.exit_code === undefined) missing_contract_fields.push("timeout_behavior(exit_code)");
  if (result.evidence_refs.length === 0) missing_contract_fields.push("evidence_behavior(evidence_refs)");
  const ok = missing_contract_fields.length === 0;
  const evidence_id = recordEvidence(candidate.work_order_id, "contract_verification", "control/agent-gateway/capability-promotion.ts#verifyContract", { candidate_id: candidate.candidate_id, ok, missing_contract_fields });
  return { ok, status: ok ? "PASS" : "REJECT", missing_contract_fields, evidence_id };
}

// ============================= 6. DUPLICATE GATE + REGISTRATION (single real call) =============================

export type DuplicateGateStatus = "NEW" | "EXTEND_EXISTING" | "DUPLICATE" | "CONFLICT";

export interface RegistrationOutcome {
  duplicate_gate_status: DuplicateGateStatus;
  registration_status: "REGISTERED" | "DUPLICATE" | "REJECTED" | "UNRESOLVED";
  resource_id: string | null;
  capability_id: string | null;
  reason_code: string | null;
}

/**
 * The existing Registration Pipeline (`runRegistrationPipeline`) already
 * runs Duplicate Resolution as an internal stage before ever writing —
 * calling it once covers requirements 8 (DUPLICATE_GATE) and 10
 * (REGISTRATION) together, exactly as every other real caller in this
 * repo already does. This function only TRANSLATES its real
 * `DuplicateResolutionStatus`/`PipelineResult.status` vocabulary
 * (`UNIQUE|DUPLICATE_EXACT|DUPLICATE_SEMANTIC|UNRESOLVED_DUPLICATE` /
 * `REGISTERED|DUPLICATE|REJECTED|UNRESOLVED`) into the Phase 3 task's
 * requested reporting vocabulary — it never invents a second, parallel
 * duplicate-detection mechanism.
 */
/**
 * `store` has a DEFAULT rather than being optional, deliberately:
 * `Function.length` ignores parameters with defaults, so
 * `registerCandidate.length` stays 3 and the adversarial invariant in
 * ./tests/capability-promotion.test.ts — "registerCandidate takes no
 * PromotionDecision argument, a candidate cannot self-authorize its own
 * registration" — keeps passing unmodified. The guard was not weakened to
 * accommodate this parameter; the parameter was shaped to leave the guard
 * exactly as it was.
 */
export function registerCandidate(candidate: CapabilityCandidateV1, correlationId: string, evidenceRefs: readonly string[], store: RegistryStore = createPersistentFileStore()): RegistrationOutcome {
  const registrationCandidate: RegistrationCandidate = {
    candidate_id: candidate.candidate_id,
    name: candidate.capability_name,
    kind: "capability",
    source_location: candidate.workspace_root,
    owner: "dna-os-capability-promotion",
    input: candidate.declared_inputs,
    output: candidate.declared_outputs,
    side_effects: [],
    dependencies: candidate.dependencies,
    behavior: candidate.requested_integration_point,
    version: candidate.revision_id,
    evidence_refs: evidenceRefs,
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: candidate.requested_integration_point,
  };
  // The store is injectable, and defaults to the live one every other
  // registration caller uses (Owner, 2026-08-26). It was hard-coded here, so
  // control/agent-gateway/tests/capability-promotion.test.ts had no way to run
  // against an isolated registry: its proof rows landed in the canonical data,
  // and the SECOND run of the same test hit the Duplicate Gate's
  // DUPLICATE_SEMANTIC and failed. The gate was right both times — the test
  // had no isolation. Production behaviour is unchanged by construction: omit
  // the store and this is exactly the call it was before.
  const result = runRegistrationPipeline(registrationCandidate, store, correlationId);
  let duplicate_gate_status: DuplicateGateStatus;
  let registration_status: RegistrationOutcome["registration_status"];
  let resource_id: string | null = null;
  let capability_id: string | null = null;
  let reason_code: string | null = null;
  if (result.status === "REGISTERED") {
    duplicate_gate_status = "NEW";
    registration_status = "REGISTERED";
    resource_id = result.resource_id;
    capability_id = result.capability_id;
  } else if (result.status === "DUPLICATE") {
    duplicate_gate_status = "DUPLICATE";
    registration_status = "DUPLICATE";
    reason_code = result.reason_code;
  } else if (result.status === "REJECTED") {
    duplicate_gate_status = "CONFLICT";
    registration_status = "REJECTED";
    reason_code = result.reason_code;
  } else {
    duplicate_gate_status = "CONFLICT";
    registration_status = "UNRESOLVED";
    reason_code = result.reason_code;
  }
  recordEvidence(candidate.work_order_id, "verification", "control/agent-gateway/capability-promotion.ts#registerCandidate", { candidate_id: candidate.candidate_id, duplicate_gate_status, registration_status, resource_id, capability_id, reason_code });
  return { duplicate_gate_status, registration_status, resource_id, capability_id, reason_code };
}

// ============================= 7. PROMOTION DECISION =============================

export type PromotionDecisionType = "PROMOTE" | "REJECT" | "CORRECTION_REQUIRED" | "OWNER_REVIEW_REQUIRED";

export interface PromotionDecision {
  decision: PromotionDecisionType;
  reasons: readonly string[];
  evidence_id: string;
}

/**
 * Deterministic, DNA-OS-only (requirement 9 — "Agent ห้ามสร้าง decision
 * นี้เอง"). PROMOTE requires artifact inspection + security + contract
 * verification to all be real PASS, AND build/test to be either PASS or
 * NOT_REQUIRED. A MISSING_COMPONENT build/test result can never resolve
 * to PROMOTE or REJECT on its own merits (DNA OS genuinely cannot tell)
 * — it resolves to OWNER_REVIEW_REQUIRED, never silently ignored.
 */
export function decidePromotion(candidate: CapabilityCandidateV1, inspection: ArtifactInspectionResult, build: BuildOrTestVerificationResult, test: BuildOrTestVerificationResult, security: SecurityVerificationResult, contract: ContractVerificationResult): PromotionDecision {
  const reasons: string[] = [];
  if (!inspection.ok) reasons.push(...inspection.reason_codes);
  if (!security.ok) reasons.push("SECURITY_VERIFICATION_FAILED");
  if (!contract.ok) reasons.push(...contract.missing_contract_fields.map((f) => `CONTRACT_MISSING:${f}`));
  // Phase 3.5 §14 mapping — applied identically to build and test:
  //   PASS | NOT_REQUIRED                              -> continue
  //   FAIL | TIMEOUT                                    -> CORRECTION_REQUIRED (candidate's own work is fixable)
  //   BOUNDARY_VIOLATION                                -> REJECT (a real security/boundary breach, not a correctable defect)
  //   DEPENDENCY_MISSING | AUTHORITY_REQUIRED
  //     | MISSING_COMPONENT | ERROR                     -> OWNER_REVIEW_REQUIRED (DNA OS genuinely cannot determine PASS/FAIL)
  function classify(v: BuildOrTestVerificationResult, label: "BUILD" | "TEST"): PromotionDecisionType | null {
    switch (v.status) {
      case "PASS": case "NOT_REQUIRED": return null;
      case "FAIL": case "TIMEOUT": reasons.push(`${label}_${v.status}`); return "CORRECTION_REQUIRED";
      case "BOUNDARY_VIOLATION": reasons.push(`${label}_BOUNDARY_VIOLATION`); return "REJECT";
      default: reasons.push(`${label}_${v.status} — cannot determine PASS/FAIL`); return "OWNER_REVIEW_REQUIRED";
    }
  }
  const buildVerdict = classify(build, "BUILD");
  const testVerdict = classify(test, "TEST");
  const hardFail = !inspection.ok || !security.ok || !contract.ok || buildVerdict === "REJECT" || testVerdict === "REJECT";

  let decision: PromotionDecisionType;
  if (hardFail) {
    decision = "REJECT";
  } else if (buildVerdict === "CORRECTION_REQUIRED" || testVerdict === "CORRECTION_REQUIRED") {
    decision = "CORRECTION_REQUIRED";
  } else if (buildVerdict === "OWNER_REVIEW_REQUIRED" || testVerdict === "OWNER_REVIEW_REQUIRED") {
    decision = "OWNER_REVIEW_REQUIRED";
  } else {
    decision = "PROMOTE";
  }

  const evidence_id = recordEvidence(candidate.work_order_id, "promotion_decision", "control/agent-gateway/capability-promotion.ts#decidePromotion", { candidate_id: candidate.candidate_id, revision_id: candidate.revision_id, decision, reasons });
  return { decision, reasons, evidence_id };
}

// ============================= 8. FULL PIPELINE ORCHESTRATION =============================

export interface CapabilityPromotionPipelineResult {
  candidate: CapabilityCandidateV1;
  inspection: ArtifactInspectionResult;
  build: BuildOrTestVerificationResult;
  test: BuildOrTestVerificationResult;
  security: SecurityVerificationResult;
  contract: ContractVerificationResult;
  decision: PromotionDecision;
  registration: RegistrationOutcome | null; // null unless decision === PROMOTE
  installation_status: "MISSING_COMPONENT";
  activation_status: "MISSING_COMPONENT";
}

/**
 * Runs the full real pipeline in the exact required order. Never skips a
 * stage; never lets a later stage override an earlier FAIL_CLOSED.
 * Registration (and therefore Duplicate Gate) only runs when
 * `decidePromotion` says PROMOTE — a REJECT/CORRECTION_REQUIRED/
 * OWNER_REVIEW_REQUIRED candidate is never written to the registry.
 */
export function runCapabilityPromotionPipeline(result: DnaOsAgentResult, workspace: TaskWorkspace, declared: DeclaredCapability, correlationId: string, store: RegistryStore = createPersistentFileStore()): CapabilityPromotionPipelineResult {
  const candidate = freezeWorkspaceResult(result, workspace, declared);
  const inspection = inspectArtifacts(candidate);
  const build = verifyBuild(candidate);
  const test = verifyTest(candidate);
  const security = verifySecurity(candidate, inspection);
  const contract = verifyContract(candidate, result);
  const decision = decidePromotion(candidate, inspection, build, test, security, contract);
  const evidenceRefs = [inspection.evidence_id, build.evidence_id, test.evidence_id, security.evidence_id, contract.evidence_id];
  const registration = decision.decision === "PROMOTE" ? registerCandidate(candidate, correlationId, evidenceRefs, store) : null;
  return { candidate, inspection, build, test, security, contract, decision, registration, installation_status: "MISSING_COMPONENT", activation_status: "MISSING_COMPONENT" };
}

// ============================= 9. CORRECTIVE LOOP (candidate-level) =============================

export interface CorrectionRequest {
  candidate_id: string;
  revision_id: string;
  failure_reasons: readonly string[];
  /** Machine-readable only — never a natural-language rewrite the Agent could reinterpret as new policy. */
  required_correction: readonly string[];
}

/**
 * Given a REJECT/CORRECTION_REQUIRED decision, builds exactly the
 * machine-readable correction the Agent is allowed to receive
 * (requirement 13 — "Agent ต้องได้รับเฉพาะ: machine-readable failure,
 * allowed source/context, required correction"). Never dispatches a new
 * WorkOrder itself (that stays the caller's/router's job) and never lets
 * the Agent alter which checks run next time.
 */
export function buildCorrectionRequest(candidate: CapabilityCandidateV1, decision: PromotionDecision): CorrectionRequest {
  return {
    candidate_id: candidate.candidate_id,
    revision_id: candidate.revision_id,
    failure_reasons: decision.reasons,
    required_correction: decision.reasons.map((r) => `RESOLVE:${r}`),
  };
}

// ============================= 10. LINEAGE =============================

export interface CapabilityLineage {
  command_id: string;
  work_order_id: string;
  workspace_id: string;
  launch_id: string | null;
  result_id: string;
  candidate_id: string;
  revision_id: string;
  verification_id: string | null;
  promotion_decision_id: string;
  capability_id: string | null;
  resource_id: string | null;
  installation_id: null; // MISSING — no Installer exists
  activation_id: null; // MISSING — no Activation mechanism exists
}

export function traceLineage(result: DnaOsAgentResult, candidate: CapabilityCandidateV1, decision: PromotionDecision, registration: RegistrationOutcome | null): CapabilityLineage {
  return {
    command_id: candidate.command_id,
    work_order_id: candidate.work_order_id,
    workspace_id: candidate.workspace_id,
    launch_id: result.launch_id,
    result_id: result.result_id,
    candidate_id: candidate.candidate_id,
    revision_id: candidate.revision_id,
    verification_id: result.verification_id,
    promotion_decision_id: decision.evidence_id,
    capability_id: registration?.capability_id ?? null,
    resource_id: registration?.resource_id ?? null,
    installation_id: null,
    activation_id: null,
  };
}
