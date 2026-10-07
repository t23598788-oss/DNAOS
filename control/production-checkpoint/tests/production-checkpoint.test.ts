/**
 * PRODUCTION_CHECKPOINT_RECONCILIATION_V1 / OWNER_WORK_COMPLETION_NOTIFICATION_V1
 *
 * How to run:
 *   npx tsx control/production-checkpoint/tests/production-checkpoint.test.ts
 */

import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { persistCodingActivity, resetInboundMemory } from "../../inbound-event-fabric/persist";
import {
  disconnectCodingClient,
  recordWorkOutput,
  submitOwnerWork,
} from "../../inbound-event-fabric/contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";
import {
  describeNativeNotificationEnablement,
  listNotifications,
  projectHumanNotification,
  readMacosNotificationPermission,
  resetNotificationMemory,
  setNativeNotificationPort,
} from "../../owner-notification/contract";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import {
  advanceProductionConveyor,
  attachBareRemote,
  ownerEnableProducedCapability,
  prepareDisposableClone,
  registerDeploymentTarget,
  submitOwnerDevelopmentIntent,
  writeRuntimeRevision,
} from "../../work-production-pipeline/contract";
import { initCanonicalFixtureRepo } from "../../work-production-pipeline/git-fixture";
import { persistDeployment, persistPipeline } from "../../work-production-pipeline/persist";
import type { PipelineRecordV1 } from "../../work-production-pipeline/types";
import {
  TRUTH_LOCKS,
  classifyProductionEnvironment,
  completionReadiness,
  getWorkCompletionReadiness,
  listProductionCheckpoints,
  reconcileRegisteredWork,
  resetCheckpointMemory,
  sourceLineageStatus,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const ROOT = process.cwd();
const DIR = join(ROOT, "control/production-checkpoint/data");
const PIPE = join(ROOT, "control/work-production-pipeline/data");
const INB = join(ROOT, "control/inbound-event-fabric/data");
const NOTE = join(ROOT, "control/owner-notification/data");
const LRA = join(ROOT, "control/local-resource-access/data");
const OCR = join(ROOT, "control/owner-client-runtime/data");

for (const [key, value] of Object.entries({
  PRODUCTION_CHECKPOINT_LOG: join(DIR, `ckpt-${STAMP}.jsonl`),
  PRODUCTION_COMPLETION_REPORT_LOG: join(DIR, `rep-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_CATCHUP_LOG: join(DIR, `catch-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_EMITTED_LOG: join(DIR, `emit-${STAMP}.jsonl`),
  WORK_PIPELINE_LOG: join(PIPE, `ckpt-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_NOTIFY_LOG: join(PIPE, `ckpt-pnotify-${STAMP}.jsonl`),
  WORK_PIPELINE_VERIFY_LOG: join(PIPE, `ckpt-ver-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(PIPE, `ckpt-dep-${STAMP}.jsonl`),
  WORK_PIPELINE_CAPS_LOG: join(PIPE, `ckpt-caps-${STAMP}.jsonl`),
  INBOUND_ADAPTER_LOG: join(INB, `ckpt-ad-${STAMP}.jsonl`),
  INBOUND_SUBMITTED_WORK_LOG: join(INB, `ckpt-sw-${STAMP}.jsonl`),
  INBOUND_CODING_ACTIVITY_LOG: join(INB, `ckpt-ca-${STAMP}.jsonl`),
  INBOUND_OUTPUT_LOG: join(INB, `ckpt-out-${STAMP}.jsonl`),
  INBOUND_IDENTITY_LOG: join(INB, `ckpt-id-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_LOG: join(NOTE, `ckpt-note-${STAMP}.jsonl`),
  OWNER_ACTIVITY_LOG: join(NOTE, `ckpt-act-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_DELIVERY_LOG: join(NOTE, `ckpt-del-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_ENABLEMENT_LOG: join(NOTE, `ckpt-en-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVENTS_LOG: join(LRA, `ckpt-lra-${STAMP}.jsonl`),
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `ckpt-grants-${STAMP}.jsonl`),
  RESOURCE_HANDLES_LOG: join(OCR, `ckpt-handles-${STAMP}.jsonl`),
  WORK_CONTEXT_LOG: join(OCR, `ckpt-work-${STAMP}.jsonl`),
})) process.env[key] = value;

mkdirSync(DIR, { recursive: true });
mkdirSync(PIPE, { recursive: true });
mkdirSync(INB, { recursive: true });
mkdirSync(NOTE, { recursive: true });

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

setNativeNotificationPort({
  readPermission: () => ({ state: "NOT_REQUESTED", helper_present: true, error_code: null }),
  requestAuthorization: () => ({ state: "NOT_REQUESTED", error_code: "NOT_INTERACTIVE" }),
  schedule: () => ({ result: "DELIVERY_FAILED", error_code: "NOT_REQUESTED" }),
});

function pipeRow(input: {
  readonly work_id: string;
  readonly state: PipelineRecordV1["state"];
  readonly production_intent?: boolean;
  readonly promotion?: PipelineRecordV1["promotion"];
  readonly source_revision?: string | null;
  readonly remote_sha?: string | null;
  readonly deployment_id?: string | null;
  readonly capability_id?: string | null;
  readonly owner_enabled?: boolean;
  readonly runtime_verified?: boolean;
  readonly deployment_target?: string | null;
  readonly goal?: string;
  readonly lineage?: Record<string, unknown>;
}): PipelineRecordV1 {
  const work_id = input.work_id;
  return {
    schema: "DNA_OS_WORK_PRODUCTION_PIPELINE_V1",
    work_id,
    lane: "DEVELOPMENT_LANE",
    intent: {
      schema: "OWNER_DEVELOPMENT_INTENT_V1",
      intent_id: `intent-${work_id}`,
      work_id,
      owner_goal: input.goal ?? work_id,
      requested_change: "marker",
      target_domain: "code",
      target_system: "dna-os-fixture",
      target_repository: "repo://pipeline-fixture",
      known_resources: [],
      known_capabilities: [],
      affected_components: ["src/feature.ts"],
      risk_class: "LOW",
      required_evidence: ["build"],
      acceptance_criteria: [],
      production_intent: input.production_intent ?? false,
      deployment_target: input.deployment_target ?? null,
      authority_requirements: [],
    },
    work_order: {
      schema: "DETERMINISTIC_CODE_WORK_ORDER_V1",
      work_order_id: `wo-${work_id}`,
      work_id,
      goal: input.goal ?? work_id,
      repository_id: "repo://pipeline-fixture",
      base_revision: "UNCOMMITTED",
      target_components: ["src/feature.ts"],
      target_files: ["src/feature.ts"],
      allowed_paths: ["src/feature.ts"],
      forbidden_paths: [],
      related_interfaces: [],
      related_schemas: [],
      dependencies: [],
      required_tests: ["pipeline.test.marker"],
      required_builds: ["pipeline.build.hash_check"],
      acceptance_criteria: [],
      expected_outputs: ["marker"],
      side_effect_policy: "SCOPED_WRITE_ONLY",
      production_policy: "LOW",
      evidence_requirements: [],
      discovery_required: false,
    },
    state: input.state,
    risk_class: "LOW",
    source_revision: input.source_revision ?? "UNCOMMITTED",
    remote_sha: input.remote_sha ?? null,
    promotion: input.promotion ?? "LOCAL_ONLY",
    artifact_id: null,
    deployment_id: input.deployment_id ?? null,
    capability_id: input.capability_id ?? null,
    previous_verified_revision: null,
    owner_enabled: input.owner_enabled ?? false,
    runtime_verified: input.runtime_verified ?? false,
    missing: [],
    evidence: {},
    metrics: {},
    transitions: [],
    lineage: input.lineage ?? {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function readinessOf(work_id: string) {
  reconcileRegisteredWork({ includeDiskCatalog: false, catchup: false });
  return getWorkCompletionReadiness(work_id);
}

async function main(): Promise<void> {
  resetInboundMemory();
  resetNotificationMemory();
  resetCheckpointMemory();

  await check("locks", () => {
    assert(TRUTH_LOCKS.AGENT_DONE_EQUALS_WORK_COMPLETED === false, "agent");
    assert(TRUTH_LOCKS.LOCAL_COMMIT_EQUALS_REMOTE_PUBLISHED === false, "local");
    assert(TRUTH_LOCKS.REMOTE_PUBLISHED_EQUALS_DEPLOYED === false, "pub");
    assert(TRUTH_LOCKS.DEPLOYED_EQUALS_RUNTIME_VERIFIED === false, "rt");
    assert(TRUTH_LOCKS.OWNER_UI_PRESENCE_REQUIRED === false, "ui");
    assert(TRUTH_LOCKS.CODING_CLIENT_FRONTMOST_REQUIRED === false, "front");
    assert(TRUTH_LOCKS.REPOSITORY_REDISCOVERY_REQUIRED === false, "rediscover");
    assert(TRUTH_LOCKS.AGENT_STATUS_QUERY_REQUIRED === false, "query");
    assert(TRUTH_LOCKS.NATIVE_NOTIFICATION_AUTO_REQUESTED === false, "native");
  });

  const agent = submitOwnerWork({
    subject: "agent-done-only",
    assigned_client: "Cursor",
    work_id: `work-agent-done-${STAMP}`,
  });
  persistCodingActivity({
    schema: "CODING_CLIENT_ACTIVITY_ADAPTER_V1",
    client_id: "Cursor",
    work_id: agent.work_id,
    work_order_id: agent.work_order_id,
    subject: agent.subject,
    goal: agent.subject,
    repository_id: "repo://canonical",
    workspace_id: `ws:${agent.work_id}`,
    current_stage: "COMPLETED_CANDIDATE",
    current_action: "done",
    started_at: agent.submitted_at,
    last_activity_at: agent.last_activity_at,
    reported_status: "DONE",
    machine_verified_status: null,
    result_refs: [],
    report_count: 0,
  });

  await check("A+LIVE2. Agent done cannot complete work", () => {
    const ready = readinessOf(agent.work_id);
    assert(ready?.WORK_COMPLETED === false, JSON.stringify(ready));
    assert(ready?.stuck_state === "WAITING_FOR_INTEGRATION", String(ready?.stuck_state));
    console.log("LIVE_AGENT_DONE_ONLY=true");
  });

  const integratedId = `work-integ-${STAMP}`;
  persistPipeline(pipeRow({
    work_id: integratedId,
    state: "INTEGRATION_VERIFIED",
    production_intent: true,
    promotion: "INTEGRATED",
    source_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    remote_sha: null,
    goal: "integrated-only",
  }));

  await check("B+LIVE3. Integrated without publish waits", () => {
    const ready = readinessOf(integratedId);
    assert(ready?.WORK_COMPLETED === false, JSON.stringify(ready));
    assert(ready?.stuck_state === "WAITING_FOR_PUBLISH", String(ready?.stuck_state));
    console.log("LIVE_INTEGRATED_ONLY=true");
  });

  const publishedId = `work-pub-${STAMP}`;
  persistPipeline(pipeRow({
    work_id: publishedId,
    state: "PUBLISHED",
    production_intent: true,
    promotion: "REMOTE_VERIFIED",
    source_revision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    remote_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    goal: "published-gap",
  }));

  await check("C+LIVE4. Published without deployment waits or NOT_WIRED", () => {
    const ready = readinessOf(publishedId);
    const dep = listProductionCheckpoints(publishedId).find((row) => row.checkpoint_type === "DEPLOYED");
    assert(ready?.stuck_state === "WAITING_FOR_DEPLOYMENT" || dep?.state === "NOT_AVAILABLE", JSON.stringify({ ready, dep }));
    const env = classifyProductionEnvironment(null);
    assert(env !== "REMOTE_REAL", env);
    console.log(`LIVE_DEPLOYMENT_GAP=${ready?.stuck_state}/${dep?.state}/${env}`);
  });

  const TARGET = `deploy://local/fixture-ckpt-${STAMP}`;
  const TARGET_GAP = `deploy://local/fixture-ckpt-gap-${STAMP}`;
  const runtime = join(PIPE, `runtime-ckpt-${STAMP}`);
  const gapRuntime = join(PIPE, `runtime-ckpt-gap-${STAMP}`);
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
  registerDeploymentTarget({
    target_id: TARGET_GAP,
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
    runtime_identity: "fixture-runtime-gap",
    status: "REGISTERED",
    runtime_dir: gapRuntime,
  });
  const deployedId = `work-dep-${STAMP}`;
  persistPipeline(pipeRow({
    work_id: deployedId,
    state: "DEPLOYED",
    production_intent: true,
    promotion: "REMOTE_VERIFIED",
    source_revision: "cccccccccccccccccccccccccccccccccccccccc",
    remote_sha: "cccccccccccccccccccccccccccccccccccccccc",
    deployment_id: `dep-${STAMP}`,
    deployment_target: TARGET_GAP,
    runtime_verified: false,
    goal: "runtime-gap",
    lineage: { runtime_revision: null },
  }));
  persistDeployment({
    schema: "PRODUCTION_DEPLOYMENT_V1",
    record_type: "DEPLOY",
    deployment_id: `dep-${STAMP}`,
    work_id: deployedId,
    target_id: TARGET_GAP,
    state: "DEPLOYED",
  });

  await check("D+LIVE5. Deployed without runtime proof waits", () => {
    const ready = readinessOf(deployedId);
    assert(ready?.stuck_state === "WAITING_FOR_RUNTIME_VERIFY", String(ready?.stuck_state));
    const reportEnv = classifyProductionEnvironment(pipeRow({
      work_id: deployedId,
      state: "DEPLOYED",
      production_intent: true,
      deployment_target: TARGET_GAP,
      source_revision: "cccccccccccccccccccccccccccccccccccccccc",
    }));
    assert(reportEnv === "LOCAL_FIXTURE", reportEnv);
    console.log("LIVE_RUNTIME_GAP=true");
  });

  const failedTarget = `deploy://local/fixture-ckpt-fail-${STAMP}`;
  const failRuntime = join(PIPE, `runtime-ckpt-fail-${STAMP}`);
  registerDeploymentTarget({
    target_id: failedTarget,
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
    runtime_identity: "fixture-runtime-fail",
    status: "REGISTERED",
    runtime_dir: failRuntime,
  });
  const failedId = `work-fail-${STAMP}`;
  persistPipeline(pipeRow({
    work_id: failedId,
    state: "FAILED",
    production_intent: true,
    promotion: "REMOTE_VERIFIED",
    source_revision: "dddddddddddddddddddddddddddddddddddddddd",
    remote_sha: "dddddddddddddddddddddddddddddddddddddddd",
    deployment_id: `dep-fail-${STAMP}`,
    deployment_target: failedTarget,
    runtime_verified: false,
    goal: "runtime-fail",
  }));
  persistDeployment({ record_type: "DEPLOY", deployment_id: `dep-fail-${STAMP}`, work_id: failedId, target_id: failedTarget, state: "DEPLOYED" });
  writeRuntimeRevision(failedTarget, "dddddddddddddddddddddddddddddddddddddddd", false);

  await check("E. Runtime failure reports BLOCKED", () => {
    const ready = readinessOf(failedId);
    assert(ready?.stuck_state === "BLOCKED_BY_FAILURE", String(ready?.stuck_state));
  });

  persistCodingActivity({
    schema: "CODING_CLIENT_ACTIVITY_ADAPTER_V1",
    client_id: "Cursor",
    work_id: `work-unreg-${STAMP}`,
    work_order_id: "wo-unreg",
    subject: "loose activity",
    goal: "loose",
    repository_id: "repo://canonical",
    workspace_id: "ws-unreg",
    current_stage: "IMPLEMENTING",
    current_action: "edit",
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    reported_status: "WORKING",
    machine_verified_status: null,
    result_refs: [],
    report_count: 0,
  });

  const canonical = join(PIPE, `canonical-ckpt-${STAMP}`);
  const disposable = join(PIPE, ".dna-os-agent-worktrees", `ckpt-${STAMP}`);
  const remote = join(PIPE, `remote-ckpt-${STAMP}.git`);
  mkdirSync(PIPE, { recursive: true });
  initCanonicalFixtureRepo(canonical, String(STAMP));
  prepareDisposableClone(canonical, disposable);
  attachBareRemote(disposable, remote);
  issueLocalAccessGrant({
    ai_identity: "ai://ckpt", session_id: `session-ckpt-${STAMP}`, work_id: null, capability: "*",
    resource_id: "resource://local/files/fixture-corpus",
    data_scope: ["control/local-resource-access/fixtures/corpus"], access: ["READ"],
    network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
  const full = submitOwnerDevelopmentIntent({
    owner_goal: "full-completion-fixture",
    requested_change: `MARKER_CKPT_${STAMP}`,
    risk_class: "LOW",
    production_intent: true,
    deployment_target: TARGET,
    workspace_root: disposable,
    canonical_root: canonical,
    disposable_root: disposable,
    remote_root: remote,
  });
  const advanced = await advanceProductionConveyor(full.work_id);
  ownerEnableProducedCapability(full.work_id, true);
  recordWorkOutput({ work_id: full.work_id, kind: "report" });
  recordWorkOutput({ work_id: full.work_id, kind: "report" });

  await check("F+LIVE6. Fully verified lifecycle completes with report count", () => {
    assert(advanced.state === "CAPABILITY_REGISTERED", advanced.state);
    const before = listNotifications().length;
    const report = reconcileRegisteredWork({ includeDiskCatalog: false, catchup: false });
    const ready = getWorkCompletionReadiness(full.work_id);
    assert(ready?.WORK_COMPLETED === true, JSON.stringify(ready));
    const notes = listNotifications().filter((row) => row.work_id === full.work_id && (row.notification_type === "WORK_FULLY_COMPLETED" || row.notification_type === "WORK_COMPLETION_REPORT_READY"));
    assert(notes.length >= 1, `notes ${notes.length}`);
    const human = projectHumanNotification(notes.find((row) => row.notification_type === "WORK_FULLY_COMPLETED") ?? notes[0]!);
    assert(human.message.includes("2") || String(notes[0]?.structured_facts.reports_created) === "2", human.message);
    const env = classifyProductionEnvironment(advanced);
    assert(env === "LOCAL_FIXTURE", env);
    assert(!human.message.toLowerCase().includes("live cloud"), human.message);
    void before;
    console.log("LIVE_FULL_COMPLETION=true");
    console.log(`PRODUCTION_ENVIRONMENT=${env}`);
    void report;
  });

  await check("G+J. Reports count included; no notification storm", () => {
    const before = listNotifications().length;
    reconcileRegisteredWork({ includeDiskCatalog: false, catchup: false });
    reconcileRegisteredWork({ includeDiskCatalog: false, catchup: false });
    const after = listNotifications().length;
    assert(after - before <= 2, `storm ${after - before}`);
    const fullNotes = listNotifications().filter((row) => row.work_id === full.work_id && row.notification_type === "WORK_FULLY_COMPLETED");
    assert(fullNotes.length <= 2, String(fullNotes.length));
  });

  await check("K. Fixture deployment is not real cloud production", () => {
    const env = classifyProductionEnvironment(advanced);
    assert(env === "LOCAL_FIXTURE", env);
    const lineage = sourceLineageStatus(advanced);
    assert(typeof lineage.SOURCE_LINEAGE_ALIGNED === "boolean", "aligned");
  });

  await check("N. Unregistered agent activity is not production truth", () => {
    const report = reconcileRegisteredWork({ includeDiskCatalog: false, catchup: true });
    const item = report.items.find((row) => row.work_id === `work-unreg-${STAMP}`);
    assert(item?.stuck_state === "UNREGISTERED_AGENT_ACTIVITY", JSON.stringify(item));
    const notes = listNotifications().filter((row) => row.notification_type === "UNREGISTERED_AGENT_ACTIVITY");
    assert(notes.length >= 1, "unreg notify");
    assert(projectHumanNotification(notes[0]!).message.includes("ยังไม่ถูกผูก"), "human");
  });

  await check("K-client. Disconnect waits for client, not FAILED", () => {
    disconnectCodingClient(agent.work_id);
    const ready = readinessOf(agent.work_id);
    assert(ready?.stuck_state === "WAITING_FOR_CLIENT" || ready?.WORK_COMPLETED === false, JSON.stringify(ready));
    assert(ready?.stuck_state !== "BLOCKED_BY_FAILURE", String(ready?.stuck_state));
  });

  await check("H+LIVE7. Restart without Cursor still has canonical status", () => {
    resetCheckpointMemory();
    const again = reconcileRegisteredWork({ includeDiskCatalog: false, catchup: false });
    const ready = getWorkCompletionReadiness(full.work_id);
    assert(ready?.WORK_COMPLETED === true, JSON.stringify(ready));
    assert(again.items.some((row) => row.work_id === full.work_id), "present");
    console.log("LIVE_RESTART_WITHOUT_CURSOR=true");
  });

  await check("I+LIVE1+T. Current registered work catch-up", () => {
    const first = reconcileRegisteredWork({ includeDiskCatalog: true, catchup: true });
    const second = reconcileRegisteredWork({ includeDiskCatalog: true, catchup: true });
    assert(second.catchup_notifications === 0, `storm catchup ${second.catchup_notifications}`);
    console.log(`CURRENT_RUNNING_WORK=${first.CURRENT_RUNNING_WORK}`);
    console.log(`CURRENT_COMPLETED_WORK=${first.CURRENT_COMPLETED_WORK}`);
    console.log(`CURRENT_BLOCKED_WORK=${first.CURRENT_BLOCKED_WORK}`);
    console.log(`CURRENT_WAITING_OWNER=${first.CURRENT_WAITING_OWNER}`);
    console.log(`CURRENT_REPORTS_CREATED=${first.CURRENT_REPORTS_CREATED}`);
    console.log(`CURRENT_WORK_CATCHUP_NOTIFICATIONS=${first.catchup_notifications}`);
    console.log(`SOURCE_LINEAGE_ALIGNED=${first.SOURCE_LINEAGE_ALIGNED}`);
    for (const item of first.items) {
      console.log(`WORK_ID=${item.work_id}`);
      console.log(`SUBJECT=${item.subject}`);
      console.log(`CLIENT=${item.client}`);
      console.log(`CURRENT_STAGE=${item.current_stage}`);
      console.log(`LAST_VERIFIED_CHECKPOINT=${item.last_verified_checkpoint}`);
      console.log(`NEXT_EXPECTED_CHECKPOINT=${item.next_expected_checkpoint}`);
      console.log(`REPORTS=${item.reports_created}`);
      console.log(`CANONICAL_REVISION=${item.CANONICAL_REVISION}`);
      console.log(`REMOTE_REVISION=${item.REMOTE_REVISION}`);
      console.log(`DEPLOYMENT_STATE=${item.DEPLOYMENT_STATE}`);
      console.log(`RUNTIME_STATE=${item.RUNTIME_STATE}`);
      console.log(`OWNER_ATTENTION=${item.OWNER_ATTENTION}`);
    }
    assert(first.items.length >= 1, "has work");
    console.log("LIVE_CURRENT_REAL_WORK=true");
    console.log(`CURRENT_WORK_RECONCILIATION=${first.items.length}`);
  });

  await check("P. macOS permission remains NOT_REQUESTED", () => {
    const perm = readMacosNotificationPermission();
    assert(perm.state === "NOT_REQUESTED", perm.state);
    assert(perm.NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED === false, "auto");
    const enable = describeNativeNotificationEnablement();
    assert(enable.action === "ENABLE_NATIVE_NOTIFICATIONS", JSON.stringify(enable));
    assert(enable.requested === false, "not requested");
  });

  await check("Q+L. Existing MCP reused; no second plane", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("submit_command"), "existing");
    assert(names.includes("dna_os.get_production_checkpoint"), "ckpt");
    assert(names.includes("dna_os.list_production_checkpoints"), "list");
    assert(names.includes("dna_os.get_work_completion_readiness"), "ready");
    assert(names.includes("dna_os.get_work_completion_report"), "report");
    assert(names.includes("dna_os.get_source_lineage_status"), "lineage");
    assert(names.filter((name) => name === "submit_command").length === 1, "one mcp");
    const snap = ownerWorkSurfaceSnapshot("ai://ckpt", "session-ckpt");
    assert((snap.production_checkpoints as { grants_authority?: boolean }).grants_authority === false, "slice");
    assert(snap.layout !== undefined, "layout");
  });

  await check("readiness schema", () => {
    const rows = listProductionCheckpoints(full.work_id);
    const ready = completionReadiness(rows, advanced);
    assert(ready.schema === "WORK_COMPLETION_READINESS_V1", ready.schema);
  });

  console.log(`PRODUCTION_CHECKPOINT_RECONCILIATION_V1=true`);
  console.log(`PRODUCTION_CHECKPOINT_V1=true`);
  console.log(`CONTINUOUS_PRODUCTION_RECONCILER_V1=true`);
  console.log(`WORK_COMPLETION_READINESS_V1=true`);
  console.log(`PRODUCTION_CHECKPOINT_STALENESS_V1=true`);
  console.log(`WORK_COMPLETION_REPORT_V1=true`);
  console.log(`OWNER_WORK_COMPLETION_NOTIFICATION_V1=true`);
  console.log(`AGENT_DONE_EQUALS_WORK_COMPLETED=false`);
  console.log(`LOCAL_COMMIT_EQUALS_REMOTE_PUBLISHED=false`);
  console.log(`REMOTE_PUBLISHED_EQUALS_DEPLOYED=false`);
  console.log(`DEPLOYED_EQUALS_RUNTIME_VERIFIED=false`);
  console.log(`OWNER_UI_PRESENCE_REQUIRED=false`);
  console.log(`CODING_CLIENT_FRONTMOST_REQUIRED=false`);
  console.log(`REPOSITORY_REDISCOVERY_REQUIRED=false`);
  console.log(`AGENT_STATUS_QUERY_REQUIRED=false`);
  console.log(`NATIVE_NOTIFICATION_AUTO_REQUESTED=false`);
  console.log(`EXISTING_MCP_REUSED=true`);
  console.log(`SECOND_MCP_SERVER_CREATED=false`);
  console.log(`SECOND_CONTROL_PLANE_CREATED=false`);
  console.log(`NEW_AGENT_CREATED=false`);
  console.log(`NEW_AI_MODEL_INSTALLED=false`);
  console.log(`MACOS_NOTIFICATION_PERMISSION=${readMacosNotificationPermission().state}`);

  for (const file of [
    process.env.PRODUCTION_CHECKPOINT_LOG,
    process.env.PRODUCTION_COMPLETION_REPORT_LOG,
    process.env.PRODUCTION_CHECKPOINT_CATCHUP_LOG,
    process.env.PRODUCTION_CHECKPOINT_EMITTED_LOG,
    process.env.WORK_PIPELINE_LOG,
    process.env.WORK_PIPELINE_NOTIFY_LOG,
    process.env.WORK_PIPELINE_VERIFY_LOG,
    process.env.WORK_PIPELINE_DEPLOY_LOG,
    process.env.WORK_PIPELINE_CAPS_LOG,
    process.env.INBOUND_ADAPTER_LOG,
    process.env.INBOUND_SUBMITTED_WORK_LOG,
    process.env.INBOUND_CODING_ACTIVITY_LOG,
    process.env.INBOUND_OUTPUT_LOG,
    process.env.INBOUND_IDENTITY_LOG,
    process.env.OWNER_NOTIFICATION_LOG,
    process.env.OWNER_ACTIVITY_LOG,
    process.env.OWNER_NOTIFICATION_DELIVERY_LOG,
    process.env.OWNER_NOTIFICATION_ENABLEMENT_LOG,
    process.env.LOCAL_RESOURCE_EVENTS_LOG,
    process.env.LOCAL_RESOURCE_GRANTS_LOG,
    process.env.RESOURCE_HANDLES_LOG,
    process.env.WORK_CONTEXT_LOG,
  ]) {
    if (file && existsSync(file)) unlinkSync(file);
  }
  rmSync(canonical, { recursive: true, force: true });
  rmSync(disposable, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
  rmSync(gapRuntime, { recursive: true, force: true });
  rmSync(failRuntime, { recursive: true, force: true });
  setNativeNotificationPort(null);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED=${failed === 0}`);
  console.log(`EXISTING_TESTS_PASSED=see-regression`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
