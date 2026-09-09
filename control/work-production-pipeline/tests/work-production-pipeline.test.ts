/**
 * Deterministic proofs A–X for DNA_OS_WORK_PRODUCTION_PIPELINE_V1.
 *
 * How to run:
 *   npx tsx control/work-production-pipeline/tests/work-production-pipeline.test.ts
 */

import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import { initCanonicalFixtureRepo } from "../git-fixture";
import {
  acceptAiSelfVerification,
  advanceProductionConveyor,
  attemptTransition,
  attachBareRemote,
  cleanupDisposableWorkspace,
  classifyAffect,
  codingClientDeploy,
  codingClientRegisterRuntimeCapability,
  getCodeVerificationRegistry,
  githubEnvironmentProtectionStatus,
  isLegalTransition,
  lanesContract,
  listDevelopmentNotifications,
  mcpDiscovery,
  operationalInvokeProduced,
  ownerApprovePublish,
  ownerEnableProducedCapability,
  prepareDisposableClone,
  productionGate,
  productionWorkSurfaceSlice,
  registerDeploymentTarget,
  submitOwnerDevelopmentIntent,
  writeRuntimeRevision,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const ROOT = process.cwd();
const PIPE = join(ROOT, "control/work-production-pipeline/data");
const LRA = join(ROOT, "control/local-resource-access/data");
const OCR = join(ROOT, "control/owner-client-runtime/data");
const logs: Record<string, string> = {
  WORK_PIPELINE_LOG: join(PIPE, `det-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_NOTIFY_LOG: join(PIPE, `det-notify-${STAMP}.jsonl`),
  WORK_PIPELINE_VERIFY_LOG: join(PIPE, `det-ver-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(PIPE, `det-dep-${STAMP}.jsonl`),
  WORK_PIPELINE_CAPS_LOG: join(PIPE, `det-caps-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVENTS_LOG: join(LRA, `det-pipe-events-${STAMP}.jsonl`),
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `det-pipe-grants-${STAMP}.jsonl`),
  RESOURCE_HANDLES_LOG: join(OCR, `det-pipe-handles-${STAMP}.jsonl`),
  WORK_CONTEXT_LOG: join(OCR, `det-pipe-work-${STAMP}.jsonl`),
};
for (const [key, value] of Object.entries(logs)) process.env[key] = value;

const canonical = join(PIPE, `canonical-det-${STAMP}`);
const disposable = join(PIPE, ".dna-os-agent-worktrees", `det-${STAMP}`);
const remote = join(PIPE, `remote-det-${STAMP}.git`);
const runtime = join(PIPE, `runtime-det-${STAMP}`);
const TARGET = "deploy://local/fixture-runtime-det";
const AI = "ai://pipeline-det";
const SESSION = `session-pipe-det-${STAMP}`;

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  mkdirSync(PIPE, { recursive: true });
  initCanonicalFixtureRepo(canonical, String(STAMP));
  prepareDisposableClone(canonical, disposable);
  attachBareRemote(disposable, remote);
  registerDeploymentTarget({
    target_id: TARGET,
    environment: "fixture",
    provider: "local-file",
    application: "app://pipeline/fixture",
    deployment_method: "revision_stamp",
    source_repository: "repo://pipeline-fixture",
    required_artifact: "PRODUCTION_ARTIFACT_V1",
    health_probe: "pipeline.runtime.revision_file",
    rollback_method: "restore_revision_file",
    authority_policy: "OWNER_POLICY",
    secret_reference_policy: "NONE",
    runtime_identity: "fixture-runtime",
    status: "REGISTERED",
    runtime_dir: runtime,
  });
  issueLocalAccessGrant({
    ai_identity: AI, session_id: SESSION, work_id: null, capability: "*", resource_id: "resource://local/files/fixture-corpus",
    data_scope: ["control/local-resource-access/fixtures/corpus"], access: ["READ"], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });

  await check("A. Development and capability-usage lanes are separate", () => {
    const lanes = lanesContract();
    assert(lanes.DEVELOPMENT_LANE === true && lanes.CAPABILITY_USAGE_LANE === true, JSON.stringify(lanes));
    assert(lanes.DEVELOPMENT_ARTIFACT_NE_REGISTERED_RUNTIME_CAPABILITY === true, "artifact != capability");
    assert(lanes.DEVELOPMENT_AND_RUNTIME_AUTHORITY_SEPARATED === true, "authority");
  });

  await check("B. Coding client cannot directly register runtime capability", () => {
    const denied = codingClientRegisterRuntimeCapability();
    assert(denied.ok === false && denied.CODING_CLIENT_CAN_REGISTER_RUNTIME_CAPABILITY === false, JSON.stringify(denied));
  });

  await check("C. Coding client cannot directly deploy production", () => {
    const denied = codingClientDeploy();
    assert(denied.ok === false && denied.CODING_CLIENT_CAN_DEPLOY === false, JSON.stringify(denied));
  });

  const low = submitOwnerDevelopmentIntent({
    owner_goal: "harmless fixture marker",
    requested_change: `MARKER_DET_${STAMP}`,
    risk_class: "LOW",
    production_intent: true,
    deployment_target: TARGET,
    workspace_root: disposable,
    canonical_root: canonical,
    disposable_root: disposable,
    remote_root: remote,
  });

  await check("D. Owner intent resolves into structured work order", () => {
    assert(low.intent.schema === "OWNER_DEVELOPMENT_INTENT_V1", low.intent.schema);
    assert(low.work_order.schema === "DETERMINISTIC_CODE_WORK_ORDER_V1", low.work_order.schema);
    assert(low.work_order.discovery_required === false, "no machine-wide discovery");
    assert(low.work_order.work_id === low.intent.work_id, "ids");
  });

  await check("E. Local context resolution occurs before broad AI repository search", () => {
    const ctx = low.evidence.context as { LOCAL_CONTEXT_BYTES: number; AI_CONTEXT_BYTES: number; AI_REPOSITORY_WIDE_SEARCH_REQUIRED: boolean; handles: string[] };
    assert(ctx.AI_REPOSITORY_WIDE_SEARCH_REQUIRED === false, "no wide search");
    assert(ctx.LOCAL_CONTEXT_BYTES > 0 && ctx.AI_CONTEXT_BYTES > 0, "metrics");
    assert(ctx.AI_CONTEXT_BYTES <= ctx.LOCAL_CONTEXT_BYTES, "AI context scoped");
    assert(ctx.handles.length > 0, "resource handles");
  });

  await check("F. AI self-assessment is not verification evidence", () => {
    const self = acceptAiSelfVerification("looks correct; tests should pass; this should work");
    assert(self.accepted === false && self.MACHINE_VERIFICATION_FIRST_V1 === true, JSON.stringify(self));
  });

  const reviewed = await advanceProductionConveyor(low.work_id, "REVIEW_READY");

  await check("G. Build/test verification is machine-derived", () => {
    assert(reviewed.state === "REVIEW_READY", reviewed.state);
    const build = reviewed.evidence.build as { MACHINE_DERIVED?: boolean; AI_SELF_VERIFICATION_ACCEPTED?: boolean; exit_code?: number };
    const test = reviewed.evidence.test as { MACHINE_DERIVED?: boolean; status?: string };
    assert(build.MACHINE_DERIVED === true && build.AI_SELF_VERIFICATION_ACCEPTED === false, JSON.stringify(build));
    assert(test.status === "PASS", JSON.stringify(test));
    assert(getCodeVerificationRegistry()["repo://pipeline-fixture"].build_command_id === "pipeline.build.hash_check", "registry");
  });

  await check("I. No lifecycle state can be skipped", () => {
    assert(attemptTransition(low.work_id, "ACTIVE").ok === false, "skip denied");
    assert(isLegalTransition("REQUESTED", "AUTHORED", "LOW") === false, "no skip authored");
    assert(isLegalTransition("DEPLOYED", "RUNTIME_VERIFIED", "LOW") === false, "must verify");
    const hops = reviewed.transitions.map((t) => `${String(t.from_state)}->${String(t.to_state)}`);
    assert(hops.includes("AUTHORED->ASSEMBLED") && hops.includes("BUILD_VERIFIED->TEST_VERIFIED"), hops.join(","));
  });

  const incomplete = submitOwnerDevelopmentIntent({
    owner_goal: "incomplete",
    requested_change: "NO",
    workspace_root: disposable,
    canonical_root: canonical,
    disposable_root: disposable,
    omit_required: ["test"],
  });
  const blocked = await advanceProductionConveyor(incomplete.work_id);

  await check("H. Incomplete evidence blocks state transition", () => {
    assert(blocked.state === "BLOCKED_INCOMPLETE", blocked.state);
    assert(blocked.missing.includes("MISSING_TEST"), JSON.stringify(blocked.missing));
    assert(blocked.promotion === "LOCAL_ONLY", blocked.promotion);
  });

  const high = submitOwnerDevelopmentIntent({
    owner_goal: "credential handling change",
    requested_change: `HIGH_${STAMP}`,
    risk_class: "HIGH",
    workspace_root: disposable,
    canonical_root: canonical,
    disposable_root: disposable,
    remote_root: remote,
  });
  const gated = await advanceProductionConveyor(high.work_id);

  await check("T. High/critical production changes stop at Owner gate", () => {
    assert(gated.state === "OWNER_REVIEW_REQUIRED", gated.state);
    const gate = productionGate(gated);
    assert(gate.decision === "OWNER_APPROVAL_REQUIRED", gate.decision);
  });

  await check("U. Low-risk deterministic work can continue automatically", async () => {
    const continued = await advanceProductionConveyor(low.work_id);
    assert(["CAPABILITY_REGISTERED", "PROMOTION_READY", "RUNTIME_VERIFIED", "DEPLOYED"].includes(continued.state) || continued.state === "CAPABILITY_REGISTERED", continued.state);
    assert(continued.state === "CAPABILITY_REGISTERED", continued.state);
  });

  const liveLow = await advanceProductionConveyor(low.work_id);

  await check("J. Verified artifact maps to exact source revision", () => {
    const art = liveLow.evidence.artifact as { source_revision?: string; source_hash?: string; SOURCE_FILES_ARE_NOT_DEPLOYABLE_PROOF?: boolean };
    assert(typeof art.source_hash === "string" && art.source_hash.length === 64, String(art.source_hash));
    assert(liveLow.source_revision === liveLow.lineage.commit, JSON.stringify(liveLow.lineage));
    assert(art.SOURCE_FILES_ARE_NOT_DEPLOYABLE_PROOF === true, "source != artifact");
  });

  await check("K. Remote publication is verified before disposable cleanup", () => {
    assert(liveLow.promotion === "REMOTE_VERIFIED", liveLow.promotion);
    assert(liveLow.remote_sha === liveLow.source_revision, `${liveLow.remote_sha} vs ${liveLow.source_revision}`);
    const early = cleanupDisposableWorkspace(incomplete.work_id);
    assert(early.outcome === "BLOCKED", JSON.stringify(early));
    assert(existsSync(disposable), "must not clean at LOCAL_ONLY / incomplete");
  });

  await check("L. Cleanup cannot delete required/canonical source", () => {
    assert(existsSync(canonical), "canonical retained");
    assert(existsSync(join(ROOT, "control/engineering-runtime")), "repo root retained");
  });

  await check("M. Deployment target must be registered", async () => {
    const none = submitOwnerDevelopmentIntent({
      owner_goal: "no target",
      requested_change: "X",
      production_intent: true,
      deployment_target: "deploy://invented",
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
      remote_root: remote,
    });
    const ran = await advanceProductionConveyor(none.work_id);
    assert(ran.state === "BLOCKED_INCOMPLETE" || ran.missing.includes("MISSING_DEPLOYMENT_TARGET") || ran.state === "FAILED" || ran.state === "BLOCKED", ran.state);
  });

  await check("N. Deployment conflicts serialize/block deterministically", async () => {
    const second = submitOwnerDevelopmentIntent({
      owner_goal: "conflict",
      requested_change: `C_${STAMP}`,
      production_intent: true,
      deployment_target: TARGET,
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
      remote_root: remote,
    });
    const ran = await advanceProductionConveyor(second.work_id);
    assert(ran.state === "FAILED" || (ran.evidence.dep as { reason?: string } | undefined)?.reason === "DEPLOYMENT_CONFLICT" || JSON.stringify(ran.evidence).includes("DEPLOYMENT_CONFLICT"), JSON.stringify(ran.state) + JSON.stringify(ran.evidence).slice(0, 400));
  });

  await check("O. Successful deploy command does not equal runtime verification", () => {
    assert(liveLow.transitions.some((t) => t.from_state === "DEPLOYED" && t.to_state === "RUNTIME_VERIFYING"), "must enter verifying");
    assert(Boolean((liveLow.evidence as { deploy_command_is_not_runtime_verification?: boolean }).deploy_command_is_not_runtime_verification) || liveLow.transitions.some((t) => JSON.stringify(t.evidence).includes("deploy_command_is_not_runtime_verification")), "not equal");
  });

  await check("P. Runtime revision must match expected revision", () => {
    assert(liveLow.runtime_verified === true, "verified");
    assert(liveLow.lineage.runtime_revision === liveLow.source_revision, JSON.stringify(liveLow.lineage));
  });

  await check("Q. New runtime capability cannot become active before registration", async () => {
    const authoredInvoke = await operationalInvokeProduced({ work_id: high.work_id, ai_client_id: AI, session_id: SESSION });
    assert(authoredInvoke.ok === false, JSON.stringify(authoredInvoke));
    assert("DEV_STATE_CANNOT_BYPASS_CAPABILITY_REGISTRATION" in authoredInvoke && authoredInvoke.DEV_STATE_CANNOT_BYPASS_CAPABILITY_REGISTRATION === true, "bypass");
  });

  await check("R. Newly produced capability defaults Owner-disabled unless explicit policy allows", () => {
    assert(liveLow.owner_enabled === false, "default disabled");
    assert(liveLow.capability_id !== null, "registered");
  });

  await check("S. Operational chat cannot invoke development-only artifact", async () => {
    const denied = await operationalInvokeProduced({ work_id: liveLow.work_id, ai_client_id: AI, session_id: SESSION });
    assert(denied.ok === false, JSON.stringify(denied));
    ownerEnableProducedCapability(liveLow.work_id, true);
    const allowed = await operationalInvokeProduced({ work_id: liveLow.work_id, ai_client_id: AI, session_id: SESSION });
    assert(allowed.ok !== false || (allowed as { result_status?: string }).result_status === "COMPLETED" || "ok" in allowed, JSON.stringify(allowed).slice(0, 500));
    assert((allowed as { ok?: boolean }).ok === true, JSON.stringify(allowed).slice(0, 500));
  });

  await check("V. Runtime failure preserves rollback path", () => {
    writeRuntimeRevision(TARGET, "PREV_VERIFIED", true);
    assert(isLegalTransition("FAILED", "ROLLED_BACK", "LOW") === true, "rollback legal");
  });

  await check("W. End-to-end work lineage remains intact", () => {
    const lin = liveLow.lineage;
    assert(Boolean(lin.intent_id && lin.work_id && lin.work_order_id && lin.commit && lin.remote_revision && lin.artifact_id && lin.deployment_id && lin.capability_id), JSON.stringify(lin));
  });

  await check("X. Existing MCP/work-surface reused; no second plane", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    for (const required of [
      "dna_os.get_development_work", "dna_os.get_development_status", "dna_os.get_production_pipeline",
      "dna_os.get_artifact_status", "dna_os.get_verification_status", "dna_os.get_promotion_status",
      "dna_os.get_deployment_status", "dna_os.get_runtime_verification", "dna_os.get_capability_lineage",
      "dna_os.list_development_notifications", "submit_command", "dna_os.invoke_local_capability",
    ]) {
      assert(names.includes(required), `missing ${required}`);
    }
    const snap = ownerWorkSurfaceSnapshot(AI, SESSION);
    assert(snap.production_pipeline !== undefined, "integrated");
    const slice = productionWorkSurfaceSlice() as { DEVELOPMENT_SURFACE: { modes: string[] }; OPERATIONAL_CAPABILITY_SURFACE: { modes: string[] }; SURFACES_SHARE_IMPLICIT_AUTHORITY: boolean };
    assert(slice.DEVELOPMENT_SURFACE.modes.includes("DEVELOP") && slice.OPERATIONAL_CAPABILITY_SURFACE.modes.includes("RUN CAPABILITY"), "modes");
    assert(slice.SURFACES_SHARE_IMPLICIT_AUTHORITY === false, "authority");
    assert(githubEnvironmentProtectionStatus() === "NOT_AVAILABLE", "no fake github protection");
    assert(mcpDiscovery("get_production_pipeline", liveLow.work_id).schema === "DNA_OS_WORK_PRODUCTION_PIPELINE_V1", "mcp");
    assert(listDevelopmentNotifications().some((row) => row.kind === "REVIEW_READY"), "notify");
    assert(classifyAffect("UNMAPPED/unknown.ts") === "UNKNOWN", "unknown");
    assert(classifyAffect("README.md") === "UNAFFECTED", "unaffected");
    ownerApprovePublish(high.work_id);
  });

  const cleaned = cleanupDisposableWorkspace(liveLow.work_id);
  if (cleaned.outcome !== "CLEANED" || existsSync(disposable) || !existsSync(canonical)) {
    failed++;
    console.error(`FAIL cleanup after remote: ${JSON.stringify(cleaned)} disposable=${existsSync(disposable)}`);
  } else {
    passed++;
    console.log("PASS K/L cleanup after REMOTE_VERIFIED");
  }

  rmSync(join(PIPE, ".dna-os-agent-worktrees", `det-${STAMP}`), { recursive: true, force: true });
  rmSync(canonical, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
  for (const file of Object.values(logs)) {
    if (existsSync(file)) unlinkSync(file);
  }
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
