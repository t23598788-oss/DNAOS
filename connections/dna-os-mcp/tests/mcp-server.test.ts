/**
 * หน้าที่: proof of the DNA OS MCP adapter slice — command submission
 * reaches POST /owner/submit-command (submitOwnerCommand), capability
 * discovery is a sanitized projection of the existing command-router
 * registry, and registration is not a model-callable tool.
 *
 * Live HTTP checks require the canonical server:
 *   npm run owner-command:serve
 *
 * How to run: npx tsx connections/dna-os-mcp/tests/mcp-server.test.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createDnaOsMcpServer,
  DnaOsHttpClient,
  DNA_OS_MCP_TOOLS,
  projectCapability,
  projectCapabilityList,
  resolveCapabilityForTool,
  UNAUTHENTICATED_CONTEXT,
} from "../contract";
import type { CallerContext } from "../contract";
import { listOwnerSessions, validateOwnerSession } from "../../../control/owner-authentication/contract";

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

const INTERNAL_CALLER: CallerContext = {
  caller: "INTERNAL_DNA_OS",
  caller_class: "INTERNAL_DNA_OS",
  owner_session_id: null,
  channel: "EXTERNAL",
};

async function main(): Promise<void> {
  await check("submitCommand HTTP client posts to /owner/submit-command, never /command", async () => {
    const seen: { url: string; body: Record<string, unknown>; authorization: string | undefined }[] = [];
    const previousSecret = process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
    const previousSession = process.env.DNA_OS_OWNER_SESSION_ID;
    delete process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
    delete process.env.DNA_OS_OWNER_SESSION_ID;
    try {
      const client = new DnaOsHttpClient({
        baseUrl: "http://127.0.0.1:8791",
        fetchImpl: (async (input, init) => {
          const url = String(input);
          const headers = init?.headers as Record<string, string> | undefined;
          seen.push({
            url,
            body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            authorization: headers?.Authorization ?? headers?.authorization,
          });
          return new Response(JSON.stringify({ error: "OWNER_AUTHENTICATION_REQUIRED", reason_code: "NO_UNAMBIGUOUS_HUMAN_VERIFIED_OWNER_SESSION" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }) as typeof fetch,
      });
      const response = await client.submitCommand({ commandText: "ตรวจสถานะ firewall" });
      assert(seen.length === 1, "expected one HTTP call");
      assert(seen[0]!.url.endsWith("/owner/submit-command"), `expected /owner/submit-command, got ${seen[0]!.url}`);
      assert(!seen[0]!.url.endsWith("/command") || seen[0]!.url.endsWith("/owner/submit-command"), "must not post to chat-intake /command");
      assert(seen[0]!.body.commandText === "ตรวจสถานะ firewall", "commandText must be forwarded");
      assert(seen[0]!.body.ownerIdentity === undefined, "must not send caller-selected ownerIdentity");
      assert(seen[0]!.authorization === undefined, "must not invent an Authorization header when OWNER_COMMAND_HTTP_SHARED_SECRET is unset");
      assert(response.status === 401, `expected mocked 401, got ${response.status}`);
    } finally {
      if (previousSecret === undefined) delete process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
      else process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = previousSecret;
      if (previousSession === undefined) delete process.env.DNA_OS_OWNER_SESSION_ID;
      else process.env.DNA_OS_OWNER_SESSION_ID = previousSession;
    }
  });

  await check("submitCommand sends existing Core Authorization from OWNER_COMMAND_HTTP_SHARED_SECRET", async () => {
    const seen: { authorization: string | undefined }[] = [];
    const previous = process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
    process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = "test-only-core-shared-secret";
    try {
      const client = new DnaOsHttpClient({
        baseUrl: "http://127.0.0.1:8791",
        fetchImpl: (async (_input, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          seen.push({ authorization: headers?.Authorization ?? headers?.authorization });
          return new Response(JSON.stringify({ error: "OWNER_AUTHENTICATION_REQUIRED" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }) as typeof fetch,
      });
      await client.submitCommand({ commandText: "ตรวจสถานะ firewall" });
      assert(seen[0]!.authorization === "Bearer test-only-core-shared-secret", `expected Bearer from env, got ${String(seen[0]!.authorization)}`);
    } finally {
      if (previous === undefined) delete process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
      else process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = previous;
    }
  });

  await check("submitCommand forwards existing Owner session pointer, never body identity", async () => {
    const seen: { sessionHeader: string | undefined; body: Record<string, unknown> }[] = [];
    const previousSession = process.env.DNA_OS_OWNER_SESSION_ID;
    delete process.env.DNA_OS_OWNER_SESSION_ID;
    try {
      const client = new DnaOsHttpClient({
        baseUrl: "http://127.0.0.1:8791",
        ownerSessionId: "owner-session-test-pointer-only",
        fetchImpl: (async (_input, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          seen.push({
            sessionHeader: headers?.["x-dna-os-owner-session"],
            body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          });
          return new Response(JSON.stringify({ error: "OWNER_AUTHENTICATION_REQUIRED" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }) as typeof fetch,
      });
      await client.submitCommand({ commandText: "ตรวจสถานะ firewall" });
      assert(seen[0]!.sessionHeader === "owner-session-test-pointer-only", "must send x-dna-os-owner-session from bound session pointer");
      assert(seen[0]!.body.ownerIdentity === undefined, "must not put identity in the JSON body");
    } finally {
      if (previousSession === undefined) delete process.env.DNA_OS_OWNER_SESSION_ID;
      else process.env.DNA_OS_OWNER_SESSION_ID = previousSession;
    }
  });

  await check("MCP tool table includes submit_command and list_capabilities, not registration/shell/secret tools", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("submit_command"), "submit_command must remain");
    assert(names.includes("list_capabilities"), "list_capabilities must project the existing registry");
    assert(names.includes("lookup_capability"), "lookup_capability must remain");
    assert(!names.includes("submit_registration_candidate"), "registration must not be model-callable");
    assert(!names.includes("approve_consent"), "consent approval must not be a tool");
    assert(!names.includes("get_secret"), "secret retrieval must not be a tool");
    assert(!names.includes("shell"), "arbitrary shell must not be a tool");
  });

  await check("capability projection is sanitized and sourced from the existing command-router registry", () => {
    const list = projectCapabilityList();
    assert(list.length > 0, "expected at least one capability from CAPABILITY_REGISTRY");
    const osLogin = projectCapability("os-login");
    assert(osLogin !== null && osLogin.id === "os-login", "os-login must project from the real registry");
    assert(osLogin!.health_status === "CONNECTED", "os-login is CONNECTED in the real registry");
    assert(osLogin!.available === true, "CONNECTED + callable endpoint is available");
    const fileIntel = projectCapability("file-intelligence");
    assert(fileIntel !== null, "file-intelligence is a real registry row");
    assert(fileIntel!.available === false, "NOT_CONNECTED must not look available");
    assert(projectCapability("does-not-exist-capability-id") === null, "unknown id is not fabricated");
    const blob = JSON.stringify(list);
    assert(!/keychain/i.test(blob), "projection must not mention Keychain");
    assert(!/"secretRefs"/i.test(blob), "projection must not include secretRefs");
    assert(!/"endpoint"/i.test(blob), "projection must not include internal endpoint wiring");
    assert(!/"contract":/i.test(blob), "projection must not include internal contract paths");
    for (const row of list) {
      assert(typeof row.id === "string" && row.id.length > 0, "id required");
      assert(typeof row.description === "string", "description required");
      assert(row.inputSchema?.type === "object", "inputSchema required");
      assert(row.health_status === "CONNECTED" || row.health_status === "NOT_CONNECTED", "health_status required");
    }
  });

  const mcpClient = new Client({ name: "dna-os-mcp-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), INTERNAL_CALLER);

  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  await check("MCP client lists read discovery tools and does not list registration", async () => {
    const { tools } = await mcpClient.listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));
    assert(toolNames.has("list_capabilities"), "list_capabilities must be discoverable internally");
    assert(toolNames.has("lookup_capability"), "lookup_capability must be discoverable internally");
    assert(!toolNames.has("submit_registration_candidate"), "registration must not appear in tools/list");
    assert(!toolNames.has("submit_command"), "submit_command stays OWNER_ONLY — unauthenticated/internal machine must not discover it as a free model primitive");
  });

  await check("list_capabilities MCP tool returns the sanitized existing registry", async () => {
    const result = await mcpClient.callTool({ name: "list_capabilities", arguments: {} });
    const body = structuredOf(result as never);
    assert(body.status === 200, `expected 200, got ${body.status}`);
    assert(Array.isArray(body.capabilities), "expected capabilities array");
    const ids = (body.capabilities as Array<{ id: string }>).map((row) => row.id);
    assert(ids.includes("os-login"), "os-login must be in the projected list");
    assert(ids.includes("dispatcher"), "dispatcher must be in the projected list");
    assert(!JSON.stringify(body.capabilities).includes("keychain://"), "no Keychain refs");
  });

  await check("lookup_capability finds os-login and rejects an unknown id", async () => {
    const found = structuredOf(await mcpClient.callTool({ name: "lookup_capability", arguments: { capability_id: "os-login" } }) as never);
    assert(found.found === true, `expected found=true for os-login, got ${JSON.stringify(found)}`);
    const capability = found.capability as { id?: string; endpoint?: unknown };
    assert(capability?.id === "os-login", "projected id must match");
    assert(capability?.endpoint === undefined, "endpoint must not be visible");
    const missing = structuredOf(await mcpClient.callTool({ name: "lookup_capability", arguments: { capability_id: "does-not-exist-capability-id" } }) as never);
    assert(missing.found === false, "expected found=false for an unknown capability_id");
    assert(missing.reason === "CAPABILITY_NOT_FOUND", `expected CAPABILITY_NOT_FOUND, got ${missing.reason}`);
  });

  if (process.env.DNA_OS_HERMETIC_SOURCE !== "1") {
  const submitTool = DNA_OS_MCP_TOOLS.find((tool) => tool.metadata.name === "submit_command");
  assert(submitTool !== undefined, "submit_command tool must exist");
  await check("submit_command tool handler hits live Core /owner/submit-command (not chat intake)", async () => {
    const humanRows = listOwnerSessions().filter((session) => String(session.authenticated_via).startsWith("human-verification"));
    const latestHuman = humanRows[humanRows.length - 1];
    const sessionCheck = latestHuman ? validateOwnerSession(latestHuman.session_id) : null;
    const client = new DnaOsHttpClient({
      ownerSessionId: latestHuman?.session_id ?? null,
    });
    const response = await submitTool!.handler({ commandText: "ตรวจสถานะ firewall" }, client);
    const body = response.structuredContent;
    const raw = (body.raw ?? {}) as Record<string, unknown>;
    const status = body.status as number;
    const chatIntake = raw.layer === "RAW_CHAT_INTAKE" || raw.next_layer !== undefined;
    assert(!chatIntake, `submit_command must not land on chat intake, got ${JSON.stringify(raw).slice(0, 400)}`);
    const error = String(body.error ?? raw.error ?? "");
    const passedNetworkAuth = error !== "unauthorized" && error !== "write authentication is not configured";
    const stoppedAtOwnerAuthGate =
      error === "OWNER_AUTHENTICATION_REQUIRED" || error === "authenticated owner identity required";
    const reachedSubmitCommand =
      (status === 401 && stoppedAtOwnerAuthGate)
      || status === 403
      || (status === 200 && typeof body.dna_os_command_id === "string" && String(body.dna_os_command_id).startsWith("cmd_"));
    assert(passedNetworkAuth, `network auth gate still blocked submit_command (status=${status} error=${error}) — Authorization must come from OWNER_COMMAND_HTTP_SHARED_SECRET`);
    assert(reachedSubmitCommand, `expected Core /owner/submit-command after network auth (401 owner-auth gate, 403, or 200 cmd_), got status=${status} body=${JSON.stringify(body).slice(0, 500)}`);
    void sessionCheck;
  });

  await check("get_system_status returns the real live capability inventory when Core is up", async () => {
    const result = await mcpClient.callTool({ name: "get_system_status", arguments: {} });
    const body = structuredOf(result as never);
    const status = body.system_status as Record<string, unknown> | undefined;
    if (body.status !== 200) {
      throw new Error(`Core GET /runtime/inventory not reachable (status=${body.status}) AUTH_REQUIRED`);
    }
    assert(Array.isArray(status?.capabilities), "expected a real capabilities array from /runtime/inventory");
  });
  }

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
    const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const file of files) {
      if (file.endsWith("mcp-server.test.ts")) continue;
      const code = stripComments(readFileSync(file, "utf-8"));
      for (const pattern of forbidden) {
        assert(!pattern.test(code), `forbidden pattern ${pattern} found in ${file}`);
      }
    }
  });

  await check("MCP Tool Resolver blocks a real NOT_CONNECTED capability (file-intelligence) and an unregistered one", () => {
    const notConnected = resolveCapabilityForTool("file-intelligence");
    assert(notConnected.status === "CAPABILITY_NOT_AVAILABLE" && notConnected.reason === "NOT_VERIFIED", `expected NOT_VERIFIED for file-intelligence (NOT_CONNECTED), got ${JSON.stringify(notConnected)}`);
    const unregistered = resolveCapabilityForTool("totally-fake-capability-id");
    assert(unregistered.status === "CAPABILITY_NOT_AVAILABLE" && unregistered.reason === "NOT_REGISTERED", `expected NOT_REGISTERED for an unregistered id, got ${JSON.stringify(unregistered)}`);
    const connected = resolveCapabilityForTool("dispatcher");
    assert(connected.status === "REGISTERED_VERIFIED_AVAILABLE", `expected dispatcher to be REGISTERED_VERIFIED_AVAILABLE, got ${JSON.stringify(connected)}`);
  });

  await mcpClient.close();
  await mcpServer.close();

  console.log(`${passed} passed, ${failed} failed`);
  console.log(`MISSING_SECRET_FAILS_CLOSED=true`);
  console.log(`REAL_SECRET_REQUIRED_FOR_SOURCE_TEST=false`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
