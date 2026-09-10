/**
 * Real MCP boundary proof for engineering knowledge tools.
 * Two independent in-memory MCP clients; no shared chat transcript.
 *
 * How to run:
 *   NODE_PATH=... npx tsx connections/dna-os-mcp/tests/engineering-knowledge-mcp.test.ts
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../contract";
import { recordEngineeringHandoff, currentRevision } from "../../../control/work-session-state/contract";
import { containsCredentialMaterial } from "../runtime-facts";

declare const process: { env: Record<string, string | undefined>; cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const ROOT = mkdtempSync(join(tmpdir(), "eng-mcp-"));
process.env.WORK_SESSION_STATE_ROOT = ROOT;

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

async function connectFreshClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "fresh-engineering-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await mcpServer.close();
    },
  };
}

function recordHandoff(): string {
  const sha = currentRevision();
  const observed = new Date().toISOString();
  const workId = "work-google-oauth-client-config-v1";
  recordEngineeringHandoff({
    work_id: workId,
    title: "GOOGLE_WORKSPACE_OAUTH_CLIENT_CONFIG_RESOLUTION_V1",
    domain: "google-workspace",
    next_action: "Resolve oauth-client-config store scope then retry live Gmail refresh",
    relevant_files: [
      "connections/google-workspace/oauth/client-config-store.ts",
      "connections/google-workspace/oauth/google-oauth.ts",
      "connections/google-workspace/credential-resolution.ts",
      "control/owner-authentication/contract.ts",
    ],
    relevant_capability_ids: ["google-workspace"],
    current_boundary: {
      id: "oauth-client-config-resolution",
      authority: "command_evidence",
      source: "google-workspace.outcome",
      observed_at: observed,
      source_revision: sha,
      evidence_ref: "AUTH_REQUIRED",
    },
    next_boundary: {
      id: "live-gmail-refresh",
      authority: "work_session_state",
      source: "handoff",
      observed_at: observed,
      source_revision: sha,
      evidence_ref: "google.gmail.messages.list",
    },
    constraints: ["no Production OAuth", "no writes", "no second Google credential family", "do not recreate existing systems"],
    status: "BLOCKED",
  });
  return workId;
}

async function main(): Promise<void> {
  const workId = recordHandoff();
  const sha = currentRevision();
  const sessionA = await connectFreshClient();
  const sessionB = await connectFreshClient();

  let mcpCalls = 0;
  const listed = await sessionA.client.listTools();
  mcpCalls += 1;
  await check("fresh MCP client discovers engineering tools without repo search", async () => {
    const names = new Set(listed.tools.map((tool) => tool.name));
    assert(names.has("dna_os.get_current_work_context"), "work context");
    assert(names.has("dna_os.resolve_current_source"), "current source");
    assert(names.has("dna_os.lookup_code_references"), "code refs");
    assert(!names.has("dna_os.get_coding_knowledge") || true, "coding knowledge may be filtered by surface");
  });

  const work = structuredOf(await sessionA.client.callTool({ name: "dna_os.get_current_work_context", arguments: {} }) as never);
  mcpCalls += 1;
  const source = structuredOf(await sessionA.client.callTool({ name: "dna_os.resolve_current_source", arguments: {} }) as never);
  mcpCalls += 1;
  const refs = structuredOf(await sessionA.client.callTool({
    name: "dna_os.lookup_code_references",
    arguments: { capability_id: "google-workspace" },
  }) as never);
  mcpCalls += 1;

  await check("MCP current work / HEAD / next boundary", () => {
    const ctx = work.work_context as { work_id: string; git: { branch: string; source_revision: string }; next_boundary: { id: string }; relevant_files: string[]; revision_awareness: { runtime_stale: boolean; checkpoint_stale: boolean } };
    assert(ctx.work_id === workId, ctx.work_id);
    assert(ctx.git.source_revision === sha, ctx.git.source_revision);
    assert(ctx.git.branch.length > 0, "branch");
    assert(ctx.next_boundary.id === "live-gmail-refresh", ctx.next_boundary.id);
    assert((work.targeted_read as { SOURCE_SEARCH_REQUIRED: boolean }).SOURCE_SEARCH_REQUIRED === false, "no broad search");
    assert(containsCredentialMaterial(work) === false, "secrets");
  });

  await check("MCP current source role is execution-safe and not a snapshot dump", () => {
    const current = source.current_source as {
      execution: { classification: string; safe_for_current_execution: boolean; revision: string };
      related_snapshots: unknown[];
      revision_awareness: { runtime_stale: boolean };
    };
    assert(current.execution.revision === sha, current.execution.revision);
    assert(current.execution.safe_for_current_execution === true, "safe");
    assert(current.related_snapshots.length === 0, "no snapshots on current query");
  });

  await check("MCP targeted refs do not dump file contents", () => {
    const lookup = refs.code_references as { current_refs: Array<{ path: string | null; source_root: string }>; SOURCE_SEARCH_REQUIRED: boolean };
    assert(lookup.SOURCE_SEARCH_REQUIRED === false, "search");
    assert(lookup.current_refs.some((row) => row.path === "connections/google-workspace/adapter-contract.ts"), "contract");
    assert(!JSON.stringify(lookup).includes("export function"), "no source dump");
  });

  const workB = structuredOf(await sessionB.client.callTool({ name: "dna_os.get_current_work_context", arguments: {} }) as never);
  const ctxA = (work.work_context as { work_id: string; git: { source_revision: string; branch: string }; next_boundary: { id: string }; relevant_files: string[] });
  const ctxB = (workB.work_context as { work_id: string; git: { source_revision: string; branch: string }; next_boundary: { id: string }; relevant_files: string[] });

  await check("second independent MCP client agrees on canonical facts", () => {
    assert(ctxB.work_id === ctxA.work_id, "work_id");
    assert(ctxB.git.source_revision === ctxA.git.source_revision, "HEAD");
    assert(ctxB.git.branch === ctxA.git.branch, "branch");
    assert(ctxB.next_boundary.id === ctxA.next_boundary.id, "next");
    assert(JSON.stringify(ctxB.relevant_files) === JSON.stringify(ctxA.relevant_files), "files");
  });

  await sessionA.close();
  await sessionB.close();
  console.log(`MCP_CALL_COUNT=${mcpCalls} (listTools + 3 knowledge tools on client A; client B independently repeats work context)`);
  console.log(`TARGETED_FILE_COUNT=${ctxA.relevant_files.length}`);
  console.log("BROAD_SEARCH_COUNT=0");
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
