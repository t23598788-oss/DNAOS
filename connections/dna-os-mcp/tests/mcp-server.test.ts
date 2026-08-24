/**
 * หน้าที่: real, end-to-end proof of the DNA OS Canonical MCP Server — an
 * actual MCP `Client` (from @modelcontextprotocol/sdk) talks real MCP
 * JSON-RPC to a real `McpServer` over `InMemoryTransport.createLinkedPair()`
 * (a genuine protocol round trip, just without a TCP socket in between),
 * and every tool handler makes a REAL HTTP call to the REAL, already
 * running canonical DNA OS server on http://127.0.0.1:8791. Nothing here
 * is mocked at the DNA OS boundary — a BLOCKED/REJECTED/NOT_FOUND result
 * is a real DNA OS answer, never asserted away.
 *
 * Requires the canonical server to be running:
 *   npx tsx transport/owner-command-http/server.ts
 *
 * How to run: npx tsx connections/dna-os-mcp/tests/mcp-server.test.ts
 * (requires Node >= 18 — the MCP SDK's minimum; this repo's default node
 * may be older, see the folder's own README for the exact command used).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, resolveCapabilityForTool } from "../contract";

declare const process: { exitCode?: number; env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

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
  const client = new Client({ name: "dna-os-mcp-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient());

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  // 1. MCP client -> list tools
  const toolNames = new Set<string>();
  await check("1. MCP client lists all seven real DNA OS tools", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) toolNames.add(tool.name);
    for (const expected of ["submit_command", "submit_registration_candidate", "lookup_capability", "get_resource", "get_task", "submit_work_result", "get_system_status"]) {
      assert(toolNames.has(expected), `expected tool ${expected} to be listed`);
    }
    assert(tools.length === 7, `expected exactly 7 tools, got ${tools.length}`);
  });

  // 2/3/4. submit a harmless command -> DNA OS really receives it -> command_id/task_id/evidence come back
  let commandCorrelationId = "";
  await check("2/3/4. submit_command reaches the real DNA OS ingress and returns command_id/task_id/evidence", async () => {
    const result = await client.callTool({ name: "submit_command", arguments: { commandText: "ตรวจสถานะ firewall", agentIdentity: { id: "mcp-test-agent", email: "mcp-test@example.com" } } });
    const body = structuredOf(result as any);
    assert(body.status === 200, `expected HTTP 200 from the real DNA OS ingress, got ${body.status}`);
    assert(typeof body.correlation_id === "string" && (body.correlation_id as string).length > 0, "expected a correlation_id");
    commandCorrelationId = body.correlation_id as string;
    assert(typeof body.dna_os_command_id === "string" && (body.dna_os_command_id as string).startsWith("cmd_"), `expected a real dna_os_command_id, got ${body.dna_os_command_id}`);
    // task- (hyphen), not the old task_ label: this is a real agent-gateway
    // Task id (control/agent-gateway/host-runtime.ts's newId("task")), not
    // a router-local label that only looked like one — see get_task below.
    assert(typeof body.dna_os_task_id === "string" && (body.dna_os_task_id as string).startsWith("task-"), `expected a real dna_os_task_id, got ${body.dna_os_task_id}`);
    assert(Array.isArray(body.evidence) && (body.evidence as unknown[]).length > 0, "expected a non-empty real evidence array");
    console.log(`  command_id=${body.dna_os_command_id} task_id=${body.dna_os_task_id} correlation_id=${commandCorrelationId}`);
  });

  // 7. register a real SOFTWARE candidate through MCP -> the real Registration Pipeline
  let registeredCapabilityId = "";
  await check("7. submit_registration_candidate (software domain) reaches the real Registration Pipeline and is APPROVED", async () => {
    const result = await client.callTool({
      name: "submit_registration_candidate",
      arguments: {
        request_id: `mcp-test-${Date.now()}`,
        source_type: "mcp-test",
        source_id: "connections/dna-os-mcp/tests/mcp-server.test.ts",
        evidence_refs: ["connections/dna-os-mcp/tests/mcp-server.test.ts"],
        agentIdentity: { id: "mcp-test-agent", email: "mcp-test@example.com" },
        candidate: {
          candidate_id: `mcp-test-candidate-${Date.now()}`,
          canonical_name: "mcp-test.round-trip-capability",
          kind: "capability",
          source_location: "connections/dna-os-mcp/tests/mcp-server.test.ts",
          purpose: "prove the MCP registration tool reaches the real Registration Pipeline",
          version: "1.0.0",
          domain: "SOFTWARE_CONTROL_PLANE",
          resource_type: "CAPABILITY",
          data_classification: "INTERNAL",
          source_system: "dna-os-infrastructure",
          scope: "software_registry",
        },
      },
    });
    const body = structuredOf(result as any);
    assert(body.registration_status === "APPROVED_FOR_REGISTRATION", `expected APPROVED_FOR_REGISTRATION, got ${body.registration_status}`);
    assert(typeof body.capability_id === "string" && (body.capability_id as string).length > 0, "expected a real capability_id back");
    registeredCapabilityId = body.capability_id as string;
    console.log(`  registered capability_id=${registeredCapabilityId}`);
  });

  // 5. lookup_capability finds the just-registered real capability
  await check("5. lookup_capability finds the just-registered real capability", async () => {
    const result = await client.callTool({ name: "lookup_capability", arguments: { capability_id: registeredCapabilityId } });
    const body = structuredOf(result as any);
    assert(body.found === true, `expected found=true for a real, just-registered capability_id, got ${JSON.stringify(body)}`);
  });

  // 6. unknown capability -> rejected
  await check("6. lookup_capability rejects an unknown capability_id honestly", async () => {
    const result = await client.callTool({ name: "lookup_capability", arguments: { capability_id: "does-not-exist-capability-id" } });
    const body = structuredOf(result as any);
    assert(body.found === false, "expected found=false for an unknown capability_id");
    assert(body.reason === "CAPABILITY_NOT_FOUND", `expected reason CAPABILITY_NOT_FOUND, got ${body.reason}`);
  });

  // 8. business-data candidate -> domain rejected by DNA OS itself
  await check("8. submit_registration_candidate (business data) is DOMAIN_REJECTED by the real pipeline", async () => {
    const result = await client.callTool({
      name: "submit_registration_candidate",
      arguments: {
        request_id: `mcp-test-business-${Date.now()}`,
        source_type: "mcp-test",
        source_id: "connections/dna-os-mcp/tests/mcp-server.test.ts",
        evidence_refs: ["connections/dna-os-mcp/tests/mcp-server.test.ts"],
        agentIdentity: { id: "mcp-test-agent", email: "mcp-test@example.com" },
        candidate: {
          candidate_id: `mcp-test-business-candidate-${Date.now()}`,
          canonical_name: "not-a-real-invoice",
          kind: "resource",
          source_location: "connections/dna-os-mcp/tests/mcp-server.test.ts",
          purpose: "prove business data is rejected even when submitted through MCP",
          version: "1.0.0",
          domain: "SOFTWARE_CONTROL_PLANE",
          resource_type: "INVOICE",
          data_classification: "INTERNAL",
          source_system: "dna-os-infrastructure",
          scope: "software_registry",
        },
      },
    });
    const body = structuredOf(result as any);
    assert(body.registration_status === "DOMAIN_REJECTED", `expected DOMAIN_REJECTED even for a spoofed domain field, got ${body.registration_status}`);
  });

  // get_task round-trips a real task_id through DNA OS's own canonical task
  // store. Every command-router step now admits a real Task via
  // admitCompletedTask() (control/agent-gateway/gateway.ts) — one task_id,
  // one meaning: no task_id this router hands out is ever unfindable here,
  // including a non-dispatcher capability like os-login used below.
  await check("get_task finds the real task from a non-dispatcher command (one task_id, one meaning)", async () => {
    const submit = await client.callTool({ name: "submit_command", arguments: { commandText: "ตรวจสถานะ firewall" } });
    const submitBody = structuredOf(submit as any);
    const taskId = submitBody.dna_os_task_id as string;
    assert(typeof taskId === "string" && taskId.startsWith("task-"), "expected a real task_id to query");
    const result = await client.callTool({ name: "get_task", arguments: { task_id: taskId } });
    const body = structuredOf(result as any);
    assert(body.found === true, `expected the real task_id ${taskId} to be found — no task_id should look real but be unfindable`);
    console.log(`  get_task(${taskId}) -> found=${body.found}`);
  });

  // get_system_status returns the real live capability inventory
  await check("get_system_status returns the real live capability inventory", async () => {
    const result = await client.callTool({ name: "get_system_status", arguments: {} });
    const body = structuredOf(result as any);
    const status = body.system_status as Record<string, unknown> | undefined;
    assert(Array.isArray(status?.capabilities), "expected a real capabilities array from /runtime/inventory");
  });

  // 9. no direct database/provider access anywhere in this capability folder — static source check
  await check("9. no direct Postgres/Supabase/GitHub/Vercel access anywhere in connections/dna-os-mcp/", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const folderRoot = join(here, "..");
    const forbidden = [/\bnew Pool\(/, /\bpg\.Pool\b/, /require\(["']pg["']\)/, /from ["']pg["']/, /supabase/i, /octokit/i, /@octokit/i, /\bvercel\b/i, /\bCREATE TABLE\b/i, /\bINSERT INTO\b/i, /\bSELECT \* FROM\b/i, /service[_-]?role/i];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(folderRoot);
    assert(files.length >= 7, `expected to scan at least 7 source files, found ${files.length}`);
    // Strip comments first — this scans real code, not this file's own
    // explanatory docstrings about what is deliberately absent.
    const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const file of files) {
      if (file.endsWith("mcp-server.test.ts")) continue; // this file names the forbidden patterns themselves
      const code = stripComments(readFileSync(file, "utf-8"));
      for (const pattern of forbidden) {
        assert(!pattern.test(code), `forbidden pattern ${pattern} found in ${file}`);
      }
    }
  });

  // MCP Tool Resolver itself: proves CAPABILITY_NOT_AVAILABLE really fires
  // (not just the always-CONNECTED path exercised above), reading the
  // real control/command-router/capability-registry.ts state.
  await check("MCP Tool Resolver blocks a real NOT_CONNECTED capability (file-intelligence) and an unregistered one", () => {
    const notConnected = resolveCapabilityForTool("file-intelligence");
    assert(notConnected.status === "CAPABILITY_NOT_AVAILABLE" && notConnected.reason === "NOT_VERIFIED", `expected NOT_VERIFIED for file-intelligence (NOT_CONNECTED), got ${JSON.stringify(notConnected)}`);
    const unregistered = resolveCapabilityForTool("totally-fake-capability-id");
    assert(unregistered.status === "CAPABILITY_NOT_AVAILABLE" && unregistered.reason === "NOT_REGISTERED", `expected NOT_REGISTERED for an unregistered id, got ${JSON.stringify(unregistered)}`);
    const connected = resolveCapabilityForTool("dispatcher");
    assert(connected.status === "REGISTERED_VERIFIED_AVAILABLE", `expected dispatcher to be REGISTERED_VERIFIED_AVAILABLE, got ${JSON.stringify(connected)}`);
  });

  await client.close();
  await mcpServer.close();

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
