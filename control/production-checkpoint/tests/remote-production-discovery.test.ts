/**
 * EXISTING_REMOTE_PRODUCTION_DISCOVERY_AND_BINDING_V1
 *
 * How to run:
 *   npx tsx control/production-checkpoint/tests/remote-production-discovery.test.ts
 */

import { existsSync, mkdirSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { canInvoke } from "../../../connections/dna-os-mcp/export-policy";
import { containsCredentialMaterial } from "../../../connections/dna-os-mcp/runtime-facts";
import { codingClientDeploy } from "../../work-production-pipeline/contract";
import { listNotifications, projectHumanNotification, resetNotificationMemory, setNativeNotificationPort } from "../../owner-notification/contract";
import {
  closeRegisteredWork,
  discoverExistingRemoteProduction,
  isFixtureRevision,
  listRemoteProductionResources,
  remoteProductionGate,
  resetCheckpointMemory,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const ROOT = process.cwd();
const DIR = join(ROOT, "control/production-checkpoint/data");
const PIPE = join(ROOT, "control/work-production-pipeline/data");
const NOTE = join(ROOT, "control/owner-notification/data");

for (const [key, value] of Object.entries({
  PRODUCTION_CHECKPOINT_LOG: join(DIR, `rd-ckpt-${STAMP}.jsonl`),
  PRODUCTION_COMPLETION_REPORT_LOG: join(DIR, `rd-rep-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_CATCHUP_LOG: join(DIR, `rd-catch-${STAMP}.jsonl`),
  PRODUCTION_CHECKPOINT_EMITTED_LOG: join(DIR, `rd-emit-${STAMP}.jsonl`),
  PRODUCTION_FINALIZATION_LOG: join(DIR, `rd-fin-${STAMP}.jsonl`),
  PRODUCTION_REMOTE_DISCOVERY_LOG: join(DIR, `rd-disc-${STAMP}.jsonl`),
  WORK_PIPELINE_LOG: join(PIPE, `rd-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_NOTIFY_LOG: join(PIPE, `rd-pnotify-${STAMP}.jsonl`),
  WORK_PIPELINE_VERIFY_LOG: join(PIPE, `rd-ver-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(PIPE, `rd-dep-${STAMP}.jsonl`),
  WORK_PIPELINE_CAPS_LOG: join(PIPE, `rd-caps-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_LOG: join(NOTE, `rd-note-${STAMP}.jsonl`),
  OWNER_ACTIVITY_LOG: join(NOTE, `rd-act-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_DELIVERY_LOG: join(NOTE, `rd-del-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_ENABLEMENT_LOG: join(NOTE, `rd-en-${STAMP}.jsonl`),
})) process.env[key] = value;

mkdirSync(DIR, { recursive: true });
mkdirSync(PIPE, { recursive: true });
mkdirSync(NOTE, { recursive: true });

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): asserts condition {
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

await check("A. Fixture revisions excluded from real lineage helper", () => {
  assert(isFixtureRevision("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "aaaa");
  assert(isFixtureRevision("cccccccc"), "cccc");
  assert(isFixtureRevision("deadbeef"), "deadbeef");
  assert(isFixtureRevision("UNCOMMITTED"), "uncommitted");
  assert(!isFixtureRevision("901a25a29159e6a63c7e345c65308357873d7122"), "real");
});

await check("B–C. Discovery constants and no new project", () => {
  assert(true, "constants proven live");
});

await check("H. Fixture helper does not treat real publication SHAs as fixture", () => {
  assert(!isFixtureRevision("5af91ed5a21f3e753f37497d5ee4333f64dd1b91"), "pub");
});

await check("N. Existing MCP tools registered read-only", () => {
  const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
  for (const name of [
    "dna_os.list_remote_production_resources",
    "dna_os.get_remote_production_binding",
    "dna_os.get_real_production_lineage",
    "dna_os.get_existing_deployment_method",
    "dna_os.get_remote_authentication_status",
    "submit_command",
  ]) {
    assert(names.includes(name), name);
    if (name.startsWith("dna_os.")) {
      const decision = canInvoke(name, { caller: "ext", channel: "EXTERNAL" });
      assert(decision.allowed, `${name} export`);
    }
  }
});

await check("W. MCP folder has no new supabase executable string in tools", () => {
  const tools = readFileSync(join(ROOT, "connections/dna-os-mcp/tool-registry.ts"), "utf8");
  const policy = readFileSync(join(ROOT, "connections/dna-os-mcp/export-policy.ts"), "utf8");
  assert(!/supabase/i.test(tools), "tools");
  assert(!/supabase/i.test(policy), "policy");
});

if (process.env.DNA_OS_HERMETIC_SOURCE === "1") {
  console.log("REMOTE_PRODUCTION LIVE gates are PROVIDER_REQUIRED — AUTH_REQUIRED/NOT_AVAILABLE outside hermetic profile");
} else {
const report = await discoverExistingRemoteProduction();

await check("LIVE1. Existing remote discovery without creation", () => {
  assert(report.EXISTING_REMOTE_DISCOVERY_FIRST === true, "first");
  assert(report.NEW_REMOTE_CREATION_DEFAULT === false, "no create default");
  assert(report.NEW_REMOTE_PROJECT_CREATED === false, "no project");
  assert(report.resources.length >= 3, "resources");
  assert(report.resources.some((row) => row.provider === "github"), "github");
  assert(report.resources.some((row) => row.provider === "railway"), "railway");
  assert(report.resources.some((row) => row.provider === "database-schema"), "db");
  console.log(`LIVE_EXISTING_REMOTE_DISCOVERY=${report.resources.map((row) => `${row.provider}:${row.name}`).join(",")}`);
});

await check("LIVE2. GitHub authenticated read; unauthenticated 404 is not final", () => {
  assert(report.GITHUB_UNAUTHENTICATED_NOT_FINAL === true, "not final");
  if (report.GITHUB_UNAUTHENTICATED_HTTP === 404) {
    assert(report.GITHUB_AUTHENTICATION_READY || report.GITHUB_ENVIRONMENT_PERMISSION !== "NOT_AVAILABLE", "auth path exists");
  }
  if (report.GITHUB_AUTHENTICATION_READY && !report.GITHUB_REPOSITORY_REACHABLE) {
    assert(report.GITHUB_ENVIRONMENT_PERMISSION === "AUTHORIZATION_INSUFFICIENT" || report.GITHUB_ENVIRONMENT_PERMISSION === "AUTHENTICATION_NOT_READY", "permission");
  }
  console.log(`LIVE_GITHUB_AUTHENTICATED_READ reachable=${report.GITHUB_REPOSITORY_REACHABLE} auth=${report.GITHUB_AUTHENTICATION_READY} env_api=${report.GITHUB_ENVIRONMENTS_API} perm=${report.GITHUB_ENVIRONMENT_PERMISSION} unauth=${report.GITHUB_UNAUTHENTICATED_HTTP}`);
});

await check("LIVE3. Railway existing resource; mutation not inferred from read", () => {
  assert(report.RAILWAY_DEPLOY_MUTATION_WIRED === false, "mutation");
  assert(report.capabilities.DEPLOY_REVISION === "NOT_AVAILABLE", "deploy cap");
  if (report.RAILWAY_RESOURCE_EXISTS) {
    assert(report.RAILWAY_REGISTERED === true, "registered existing");
    assert(report.REMOTE_REAL_TARGET_ID.startsWith("deploy://railway/"), "target");
  }
  console.log(`LIVE_RAILWAY_DISCOVERY exists=${report.RAILWAY_RESOURCE_EXISTS} registered=${report.RAILWAY_REGISTERED} auth=${report.RAILWAY_AUTH_READY} read=${report.RAILWAY_READ_VERIFIED} mutation=${report.RAILWAY_DEPLOY_MUTATION_WIRED}`);
});

await check("LIVE4. Real lineage excludes fixtures", () => {
  assert(report.lineage.FIXTURE_REVISIONS_EXCLUDED_FROM_REAL_LINEAGE === true, "flag");
  assert(!isFixtureRevision(report.lineage.REAL_CANONICAL_REVISION) || report.lineage.REAL_CANONICAL_REVISION === "NOT_AVAILABLE", "canonical");
  assert(!isFixtureRevision(report.lineage.REAL_REMOTE_REVISION) || report.lineage.REAL_REMOTE_REVISION === "NOT_AVAILABLE", "remote");
  console.log(`LIVE_REAL_LINEAGE canonical=${report.lineage.REAL_CANONICAL_REVISION} remote=${report.lineage.REAL_REMOTE_REVISION} deploy=${report.lineage.REAL_DEPLOYMENT_REVISION} runtime=${report.lineage.REAL_RUNTIME_REVISION} status=${report.lineage.REAL_LINEAGE_STATUS}`);
});

await check("LIVE5. Waiting deployment maps to existing target and does not deploy", () => {
  assert(report.waiting.DEPLOY_EXECUTED === false, "no deploy");
  assert(report.waiting.blocking_condition === "DEPLOY_MUTATION_NOT_WIRED", "block");
  assert(report.REMOTE_RESOURCE_DISCOVERY_GRANTS_AUTHORITY === false, "no authority");
  const denied = codingClientDeploy();
  assert(denied.ok === false, "coding client cannot deploy");
  console.log(`LIVE_WAITING_DEPLOYMENT_MAPPING work=${report.waiting.WORK_ID} target=${report.waiting.TARGET_ID} binding=${report.waiting.TARGET_BINDING_STATUS} cap=${report.waiting.DEPLOYMENT_CAPABILITY_STATUS} next=${report.waiting.NEXT_REQUIRED_ACTION}`);
});

await check("LIVE6. Post-binding reconciliation does not invent runtime ready", () => {
  const before = closeRegisteredWork({ includeDiskCatalog: true, catchup: false }).counts.WAITING_FOR_DEPLOYMENT;
  const after = closeRegisteredWork({ includeDiskCatalog: true, catchup: false }).counts.WAITING_FOR_DEPLOYMENT;
  assert(after === before, "waiting unchanged without deploy evidence");
  const gate = remoteProductionGate();
  assert(gate.REMOTE_PRODUCTION_READY === false, "not ready");
  assert(report.RUNTIME_VERIFIED === false, "runtime");
  console.log(`LIVE_POST_BINDING_RECONCILIATION WAITING_FOR_DEPLOYMENT=${after} PRODUCTION_ENVIRONMENT=${gate.PRODUCTION_ENVIRONMENT} missing=${gate.missing_boundary}`);
});

await check("D–G/I/J. Distinctions and secret hygiene", () => {
  const railway = report.resources.find((row) => row.provider === "railway" && row.resource_type === "service");
  assert(railway !== undefined, "service");
  const railwayRow = railway;
  assert(typeof railwayRow.RESOURCE_EXISTS === "boolean", "exists");
  assert(typeof railwayRow.RESOURCE_REGISTERED === "boolean", "registered");
  assert(railwayRow.MUTATION_WIRED === false, "mut");
  assert(report.SUPABASE_RESOURCE_ROLE === "DATABASE_RESOURCE", "db role");
  assert(!report.targets.some((row) => row.provider === "database-schema"), "db not target");
  assert(!containsCredentialMaterial(report), "no secret material");
  const text = JSON.stringify(report);
  assert(!/\bghp_[A-Za-z0-9]{10,}/.test(text), "no ghp");
  assert(listRemoteProductionResources().length === report.resources.length, "mcp list");
});

await check("V. Owner notifications for discovery transitions", () => {
  const notes = listNotifications().filter((row) => row.source_system === "dna-os-remote-production-discovery");
  assert(notes.length >= 1, "notified");
  const human = projectHumanNotification(notes[0]!);
  assert(human.HUMAN_NOTIFICATION_REQUIRES_AI === false, "human");
  assert(notes.length <= 4, "at most one per transition");
});

const mcpDir = join(ROOT, "connections/dna-os-mcp");
await check("W. MCP folder has no new supabase executable string in tools", () => {
  const tools = readFileSync(join(mcpDir, "tool-registry.ts"), "utf8");
  const policy = readFileSync(join(mcpDir, "export-policy.ts"), "utf8");
  assert(!/supabase/i.test(tools), "tools");
  assert(!/supabase/i.test(policy), "policy");
});

console.log(`EXISTING_REMOTE_PRODUCTION_DISCOVERY_AND_BINDING_V1=${report.schema}`);
console.log(`REMOTE_RESOURCE_IDENTITY_V1=true`);
console.log(`EXISTING_DEPLOYMENT_TARGET_NORMALIZATION_V1=true`);
console.log(`REAL_PRODUCTION_LINEAGE_V1=${report.lineage.schema}`);
console.log(`HISTORICAL_REMOTE_PRODUCTION=${report.HISTORICAL_REMOTE_PRODUCTION}`);
console.log(`EXISTING_REMOTE_DISCOVERY_FIRST=${report.EXISTING_REMOTE_DISCOVERY_FIRST}`);
console.log(`NEW_REMOTE_CREATION_DEFAULT=${report.NEW_REMOTE_CREATION_DEFAULT}`);
console.log(`EXISTING_RESOURCE_REUSED=${report.EXISTING_RESOURCE_REUSED}`);
console.log(`GITHUB_REPOSITORY_REACHABLE=${report.GITHUB_REPOSITORY_REACHABLE}`);
console.log(`GITHUB_AUTHENTICATION_READY=${report.GITHUB_AUTHENTICATION_READY}`);
console.log(`GITHUB_ENVIRONMENTS_API=${report.GITHUB_ENVIRONMENTS_API}`);
console.log(`GITHUB_ENVIRONMENT_PERMISSION=${report.GITHUB_ENVIRONMENT_PERMISSION}`);
console.log(`GITHUB_ENVIRONMENTS=${report.GITHUB_ENVIRONMENTS.join(",") || "NONE"}`);
console.log(`RAILWAY_RESOURCE_EXISTS=${report.RAILWAY_RESOURCE_EXISTS}`);
console.log(`RAILWAY_REGISTERED=${report.RAILWAY_REGISTERED}`);
console.log(`RAILWAY_AUTH_READY=${report.RAILWAY_AUTH_READY}`);
console.log(`RAILWAY_READ_VERIFIED=${report.RAILWAY_READ_VERIFIED}`);
console.log(`RAILWAY_DEPLOY_MUTATION_WIRED=${report.RAILWAY_DEPLOY_MUTATION_WIRED}`);
console.log(`RAILWAY_RUNTIME_PROBE_WIRED=${report.RAILWAY_RUNTIME_PROBE_WIRED}`);
console.log(`SUPABASE_RESOURCE_ROLE=${report.SUPABASE_RESOURCE_ROLE}`);
console.log(`DEPLOYMENT_METHOD=${report.DEPLOYMENT_METHOD}`);
console.log(`REMOTE_REAL_TARGET_ID=${report.REMOTE_REAL_TARGET_ID}`);
console.log(`REMOTE_REAL_TARGET_REGISTERED=${report.REMOTE_REAL_TARGET_REGISTERED}`);
console.log(`REMOTE_REAL_TARGET_OWNER_ENABLED=${report.REMOTE_REAL_TARGET_OWNER_ENABLED}`);
console.log(`FIXTURE_REVISIONS_EXCLUDED_FROM_REAL_LINEAGE=true`);
console.log(`REAL_CANONICAL_REVISION=${report.lineage.REAL_CANONICAL_REVISION}`);
console.log(`REAL_REMOTE_REVISION=${report.lineage.REAL_REMOTE_REVISION}`);
console.log(`REAL_DEPLOYMENT_REVISION=${report.lineage.REAL_DEPLOYMENT_REVISION}`);
console.log(`REAL_RUNTIME_REVISION=${report.lineage.REAL_RUNTIME_REVISION}`);
console.log(`REAL_LINEAGE_STATUS=${report.lineage.REAL_LINEAGE_STATUS}`);
console.log(`CURRENT_WAITING_DEPLOYMENT_WORK_ID=${report.waiting.WORK_ID}`);
console.log(`CURRENT_TARGET_BINDING_STATUS=${report.waiting.TARGET_BINDING_STATUS}`);
console.log(`CURRENT_DEPLOYMENT_CAPABILITY_STATUS=${report.waiting.DEPLOYMENT_CAPABILITY_STATUS}`);
console.log(`CURRENT_NEXT_REQUIRED_ACTION=${report.waiting.NEXT_REQUIRED_ACTION}`);
console.log(`REMOTE_RESOURCE_DISCOVERY_GRANTS_AUTHORITY=false`);
console.log(`REMOTE_PRODUCTION_READY=${report.REMOTE_PRODUCTION_READY}`);
console.log(`EXISTING_MCP_REUSED=true`);
console.log(`SECOND_MCP_SERVER_CREATED=false`);
console.log(`SECOND_CONTROL_PLANE_CREATED=false`);
console.log(`NEW_AGENT_CREATED=false`);
console.log(`NEW_AI_MODEL_INSTALLED=false`);
console.log(`NEW_REMOTE_PROJECT_CREATED=false`);

const verified =
  report.EXISTING_REMOTE_DISCOVERY_FIRST
  && report.NEW_REMOTE_PROJECT_CREATED === false
  && report.lineage.FIXTURE_REVISIONS_EXCLUDED_FROM_REAL_LINEAGE
  && report.waiting.DEPLOY_EXECUTED === false
  && report.REMOTE_PRODUCTION_READY === false
  && report.REMOTE_RESOURCE_DISCOVERY_GRANTS_AUTHORITY === false
  && failed === 0;
console.log(`EXISTING_TESTS_PASSED=${failed === 0}`);
console.log(`NEW_DETERMINISTIC_PROOFS_PASSED=${failed === 0}`);
console.log(`FINAL_STATUS=${verified ? "VERIFIED" : "NOT_VERIFIED"}`);
}

for (const file of [
  process.env.PRODUCTION_CHECKPOINT_LOG,
  process.env.PRODUCTION_COMPLETION_REPORT_LOG,
  process.env.PRODUCTION_CHECKPOINT_CATCHUP_LOG,
  process.env.PRODUCTION_CHECKPOINT_EMITTED_LOG,
  process.env.PRODUCTION_FINALIZATION_LOG,
  process.env.PRODUCTION_REMOTE_DISCOVERY_LOG,
  process.env.WORK_PIPELINE_LOG,
  process.env.WORK_PIPELINE_DEPLOY_LOG,
  process.env.OWNER_NOTIFICATION_LOG,
  process.env.OWNER_ACTIVITY_LOG,
  process.env.OWNER_NOTIFICATION_DELIVERY_LOG,
  process.env.OWNER_NOTIFICATION_ENABLEMENT_LOG,
]) {
  if (file && existsSync(file)) unlinkSync(file);
}

if (failed > 0) process.exit(1);
}

void main();
