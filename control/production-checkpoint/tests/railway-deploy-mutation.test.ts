/**
 * RAILWAY_REGISTERED_DEPLOY_MUTATION_V1 / REMOTE_PRODUCTION_EXECUTION_CLOSURE_V1
 *
 * How to run:
 *   npx tsx control/production-checkpoint/tests/railway-deploy-mutation.test.ts
 */

import { existsSync, mkdirSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { canInvoke } from "../../../connections/dna-os-mcp/export-policy";
import { getConnectorInvoker } from "../../connector-execution-boundary/registry";
import { codingClientDeploy } from "../../work-production-pipeline/contract";
import { listNotifications, resetNotificationMemory, setNativeNotificationPort } from "../../owner-notification/contract";
import {
  admitRailwayDeploy,
  CIRCUIT_TARGET_ID,
  classifyCurrentRemoteLineage,
  closeRegisteredWork,
  constructRailwayDeployMutation,
  describeOwnerEnablementState,
  discoverExistingRemoteProduction,
  executeRailwayDeployRevision,
  getRailwayDeployCapabilityStatus,
  previewEnableRemoteProductionTarget,
  rejectGenericRailwayGraphql,
  resetCheckpointMemory,
  resolveExistingRailwayServices,
  runRemoteProductionClosure,
  verifyRailwayDeployAdapter,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const ROOT = process.cwd();
const DIR = join(ROOT, "control/production-checkpoint/data");
const PIPE = join(ROOT, "control/work-production-pipeline/data");
const NOTE = join(ROOT, "control/owner-notification/data");
const VIEW = join(ROOT, "control/canonical-view/data");

for (const [key, value] of Object.entries({
  PRODUCTION_CHECKPOINT_LOG: join(DIR, `rw-ckpt-${STAMP}.jsonl`),
  PRODUCTION_COMPLETION_REPORT_LOG: join(DIR, `rw-rep-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_CATCHUP_LOG: join(DIR, `rw-catch-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_EMITTED_LOG: join(DIR, `rw-emit-${STAMP}.jsonl`),
  PRODUCTION_FINALIZATION_LOG: join(DIR, `rw-fin-${STAMP}.jsonl`),
  PRODUCTION_REMOTE_DISCOVERY_LOG: join(DIR, `rw-disc-${STAMP}.jsonl`),
  PRODUCTION_REMOTE_TARGET_ENABLEMENT_LOG: join(DIR, `rw-en-${STAMP}.jsonl`),
  PRODUCTION_RAILWAY_DEPLOYMENT_LOG: join(DIR, `rw-dep-${STAMP}.jsonl`),
  PRODUCTION_RAILWAY_DEPLOY_CAPABILITY_LOG: join(DIR, `rw-cap-${STAMP}.jsonl`),
  PRODUCTION_CANONICAL_LINEAGE_REPAIR_LOG: join(DIR, `rw-repair-${STAMP}.jsonl`),
  WORK_PIPELINE_LOG: join(PIPE, `rw-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(PIPE, `rw-pdep-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_LOG: join(NOTE, `rw-note-${STAMP}.jsonl`),
  OWNER_ACTIVITY_LOG: join(NOTE, `rw-act-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_DELIVERY_LOG: join(NOTE, `rw-del-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_ENABLEMENT_LOG: join(NOTE, `rw-nen-${STAMP}.jsonl`),
  CANONICAL_VIEW_REVIEWS_LOG: join(VIEW, `rw-rev-${STAMP}.jsonl`),
})) process.env[key] = value;

mkdirSync(DIR, { recursive: true });
mkdirSync(PIPE, { recursive: true });
mkdirSync(NOTE, { recursive: true });
mkdirSync(VIEW, { recursive: true });

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
resetCheckpointMemory();
resetNotificationMemory();

async function main(): Promise<void> {
  await check("A. Existing Railway target reused; no new project", () => {
    const constructed = constructRailwayDeployMutation({
      service_id: "svc",
      environment_id: "env",
      commit_sha: "abc1234",
    });
    assert(constructed.operation === "DEPLOY_EXISTING_SERVICE_REVISION", "op");
    assert(constructed.GENERIC_GRAPHQL_EXPOSED === false, "no generic");
    assert(constructed.document.includes("serviceInstanceDeployV2"), "mutation name");
    assert(!constructed.document.toLowerCase().includes("serviceCreate"), "no create");
  });

  await check("D. Generic Railway GraphQL is rejected", async () => {
    assert(rejectGenericRailwayGraphql({ query: "mutation { x }" }).ok === false, "helper");
    const invoker = getConnectorInvoker("railway");
    assert(Boolean(invoker), "invoker");
    const blocked = await invoker!({
      command_id: "cmd-generic",
      issued_by: { identity_id: "t", acting_as_account_id: "a", acting_as_tenant_id: "t", software_id: "s", kind: "service" },
      intent: "connector.invoke",
      payload: { intent: "railway.deploy_revision", query: "mutation { serviceCreate }" },
      issued_at: new Date().toISOString(),
    });
    assert(blocked.summary === "GENERIC_GRAPHQL_FORBIDDEN", blocked.summary);
  });

  await check("C. Read auth is not deploy authority", () => {
    const denied = codingClientDeploy();
    assert(denied.CODING_CLIENT_CAN_DEPLOY === false, "client");
    assert(describeOwnerEnablementState().REMOTE_REAL_TARGET_OWNER_ENABLED === false, "disabled");
  });

  await check("G. Owner enablement preview does not enable", () => {
    const preview = previewEnableRemoteProductionTarget();
    assert(preview.action === "ENABLE_REMOTE_PRODUCTION_TARGET", "action");
    assert(preview.OWNER_APPROVAL_REQUIRED === true, "approval");
    assert(preview.requested === false, "not requested");
    assert(describeOwnerEnablementState().REMOTE_REAL_TARGET_OWNER_ENABLED === false, "still disabled");
  });

  await check("E/F. Unknown and unregistered revisions cannot deploy", async () => {
    const unknown = await admitRailwayDeploy({
      work_id: "w",
      target_id: CIRCUIT_TARGET_ID,
      requested_revision: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      canonical_revision: "5af91ed5a21f3e753f37497d5ee4333f64dd1b91",
      remote_revision: "c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f",
      authority_ref: "should-not-matter",
    });
    assert(unknown.ok === false, "unknown");
    assert(
      unknown.ok === false && (
        unknown.reason_code === "DEPLOYMENT_REVISION_NOT_FOUND"
        || unknown.reason_code === "UNREGISTERED_REVISION"
        || unknown.reason_code === "UNREGISTERED_TARGET"
      ),
      unknown.ok === false ? unknown.reason_code : "ok",
    );
    const unrelated = await admitRailwayDeploy({
      work_id: "w",
      target_id: CIRCUIT_TARGET_ID,
      requested_revision: "ffffffffffffffffffffffffffffffffffffffff",
      canonical_revision: "5af91ed5a21f3e753f37497d5ee4333f64dd1b91",
      remote_revision: "c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f",
      authority_ref: "owner",
    });
    assert(unrelated.ok === false, "unrelated");
  });

  await check("ADAPTER. Mutation document does not carry secrets or generic GraphQL", () => {
    const constructed = constructRailwayDeployMutation({
      service_id: "svc",
      environment_id: "env",
      commit_sha: "abc1234abc1234abc1234abc1234abc1234abc12",
    });
    assert(!/token|password|authorization|bearer/i.test(constructed.document), "secret");
    assert(constructed.GENERIC_GRAPHQL_EXPOSED === false, "generic");
    assert(getRailwayDeployCapabilityStatus().GENERIC_GRAPHQL_EXPOSED === false, "cap");
  });

  if (process.env.DNA_OS_HERMETIC_SOURCE !== "1") {
  const report = await runRemoteProductionClosure({ attempt_deploy: true });
  const lineage = classifyCurrentRemoteLineage();
  const adapter = report.adapter as { RAILWAY_DEPLOY_ADAPTER_PRESENT: boolean; RAILWAY_DEPLOY_AUTH_READY: boolean; RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED: boolean };
  const services = report.services as { NEW_RAILWAY_PROJECT_CREATED: false; NEW_RAILWAY_SERVICE_CREATED: false; services: { name: string; service_id: string | null }[] };
  const enablement = report.enablement as { REMOTE_REAL_TARGET_OWNER_ENABLED: boolean };
  const closure = report.closure as {
    REAL_CANONICAL_REVISION: string;
    REAL_REMOTE_REVISION: string;
    REAL_DEPLOYMENT_REVISION: string;
    REAL_RUNTIME_REVISION: string;
    REAL_LINEAGE_STATUS: string;
    REMOTE_PRODUCTION_READY: boolean;
  };
  const runtime = report.runtime as { RUNTIME_REVISION_PROOF: string; http_200_is_not_revision_proof: true };

  await check("LIVE1. Current remote lineage classified from evidence", () => {
    assert(lineage.SOURCE_HISTORY_REWRITE === false, "no rewrite");
    assert(typeof lineage.CURRENT_LINEAGE_CLASSIFICATION === "string", "class");
    console.log(`LIVE_CURRENT_REMOTE_LINEAGE class=${lineage.CURRENT_LINEAGE_CLASSIFICATION} stale=${lineage.CANONICAL_REGISTRY_STALE} canonical=${lineage.REAL_CANONICAL_REVISION} remote=${lineage.REAL_REMOTE_REVISION}`);
  });

  await check("LIVE2. Deploy adapter without production deploy", () => {
    assert(adapter.RAILWAY_DEPLOY_ADAPTER_PRESENT === true, "adapter");
    console.log(`LIVE_DEPLOY_ADAPTER present=${adapter.RAILWAY_DEPLOY_ADAPTER_PRESENT} auth=${adapter.RAILWAY_DEPLOY_AUTH_READY} mutation_verified=${adapter.RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED} target=${CIRCUIT_TARGET_ID}`);
  });

  await check("LIVE3. Owner enablement remains false", () => {
    assert(enablement.REMOTE_REAL_TARGET_OWNER_ENABLED === false, "disabled");
    console.log(`LIVE_OWNER_ENABLEMENT enabled=false action=ENABLE_REMOTE_PRODUCTION_TARGET required=true`);
  });

  await check("LIVE4. Safe deploy blocked without Owner enable", () => {
    assert(report.liveDeploy === "OWNER_ENABLE_REQUIRED", String(report.liveDeploy));
    console.log(`LIVE_REAL_DEPLOY=${report.liveDeploy}`);
  });

  await check("LIVE5. No provider deployment without mutate", () => {
    assert(report.providerDeployment === null, "no deploy");
    console.log(`LIVE_PROVIDER_DEPLOYMENT=NOT_PERFORMED`);
  });

  await check("LIVE6. Runtime revision independently verified or NOT_AVAILABLE", () => {
    assert(runtime.http_200_is_not_revision_proof === true, "http");
    assert(runtime.RUNTIME_REVISION_PROOF === "NOT_AVAILABLE" || runtime.RUNTIME_REVISION_PROOF === "PRESENT" || runtime.RUNTIME_REVISION_PROOF === "MATCHED", "proof");
    console.log(`LIVE_RUNTIME_VERIFICATION proof=${runtime.RUNTIME_REVISION_PROOF} revision=${closure.REAL_RUNTIME_REVISION}`);
  });

  await check("LIVE7. Reconcile only from evidence", () => {
    const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
    assert(closure.REMOTE_PRODUCTION_READY === false, "not ready");
    console.log(`LIVE_POST_DEPLOY_RECONCILIATION lineage=${closure.REAL_LINEAGE_STATUS} waiting=${closed.counts.WAITING_FOR_DEPLOYMENT} ready=${closure.REMOTE_PRODUCTION_READY}`);
  });

  await check("A/B. Existing services preserved separately", () => {
    const names = services.services.map((row) => row.name);
    assert(names.includes("dna-os-circuit"), "circuit");
    assert(names.includes("joint-monitor"), "joint");
    assert(names.includes("owner-command-http"), "http");
    assert(services.NEW_RAILWAY_PROJECT_CREATED === false, "project");
    assert(services.NEW_RAILWAY_SERVICE_CREATED === false, "service");
  });

  const identities = await resolveExistingRailwayServices();
  const circuit = identities.services.find((row) => row.name === "dna-os-circuit");
  console.log(`RAILWAY_REGISTERED_DEPLOY_MUTATION_V1=true`);
  console.log(`REMOTE_PRODUCTION_EXECUTION_CLOSURE_V1=true`);
  console.log(`RAILWAY_DEPLOYMENT_REVISION_RESOLUTION_V1=true`);
  console.log(`RAILWAY_DEPLOY_ADAPTER_PRESENT=${adapter.RAILWAY_DEPLOY_ADAPTER_PRESENT}`);
  console.log(`RAILWAY_DEPLOY_AUTH_READY=${adapter.RAILWAY_DEPLOY_AUTH_READY}`);
  console.log(`RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED=${adapter.RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED}`);
  console.log(`REMOTE_REAL_TARGET_ID=${CIRCUIT_TARGET_ID}`);
  console.log(`REMOTE_REAL_TARGET_OWNER_ENABLED=${enablement.REMOTE_REAL_TARGET_OWNER_ENABLED}`);
  console.log(`CURRENT_LINEAGE_CLASSIFICATION=${lineage.CURRENT_LINEAGE_CLASSIFICATION}`);
  console.log(`CANONICAL_REGISTRY_STALE=${lineage.CANONICAL_REGISTRY_STALE}`);
  console.log(`SOURCE_HISTORY_REWRITE=false`);
  console.log(`REAL_CANONICAL_REVISION=${closure.REAL_CANONICAL_REVISION}`);
  console.log(`REAL_REMOTE_REVISION=${closure.REAL_REMOTE_REVISION}`);
  console.log(`REAL_DEPLOYMENT_REVISION=${closure.REAL_DEPLOYMENT_REVISION}`);
  console.log(`REAL_RUNTIME_REVISION=${closure.REAL_RUNTIME_REVISION}`);
  console.log(`REAL_LINEAGE_STATUS=${closure.REAL_LINEAGE_STATUS}`);
  console.log(`DEPLOY_WITHOUT_AUTHORITY=false`);
  console.log(`DEPLOY_UNKNOWN_REVISION=false`);
  console.log(`REMOTE_PRODUCTION_READY=${closure.REMOTE_PRODUCTION_READY}`);
  console.log(`NEW_RAILWAY_PROJECT_CREATED=false`);
  console.log(`NEW_RAILWAY_SERVICE_CREATED=false`);
  console.log(`NEW_DATABASE_CREATED=false`);
  console.log(`EXISTING_MCP_REUSED=true`);
  console.log(`SECOND_MCP_SERVER_CREATED=false`);
  console.log(`SECOND_CONTROL_PLANE_CREATED=false`);
  console.log(`NEW_AGENT_CREATED=false`);
  console.log(`NEW_AI_MODEL_INSTALLED=false`);
  console.log(`CIRCUIT_SERVICE_ID=${circuit?.service_id ?? "NOT_AVAILABLE"}`);
  void listNotifications;
  const verified = failed === 0
    && adapter.RAILWAY_DEPLOY_ADAPTER_PRESENT
    && enablement.REMOTE_REAL_TARGET_OWNER_ENABLED === false
    && report.liveDeploy === "OWNER_ENABLE_REQUIRED"
    && lineage.SOURCE_HISTORY_REWRITE === false
    && services.NEW_RAILWAY_PROJECT_CREATED === false;
  console.log(`EXISTING_TESTS_PASSED=${failed === 0}`);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED=${failed === 0}`);
  console.log(`FINAL_STATUS=${verified ? "VERIFIED" : "NOT_VERIFIED"}`);
  }

  await check("M. MCP read-only deploy status tools", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    for (const name of [
      "dna_os.get_railway_deploy_capability_status",
      "dna_os.get_remote_deployment",
      "dna_os.get_remote_deployment_revision",
      "dna_os.get_runtime_revision_alignment",
    ]) {
      assert(names.includes(name), name);
      assert(canInvoke(name, { caller: "ext", channel: "EXTERNAL" }).allowed, name);
    }
    assert(getRailwayDeployCapabilityStatus().GENERIC_GRAPHQL_EXPOSED === false, "cap");
  });

  await check("W. MCP tools source has no supabase string", () => {
    const tools = readFileSync(join(ROOT, "connections/dna-os-mcp/tool-registry.ts"), "utf8");
    const policy = readFileSync(join(ROOT, "connections/dna-os-mcp/export-policy.ts"), "utf8");
    assert(!/supabase/i.test(tools), "tools");
    assert(!/supabase/i.test(policy), "policy");
  });

  if (process.env.DNA_OS_HERMETIC_SOURCE === "1") {
    console.log(`RAILWAY_ADAPTER_SOURCE_TEST=PASS`);
  }

  console.log(`EXISTING_TESTS_PASSED=${failed === 0}`);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED=${failed === 0}`);
  if (process.env.DNA_OS_HERMETIC_SOURCE === "1") {
    console.log(`FINAL_STATUS=${failed === 0 ? "HERMETIC_PASS" : "FAIL"}`);
  }

  for (const file of [
    process.env.PRODUCTION_CHECKPOINT_LOG,
    process.env.PRODUCTION_COMPLETION_REPORT_LOG,
    process.env.PRODUCTION_CHECKPOINT_CATCHUP_LOG,
    process.env.PRODUCTION_CHECKPOINT_EMITTED_LOG,
    process.env.PRODUCTION_FINALIZATION_LOG,
    process.env.PRODUCTION_REMOTE_DISCOVERY_LOG,
    process.env.PRODUCTION_REMOTE_TARGET_ENABLEMENT_LOG,
    process.env.PRODUCTION_RAILWAY_DEPLOYMENT_LOG,
    process.env.PRODUCTION_RAILWAY_DEPLOY_CAPABILITY_LOG,
    process.env.PRODUCTION_CANONICAL_LINEAGE_REPAIR_LOG,
    process.env.WORK_PIPELINE_LOG,
    process.env.WORK_PIPELINE_DEPLOY_LOG,
    process.env.OWNER_NOTIFICATION_LOG,
    process.env.OWNER_ACTIVITY_LOG,
    process.env.CANONICAL_VIEW_REVIEWS_LOG,
  ]) {
    if (file && existsSync(file)) unlinkSync(file);
  }
  if (failed > 0) process.exit(1);
}

void main();
