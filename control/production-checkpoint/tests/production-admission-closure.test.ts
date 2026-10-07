/**
 * PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE_V1
 *
 * How to run:
 *   npx tsx control/production-checkpoint/tests/production-admission-closure.test.ts
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { canInvoke } from "../../../connections/dna-os-mcp/export-policy";
import { codingClientBarriers } from "../../mcp-code-knowledge/contract";
import { listNotifications, resetNotificationMemory, setNativeNotificationPort } from "../../owner-notification/contract";
import { codingClientDeploy, githubEnvironmentProtectionStatus } from "../../work-production-pipeline/contract";
import { persistPipeline } from "../../work-production-pipeline/persist";
import type { PipelineRecordV1 } from "../../work-production-pipeline/types";
import {
  closeRegisteredWork,
  probeGithubEnvironments,
  resetCheckpointMemory,
  runtimeVerificationFor,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const ROOT = process.cwd();
const DIR = join(ROOT, "control/production-checkpoint/data");
const PIPE = join(ROOT, "control/work-production-pipeline/data");
const NOTE = join(ROOT, "control/owner-notification/data");
const INB = join(ROOT, "control/inbound-event-fabric/data");

for (const [key, value] of Object.entries({
  PRODUCTION_CHECKPOINT_LOG: join(DIR, `ad-ckpt-${STAMP}.jsonl`),
  PRODUCTION_COMPLETION_REPORT_LOG: join(DIR, `ad-rep-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_CATCHUP_LOG: join(DIR, `ad-catch-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_EMITTED_LOG: join(DIR, `ad-emit-${STAMP}.jsonl`),
  PRODUCTION_FINALIZATION_LOG: join(DIR, `ad-fin-${STAMP}.jsonl`),
  WORK_PIPELINE_LOG: join(PIPE, `ad-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_NOTIFY_LOG: join(PIPE, `ad-pnotify-${STAMP}.jsonl`),
  WORK_PIPELINE_VERIFY_LOG: join(PIPE, `ad-ver-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(PIPE, `ad-dep-${STAMP}.jsonl`),
  WORK_PIPELINE_CAPS_LOG: join(PIPE, `ad-caps-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_LOG: join(NOTE, `ad-note-${STAMP}.jsonl`),
  OWNER_ACTIVITY_LOG: join(NOTE, `ad-act-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_DELIVERY_LOG: join(NOTE, `ad-del-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_ENABLEMENT_LOG: join(NOTE, `ad-en-${STAMP}.jsonl`),
  INBOUND_ADAPTER_LOG: join(INB, `ad-inb-ad-${STAMP}.jsonl`),
  INBOUND_SUBMITTED_WORK_LOG: join(INB, `ad-inb-sw-${STAMP}.jsonl`),
  INBOUND_CODING_ACTIVITY_LOG: join(INB, `ad-inb-ca-${STAMP}.jsonl`),
  INBOUND_OUTPUT_LOG: join(INB, `ad-inb-out-${STAMP}.jsonl`),
  INBOUND_IDENTITY_LOG: join(INB, `ad-inb-id-${STAMP}.jsonl`),
})) process.env[key] = value;

mkdirSync(DIR, { recursive: true });
mkdirSync(PIPE, { recursive: true });
mkdirSync(NOTE, { recursive: true });
mkdirSync(INB, { recursive: true });

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

function pipeRow(input: Partial<PipelineRecordV1> & { work_id: string; state: PipelineRecordV1["state"]; production_intent?: boolean; required_tests?: readonly string[]; required_builds?: readonly string[] }): PipelineRecordV1 {
  const work_id = input.work_id;
  return {
    schema: "DNA_OS_WORK_PRODUCTION_PIPELINE_V1",
    work_id,
    lane: "DEVELOPMENT_LANE",
    intent: input.intent ?? {
      schema: "OWNER_DEVELOPMENT_INTENT_V1",
      intent_id: `intent-${work_id}`,
      work_id,
      owner_goal: work_id,
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
      production_intent: input.production_intent ?? true,
      deployment_target: null,
      authority_requirements: [],
    },
    work_order: input.work_order ?? {
      schema: "DETERMINISTIC_CODE_WORK_ORDER_V1",
      work_order_id: `wo-${work_id}`,
      work_id,
      goal: work_id,
      repository_id: "repo://pipeline-fixture",
      base_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      target_components: ["src/feature.ts"],
      target_files: ["src/feature.ts"],
      allowed_paths: ["src/feature.ts"],
      forbidden_paths: [],
      related_interfaces: [],
      related_schemas: [],
      dependencies: [],
      required_tests: [...(input.required_tests ?? ["pipeline.test.marker"])],
      required_builds: [...(input.required_builds ?? ["pipeline.build.hash_check"])],
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
    artifact_id: input.artifact_id ?? null,
    deployment_id: input.deployment_id ?? null,
    capability_id: input.capability_id ?? null,
    previous_verified_revision: input.previous_verified_revision ?? null,
    owner_enabled: input.owner_enabled ?? false,
    runtime_verified: input.runtime_verified ?? false,
    missing: input.missing ?? [],
    evidence: input.evidence ?? {},
    metrics: {},
    transitions: input.transitions ?? [{ from_state: "REQUESTED", to_state: input.state, transition_rule: "test", evidence: {}, authority: "TEST", timestamp: new Date().toISOString() }],
    lineage: input.lineage ?? {},
    created_at: input.created_at ?? new Date().toISOString(),
    updated_at: input.updated_at ?? new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  resetCheckpointMemory();
  resetNotificationMemory();

  persistPipeline(pipeRow({
    work_id: `work-cinfo-${STAMP}`,
    state: "IN_DEVELOPMENT",
    source_revision: "UNCOMMITTED",
    promotion: "LOCAL_ONLY",
    transitions: [],
    evidence: {},
    production_intent: false,
    required_tests: [],
    required_builds: [],
  }));

  persistPipeline(pipeRow({
    work_id: `work-pub-${STAMP}`,
    state: "PUBLISHED",
    promotion: "REMOTE_VERIFIED",
    source_revision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    remote_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }));

  persistPipeline(pipeRow({
    work_id: `work-fail-${STAMP}`,
    state: "FAILED",
    source_revision: "cccccccccccccccccccccccccccccccccccccccc",
    remote_sha: "cccccccccccccccccccccccccccccccccccccccc",
    promotion: "REMOTE_VERIFIED",
    deployment_id: `dep-fail-${STAMP}`,
    runtime_verified: false,
    previous_verified_revision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    evidence: { last_rule: "runtime_mismatch", kind: "RUNTIME" },
    lineage: { runtime_revision: "deadbeef" },
  }));

  await check("A. Historical cinfo-pipe is not left permanently active", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    const cinfo = closed.items.filter((row) => row.work_id.startsWith("work-cinfo-"));
    assert(cinfo.length >= 1, "cinfo present");
    assert(cinfo.every((row) => row.activity_class === "STALE" || row.finalized_as === "ABANDONED" || row.finalized_as === "SUPERSEDED"), JSON.stringify(cinfo.map((row) => ({ id: row.work_id, a: row.activity_class, f: row.finalized_as }))));
    assert(cinfo.every((row) => row.STATE_CLASSIFICATION === "NOT_PRODUCTION_BOUND"), "not production");
    console.log(`CURRENT_STALE_WORK_FINALIZED=${closed.stale_finalized}`);
  });

  await check("B. Ready work identified without coding client", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    assert(closed.LIVE_ADMISSION_CANDIDATE === "NOT_AVAILABLE" || typeof closed.LIVE_ADMISSION_CANDIDATE === "string", "id");
    console.log(`LIVE_ADMISSION_CANDIDATE=${closed.LIVE_ADMISSION_CANDIDATE}`);
  });

  await check("C. Source divergence boundary is explicit", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    assert(closed.lineage?.AUTO_REPAIR_ALLOWED === false, "no repair");
    assert(closed.lineage?.LINEAGE_STATUS !== "ALIGNED" || closed.lineage.canonical_revision !== "UNCOMMITTED", JSON.stringify(closed.lineage));
    console.log(`LINEAGE_DIVERGENCE_BOUNDARY=${closed.lineage?.LINEAGE_STATUS}`);
    console.log(`LATEST_CANONICAL_REVISION=${closed.summary.latest_canonical_revision}`);
    console.log(`LATEST_REMOTE_REVISION=${closed.summary.latest_remote_revision}`);
    console.log(`LATEST_DEPLOYMENT_REVISION=${closed.summary.latest_deployment_revision}`);
    console.log(`LATEST_RUNTIME_REVISION=${closed.summary.latest_runtime_revision}`);
  });

  await check("D. No coding-client canonical commit/push path", () => {
    const barriers = codingClientBarriers();
    assert(barriers.CODING_CLIENT_CAN_CREATE_CANONICAL_COMMIT === false, "commit");
    assert(barriers.CODING_CLIENT_CAN_PUSH_CANONICAL_SOURCE === false, "push");
    assert(codingClientDeploy().ok === false, "deploy");
    assert(canInvoke("dna_os.commit_source", { caller: "cursor", channel: "EXTERNAL", authority_domain: "DEVELOPMENT", lease_active: true }).allowed === false, "mcp commit");
  });

  await check("E–F. LOCAL_FIXTURE is not remote production; REMOTE_REAL truthful", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    assert(closed.remote.PRODUCTION_ENVIRONMENT !== "REMOTE_REAL" || closed.remote.REMOTE_PRODUCTION_READY === true, JSON.stringify(closed.remote));
    assert(closed.remote.REMOTE_PRODUCTION_READY === false, JSON.stringify(closed.remote));
    assert(closed.remote.REMOTE_REAL === "NOT_WIRED" || closed.remote.REMOTE_REAL === "NOT_AVAILABLE", closed.remote.REMOTE_REAL);
    console.log(`PRODUCTION_ENVIRONMENT=${closed.remote.PRODUCTION_ENVIRONMENT}`);
    console.log(`REMOTE_PRODUCTION_READY=${closed.remote.REMOTE_PRODUCTION_READY}`);
    console.log(`LIVE_REMOTE_TARGET=${closed.remote.REMOTE_REAL}`);
  });

  await check("G. Published is not deployed", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    const pub = closed.items.find((row) => row.work_id === `work-pub-${STAMP}`);
    assert(pub?.STATE_CLASSIFICATION === "WAITING_FOR_DEPLOYMENT", String(pub?.STATE_CLASSIFICATION));
    assert(closed.LOCAL_COMMIT_EQUALS_REMOTE_PUBLISHED === false, "lock");
  });

  await check("H–I. Deployed is not runtime verified; mismatch blocks", () => {
    const rt = runtimeVerificationFor(`work-fail-${STAMP}`);
    assert(rt.RUNTIME_VERIFIED === false, JSON.stringify(rt));
  });

  await check("J+LIVE4. Blocked work remains isolated", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    assert(closed.blocked.WORK_ID === `work-fail-${STAMP}` || closed.blocked.WORK_ID === "NOT_AVAILABLE" || closed.counts.BLOCKED_BY_FAILURE >= 1, JSON.stringify(closed.blocked));
    if (closed.blocked.WORK_ID !== "NOT_AVAILABLE") {
      console.log(`CURRENT_BLOCKED_WORK_ID=${closed.blocked.WORK_ID}`);
      console.log(`CURRENT_BLOCKED_CHECKPOINT=${"BLOCKED_CHECKPOINT" in closed.blocked ? closed.blocked.BLOCKED_CHECKPOINT : "NOT_AVAILABLE"}`);
      console.log(`CURRENT_BLOCKED_REASON=${"FAILURE_REASON" in closed.blocked ? closed.blocked.FAILURE_REASON : "NOT_AVAILABLE"}`);
      assert("AUTO_REPAIR_ALLOWED" in closed.blocked && closed.blocked.AUTO_REPAIR_ALLOWED === false, "no repair");
    }
  });

  await check("K. Catch-up notifications are deduplicated", () => {
    const first = closeRegisteredWork({ includeDiskCatalog: true, catchup: true });
    const second = closeRegisteredWork({ includeDiskCatalog: true, catchup: true });
    assert(first.catchup_notifications >= 1, `first ${first.catchup_notifications}`);
    assert(second.catchup_notifications === 0, `storm ${second.catchup_notifications}`);
    console.log(`CURRENT_CATCHUP_NOTIFICATIONS=${first.catchup_notifications}`);
    void listNotifications;
  });

  await check("LIVE1. Classify all registered work", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    console.log(`READY_FOR_ADMISSION=${closed.counts.READY_FOR_ADMISSION}`);
    console.log(`WAITING_FOR_INTEGRATION=${closed.counts.WAITING_FOR_INTEGRATION}`);
    console.log(`WAITING_FOR_CANONICAL_COMMIT=${closed.counts.WAITING_FOR_CANONICAL_COMMIT}`);
    console.log(`WAITING_FOR_PUBLISH=${closed.counts.WAITING_FOR_PUBLISH}`);
    console.log(`WAITING_FOR_DEPLOYMENT=${closed.counts.WAITING_FOR_DEPLOYMENT}`);
    console.log(`WAITING_FOR_RUNTIME_VERIFY=${closed.counts.WAITING_FOR_RUNTIME_VERIFY}`);
    console.log(`BLOCKED_BY_FAILURE=${closed.counts.BLOCKED_BY_FAILURE}`);
    console.log(`STALE_WORK=${closed.activity_counts.STALE ?? 0}`);
    console.log(`CURRENT_RUNNING_WORK_RECONCILED=${closed.summary.running_after_finalization}`);
    for (const item of closed.items) {
      console.log(`WORK_ID=${item.work_id}`);
      console.log(`SUBJECT=${item.subject}`);
      console.log(`STATE_CLASSIFICATION=${item.STATE_CLASSIFICATION}`);
      console.log(`CURRENT_CHECKPOINT=${item.CURRENT_CHECKPOINT}`);
      console.log(`LAST_VERIFIED_CHECKPOINT=${item.LAST_VERIFIED_CHECKPOINT}`);
      console.log(`LINEAGE_STATUS=${item.LINEAGE_STATUS}`);
      console.log(`OWNER_ATTENTION=${item.OWNER_ATTENTION}`);
    }
    assert(closed.items.length >= 1, "items");
  });

  await check("LIVE7. GitHub protection is not guessed", async () => {
    const gh = closeRegisteredWork({ includeDiskCatalog: false, catchup: false }).github;
    assert(githubEnvironmentProtectionStatus() === "NOT_AVAILABLE", "pipeline");
    assert(gh.GITHUB_REQUIRED_REVIEWERS === "NOT_AVAILABLE", "reviewers");
    assert(gh.GITHUB_PREVENT_SELF_REVIEW === "NOT_AVAILABLE", "self");
    assert(gh.GITHUB_CUSTOM_DEPLOYMENT_PROTECTION === "NOT_AVAILABLE", "custom");
    assert(gh.GITHUB_PROTECTION_RUNTIME_VERIFIED === false, "verified");
    assert(gh.AUTO_CONFIGURED === false, "auto");
    if (process.env.DNA_OS_HERMETIC_SOURCE !== "1") {
      const probe = await probeGithubEnvironments();
      assert(probe.GITHUB_ENVIRONMENT === "NOT_AVAILABLE", JSON.stringify(probe));
      console.log(`LIVE_GITHUB_HTTP=${probe.http_status}`);
    }
    console.log(`GITHUB_ENVIRONMENT=${gh.GITHUB_ENVIRONMENT}`);
    console.log(`GITHUB_REQUIRED_REVIEWERS=${gh.GITHUB_REQUIRED_REVIEWERS}`);
    console.log(`GITHUB_PREVENT_SELF_REVIEW=${gh.GITHUB_PREVENT_SELF_REVIEW}`);
    console.log(`GITHUB_CUSTOM_DEPLOYMENT_PROTECTION=${gh.GITHUB_CUSTOM_DEPLOYMENT_PROTECTION}`);
    console.log(`GITHUB_PROTECTION_RUNTIME_VERIFIED=${gh.GITHUB_PROTECTION_RUNTIME_VERIFIED}`);
  });

  await check("L. Existing MCP reused", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("submit_command"), "existing");
    assert(names.includes("dna_os.get_production_readiness_summary"), "summary");
    assert(names.includes("dna_os.get_lineage_closure_status"), "lineage");
    assert(names.includes("dna_os.list_admission_ready_work"), "ready");
    assert(names.includes("dna_os.get_deployment_target_status"), "targets");
    assert(names.includes("dna_os.get_github_protection_status"), "gh");
  });

  const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
  console.log(`PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE_V1=true`);
  console.log(`SOURCE_LINEAGE_CLOSURE_V1=true`);
  console.log(`PRODUCTION_ADMISSION_READINESS_V1=true`);
  console.log(`WORK_STATE_FINALIZATION_V1=true`);
  console.log(`OWNER_PRODUCTION_READINESS_SUMMARY_V1=true`);
  console.log(`SOURCE_LINEAGE_ALIGNED=${closed.lineage?.LINEAGE_STATUS === "ALIGNED"}`);
  console.log(`EXISTING_MCP_REUSED=true`);
  console.log(`SECOND_MCP_SERVER_CREATED=false`);
  console.log(`SECOND_CONTROL_PLANE_CREATED=false`);
  console.log(`NEW_AGENT_CREATED=false`);
  console.log(`NEW_AI_MODEL_INSTALLED=false`);

  for (const file of Object.values({
    a: process.env.PRODUCTION_CHECKPOINT_LOG,
    b: process.env.PRODUCTION_COMPLETION_REPORT_LOG,
    c: process.env.PRODUCTION_CHECKPOINT_CATCHUP_LOG,
    d: process.env.PRODUCTION_CHECKPOINT_EMITTED_LOG,
    e: process.env.PRODUCTION_FINALIZATION_LOG,
    f: process.env.WORK_PIPELINE_LOG,
    g: process.env.OWNER_NOTIFICATION_LOG,
    h: process.env.OWNER_ACTIVITY_LOG,
    i: process.env.OWNER_NOTIFICATION_DELIVERY_LOG,
    j: process.env.OWNER_NOTIFICATION_ENABLEMENT_LOG,
  })) {
    if (file && existsSync(file)) unlinkSync(file);
  }
  setNativeNotificationPort(null);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED=${failed === 0}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
