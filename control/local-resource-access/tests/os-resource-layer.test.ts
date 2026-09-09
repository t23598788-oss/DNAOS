/**
 * Deterministic A–M proofs for OS_RESOURCE_V1 / application / process-gate extensions.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/os-resource-layer.test.ts
 */

import { join } from "node:path";
import {
  FORBIDDEN_CAPABILITY_NAMES,
  discoverInstalledApplications,
  evaluateProcessJobRequest,
  getLocalCapability,
  invokeLocalCapability,
  issueLocalAccessGrant,
  issueOwnerMachinePolicy,
  listDataEgress,
  listLocalResourceEvents,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; pid: number; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DATA = join(process.cwd(), "control/local-resource-access/data");
process.env.LOCAL_RESOURCE_GRANTS_LOG = join(DATA, `os-grants-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_REGISTRY_LOG = join(DATA, `os-resources-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVENTS_LOG = join(DATA, `os-events-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EGRESS_LOG = join(DATA, `os-egress-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVIDENCE_LOG = join(DATA, `os-evidence-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_WORKSPACES_LOG = join(DATA, `os-workspaces-${STAMP}.jsonl`);
process.env.OWNER_MACHINE_POLICY_LOG = join(DATA, `os-policy-${STAMP}.jsonl`);

const SESSION = `session-os-${STAMP}`;
const AI = "ai://os-client";
const PROC = "resource://local/os/process-table";
const PORT = "resource://local/os/ports";
const METRIC = "resource://local/os/metrics";
const APP = "resource://local/app/textedit";
const REG = "resource://local/app/registry";
const JOB = "resource://local/compute/registered-jobs";

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

function grant(resource_id: string, capability: "*" | Parameters<typeof issueLocalAccessGrant>[0]["capability"], access: ReadonlyArray<"READ" | "WRITE" | "EXECUTE">): void {
  issueLocalAccessGrant({
    ai_identity: AI,
    session_id: SESSION,
    work_id: null,
    capability,
    resource_id,
    data_scope: [],
    access,
    network_egress: "LOCAL_ONLY",
    expires_at: null,
    effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  grant(PROC, "*", ["READ"]);
  grant(PORT, "*", ["READ"]);
  grant(METRIC, "*", ["READ"]);
  grant(REG, "*", ["READ"]);
  grant(APP, "*", ["READ", "EXECUTE"]);
  grant(JOB, "*", ["EXECUTE"]);
  issueOwnerMachinePolicy({
    ai_identity: AI,
    session_id: SESSION,
    visible_resource_ids: [PROC, PORT, METRIC, APP, REG, JOB],
    read_only_capabilities: ["local.system.process.list", "local.system.process.inspect", "local.system.port.list", "local.system.resource_usage"],
    approval_required_capabilities: [],
    local_only_resource_ids: [PROC, PORT, METRIC],
    allowed_network_destinations: ["none"],
    enabled_application_actions: ["textedit.read_state"],
    expires_at: null,
    effect: "ALLOW",
  });

  await check("A. Installed application discovery does not grant usage authority", async () => {
    const discovered = discoverInstalledApplications(`work-disc-${STAMP}`, SESSION);
    assert(discovered.every((row) => row.usage_authorized === false), "discovery must not authorize");
    const denied = await invokeLocalCapability({
      ai_client_id: AI,
      session_id: SESSION,
      work_id: `work-disc-${STAMP}`,
      capability: "local.app.invoke_registered_action",
      resource_id: APP,
      input: { application_id: "app://discovered-only", action_id: "textedit.read_state" },
    });
    assert(denied.ok === false, "unregistered application must be denied");
  });

  await check("B. Unknown process execution is denied", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: AI,
      session_id: SESSION,
      work_id: `work-unk-${STAMP}`,
      capability: "local.compute.run_registered_job",
      resource_id: JOB,
      input: { job_id: "local.os.not-a-job" },
    });
    assert(denied.ok === false, "unknown job must deny");
  });

  await check("C. Arbitrary shell remains impossible", async () => {
    assert(getLocalCapability("sudo") === null, "sudo is not a capability");
    assert(FORBIDDEN_CAPABILITY_NAMES.includes("sudo"), "sudo forbidden");
    const shell = evaluateProcessJobRequest({ job_id: "local.compute.true", argv: ["-c", "echo pwned"] });
    assert(shell.ok === false, "shell argv rejected");
  });

  await check("D. Read-only process inspection works", async () => {
    const listed = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-ps-${STAMP}`,
      capability: "local.system.process.list", resource_id: PROC, input: {},
    });
    assert(listed.ok, JSON.stringify(listed.result));
    assert(listed.result.mutation === false, "must not mutate");
    const inspected = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-ps-${STAMP}`,
      capability: "local.system.process.inspect", resource_id: PROC, input: { pid: String(process.pid) },
    });
    assert(inspected.ok, JSON.stringify(inspected.result));
    assert(inspected.envelope.execution_locality === "LOCAL", "local inspect");
  });

  await check("E. Read-only port inspection works", async () => {
    const ports = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-port-${STAMP}`,
      capability: "local.system.port.list", resource_id: PORT, input: {},
    });
    assert(ports.ok, JSON.stringify(ports.result));
    assert(ports.envelope.execution_locality === "LOCAL", "local ports");
  });

  await check("F. Local resource usage metrics are collected locally", async () => {
    const metrics = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-met-${STAMP}`,
      capability: "local.system.resource_usage", resource_id: METRIC, input: {},
    });
    assert(metrics.ok, JSON.stringify(metrics.result));
    assert(metrics.result.locality === "LOCAL", "metrics local");
    assert(typeof (metrics.result.memory as { total_bytes?: number })?.total_bytes === "number", "memory collected");
  });

  await check("G. Registered application action executes only when explicitly authorized", async () => {
    const ok = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-app-${STAMP}`,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", action_id: "textedit.read_state" },
    });
    assert(ok.ok, JSON.stringify(ok.result));
    assert(ok.result.action_type === "READ_STATE", String(ok.result.action_type));
  });

  await check("H. Unauthorized application action is denied", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-app-deny-${STAMP}`,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", action_id: "textedit.applescript_anything" },
    });
    assert(denied.ok === false, "unregistered action must deny");
  });

  await check("I. Process cwd cannot escape allowed scope", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-cwd-${STAMP}`,
      capability: "local.compute.run_registered_job", resource_id: JOB,
      input: { job_id: "local.compute.true", cwd: "/tmp" },
    });
    assert(denied.ok === false, "cwd escape must deny");
    assert(JSON.stringify(denied.result).includes("CWD_ESCAPE_REJECTED"), JSON.stringify(denied.result));
  });

  await check("J. Environment injection is rejected", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-env-${STAMP}`,
      capability: "local.compute.run_registered_job", resource_id: JOB,
      input: { job_id: "local.compute.true", env: { EVIL: "1" } },
    });
    assert(denied.ok === false, "env injection must deny");
  });

  await check("K. Network policy is enforced for registered process jobs", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-net-${STAMP}`,
      capability: "local.compute.run_registered_job", resource_id: JOB,
      input: { job_id: "local.compute.true", network: "any" },
    });
    assert(denied.ok === false, "network override must deny");
  });

  await check("L. OS inspection sends no machine data externally unless allowed", async () => {
    const rows = listDataEgress(`work-ps-${STAMP}`);
    assert(rows.length > 0, "egress recorded");
    assert(rows.every((row) => row.policy_state === "LOCAL_ONLY" || row.policy_state === "DENIED"), rows[0]!.policy_state);
    assert(rows.every((row) => row.bytes_actually_sent < 100_000), "must not dump the machine");
    const events = listLocalResourceEvents(`work-ps-${STAMP}`);
    assert(events.some((row) => row.event === "PROCESS_INSPECTED" || row.event === "PROCESS_DISCOVERED"), "os events");
  });

  await check("M. Existing LOCAL_RESOURCE_V1 forbidden capabilities remain closed", async () => {
    assert(getLocalCapability("execute_any_command") === null, "no arbitrary exec");
    assert(getLocalCapability("arbitrary_applescript") === null, "no applescript");
    assert(getLocalCapability("kill_any_process") === null, "no kill");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
