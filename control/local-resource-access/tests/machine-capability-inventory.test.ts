/**
 * Deterministic A–N proofs for MACHINE_CAPABILITY_INVENTORY_V1 and remote bindings.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/machine-capability-inventory.test.ts
 */

import { join } from "node:path";
import {
  capabilityInvocable,
  evaluateOwnerCapabilityBinding,
  getRemoteServiceBinding,
  invokeLocalCapability,
  issueLocalAccessGrant,
  issueOwnerCapabilityBindingPolicy,
  listDataEgress,
  listRemoteServiceBindings,
  resolveCapabilityBindings,
} from "../contract";
import { discoverInstalledApplications } from "../application-adapter";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DATA = join(process.cwd(), "control/local-resource-access/data");
process.env.LOCAL_RESOURCE_GRANTS_LOG = join(DATA, `inv-grants-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_REGISTRY_LOG = join(DATA, `inv-resources-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVENTS_LOG = join(DATA, `inv-events-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EGRESS_LOG = join(DATA, `inv-egress-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVIDENCE_LOG = join(DATA, `inv-evidence-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_WORKSPACES_LOG = join(DATA, `inv-workspaces-${STAMP}.jsonl`);
process.env.OWNER_MACHINE_POLICY_LOG = join(DATA, `inv-omp-${STAMP}.jsonl`);
process.env.OWNER_CAPABILITY_BINDING_LOG = join(DATA, `inv-ocb-${STAMP}.jsonl`);
process.env.MACHINE_CAPABILITY_INVENTORY_LOG = join(DATA, `inv-mci-${STAMP}.jsonl`);

const SESSION = `session-inv-${STAMP}`;
const AI = "ai://inventory-client";
const APP = "resource://local/app/textedit";
const INV = "resource://local/inventory/machine";
const GH = "resource://local/remote/github";
const FILE_RES = "resource://local/files/fixture-corpus";

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

function grant(resource_id: string, access: ReadonlyArray<"READ" | "WRITE" | "EXECUTE">): void {
  const data_scope = resource_id === FILE_RES ? ["control/local-resource-access/fixtures/corpus"] : [];
  issueLocalAccessGrant({
    ai_identity: AI,
    session_id: SESSION,
    work_id: null,
    capability: "*",
    resource_id,
    data_scope,
    access,
    network_egress: "LOCAL_ONLY",
    expires_at: null,
    effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  grant(APP, ["READ", "EXECUTE"]);
  grant(INV, ["READ"]);
  grant(GH, ["READ"]);
  grant(FILE_RES, ["READ", "WRITE"]);

  await check("A. Installed app discovery grants no authority", async () => {
    const found = discoverInstalledApplications(`work-a-${STAMP}`, SESSION);
    assert(found.length > 0, "must discover apps");
    assert(found.every((row) => row.usage_authorized === false), "discovery must not authorize");
    assert(found.every((row) => row.authority_status === "DENY"), "authority stays DENY");
  });

  await check("B. Connected service discovery grants no authority", async () => {
    const services = listRemoteServiceBindings(AI, SESSION);
    assert(services.some((row) => row.provider === "github"), "github binding present");
    assert(services.every((row) => row.owner_authority_state === "DENY"), "discovery does not enable");
    const gh = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-b-${STAMP}`,
      capability: "local.remote.github.read_identity", resource_id: GH, input: {},
    });
    assert(gh.ok === false, "github invoke without Owner enable");
    assert(gh.authority.decision === "ALLOW" || JSON.stringify(gh.result).includes("REMOTE_BINDING_NOT_OWNER_ENABLED") || JSON.stringify(gh.result).includes("BINDING_NOT_OWNER_ENABLED"), JSON.stringify(gh.result));
  });

  await check("C. Unknown application capability cannot execute", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-c-${STAMP}`,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", action_id: "textedit.unknown" },
    });
    assert(denied.ok === false, "unknown action");
  });

  await check("D. Declared-but-unverified capability cannot execute", async () => {
    assert(capabilityInvocable({
      DECLARED: true, ADAPTER_PRESENT: false, AUTHENTICATION_READY: false, RUNTIME_VERIFIED: false, OWNER_ENABLED: false,
    }) === false, "declared only is not invocable");
    const conv = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-d-${STAMP}`,
      capability: "local.document.convert_registered", resource_id: "resource://local/files/fixture-corpus",
      input: { logical_path: "notes.txt" },
    });
    assert(conv.ok === false, "unverified convert");
  });

  await check("E. Verified-but-not-Owner-enabled capability cannot execute", async () => {
    issueOwnerCapabilityBindingPolicy({
      ai_identity: AI,
      session_id: SESSION,
      enabled_binding_ids: ["service://github/source-authority"],
      allowed_actions: ["READ"],
      visible_data_classes: ["APPLICATION_STATE"],
      approval_required_actions: [],
      allowed_connection_ids: [],
      read_scope: [],
      write_scope: [],
      publish_scope: [],
      network_destinations: [],
      expires_at: null,
      effect: "ALLOW",
    });
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-e-${STAMP}`,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", everyday_action: "READ" },
    });
    assert(denied.ok === false, "policy present but TextEdit not enabled");
  });

  await check("F. Owner-enabled registered local capability executes", async () => {
    const enabledSession = `session-enabled-${STAMP}`;
    issueLocalAccessGrant({
      ai_identity: AI, session_id: enabledSession, work_id: null, capability: "*", resource_id: APP,
      data_scope: [], access: ["READ", "EXECUTE"], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
    });
    issueOwnerCapabilityBindingPolicy({
      ai_identity: AI,
      session_id: enabledSession,
      enabled_binding_ids: ["app://macos/textedit"],
      allowed_actions: ["READ"],
      visible_data_classes: ["APPLICATION_STATE"],
      approval_required_actions: [],
      allowed_connection_ids: [],
      read_scope: [],
      write_scope: [],
      publish_scope: [],
      network_destinations: [],
      expires_at: null,
      effect: "ALLOW",
    });
    const ok = await invokeLocalCapability({
      ai_client_id: AI, session_id: enabledSession, work_id: `work-f-${STAMP}`,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", everyday_action: "READ" },
    });
    assert(ok.ok, JSON.stringify(ok.result));
    assert(ok.result.action_type === "READ_STATE", String(ok.result.action_type));
  });

  await check("G. GitHub capability binding reuses existing credential_ref", async () => {
    const gh = getRemoteServiceBinding("service://github/source-authority", AI, SESSION);
    assert(gh !== null, "github binding");
    assert(gh!.credential_ref === null || gh!.credential_ref.startsWith("credential://github/"), String(gh!.credential_ref));
    assert(!JSON.stringify(gh).includes("ghp_"), "no token in binding");
  });

  await check("H. No credential value appears in inventory/bindings", async () => {
    const refreshed = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-h-${STAMP}`,
      capability: "local.inventory.refresh", resource_id: INV, input: {},
    });
    assert(refreshed.ok, JSON.stringify(refreshed.result));
    const blob = JSON.stringify(refreshed.result);
    assert(!blob.includes("ghp_"), "no github token");
    assert(!blob.includes("github_pat_"), "no pat");
    assert(!/Bearer\s+\S/.test(blob), "no bearer");
  });

  await check("I. Google capability binding is limited to actually connected supported services", async () => {
    const drive = getRemoteServiceBinding("service://google/drive", AI, SESSION);
    assert(drive?.availability === "NOT_AVAILABLE", drive?.availability ?? "missing");
    assert((drive?.canonical_action_mapping ?? []).every((row) => row.states.ADAPTER_PRESENT === false), "no fake adapter");
  });

  await check("J. Unavailable/unsupported provider is reported truthfully", async () => {
    const gmail = getRemoteServiceBinding("service://google/gmail", AI, SESSION);
    assert(gmail?.availability === "NOT_AVAILABLE", "gmail not connected");
    const line = listRemoteServiceBindings().find((row) => row.provider === "line");
    assert(line === undefined, "LINE must not be bound in this phase");
  });

  await check("K. Capability routing respects authority before cost/provider preference", async () => {
    const ranked = resolveCapabilityBindings({
      action: "SEARCH",
      ai_identity: AI,
      session_id: `session-route-${STAMP}`,
      work_id: `work-k-${STAMP}`,
    });
    const eligible = ranked.filter((row) => row.eligible);
    assert(eligible.length > 0, "local search eligible");
    assert(eligible[0]!.locality === "LOCAL", "local wins among eligible");
    const remote = ranked.find((row) => row.binding_id.startsWith("service://github"));
    assert(remote !== undefined, "github candidate exists");
    assert(remote!.eligible === false, "unauthorized remote is ineligible even if listed");
    assert(ranked[0]!.eligible === true, "eligible sorted first");
  });

  await check("L. LOCAL_FIRST wins when equivalent local capability is available", async () => {
    const ranked = resolveCapabilityBindings({
      action: "READ",
      required_locality: "ANY",
      ai_identity: AI,
      session_id: `session-route-${STAMP}`,
    });
    const firstEligible = ranked.find((row) => row.eligible);
    assert(firstEligible?.locality === "LOCAL", JSON.stringify(ranked.slice(0, 3)));
  });

  await check("M. External data egress policy remains enforced", async () => {
    const rows = listDataEgress(`work-h-${STAMP}`);
    assert(rows.length > 0, "egress recorded");
    assert(rows.every((row) => row.schema === "DATA_EGRESS_POLICY_V1"), "egress schema");
  });

  await check("N. Binding atoms stay five-state and default deny remote", async () => {
    const evalRemote = evaluateOwnerCapabilityBinding({
      ai_identity: AI, session_id: `session-none-${STAMP}`, binding_id: "service://github/source-authority", action: "READ", remote: true,
    });
    assert(evalRemote.decision === "DENY", evalRemote.reason_code);
    const schema = getRemoteServiceBinding("service://database/schema-read", AI, SESSION);
    assert(schema !== null, "schema binding");
    const write = schema!.canonical_action_mapping.find((row) => row.action === "WRITE");
    assert(write?.states.OWNER_ENABLED === false, "high-impact write not owner-enabled");
    assert(write?.states.ADAPTER_PRESENT === false, "no mutation adapter claimed");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
