/**
 * Live proofs AD–AI for DNA_OS_WORK_PRODUCTION_PIPELINE_V1.
 *
 * How to run:
 *   npx tsx control/work-production-pipeline/tests/live-work-production-pipeline.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";
import { initCanonicalFixtureRepo } from "../git-fixture";
import {
  advanceProductionConveyor,
  attachBareRemote,
  cleanupDisposableWorkspace,
  markRuntimeUnhealthyForFixture,
  operationalInvokeProduced,
  ownerEnableProducedCapability,
  prepareDisposableClone,
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
  WORK_PIPELINE_LOG: join(PIPE, `live-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_NOTIFY_LOG: join(PIPE, `live-notify-${STAMP}.jsonl`),
  WORK_PIPELINE_VERIFY_LOG: join(PIPE, `live-ver-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(PIPE, `live-dep-${STAMP}.jsonl`),
  WORK_PIPELINE_CAPS_LOG: join(PIPE, `live-caps-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVENTS_LOG: join(LRA, `live-pipe-events-${STAMP}.jsonl`),
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `live-pipe-grants-${STAMP}.jsonl`),
  RESOURCE_HANDLES_LOG: join(OCR, `live-pipe-handles-${STAMP}.jsonl`),
  WORK_CONTEXT_LOG: join(OCR, `live-pipe-work-${STAMP}.jsonl`),
};
for (const [key, value] of Object.entries(logs)) process.env[key] = value;

const canonical = join(PIPE, `canonical-live-${STAMP}`);
const disposable = join(PIPE, ".dna-os-agent-worktrees", `live-${STAMP}`);
const remote = join(PIPE, `remote-live-${STAMP}.git`);
const runtime = join(PIPE, `runtime-live-${STAMP}`);
const TARGET = "deploy://local/fixture-runtime-live";
const AI = "ai://pipeline-live";
const SESSION = `session-pipe-live-${STAMP}`;

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
  writeRuntimeRevision(TARGET, "PREV_VERIFIED_REV", true);

  const metrics: Record<string, number> = {};

  await check("AD. LIVE_DEVELOPMENT_CONVEYOR — REVIEW_READY without manual test command", async () => {
    const row = submitOwnerDevelopmentIntent({
      owner_goal: "harmless fixture conveyor",
      requested_change: `LIVE_AD_${STAMP}`,
      risk_class: "LOW",
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
    });
    const advanced = await advanceProductionConveyor(row.work_id, "REVIEW_READY");
    assert(advanced.state === "REVIEW_READY", advanced.state);
    assert(advanced.evidence.last_rule === "PRODUCTION_CONVEYOR_V1" || advanced.transitions.some((t) => t.to_state === "REVIEW_READY"), "conveyor");
    Object.assign(metrics, advanced.metrics);
  });

  await check("AE. LIVE_REMOTE_PROMOTION — REMOTE_VERIFIED before CLEANED", async () => {
    const row = submitOwnerDevelopmentIntent({
      owner_goal: "publish fixture",
      requested_change: `LIVE_AE_${STAMP}`,
      risk_class: "LOW",
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
      remote_root: remote,
    });
    const advanced = await advanceProductionConveyor(row.work_id, "PROMOTION_READY");
    assert(advanced.promotion === "REMOTE_VERIFIED", advanced.promotion);
    assert(advanced.remote_sha === advanced.source_revision, `${advanced.remote_sha}`);
    const before = cleanupDisposableWorkspace(row.work_id);
    assert(before.outcome === "CLEANED", JSON.stringify(before));
    assert(!existsSync(disposable), "disposable removed");
    assert(existsSync(canonical), "canonical kept");
    prepareDisposableClone(remote, disposable);
    Object.assign(metrics, advanced.metrics);
  });

  await check("AF. LIVE_DEPLOYMENT — registered fixture target to RUNTIME_VERIFIED", async () => {
    const row = submitOwnerDevelopmentIntent({
      owner_goal: "deploy fixture",
      requested_change: `LIVE_AF_${STAMP}`,
      risk_class: "LOW",
      production_intent: true,
      deployment_target: TARGET,
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
      remote_root: remote,
    });
    const advanced = await advanceProductionConveyor(row.work_id);
    assert(advanced.state === "CAPABILITY_REGISTERED" || advanced.state === "RUNTIME_VERIFIED", advanced.state);
    assert(advanced.runtime_verified === true, "runtime");
    assert(advanced.lineage.runtime_revision === advanced.source_revision, "revision match");
    Object.assign(metrics, advanced.metrics);
  });

  await check("AG. LIVE_CAPABILITY_PRODUCTION — disabled then Owner-enabled invoke", async () => {
    registerDeploymentTarget({
      target_id: `${TARGET}-ag`,
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
      runtime_identity: "fixture-runtime-ag",
      status: "REGISTERED",
      runtime_dir: join(runtime, "ag"),
    });
    const created = submitOwnerDevelopmentIntent({
      owner_goal: "capability fixture",
      requested_change: `LIVE_AG_${STAMP}`,
      production_intent: true,
      deployment_target: `${TARGET}-ag`,
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
      remote_root: remote,
    });
    const advanced = await advanceProductionConveyor(created.work_id);
    assert(advanced.capability_id !== null, "registered");
    assert(advanced.owner_enabled === false, "default false");
    const denied = await operationalInvokeProduced({ work_id: created.work_id, ai_client_id: AI, session_id: SESSION });
    assert(denied.ok === false, JSON.stringify(denied));
    ownerEnableProducedCapability(created.work_id, true);
    const allowed = await operationalInvokeProduced({ work_id: created.work_id, ai_client_id: AI, session_id: SESSION });
    assert((allowed as { ok?: boolean }).ok === true, JSON.stringify(allowed).slice(0, 400));
  });

  await check("AH. LIVE_INCOMPLETE_DATA_BLOCK — BLOCKED_INCOMPLETE no publish/deploy", async () => {
    const created = submitOwnerDevelopmentIntent({
      owner_goal: "incomplete live",
      requested_change: "INCOMPLETE",
      production_intent: true,
      deployment_target: TARGET,
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
      remote_root: remote,
      omit_required: ["test"],
    });
    const advanced = await advanceProductionConveyor(created.work_id);
    assert(advanced.state === "BLOCKED_INCOMPLETE", advanced.state);
    assert(advanced.promotion === "LOCAL_ONLY", advanced.promotion);
    assert(advanced.deployment_id === null, "no deploy");
  });

  await check("AI. LIVE_ROLLBACK — failed health, no activation, previous retained", async () => {
    const created = submitOwnerDevelopmentIntent({
      owner_goal: "rollback fixture",
      requested_change: `LIVE_AI_${STAMP}`,
      production_intent: true,
      deployment_target: `${TARGET}-ai`,
      workspace_root: disposable,
      canonical_root: canonical,
      disposable_root: disposable,
      remote_root: remote,
    });
    registerDeploymentTarget({
      target_id: `${TARGET}-ai`,
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
      runtime_identity: "fixture-runtime-ai",
      status: "REGISTERED",
      runtime_dir: join(runtime, "ai"),
    });
    writeRuntimeRevision(`${TARGET}-ai`, "PREV_VERIFIED_REV", true);
    const deployed = await advanceProductionConveyor(created.work_id, "DEPLOYED");
    assert(deployed.state === "DEPLOYED", deployed.state);
    markRuntimeUnhealthyForFixture(created.work_id);
    const after = await advanceProductionConveyor(created.work_id);
    assert(after.state === "ROLLED_BACK", after.state);
    assert(after.capability_id === null, "no activation");
    const restored = readFileSync(join(runtime, "ai", "revision.txt"), "utf8").trim();
    assert(restored === after.previous_verified_revision, `restored=${restored} prev=${String(after.previous_verified_revision)}`);
    writeFileSync(join(PIPE, `live-metrics-${STAMP}.json`), JSON.stringify({ ...metrics, ...after.metrics }, null, 2));
  });

  console.log("PIPELINE_METRICS", JSON.stringify(metrics));
  rmSync(disposable, { recursive: true, force: true });
  rmSync(canonical, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
  const extra = join(PIPE, `live-metrics-${STAMP}.json`);
  if (existsSync(extra)) unlinkSync(extra);
  for (const file of Object.values(logs)) {
    if (existsSync(file)) unlinkSync(file);
  }
  console.log(`LIVE_DEVELOPMENT_CONVEYOR = ${failed === 0 ? "VERIFIED" : "FAILED"}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
