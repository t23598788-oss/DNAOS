/**
 * Deterministic A–O proofs for MACOS_NATIVE_CONTROL_BRIDGE_V1.
 *
 * How to run:
 *   npx tsx control/macos-native-bridge/tests/macos-native-bridge.test.ts
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import {
  evaluateProcessJobRequest,
  issueLocalAccessGrant,
  issueOwnerCapabilityBindingPolicy,
  issueOwnerMachinePolicy,
} from "../../local-resource-access/contract";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import {
  detectCapabilityDrift,
  evaluateEndpointSecurityAuth,
  executeQueuedCommand,
  getDefaultApplication,
  getMacosPermissionState,
  listCommandQueue,
  listMacosBridges,
  nativeFailureFallback,
  probeEndpointSecurity,
  refreshMacosBridge,
  resolveMacosNativeRoute,
  submitOwnerMacosCommand,
} from "../contract";
import { discoverAppIntents } from "../intents";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const LRA = join(process.cwd(), "control/local-resource-access/data");
const CV = join(process.cwd(), "control/canonical-view/data");
const BR = join(process.cwd(), "control/macos-native-bridge/data");
const logs: Record<string, string> = {
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `mnb-grants-${STAMP}.jsonl`),
  LOCAL_RESOURCE_REGISTRY_LOG: join(LRA, `mnb-resources-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVENTS_LOG: join(LRA, `mnb-events-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EGRESS_LOG: join(LRA, `mnb-egress-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVIDENCE_LOG: join(LRA, `mnb-evidence-${STAMP}.jsonl`),
  LOCAL_RESOURCE_WORKSPACES_LOG: join(LRA, `mnb-workspaces-${STAMP}.jsonl`),
  LOCAL_RESOURCE_TRANSFER_LOG: join(LRA, `mnb-transfer-${STAMP}.jsonl`),
  OWNER_MACHINE_POLICY_LOG: join(LRA, `mnb-omp-${STAMP}.jsonl`),
  OWNER_CAPABILITY_BINDING_LOG: join(LRA, `mnb-ocb-${STAMP}.jsonl`),
  CANONICAL_VIEW_PREVIEWS_LOG: join(CV, `mnb-previews-${STAMP}.jsonl`),
  MACOS_BRIDGES_LOG: join(BR, `mnb-bridges-${STAMP}.jsonl`),
  MACOS_COMMANDS_LOG: join(BR, `mnb-commands-${STAMP}.jsonl`),
  MACOS_CORRELATION_LOG: join(BR, `mnb-corr-${STAMP}.jsonl`),
  MACOS_BASELINE_LOG: join(BR, `mnb-base-${STAMP}.jsonl`),
  MACOS_DRIFT_LOG: join(BR, `mnb-drift-${STAMP}.jsonl`),
  LOCAL_TOOL_ADAPTERS_LOG: join(process.cwd(), "control/local-tool-fabric/data", `mnb-adapters-${STAMP}.jsonl`),
  LOCAL_TOOL_DEVICES_LOG: join(process.cwd(), "control/local-tool-fabric/data", `mnb-devices-${STAMP}.jsonl`),
  LOCAL_TOOL_HEALTH_LOG: join(process.cwd(), "control/local-tool-fabric/data", `mnb-health-${STAMP}.jsonl`),
  WORK_PIPELINE_LOG: join(process.cwd(), "control/work-production-pipeline/data", `mnb-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_NOTIFY_LOG: join(process.cwd(), "control/work-production-pipeline/data", `mnb-pnotify-${STAMP}.jsonl`),
  WORK_PIPELINE_VERIFY_LOG: join(process.cwd(), "control/work-production-pipeline/data", `mnb-pver-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(process.cwd(), "control/work-production-pipeline/data", `mnb-pdep-${STAMP}.jsonl`),
  WORK_PIPELINE_CAPS_LOG: join(process.cwd(), "control/work-production-pipeline/data", `mnb-pcaps-${STAMP}.jsonl`),
  RESOURCE_HANDLES_LOG: join(process.cwd(), "control/owner-client-runtime/data", `mnb-handles-${STAMP}.jsonl`),
  WORK_CONTEXT_LOG: join(process.cwd(), "control/owner-client-runtime/data", `mnb-work-${STAMP}.jsonl`),
};
for (const [key, value] of Object.entries(logs)) process.env[key] = value;
process.env.MACOS_NATIVE_OPEN_MODE = "record";

const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const APP = "resource://local/app/textedit";
const SESSION = `session-mnb-${STAMP}`;
const ENABLED = `session-mnb-on-${STAMP}`;
const AI = "ai://macos-bridge";

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

function grant(session: string, resource_id: string, access: ReadonlyArray<"READ" | "WRITE" | "EXECUTE">, scope: readonly string[] = []): void {
  issueLocalAccessGrant({
    ai_identity: AI, session_id: session, work_id: null, capability: "*", resource_id,
    data_scope: [...scope], access: [...access], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
}

function enable(session: string): void {
  issueOwnerCapabilityBindingPolicy({
    ai_identity: AI, session_id: session,
    enabled_binding_ids: ["macos://bridge/this-machine", "app://macos/textedit", FILE_RES],
    allowed_actions: ["READ", "SEARCH", "COPY", "EXTRACT"],
    visible_data_classes: ["APPLICATION_STATE", "TEXT", "FILE"],
    approval_required_actions: [],
    allowed_connection_ids: [],
    read_scope: [], write_scope: [], publish_scope: [],
    network_destinations: [], expires_at: null, effect: "ALLOW",
  });
  issueOwnerMachinePolicy({
    ai_identity: AI, session_id: session,
    visible_resource_ids: [APP, FILE_RES, WRITE_RES],
    read_only_capabilities: [],
    approval_required_capabilities: [],
    local_only_resource_ids: [],
    allowed_network_destinations: ["none"],
    enabled_application_actions: ["textedit.read_state"],
    expires_at: null, effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  grant(SESSION, APP, ["READ", "EXECUTE"]);
  grant(SESSION, FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(ENABLED, APP, ["READ", "EXECUTE"]);
  grant(ENABLED, FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(ENABLED, WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  enable(ENABLED);

  await check("A. Native interface discovery grants no authority", () => {
    const rows = refreshMacosBridge(`work-a-${STAMP}`, SESSION, AI);
    assert(rows.every((row) => row.grants_authority === false), "no grant");
    assert(rows.every((row) => row.owner_enabled === false), "not owner-enabled");
  });

  await check("B. App Intent availability does not grant execution permission", async () => {
    const intents = discoverAppIntents();
    assert(intents.every((row) => row.grants_execution_permission === false && row.owner_authority_state === "DENY"), JSON.stringify(intents));
    const denied = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: SESSION, work_id: `work-b-${STAMP}`,
      canonical_action: "APP_INTENT", resource_id: APP,
    });
    assert(denied.ok === false, JSON.stringify(denied));
  });

  await check("C. Launch Services action respects Owner scope", async () => {
    enable(ENABLED);
    refreshMacosBridge(`work-c-${STAMP}`, ENABLED, AI);
    const escaped = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-c-${STAMP}`,
      canonical_action: "OPEN_DOCUMENT", resource_id: FILE_RES,
      payload: { logical_path: "../escape.txt", preview_approved: true },
    });
    assert(escaped.ok === false, JSON.stringify(escaped));
  });

  await check("D. Arbitrary shell is not required for native open/reveal", async () => {
    refreshMacosBridge(`work-d-${STAMP}`, ENABLED, AI);
    const opened = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-d-${STAMP}`,
      canonical_action: "OPEN_DOCUMENT", resource_id: FILE_RES,
      payload: { logical_path: "notes.txt", preview_approved: true },
    });
    assert(opened.ok === true, JSON.stringify(opened));
    const native = opened.native as { shell?: boolean; route?: string };
    const result = opened.result as { argv0?: string; shell?: boolean };
    assert(native.shell === false && result.shell === false, JSON.stringify(opened));
    assert(result.argv0 === "/usr/bin/open", String(result.argv0));
    assert(evaluateProcessJobRequest({ job_id: "/bin/sh" }).ok === false, "shell job closed");
  });

  await check("E. Queue serializes conflicting mutations", async () => {
    const first = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-e-${STAMP}`,
      canonical_action: "COPY", resource_id: FILE_RES,
      payload: { source_logical: "notes.txt", destination_logical: `mnb-a-${STAMP}.txt`, destination_resource_id: WRITE_RES, preview_approved: true, execute_now: false },
    });
    const second = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-e-${STAMP}`,
      canonical_action: "COPY", resource_id: FILE_RES,
      payload: { source_logical: "notes.txt", destination_logical: `mnb-b-${STAMP}.txt`, destination_resource_id: WRITE_RES, preview_approved: true, execute_now: false },
    });
    assert(first.executed === false, JSON.stringify(first));
    assert(second.reason_code === "SERIALIZED" || (second.command as { conflict_resolution?: string })?.conflict_resolution === "SERIALIZE", JSON.stringify(second));
    const ranFirst = await executeQueuedCommand(String((first.command as { command_id: string }).command_id), AI);
    assert(ranFirst.ok === true, JSON.stringify(ranFirst));
    const ranSecond = await executeQueuedCommand(String((second.command as { command_id: string }).command_id), AI);
    assert(ranSecond.ok === true, JSON.stringify(ranSecond));
  });

  await check("F. Client/provider cannot bypass queue", async () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("dna_os.get_command_queue"), "queue is read-only on MCP");
    assert(!names.includes("shell"), "no shell tool");
    const bypass = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-f-${STAMP}`,
      canonical_action: "OPEN_APPLICATION", resource_id: APP,
      payload: { preview_approved: true },
      requested_by: "provider-race",
    });
    assert(bypass.CLIENT_CAN_BYPASS_QUEUE === false, JSON.stringify(bypass));
  });

  await check("G. Actual system events correlate to command/work IDs", async () => {
    const opened = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-g-${STAMP}`,
      canonical_action: "OPEN_APPLICATION", resource_id: APP,
      payload: { preview_approved: true },
    });
    const command = opened.command as { command_id?: string; observed_events?: string[]; verification?: string };
    assert(typeof command.command_id === "string", "command id");
    assert((command.observed_events ?? []).includes("APPLICATION_LAUNCH"), JSON.stringify(command));
    assert(command.verification === "VERIFIED" || command.verification === "PARTIALLY_VERIFIED", String(command.verification));
  });

  await check("H. Unrelated background events are not mislabeled as violations", async () => {
    const { classifyActivity } = await import("../correlate");
    assert(classifyActivity({ event_type: "PROCESS_EXEC", process: "kernel_task" }) === "BACKGROUND_KNOWN", "background");
    assert(classifyActivity({ event_type: "PROCESS_EXEC", process: "unknown.unrelated" }) === "UNRELATED", "unrelated");
    assert(classifyActivity({ event_type: "FILE_WRITE", path_escape: true }) === "POLICY_VIOLATION_ATTEMPT", "escape");
  });

  await check("I. Endpoint Security unavailable state is reported truthfully if entitlement is absent", async () => {
    const es = await probeEndpointSecurity();
    assert(es.ENDPOINT_SECURITY === "NOT_AVAILABLE" || es.ENDPOINT_SECURITY_AVAILABLE === false || es.ENDPOINT_SECURITY === "AVAILABLE", JSON.stringify(es));
    if (es.ENDPOINT_SECURITY_AVAILABLE !== true) assert(es.ENDPOINT_SECURITY === "NOT_AVAILABLE", JSON.stringify(es));
  });

  await check("J. Observe mode never blocks system activity", async () => {
    const es = await probeEndpointSecurity();
    assert(es.observe_blocks_system_activity === false, JSON.stringify(es));
    assert(es.ENFORCEMENT_ENABLED === false, "enforcement off");
  });

  await check("K. AI/client has zero authority over system enforcement", async () => {
    const auth = evaluateEndpointSecurityAuth();
    assert(auth.AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY === false && auth.ENFORCEMENT_ENABLED === false, JSON.stringify(auth));
    const denied = await submitOwnerMacosCommand({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-k-${STAMP}`,
      canonical_action: "OPEN_APPLICATION", resource_id: APP,
      requested_by: "ai-enforcement",
    });
    assert(denied.ok === false && denied.AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY === false, JSON.stringify(denied));
  });

  await check("L. TCC permission state is separated from capability existence", () => {
    const rows = getMacosPermissionState();
    const ax = rows.find((row) => row.permission === "Accessibility");
    assert(ax !== undefined, "ax row");
    assert(ax!.auto_requested === false, "no prompt");
    assert(ax!.api_exists === true || ax!.api_exists === false, "api flag");
    assert(ax!.state === "NOT_REQUESTED" || ax!.state === "GRANTED" || ax!.state === "DENIED" || ax!.state === "NOT_AVAILABLE", ax!.state);
    if (ax!.state === "NOT_REQUESTED") assert(ax!.dna_os_has_permission === false, "existence is not grant");
  });

  await check("M. Capability drift does not auto-enable new capability", () => {
    refreshMacosBridge(`work-m-${STAMP}`, ENABLED, AI);
    const first = detectCapabilityDrift();
    const second = detectCapabilityDrift();
    assert(first.auto_enabled === false && second.auto_enabled === false, JSON.stringify({ first, second }));
    const intents = listMacosBridges().find((row) => row.interface_type === "APP_INTENTS");
    assert(intents?.owner_enabled === false, "intents stay disabled");
  });

  await check("N. Native failure does not silently downgrade to unsafe fallback", () => {
    const failed = nativeFailureFallback("APP_INTENTS");
    assert(failed.silent_downgrade === false, "no silent downgrade");
    assert(!failed.FALLBACK_AVAILABLE_REQUIRES_OWNER_POLICY.includes("ACCESSIBILITY_FALLBACK"), JSON.stringify(failed));
    const route = resolveMacosNativeRoute("OPEN_DOCUMENT");
    assert(route.accessibility_used === false && route.shell_used === false, JSON.stringify(route));
    assert(route.selected === "LAUNCH_SERVICES" || route.selected === "NSWORKSPACE", String(route.selected));
  });

  await check("O. Existing MCP/work-surface boundaries remain", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    for (const required of [
      "dna_os.get_macos_bridge_status", "dna_os.list_macos_capabilities", "dna_os.get_macos_permission_state",
      "dna_os.get_command_queue", "dna_os.get_command_status", "dna_os.get_system_activity", "dna_os.get_capability_drift",
      "dna_os.invoke_local_capability", "submit_command",
    ]) {
      assert(names.includes(required), `missing ${required}`);
    }
    const snap = ownerWorkSurfaceSnapshot(AI, ENABLED);
    assert(snap.macos_native !== undefined, "work surface slice");
    assert(getDefaultApplication("notes.txt").ok === true, "default app inspect");
    assert(listCommandQueue().length > 0, "queue recorded");
  });

  for (const file of [
    ...Object.values(logs),
    join(process.cwd(), "control/local-resource-access/fixtures/writable", `mnb-a-${STAMP}.txt`),
    join(process.cwd(), "control/local-resource-access/fixtures/writable", `mnb-b-${STAMP}.txt`),
  ]) {
    if (existsSync(file)) unlinkSync(file);
  }
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
