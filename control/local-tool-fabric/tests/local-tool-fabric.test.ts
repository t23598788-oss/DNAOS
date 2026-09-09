/**
 * Deterministic A–O proofs for LOCAL_TOOL_ADAPTER_FABRIC_V1.
 *
 * How to run:
 *   npx tsx control/local-tool-fabric/tests/local-tool-fabric.test.ts
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import {
  evaluateProcessJobRequest,
  issueLocalAccessGrant,
  issueOwnerCapabilityBindingPolicy,
  issueOwnerMachinePolicy,
  listDataEgress,
} from "../../local-resource-access/contract";
import type { BindableActionId } from "../../local-resource-access/contract";
import { listAppLauncherItems } from "../../owner-work-surface/contract";
import {
  ADAPTER_PREFERENCE,
  DEVICE_RESOURCE_SCHEMA,
  LOCAL_APP_CAPABILITY_REGISTRY_SCHEMA,
  LOCAL_TOOL_ADAPTER_FABRIC_SCHEMA,
  LOCAL_TOOL_CHAIN_SCHEMA,
  NATIVE_INTERFACE_FIRST_SCHEMA,
  NATIVE_INTERFACE_ORDER,
  TOOL_CAPABILITY_HEALTH_SCHEMA,
  executeLocalToolAction,
  getLocalTool,
  getToolHealth,
  invokeAccessibilityFallback,
  listDevices,
  listLocalAppCapabilityRegistry,
  listLocalTools,
  refreshLocalToolFabric,
  resolveLocalToolRoute,
  runLocalToolChain,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const LRA = join(process.cwd(), "control/local-resource-access/data");
const FABRIC = join(process.cwd(), "control/local-tool-fabric/data");
const OCR = join(process.cwd(), "control/owner-client-runtime/data");
const logs: Record<string, string> = {
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `ltf-grants-${STAMP}.jsonl`),
  LOCAL_RESOURCE_REGISTRY_LOG: join(LRA, `ltf-resources-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVENTS_LOG: join(LRA, `ltf-events-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EGRESS_LOG: join(LRA, `ltf-egress-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVIDENCE_LOG: join(LRA, `ltf-evidence-${STAMP}.jsonl`),
  LOCAL_RESOURCE_WORKSPACES_LOG: join(LRA, `ltf-workspaces-${STAMP}.jsonl`),
  LOCAL_RESOURCE_TRANSFER_LOG: join(LRA, `ltf-transfer-${STAMP}.jsonl`),
  OWNER_MACHINE_POLICY_LOG: join(LRA, `ltf-omp-${STAMP}.jsonl`),
  OWNER_CAPABILITY_BINDING_LOG: join(LRA, `ltf-ocb-${STAMP}.jsonl`),
  LOCAL_TOOL_ADAPTERS_LOG: join(FABRIC, `ltf-adapters-${STAMP}.jsonl`),
  LOCAL_TOOL_DEVICES_LOG: join(FABRIC, `ltf-devices-${STAMP}.jsonl`),
  LOCAL_TOOL_HEALTH_LOG: join(FABRIC, `ltf-health-${STAMP}.jsonl`),
  RESOURCE_HANDLES_LOG: join(OCR, `ltf-handles-${STAMP}.jsonl`),
  OWNER_CLIENTS_LOG: join(OCR, `ltf-clients-${STAMP}.jsonl`),
  WORK_CONTEXT_LOG: join(OCR, `ltf-work-${STAMP}.jsonl`),
};
for (const [key, value] of Object.entries(logs)) process.env[key] = value;

const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const APP = "resource://local/app/textedit";
const DISK = "resource://local/os/disk";
const SESSION = `session-ltf-${STAMP}`;
const ENABLED = `session-ltf-enabled-${STAMP}`;
const AI = "ai://local-tool-fabric";
const COPY_NAME = `ltf-copy-${STAMP}.txt`;
const COPY_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", COPY_NAME);

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

function enableBindings(session: string, ids: readonly string[], actions: readonly BindableActionId[]): void {
  issueOwnerCapabilityBindingPolicy({
    ai_identity: AI, session_id: session,
    enabled_binding_ids: [...ids],
    allowed_actions: [...actions],
    visible_data_classes: ["APPLICATION_STATE", "TEXT", "FILE"],
    approval_required_actions: [],
    allowed_connection_ids: [],
    read_scope: [], write_scope: [], publish_scope: [],
    network_destinations: [],
    expires_at: null, effect: "ALLOW",
  });
  issueOwnerMachinePolicy({
    ai_identity: AI, session_id: session,
    visible_resource_ids: [APP, FILE_RES, WRITE_RES, DISK],
    read_only_capabilities: ["local.system.disk.summary"],
    approval_required_capabilities: [],
    local_only_resource_ids: [DISK],
    allowed_network_destinations: ["none"],
    enabled_application_actions: ["textedit.read_state"],
    expires_at: null, effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  grant(SESSION, APP, ["READ", "EXECUTE"]);
  grant(SESSION, FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(SESSION, WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  grant(SESSION, DISK, ["READ"]);
  grant(ENABLED, APP, ["READ", "EXECUTE"]);
  grant(ENABLED, FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(ENABLED, WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  grant(ENABLED, DISK, ["READ"]);
  enableBindings(ENABLED, ["app://macos/textedit", FILE_RES, DISK], ["READ", "SEARCH", "EXTRACT", "SUMMARIZE", "COPY"]);

  await check("A. Installed application grants zero authority", () => {
    const adapters = refreshLocalToolFabric(`work-a-${STAMP}`, SESSION, AI);
    assert(adapters.every((row) => row.schema === LOCAL_TOOL_ADAPTER_FABRIC_SCHEMA), "schema");
    assert(adapters.every((row) => row.grants_authority === false), "no grant");
    assert(adapters.every((row) => row.owner_enabled === false), "discovery not owner-enabled");
    const apps = listLocalAppCapabilityRegistry(AI, SESSION, `work-a-${STAMP}`);
    assert(apps.every((row) => row.schema === LOCAL_APP_CAPABILITY_REGISTRY_SCHEMA), "registry schema");
    assert(apps.every((row) => row.owner_authority_state === "DENY"), "apps remain DENY");
  });

  await check("B. App category does not imply capability", () => {
    const apps = listLocalAppCapabilityRegistry(AI, SESSION, `work-b-${STAMP}`);
    const other = apps.find((row) => row.application_id !== "app://macos/textedit");
    assert(other !== undefined, "need a discovered app besides TextEdit");
    assert(other!.verified_capabilities.length === 0, JSON.stringify(other));
    assert(other!.category_does_not_imply_capability === true, "flag");
    const textedit = apps.find((row) => row.application_id === "app://macos/textedit");
    assert(textedit?.canonical_actions.includes("READ") === true, "textedit READ verified");
    assert(!textedit?.canonical_actions.includes("WRITE"), "no WRITE from editor category");
  });

  await check("C. Unknown adapter cannot execute", async () => {
    const denied = await executeLocalToolAction({
      adapter_id: "adapter://unknown", action: "READ",
      ai_client_id: AI, session_id: SESSION, work_id: `work-c-${STAMP}`,
    });
    assert(denied.ok === false && denied.reason_code === "UNKNOWN_ADAPTER", JSON.stringify(denied));
  });

  await check("D. Declared but unverified capability cannot execute", async () => {
    refreshLocalToolFabric(`work-d-${STAMP}`, SESSION, AI);
    const convert = await executeLocalToolAction({
      adapter_id: "adapter://files/convert/unavailable", action: "CONVERT",
      ai_client_id: AI, session_id: SESSION, work_id: `work-d-${STAMP}`,
    });
    assert(convert.ok === false && convert.reason_code === "CAPABILITY_NOT_VERIFIED", JSON.stringify(convert));
    const url = getLocalTool("adapter://app/textedit/url-scheme");
    if (url) {
      const open = await executeLocalToolAction({
        adapter_id: url.adapter_id, action: "OPEN",
        ai_client_id: AI, session_id: SESSION, work_id: `work-d-open-${STAMP}`,
      });
      assert(open.ok === false, JSON.stringify(open));
    }
  });

  await check("E. Owner-disabled verified capability cannot execute", async () => {
    refreshLocalToolFabric(`work-e-${STAMP}`, SESSION, AI);
    const denied = await executeLocalToolAction({
      adapter_id: "adapter://app/textedit/file-interface", action: "READ",
      ai_client_id: AI, session_id: SESSION, work_id: `work-e-${STAMP}`,
    });
    assert(denied.ok === false && denied.reason_code === "OWNER_DISABLED", JSON.stringify(denied));
    assert(denied.OWNER_ENABLED_REQUIRED === true, "owner required");
  });

  await check("F. Verified + Owner-enabled capability executes", async () => {
    refreshLocalToolFabric(`work-f-${STAMP}`, ENABLED, AI);
    const ok = await executeLocalToolAction({
      adapter_id: "adapter://app/textedit/file-interface", action: "READ",
      ai_client_id: AI, session_id: ENABLED, work_id: `work-f-${STAMP}`,
    });
    assert(ok.ok === true, JSON.stringify(ok));
    const invoked = ok.invoked as { envelope?: { result_status?: string }; result?: { action_type?: string } };
    assert(invoked.envelope?.result_status === "COMPLETED" || invoked.result?.action_type === "READ_STATE", JSON.stringify(ok));
  });

  await check("G. Structured/native adapter is preferred over fallback", () => {
    refreshLocalToolFabric(`work-g-${STAMP}`, ENABLED, AI);
    const route = resolveLocalToolRoute({ action: "READ", application_id: "app://macos/textedit" });
    assert(route.schema === NATIVE_INTERFACE_FIRST_SCHEMA, route.schema);
    assert(route.order === NATIVE_INTERFACE_ORDER, "order");
    assert(route.selected?.adapter_type === "FILE_INTERFACE", String(route.selected?.adapter_type));
    assert(route.accessibility_used === false, "no a11y");
    assert(ADAPTER_PREFERENCE.FILE_INTERFACE < ADAPTER_PREFERENCE.ACCESSIBILITY_FALLBACK, "rank");
  });

  await check("H. Accessibility fallback cannot perform arbitrary actions", async () => {
    const blocked = invokeAccessibilityFallback();
    assert(blocked.ok === false && blocked.reason_code === "ACCESSIBILITY_FALLBACK_NOT_REGISTERED", JSON.stringify(blocked));
    const fallback = listLocalTools().find((row) => row.adapter_type === "ACCESSIBILITY_FALLBACK");
    assert(fallback !== undefined, "need a discovered app without structured adapter");
    const denied = await executeLocalToolAction({
      adapter_id: fallback!.adapter_id, action: "READ",
      ai_client_id: AI, session_id: ENABLED, work_id: `work-h-${STAMP}`,
    });
    assert(denied.ok === false, JSON.stringify(denied));
    assert(denied.ARBITRARY_UI_AUTOMATION === false, "no ui automation");
  });

  await check("I. Arbitrary shell remains impossible", async () => {
    const denied = await executeLocalToolAction({
      action: "sudo", ai_client_id: AI, session_id: ENABLED, work_id: `work-i-${STAMP}`,
    });
    assert(denied.ok === false && denied.ARBITRARY_SHELL_ACCESS === false, JSON.stringify(denied));
  });

  await check("J. No sudo path exists", () => {
    const sudo = evaluateProcessJobRequest({ job_id: "sudo" });
    assert(sudo.ok === false, JSON.stringify(sudo));
    assert(sudo.ok === false && (sudo.reason_code === "ARBITRARY_SHELL_REJECTED" || sudo.reason_code === "JOB_NOT_REGISTERED"), sudo.ok === false ? sudo.reason_code : "ok");
  });

  await check("K. Resource handles allow tool chaining without raw source duplication", async () => {
    refreshLocalToolFabric(`work-k-${STAMP}`, ENABLED, AI);
    const chain = await runLocalToolChain({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-k-${STAMP}`,
      steps: [
        { adapter_id: "adapter://files/fixture-corpus/file-interface", action: "SEARCH", payload: { query: "zzqegate-local-resource-marker" } },
        { adapter_id: "adapter://files/fixture-corpus/file-interface", action: "EXTRACT", payload: { logical_path: "notes.txt" } },
      ],
    });
    assert(chain.schema === LOCAL_TOOL_CHAIN_SCHEMA, String(chain.schema));
    assert(chain.RAW_SOURCE_DUPLICATION_REQUIRED === false, "no raw copy");
    assert(Array.isArray(chain.handles) && (chain.handles as string[]).length >= 1, JSON.stringify(chain.handles));
    const results = chain.results as Array<Record<string, unknown>>;
    assert(results.some((row) => row.raw_content_included === false), JSON.stringify(results[0]));
  });

  await check("L. Local tool chain executes deterministically", async () => {
    refreshLocalToolFabric(`work-l-${STAMP}`, ENABLED, AI);
    const chain = await runLocalToolChain({
      ai_client_id: AI, session_id: ENABLED, work_id: `work-l-${STAMP}`,
      steps: [
        { adapter_id: "adapter://files/fixture-corpus/file-interface", action: "SEARCH", payload: { query: "zzqegate-local-resource-marker" } },
        { adapter_id: "adapter://files/fixture-corpus/file-interface", action: "EXTRACT", payload: { logical_path: "notes.txt" } },
        { adapter_id: "adapter://files/convert/unavailable", action: "CONVERT", payload: { logical_path: "notes.txt" } },
        {
          adapter_id: "adapter://files/fixture-corpus/file-interface",
          action: "COPY",
          payload: {
            source_logical: "notes.txt",
            destination_logical: COPY_NAME,
            destination_resource_id: WRITE_RES,
            preview_approved: true,
          },
        },
      ],
    });
    assert(chain.ok === true, JSON.stringify(chain));
    const skipped = chain.convert_skipped as { NOT_AVAILABLE?: boolean } | null;
    assert(skipped?.NOT_AVAILABLE === true, JSON.stringify(chain.convert_skipped));
    assert(existsSync(COPY_PATH), "copy created through registered COPY");
  });

  await check("M. Device discovery grants zero authority", () => {
    const devices = listDevices();
    assert(devices.every((row) => row.schema === DEVICE_RESOURCE_SCHEMA), "device schema");
    assert(devices.every((row) => row.grants_authority === false && row.owner_enabled === false), "no device authority");
    assert(devices.some((row) => row.device_type === "STORAGE_DEVICE" && row.availability === "AVAILABLE"), "storage exists");
  });

  await check("N. Tool health distinguishes install/reachability/verification/authority", () => {
    refreshLocalToolFabric(`work-n-${STAMP}`, SESSION, AI);
    const textedit = getToolHealth("adapter://app/textedit/file-interface");
    assert(textedit?.schema === TOOL_CAPABILITY_HEALTH_SCHEMA, "health schema");
    assert(textedit?.APPLICATION_INSTALLED === true, "installed");
    assert(textedit?.ADAPTER_AVAILABLE === true, "adapter");
    assert(textedit?.CAPABILITY_VERIFIED === true, "verified");
    assert(textedit?.AUTHORIZED === false, "not authorized on SESSION");
    const fallback = listLocalTools().find((row) => row.adapter_type === "ACCESSIBILITY_FALLBACK");
    const health = getToolHealth(fallback!.adapter_id);
    assert(health?.APPLICATION_INSTALLED === true, "app installed");
    assert(health?.CAPABILITY_VERIFIED === false, "not verified");
    assert(health?.AUTHORIZED === false, "not authorized");
  });

  await check("O. Existing MCP/work-surface boundaries remain", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    for (const required of [
      "dna_os.list_local_tools", "dna_os.get_local_tool", "dna_os.list_tool_capabilities",
      "dna_os.get_tool_health", "dna_os.list_devices", "dna_os.get_device", "dna_os.resolve_local_tool_route",
      "dna_os.invoke_local_capability", "submit_command",
    ]) {
      assert(names.includes(required), `missing ${required}`);
    }
    assert(!names.includes("shell") && !names.includes("get_secret"), "no extra doors");
    const launcher = listAppLauncherItems(AI, SESSION, `work-o-${STAMP}`);
    assert(launcher.some((row) => row.app_id.startsWith("device://")), "devices on launcher");
    assert(launcher.every((row) => row.grants_authority === false), "launcher still not authority");
    const egress = listDataEgress(`work-f-${STAMP}`);
    assert(egress.every((row) => row.schema === "DATA_EGRESS_POLICY_V1"), "existing egress");
  });

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  for (const file of Object.values(logs)) {
    if (existsSync(file)) unlinkSync(file);
  }
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
