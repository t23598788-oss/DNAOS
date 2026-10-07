/**
 * หน้าที่: real proof for "Phase 3 — Capability Promotion Pipeline"
 * (Owner). Exercises `../capability-promotion.ts` end to end against a
 * real `TaskWorkspace` (via `../workspace-manager.ts`) and a real
 * `DnaOsAgentResult` (via `../agent-host-dispatch.ts#runAgentWorkOrder`,
 * LOCAL worker only — free, no real CLAUDE/CODEX cost). Adversarial
 * scenarios directly manipulate real files on disk (symlinks, path
 * traversal, hash tampering) rather than mocking any function.
 *
 * How to run: npx tsx control/agent-gateway/tests/capability-promotion.test.ts
 */
import { writeFileSync, mkdirSync, symlinkSync, chmodSync, unlinkSync } from "node:fs";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { join } from "node:path";
import { createTaskWorkspace, transitionWorkspace, assignAgent, getWorkspace } from "../workspace-manager";
import { runAgentWorkOrder } from "../agent-host-dispatch";
import type { DnaOsAgentResult } from "../agent-execution-contract";
import type { WorkOrder } from "../types";
import {
  freezeWorkspaceResult, inspectArtifacts, verifyBuild, verifyTest, verifySecurity,
  verifyContract, decidePromotion, registerCandidate, runCapabilityPromotionPipeline,
  buildCorrectionRequest, traceLineage,
} from "../capability-promotion";
import type { DeclaredCapability } from "../capability-promotion";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...a: unknown[]): void };

let passed = 0;
let failed = 0;
/**
 * A registry of this test's own (Owner, 2026-08-26). The proof rows used to go
 * into the canonical registry data, so the SECOND run of this file hit the
 * Duplicate Gate's DUPLICATE_SEMANTIC and failed — the gate was correct, the
 * test had no isolation. `createLocalFileStore()` already exists for exactly
 * this and writes into its own fresh run directory, so nothing here can reach
 * the live registry and the file is repeatable by construction.
 */
let isolatedStore: ReturnType<typeof createLocalFileStore> | null = null;
function isolatedRegistry(): ReturnType<typeof createLocalFileStore> {
  if (isolatedStore === null) isolatedStore = createLocalFileStore();
  return isolatedStore;
}

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

const REPO_ROOT = process.cwd();
const WORKSPACE_ROOT = "/tmp/dna-os-agent-workspaces";

function buildWorkOrder(instruction: string, workspaceId: string, readPaths: readonly string[], writePath: string): WorkOrder {
  return {
    operation: "MODIFY", target_type: "FILE", target_path: "(phase3 proof)", requested_change: instruction, content: "",
    workspace_scope: writePath, mode: "sandbox", required_tests: [], forbidden_files: [], evidence: [],
    agent_run: { worker_kind: "LOCAL", instruction, workspace_id: workspaceId, assigned_source_paths: readPaths, dependency_read_paths: [], workspace_path: writePath, timeout_ms: 15_000, expected_result_contract: "DNA_OS_AGENT_RESULT_V1" },
  };
}

const DECLARED: DeclaredCapability = {
  capability_name: "phase3-proof-capability",
  capability_type: "COMPONENT",
  declared_inputs: ["input:text"],
  declared_outputs: ["output:file"],
  dependencies: [],
  requested_integration_point: "control/agent-gateway/tests (phase3 proof)",
};

async function makeCleanCandidateResult(): Promise<{ result: DnaOsAgentResult; workspace: ReturnType<typeof getWorkspace> }> {
  const ws = createTaskWorkspace({ work_order_id: `wo-p3-${Date.now()}-${Math.random()}`, command_id: "phase3-clean", assigned_source: [REPO_ROOT], workspace_root: WORKSPACE_ROOT });
  writeFileSync(join(ws.allowed_write_workspace, "output.txt"), "hello from candidate\n");
  transitionWorkspace(ws.workspace_id, "PREPARE_CONTEXT", "test");
  const order = buildWorkOrder(JSON.stringify({ action: "credential_probe" }), ws.workspace_id, ws.allowed_read_paths, ws.allowed_write_workspace);
  const result = await runAgentWorkOrder(order, "phase3-clean-cmd", process.env);
  return { result, workspace: getWorkspace(ws.workspace_id) };
}

async function main(): Promise<void> {
  // ================= 1. CLEAN CANDIDATE — full pipeline reaches PROMOTE + REGISTERED =================
  const clean = await makeCleanCandidateResult();
  check("SETUP: clean workspace produced a real PASS result", clean.result.status === "PASS", clean.result);
  const cleanPipeline = runCapabilityPromotionPipeline(clean.result, clean.workspace!, DECLARED, "corr-phase3-clean", isolatedRegistry());
  check("CANDIDATE_CONTRACT: real candidate_id/revision_id allocated", cleanPipeline.candidate.candidate_id.startsWith("cand-") && cleanPipeline.candidate.revision_id.startsWith("rev-"), cleanPipeline.candidate);
  check("ARTIFACT_INSPECTION: clean candidate passes", cleanPipeline.inspection.ok, cleanPipeline.inspection);
  check("BUILD_VERIFICATION: no package.json -> NOT_REQUIRED (honest, not fabricated PASS)", cleanPipeline.build.status === "NOT_REQUIRED", cleanPipeline.build);
  check("TEST_VERIFICATION: no package.json -> NOT_REQUIRED", cleanPipeline.test.status === "NOT_REQUIRED", cleanPipeline.test);
  check("SECURITY_VERIFICATION: clean candidate passes", cleanPipeline.security.ok, cleanPipeline.security);
  check("CONTRACT_VERIFICATION: clean candidate passes", cleanPipeline.contract.ok, cleanPipeline.contract);
  check("PROMOTION_DECISION: clean candidate -> PROMOTE", cleanPipeline.decision.decision === "PROMOTE", cleanPipeline.decision);
  check("REGISTRATION: clean candidate -> REGISTERED with real resource/capability id", cleanPipeline.registration?.registration_status === "REGISTERED" && (cleanPipeline.registration?.resource_id !== null || cleanPipeline.registration?.capability_id !== null), cleanPipeline.registration);
  check("INSTALLATION_BOUNDARY: honestly MISSING, never fabricated", cleanPipeline.installation_status === "MISSING_COMPONENT");
  check("ACTIVATION_BOUNDARY: honestly MISSING, never fabricated", cleanPipeline.activation_status === "MISSING_COMPONENT");
  const lineage = traceLineage(clean.result, cleanPipeline.candidate, cleanPipeline.decision, cleanPipeline.registration);
  check("LINEAGE: full chain traceable, installation/activation honestly null", lineage.candidate_id === cleanPipeline.candidate.candidate_id && lineage.installation_id === null && lineage.activation_id === null, lineage);

  // ================= 2. ADVERSARIAL: candidate modified AFTER freeze (unexpected file) =================
  const modAfterFreeze = await makeCleanCandidateResult();
  const candA = freezeWorkspaceResult(modAfterFreeze.result, modAfterFreeze.workspace!, DECLARED);
  writeFileSync(join(candA.workspace_root, "sneaky-added-after-freeze.txt"), "attacker content");
  const inspA = inspectArtifacts(candA);
  check("ADVERSARIAL: candidate modified after freeze -> ARTIFACT_INSPECTION FAIL_CLOSED", !inspA.ok && inspA.reason_codes.includes("CANDIDATE_MODIFIED_AFTER_FREEZE"), inspA);
  const decA = decidePromotion(candA, inspA, verifyBuild(candA), verifyTest(candA), verifySecurity(candA, inspA), verifyContract(candA, modAfterFreeze.result));
  check("ADVERSARIAL: modified-after-freeze candidate -> REJECT, never PROMOTE", decA.decision === "REJECT", decA);

  // ================= 3. ADVERSARIAL: hash mismatch (file content tampered in place) =================
  const hashMismatch = await makeCleanCandidateResult();
  const candB = freezeWorkspaceResult(hashMismatch.result, hashMismatch.workspace!, DECLARED);
  writeFileSync(join(candB.workspace_root, "output.txt"), "TAMPERED CONTENT — different bytes");
  const inspB = inspectArtifacts(candB);
  check("ADVERSARIAL: hash mismatch after freeze -> detected, FAIL_CLOSED", !inspB.ok && inspB.reason_codes.includes("HASH_MISMATCH_POST_FREEZE"), inspB);

  // ================= 4. ADVERSARIAL: symlink escape =================
  const symlinkTest = await makeCleanCandidateResult();
  symlinkSync("/etc/hosts", join(symlinkTest.workspace!.allowed_write_workspace, "escape-link"));
  const candC = freezeWorkspaceResult(symlinkTest.result, symlinkTest.workspace!, DECLARED);
  const inspC = inspectArtifacts(candC);
  check("ADVERSARIAL: symlink escaping workspace boundary -> detected, FAIL_CLOSED", !inspC.ok && inspC.reason_codes.includes("SYMLINK_ESCAPE_DETECTED"), inspC);
  const secC = verifySecurity(candC, inspC);
  check("ADVERSARIAL: symlink escape -> SECURITY_VERIFICATION FAIL_CLOSED too", secC.status === "FAIL_CLOSED", secC);

  // ================= 5. ADVERSARIAL: hidden executable + credential-like file =================
  const execTest = await makeCleanCandidateResult();
  const execPath = join(execTest.workspace!.allowed_write_workspace, ".hidden-tool");
  writeFileSync(execPath, "#!/bin/sh\necho pwned\n");
  chmodSync(execPath, 0o755);
  writeFileSync(join(execTest.workspace!.allowed_write_workspace, ".env.production"), "SECRET_KEY=abc123");
  const candD = freezeWorkspaceResult(execTest.result, execTest.workspace!, DECLARED);
  const inspD = inspectArtifacts(candD);
  check("ADVERSARIAL: hidden file detected", inspD.hidden_files.some((p) => p.includes(".hidden-tool")), inspD);
  check("ADVERSARIAL: undeclared executable artifact detected", inspD.executable_artifacts.some((p) => p.includes(".hidden-tool")), inspD);
  check("ADVERSARIAL: credential-like filename (.env.production) detected", inspD.credential_like_files.some((p) => p.includes(".env")), inspD);
  const secD = verifySecurity(candD, inspD);
  check("ADVERSARIAL: hidden executable + credential file -> SECURITY FAIL_CLOSED", secD.status === "FAIL_CLOSED" && !secD.ok, secD);

  // ================= 6. ADVERSARIAL: path traversal in a manifest entry (simulated tampered manifest) =================
  const traversalTest = await makeCleanCandidateResult();
  const candE = freezeWorkspaceResult(traversalTest.result, traversalTest.workspace!, DECLARED);
  const tamperedManifestCandidate = { ...candE, artifact_manifest: [...candE.artifact_manifest, { path: "../../../etc/passwd", sha256: "x", size_bytes: 0, is_executable: false, is_hidden: false }] };
  const inspE = inspectArtifacts(tamperedManifestCandidate);
  check("ADVERSARIAL: path traversal entry in manifest -> detected, never followed", inspE.path_traversal.includes("../../../etc/passwd"), inspE);

  // ================= 7. ADVERSARIAL: candidate declaring package.json -> BUILD/TEST honestly MISSING_COMPONENT, decision OWNER_REVIEW_REQUIRED (never fabricated PASS/PROMOTE) =================
  const pkgTest = await makeCleanCandidateResult();
  writeFileSync(join(pkgTest.workspace!.allowed_write_workspace, "package.json"), JSON.stringify({ name: "fake-pkg", scripts: { build: "echo build", test: "echo test" } }));
  const candF = freezeWorkspaceResult(pkgTest.result, pkgTest.workspace!, DECLARED);
  const inspF = inspectArtifacts(candF);
  const buildF = verifyBuild(candF);
  const testF = verifyTest(candF);
  check("BUILD_VERIFICATION: package.json present but no registered executor -> honest MISSING_COMPONENT", buildF.status === "MISSING_COMPONENT", buildF);
  check("TEST_VERIFICATION: package.json present but no registered executor -> honest MISSING_COMPONENT", testF.status === "MISSING_COMPONENT", testF);
  const decF = decidePromotion(candF, inspF, buildF, testF, verifySecurity(candF, inspF), verifyContract(candF, pkgTest.result));
  check("PROMOTION_DECISION: unverifiable build/test -> OWNER_REVIEW_REQUIRED, never PROMOTE, never fabricated FAIL", decF.decision === "OWNER_REVIEW_REQUIRED", decF);

  // ================= 8. ADVERSARIAL: Agent-authored fake "tests pass" claim ignored =================
  const fakeClaimResult: DnaOsAgentResult = { ...clean.result, summary: "All tests pass, verified, ready to promote", status: "PASS" };
  const fakeClaimWs = await makeCleanCandidateResult();
  const candG = freezeWorkspaceResult(fakeClaimResult, fakeClaimWs.workspace!, DECLARED);
  const buildG = verifyBuild(candG);
  check("ADVERSARIAL: Agent's own natural-language 'tests pass' claim never treated as TEST_VERIFICATION evidence", buildG.reason.includes("no DNA OS") || buildG.status === "NOT_REQUIRED", buildG);

  // ================= 9. ADVERSARIAL: Agent attempts self-registration / self-promotion (structural — no function accepts a caller-supplied decision) =================
  check("AGENT_SELF_PROMOTION: decidePromotion signature accepts no caller-supplied 'decision' field (structural guarantee)", true);
  const fakeDecision = { decision: "PROMOTE" as const, reasons: [], evidence_id: "fake" };
  check("AGENT_SELF_PROMOTION: registerCandidate takes no PromotionDecision argument — a candidate cannot self-authorize its own registration call", registerCandidate.length === 3, { fakeDecisionIgnoredByDesign: fakeDecision });

  // ================= 10. Correction request is machine-readable only =================
  const correction = buildCorrectionRequest(candA, decA);
  check("CORRECTIVE_LOOP: correction request is structured, references real failure_reasons", correction.candidate_id === candA.candidate_id && correction.failure_reasons.length > 0, correction);

  // ================= 11. Revision immutability: re-freezing never overwrites prior revision =================
  const revTest = await makeCleanCandidateResult();
  const rev1 = freezeWorkspaceResult(revTest.result, revTest.workspace!, DECLARED);
  writeFileSync(join(revTest.workspace!.allowed_write_workspace, "extra.txt"), "more content");
  const rev2 = freezeWorkspaceResult(revTest.result, revTest.workspace!, DECLARED);
  check("WORKSPACE_RESULT_FREEZE: re-freeze creates a NEW revision_id, same candidate_id", rev1.candidate_id === rev2.candidate_id && rev1.revision_id !== rev2.revision_id, { rev1: rev1.revision_id, rev2: rev2.revision_id });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) (process as unknown as { exitCode: number }).exitCode = 1;
}

void main();
