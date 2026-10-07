/**
 * Deterministic A–L proofs for local resource access.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/local-resource-access.test.ts
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import {
  FORBIDDEN_CAPABILITY_NAMES,
  createScopedLocalWorkspace,
  evaluateLocalAuthority,
  getLocalCapability,
  invokeLocalCapability,
  issueLocalAccessGrant,
  listDataEgress,
  listLocalResourceEvents,
  listLocalResourcesForSession,
  registerLocalResource,
} from "../contract";
import { createWorkspace, evaluateDisposableCleanup, latestWorkspaceForWork } from "../../source-workspace/contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DATA = join(process.cwd(), "control/local-resource-access/data");
process.env.LOCAL_RESOURCE_GRANTS_LOG = join(DATA, `grants-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_REGISTRY_LOG = join(DATA, `resources-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVENTS_LOG = join(DATA, `events-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EGRESS_LOG = join(DATA, `egress-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVIDENCE_LOG = join(DATA, `evidence-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_WORKSPACES_LOG = join(DATA, `workspaces-${STAMP}.jsonl`);
process.env.LOCAL_WORKSPACE_REGISTRY_LOG = join(process.cwd(), "control/source-workspace/data", `lra-ws-${STAMP}.jsonl`);
process.env.LOCAL_WORKSPACE_CLEANUP_EVIDENCE_LOG = join(process.cwd(), "control/source-workspace/data", `lra-clean-${STAMP}.jsonl`);
process.env.SOURCE_WORKSPACE_RESERVATION_LOG = join(process.cwd(), "control/source-workspace/data", `lra-res-${STAMP}.jsonl`);

const FILE_RES = "resource://local/files/fixture-corpus";
const GIT_RES = "resource://local/git/fixture-corpus";
const JOB_RES = "resource://local/compute/registered-jobs";

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

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const ownerSession = `session-owner-${STAMP}`;
  const chatgpt = "ai://chatgpt";
  const unknown = "ai://unknown-vendor";
  issueLocalAccessGrant({
    ai_identity: chatgpt,
    session_id: ownerSession,
    work_id: null,
    capability: "*",
    resource_id: FILE_RES,
    data_scope: ["control/local-resource-access/fixtures/corpus"],
    access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY",
    expires_at: null,
    effect: "ALLOW",
  });
  issueLocalAccessGrant({
    ai_identity: chatgpt,
    session_id: ownerSession,
    work_id: null,
    capability: "*",
    resource_id: GIT_RES,
    data_scope: ["control/local-resource-access/fixtures/corpus"],
    access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY",
    expires_at: null,
    effect: "ALLOW",
  });
  issueLocalAccessGrant({
    ai_identity: chatgpt,
    session_id: ownerSession,
    work_id: null,
    capability: "local.compute.run_registered_job",
    resource_id: JOB_RES,
    data_scope: [],
    access: ["EXECUTE"],
    network_egress: "LOCAL_ONLY",
    expires_at: null,
    effect: "ALLOW",
  });

  await check("A. Unknown AI receives zero local authority by default", async () => {
    const listed = listLocalResourcesForSession(unknown, "session-none");
    assert(listed.length === 0, "unknown AI must see no resources");
    const decision = evaluateLocalAuthority({
      ai_identity: unknown,
      session_id: "session-none",
      work_id: "work-none",
      capability: "local.files.search",
      resource_id: FILE_RES,
      data_scope: ["control/local-resource-access/fixtures/corpus"],
      access: "READ",
      network_egress: "LOCAL_ONLY",
    });
    assert(decision.decision === "DENY", decision.reason_code);
  });

  await check("B. Registered AI/session can only see explicitly allowed resources", async () => {
    const listed = listLocalResourcesForSession(chatgpt, ownerSession);
    assert(listed.some((row) => row.resource_id === FILE_RES), "granted file resource visible");
    assert(listed.some((row) => row.resource_id === GIT_RES), "granted git resource visible");
    registerLocalResource({
      schema: "LOCAL_RESOURCE_V1",
      resource_id: "resource://local/files/not-granted",
      resource_type: "FILE_SYSTEM",
      provider: "macos-filesystem",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.resource.list"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "THIS_MACHINE",
      network_egress_policy: "DENIED",
      read_scope: ["control/local-resource-access/fixtures/corpus"],
      write_scope: [],
      execute_scope: [],
      workspace_required: false,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: "control/local-resource-access/fixtures/corpus",
    });
    const after = listLocalResourcesForSession(chatgpt, ownerSession);
    assert(!after.some((row) => row.resource_id === "resource://local/files/not-granted"), "ungranted resource hidden");
  });

  await check("C. Unauthorized path access is rejected", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-path-${STAMP}`,
      capability: "local.files.metadata",
      resource_id: FILE_RES,
      input: { logical_path: "../../../../etc/passwd" },
    });
    assert(denied.ok === false, "path escape must fail");
    assert(JSON.stringify(denied.result).includes("PATH_OUT_OF_SCOPE"), JSON.stringify(denied.result));
  });

  await check("D. Arbitrary shell execution is impossible", async () => {
    for (const name of FORBIDDEN_CAPABILITY_NAMES) {
      assert(getLocalCapability(name) === null, name);
    }
    const shell = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-shell-${STAMP}`,
      capability: "local.compute.run_registered_job",
      resource_id: JOB_RES,
      input: { job_id: "/bin/sh -c echo pwned" },
    });
    assert(shell.ok === false, "unregistered job must fail");
  });

  await check("E. Authorized filesystem search executes locally", async () => {
    const found = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-search-${STAMP}`,
      capability: "local.files.search",
      resource_id: FILE_RES,
      input: { query: "zzqegate-local-resource-marker" },
    });
    assert(found.ok, JSON.stringify(found.result));
    assert(found.envelope.execution_locality === "LOCAL", found.envelope.execution_locality);
    assert(found.envelope.files_read_count > 0, "must read local files");
    assert(JSON.stringify(found.result).includes("zzqegate-local-resource-marker"), "marker must be found locally");
  });

  await check("F. Authorized git inspection executes locally", async () => {
    const status = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-git-${STAMP}`,
      capability: "local.git.status",
      resource_id: GIT_RES,
      input: {},
    });
    assert(status.ok, JSON.stringify(status.result));
    assert(status.envelope.execution_locality === "LOCAL", status.envelope.execution_locality);
    const search = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-git-${STAMP}`,
      capability: "local.git.search",
      resource_id: GIT_RES,
      input: { query: "zzqegate-local-resource-marker" },
    });
    assert(search.ok, JSON.stringify(search.result));
  });

  await check("G. Registered local job executes locally", async () => {
    const job = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-job-${STAMP}`,
      capability: "local.compute.run_registered_job",
      resource_id: JOB_RES,
      input: { job_id: "local.compute.true" },
    });
    assert(job.ok, JSON.stringify(job.result));
    assert(job.result.exit_code === 0, String(job.result.exit_code));
    assert(job.envelope.execution_locality === "LOCAL", job.envelope.execution_locality);
  });

  await check("H. Large local input processed without sending the complete input externally", async () => {
    const root = join(process.cwd(), "tests/__sandbox__", `lra-large-${STAMP}`);
    mkdirSync(root, { recursive: true });
    const payload = `${"padding-line\n".repeat(4000)}zzqegate-local-resource-marker unique-hit\n`;
    writeFileSync(join(root, "bulk.txt"), payload);
    const resourceId = `resource://local/files/large-${STAMP}`;
    registerLocalResource({
      schema: "LOCAL_RESOURCE_V1",
      resource_id: resourceId,
      resource_type: "FILE_SYSTEM",
      provider: "macos-filesystem",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.files.search", "local.resource.list", "local.resource.status", "local.workspace.create", "local.workspace.inspect"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "REGISTERED_WORKSPACE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [root],
      write_scope: [],
      execute_scope: [],
      workspace_required: false,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: root,
    });
    issueLocalAccessGrant({
      ai_identity: chatgpt,
      session_id: ownerSession,
      work_id: null,
      capability: "local.files.search",
      resource_id: resourceId,
      data_scope: [root],
      access: ["READ"],
      network_egress: "LOCAL_ONLY",
      expires_at: null,
      effect: "ALLOW",
    });
    const found = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-large-${STAMP}`,
      capability: "local.files.search",
      resource_id: resourceId,
      input: { query: "unique-hit" },
    });
    assert(found.ok, JSON.stringify(found.result));
    assert(found.egress.bytes_actually_sent < payload.length, `sent ${found.egress.bytes_actually_sent} vs source ${payload.length}`);
    assert(found.egress.minimization_applied, "minimization must apply");
  });

  await check("I. Data egress policy reports exact outbound byte count", async () => {
    const rows = listDataEgress(`work-search-${STAMP}`);
    assert(rows.length > 0, "egress row required");
    assert(typeof rows[0]!.bytes_actually_sent === "number", "byte count required");
    assert(rows[0]!.schema === "DATA_EGRESS_POLICY_V1", rows[0]!.schema);
  });

  await check("J. SECRET/CREDENTIAL data cannot be sent externally", async () => {
    const secret = await invokeLocalCapability({
      ai_client_id: chatgpt,
      session_id: ownerSession,
      work_id: `work-secret-${STAMP}`,
      capability: "local.files.read_range",
      resource_id: FILE_RES,
      input: { logical_path: "secret.credential.txt" },
    });
    assert(secret.ok === false, "secret read must deny");
    assert(secret.egress.policy_state === "DENIED" || JSON.stringify(secret.result).includes("SECRET_EGRESS_DENIED"), JSON.stringify(secret));
    assert(secret.egress.bytes_actually_sent === 0, String(secret.egress.bytes_actually_sent));
  });

  await check("K. Workspace lifecycle preserves unmanaged Owner files", async () => {
    const root = join(process.cwd(), "tests/__sandbox__", `lra-ws-${STAMP}`);
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "test"], { cwd: root });
    writeFileSync(join(root, "required.txt"), "managed\n");
    writeFileSync(join(root, "unrelated-owner.txt"), "do-not-delete\n");
    execFileSync("git", ["add", "required.txt"], { cwd: root });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root });
    const workId = `work-ws-${STAMP}`;
    const created = await createWorkspace({
      work_id: workId,
      repository_id: `repository://lra/${STAMP}`,
      repository_root: root,
      base_branch: "main",
    });
    assert(created.status === "CREATED", created.reason);
    const scoped = await createScopedLocalWorkspace({ work_id: workId, resource_ids: [FILE_RES] });
    assert(scoped.ok, scoped.reason_code);
    const ws = latestWorkspaceForWork(workId);
    assert(ws !== null, "workspace registered");
    const cleanup = await evaluateDisposableCleanup({
      workspace: ws!,
      facts: {
        remote_commit_verified: true,
        ci_verified_when_required: true,
        registry_write_verified: true,
        final_result_recorded: true,
      },
    });
    assert(existsSync(join(root, "unrelated-owner.txt")), "unmanaged Owner file must remain");
    assert(cleanup.unmanaged_files_deleted === false, "must never delete unmanaged files");
    assert(readFileSync(join(root, "unrelated-owner.txt"), "utf8") === "do-not-delete\n", "unmanaged contents unchanged");
  });

  await check("L. Execution evidence identifies local vs external processing", async () => {
    const events = listLocalResourceEvents(`work-search-${STAMP}`);
    assert(events.some((row) => row.event === "LOCAL_EXECUTION_STARTED"), "local start event");
    assert(events.some((row) => row.event === "AUTHORITY_CHECKED"), "authority event");
    const mcpClient = new Client({ name: "external-style", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    const evidence = structuredOf(await mcpClient.callTool({
      name: "dna_os.get_local_execution_evidence",
      arguments: { work_id: `work-search-${STAMP}` },
    }) as never);
    assert(evidence.envelope === "DNA_OS_LOCAL_EXECUTION", String(evidence.envelope));
    const executions = evidence.executions as Array<Record<string, unknown>>;
    assert(executions.some((row) => row.execution_locality === "LOCAL"), "local locality");
    await mcpClient.close();
    await mcpServer.close();
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
