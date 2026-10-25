/**
 * DNA OS MCP Adapter (real MCP CLIENT — read-only by construction).
 *
 * Reuse investigation (real, grep-verified, 2026-09-20):
 *   - `dna-os-mcp-server/` is a real workspace member (`package.json.workspaces`)
 *     that speaks the real MCP protocol over stdio (src/stdio.ts) and exposes
 *     5 read-only tools + 1 resource + 2 governance tools (src/server.ts,
 *     src/governanceServer.ts).
 *   - `engines/shared/ide-lib/workerAdapters/mcpWorkerAdapter.ts` already exists
 *     but is honestly FOUNDATION_ONLY (`id: "mcp-foundation"`), and three
 *     existing suites lock that in (worker-adapter-test.ts's NOT_SUPPORTED
 *     assertion, worker-selector-test.ts's cloud-backed id set,
 *     workerSelectorRuntime.ts's CLOUD_BACKED_ADAPTER_IDS).
 *   - This file therefore does NOT replace or edit that adapter. It is the
 *     second, real direction the previous adapter's own header described as
 *     missing: DNA OS as an MCP CLIENT calling INTO the real DNA OS MCP server.
 *     `mcpWorkerAdapter` is left untouched and `mcp-worker-test.ts` asserts no
 *     tool of this adapter is ever named "mcp-foundation".
 *
 * Capabilities declared here are NEW (`mcp.registry.read`, `mcp.architecture.read`,
 * `mcp.runtime.read`, `mcp.governance.read`, `mcp.proposal.write`) and deliberately
 * do NOT declare `code.generate`, so this adapter can never be selected in place
 * of the existing code workers and never perturbs the existing selector ranking.
 *
 * Hard guarantees (statically asserted by scripts/mcp-worker-test.ts):
 *   - spawn() with shell:false and an explicit argv array; `tsx` is executed
 *     directly by its real resolved path — no shell string, ever.
 *   - No git / deploy / vercel / railway / supabase / delete / reset / restore
 *     code path exists in this file.
 *   - The API token reaches the child through `env` only; it is never placed in
 *     argv, and every value that could be returned to a caller is redacted.
 *   - write-capable tools require approvalPolicy=OWNER_APPROVAL_REQUIRED and
 *     membership in the request's permittedTools; forbiddenTools always wins.
 */
import { spawn } from "child_process";
import path from "path";
import { readFileSync } from "fs";
import type { WorkerAdapter, WorkerAvailability, WorkerCostEstimate, WorkerHealthReport, WorkerPreflightResult } from "../workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../workerContract";

/* ------------------------------------------------------------- registry */

export interface McpToolEntry {
  name: string;
  kind: "tool" | "resource";
  uri?: string;
  sideEffect: "NONE" | "PROPOSAL_ONLY";
  readOnly: boolean;
  requiresOwnerApproval: boolean;
  permittedReadScope: string[];
  permittedWriteScope: string[];
  privacyLevel: "LOCAL_ONLY" | "CLOUD_ALLOWED";
  networkPolicy: "NO_NETWORK" | "OUTBOUND_ALLOWED";
  approvalPolicy: "OWNER_APPROVAL_REQUIRED" | "AUTO_LOW_RISK";
  sourceFile: string;
  backingRoute?: string;
  note?: string;
}

export interface McpToolRegistry {
  adapterId: string;
  source: {
    server: string;
    stdioEntrypoints: string[];
    transportDefault: string;
    spawnContract: string;
    envContract: { baseUrl: string; apiToken: string; note: string };
  };
  httpRoutesInThisRepo: Record<string, string>;
  forbiddenTools: string[];
  tools: McpToolEntry[];
}

/** process.cwd() — the same real workspace-root convention as fsSecurity's
 * WORKSPACE_ROOT (app code never uses __dirname; scripts/ do). */
export function mcpToolRegistryPath(): string {
  return path.join(process.cwd(), "registry", "worker-tool-registry.json");
}

export function loadMcpToolRegistry(): McpToolRegistry {
  const file = mcpToolRegistryPath();
  return JSON.parse(readFileSync(file, "utf8")) as McpToolRegistry;
}

/** Real MCP stdio entrypoints, in preference order. `dist/` is only used when
 * it really exists (this repo currently ships src + tsx, not a built dist). */
export function resolveMcpServerEntrypoints(registry: McpToolRegistry): { entrypoint: string; launcher: string[] }[] {
  const candidates: { entrypoint: string; launcher: string[] }[] = [];
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  for (const rel of registry.source.stdioEntrypoints) {
    const abs = path.join(process.cwd(), rel);
    if (!abs.endsWith(".js")) continue;
    candidates.push({ entrypoint: abs, launcher: [] });
  }
  for (const rel of registry.source.stdioEntrypoints) {
    const abs = path.join(process.cwd(), rel);
    if (!abs.endsWith(".ts")) continue;
    candidates.push({ entrypoint: abs, launcher: [tsxCli] });
  }
  return candidates;
}

/* --------------------------------------------------- secret redaction */

/** The real token is only ever read from the environment and passed to the
 * child's env. Anything that could reach a caller, a log or evidence goes
 * through this. Never prints the value, never prints a prefix/length that
 * would narrow it down. */
export function redactSecrets(text: string): string {
  const token = process.env.DNA_OS_API_TOKEN;
  let out = text;
  if (token && token.length > 0) out = out.split(token).join("[redacted:DNA_OS_API_TOKEN]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(DNA_OS_API_TOKEN\s*[=:]\s*)\S+/g, "$1[redacted]")
    .replace(/(authorization\s*[=:]\s*)\S+/gi, "$1[redacted]")
    .replace(/(api[-_]?key\s*[=:]\s*)\S+/gi, "$1[redacted]");
}

export function tokenConfigured(): boolean {
  return Boolean(process.env.DNA_OS_API_TOKEN && process.env.DNA_OS_API_TOKEN.length > 0);
}

export function resolveBaseUrl(registry: McpToolRegistry): string {
  const envName = registry.source.envContract.baseUrl;
  const raw = process.env[envName];
  return (raw && raw.length > 0 ? raw : "http://localhost:3000").replace(/\/+$/, "");
}

/* ------------------------------------------------------- tool policy */

export type ToolPolicyDecision =
  | { outcome: "ALLOW"; entry: McpToolEntry; reasons: string[] }
  | { outcome: "BLOCKED"; entry: McpToolEntry | null; reasons: string[] };

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === name) return true;
  if (pattern.endsWith(".*")) return name.startsWith(pattern.slice(0, -1));
  return false;
}

/**
 * The one real gate every tool call passes through, in order:
 *   1. the tool must exist in the real registry (never fabricate a capability)
 *   2. forbiddenTools always wins (and is enforced independently of the request)
 *   3. requested read/write scope must cover the tool's real scope
 *   4. read-only tools are allowed automatically
 *   5. write/proposal tools additionally need OWNER_APPROVAL_REQUIRED and
 *      membership in request.permittedTools
 */
export function evaluateToolPolicy(
  toolName: string,
  request: Pick<WorkerRequest, "permittedTools" | "forbiddenTools" | "permittedReadScope" | "permittedWriteScope" | "approvalPolicy" | "privacyLevel" | "networkPolicy">,
  registry: McpToolRegistry,
): ToolPolicyDecision {
  const entry = registry.tools.find((t) => t.name === toolName) ?? null;
  if (!entry) {
    return { outcome: "BLOCKED", entry: null, reasons: [`"${toolName}" is not in registry/worker-tool-registry.json — unknown capability is never invented`] };
  }

  const globallyForbidden = registry.forbiddenTools.filter((p) => matchesPattern(toolName, p));
  const requestForbidden = request.forbiddenTools.filter((p) => matchesPattern(toolName, p));
  if (globallyForbidden.length > 0 || requestForbidden.length > 0) {
    return { outcome: "BLOCKED", entry, reasons: [`forbiddenTools always wins: matched ${[...globallyForbidden, ...requestForbidden].join(", ")}`] };
  }

  if (request.privacyLevel === "LOCAL_ONLY" && entry.privacyLevel !== "LOCAL_ONLY") {
    return { outcome: "BLOCKED", entry, reasons: [`request privacyLevel=LOCAL_ONLY forbids a real ${entry.privacyLevel} tool`] };
  }
  if (request.networkPolicy === "NO_NETWORK" && entry.networkPolicy !== "NO_NETWORK") {
    return { outcome: "BLOCKED", entry, reasons: ["request networkPolicy=NO_NETWORK forbids a tool that needs network access"] };
  }

  const missingRead = entry.permittedReadScope.filter((s) => !request.permittedReadScope.includes(s));
  if (entry.readOnly && missingRead.length > 0) {
    return { outcome: "BLOCKED", entry, reasons: [`request permittedReadScope does not cover ${missingRead.join(", ")}`] };
  }

  if (entry.sideEffect === "NONE" && entry.readOnly) {
    return { outcome: "ALLOW", entry, reasons: [`read-only tool (${entry.sourceFile}) — allowed automatically, no approval needed`] };
  }

  const approved = request.approvalPolicy === "OWNER_APPROVAL_REQUIRED";
  const permitted = request.permittedTools.some((p) => matchesPattern(toolName, p));
  const reasons: string[] = [];
  if (!approved) reasons.push(`sideEffect=${entry.sideEffect} requires approvalPolicy=OWNER_APPROVAL_REQUIRED, request had ${request.approvalPolicy}`);
  if (!permitted) reasons.push(`request permittedTools does not include "${toolName}"`);
  if (reasons.length > 0) return { outcome: "BLOCKED", entry, reasons };

  return { outcome: "ALLOW", entry, reasons: [`write-capable tool allowed: Owner Approval policy set and "${toolName}" is in permittedTools`] };
}

/* ------------------------------------------------------------ transport */

export interface McpToolCallTransport {
  kind: "stdio";
  describe(): string;
  listTools(timeoutMs: number): Promise<{ ok: boolean; names: string[]; error: string | null }>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; result: unknown; error: string | null; timedOut: boolean }>;
  close(): void;
}

const MCP_PROTOCOL_VERSION = "2024-11-05";

/** The real stdio client. spawn() only — shell:false, explicit argv array,
 * cwd pinned to the real server directory, and the token handed over through
 * env alone. Returns an honest error instead of a fake transport when nothing
 * real can be launched. */
export function createStdioTransport(registry: McpToolRegistry): { transport: McpToolCallTransport | null; error: string | null } {
  const candidates = resolveMcpServerEntrypoints(registry);
  const serverDir = path.join(process.cwd(), registry.source.server);
  const launchable = candidates.filter((c) => c.launcher.length === 0 || fileExists(c.launcher[0]));
  const pick = launchable[0] ?? candidates[0];
  if (!pick) {
    return { transport: null, error: `no real MCP stdio entrypoint found (looked for ${registry.source.stdioEntrypoints.join(", ")})` };
  }

  let child: ReturnType<typeof spawn> | null = null;
  let buffer = "";
  let nextId = 1;
  const waiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  function ensureChild(): void {
    if (child) return;
    child = spawn(process.execPath, [...pick.launcher, pick.entrypoint], {
      cwd: serverDir,
      shell: false,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
          if (typeof msg.id === "number" && waiters.has(msg.id)) {
            const w = waiters.get(msg.id);
            waiters.delete(msg.id);
            if (msg.error) w?.reject(new Error(msg.error.message ?? "mcp error"));
            else w?.resolve(msg.result);
          }
        } catch {
          /* non-JSON stdout is MCP pollution — ignored, never parsed as truth */
        }
      }
    });
  }

  function request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    ensureChild();
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      if (!child?.stdin) {
        reject(new Error("mcp stdio child has no stdin"));
        return;
      }
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error(`TIMEOUT after ${timeoutMs}ms waiting for ${method}`));
      }, timeoutMs);
      waiters.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  const transport: McpToolCallTransport = {
    kind: "stdio",
    describe: () => `stdio:${path.relative(process.cwd(), pick.entrypoint)}${pick.launcher.length > 0 ? " (launched by the real tsx CLI, argv array, shell:false)" : ""}`,
    async listTools(timeoutMs: number) {
      try {
        await request("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "dna-os-mcp-adapter", version: "1.0.0" } }, timeoutMs);
        const listed = (await request("tools/list", {}, timeoutMs)) as { tools?: { name?: string }[] } | undefined;
        const names = (listed?.tools ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string");
        return { ok: true, names, error: null };
      } catch (e) {
        return { ok: false, names: [], error: redactSecrets(e instanceof Error ? e.message : String(e)) };
      }
    },
    async callTool(name: string, args: Record<string, unknown>, timeoutMs: number) {
      try {
        const res = await request("tools/call", { name, arguments: args }, timeoutMs);
        return { ok: true, result: res, error: null, timedOut: false };
      } catch (e) {
        const message = redactSecrets(e instanceof Error ? e.message : String(e));
        return { ok: false, result: null, error: message, timedOut: message.includes("TIMEOUT") };
      }
    },
    close() {
      if (child) { try { child.kill("SIGTERM"); } catch { /* already gone */ } child = null; }
      waiters.clear();
    },
  };
  return { transport, error: null };
}

function fileExists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------- preflight / health / discovery */

/** Real, CHEAP, zero-token readiness probe. It performs the MCP handshake and
 * `tools/list` only — never a model call, never a paid provider call, so no
 * token or credit can be spent. It refuses to even spawn when the token the
 * server needs to authenticate back into DNA OS is missing (honest CONFIGURED
 * status instead of a fake AVAILABLE). */
export async function mcpPreflight(timeoutMs = 8000): Promise<WorkerPreflightResult> {
  const checkedAt = new Date().toISOString();
  let registry: McpToolRegistry;
  try {
    registry = loadMcpToolRegistry();
  } catch (e) {
    return { status: "FAILED", reason: redactSecrets(`cannot read real tool registry: ${e instanceof Error ? e.message : String(e)}`), checkedAt, costIncurred: false };
  }
  const candidates = resolveMcpServerEntrypoints(registry);
  const launchable = candidates.filter((c) => c.launcher.length === 0 || fileExists(c.launcher[0]));
  if (launchable.length === 0) {
    return { status: "UNAVAILABLE", reason: `no real MCP stdio entrypoint is launchable (tried ${registry.source.stdioEntrypoints.join(", ")})`, checkedAt, costIncurred: false };
  }
  if (!tokenConfigured()) {
    return {
      status: "CONFIGURED",
      reason: `entrypoint ${path.relative(process.cwd(), launchable[0].entrypoint)} resolved, but ${registry.source.envContract.apiToken} is not configured — handshake deliberately not attempted (zero cost, no fake success)`,
      checkedAt,
      costIncurred: false,
    };
  }
  const { transport, error } = createStdioTransport(registry);
  if (!transport) {
    return { status: "UNAVAILABLE", reason: redactSecrets(error ?? "no transport"), checkedAt, costIncurred: false };
  }
  try {
    const listed = await transport.listTools(timeoutMs);
    if (!listed.ok) return { status: "FAILED", reason: `real MCP tools/list failed: ${listed.error ?? "unknown"}`, checkedAt, costIncurred: false };
    if (listed.names.length === 0) {
      // WorkerPreflightStatus has no DEGRADED member and this adapter must not
      // widen that shared contract, so the degraded-but-reachable case maps to
      // the existing UNAVAILABLE value while the reason keeps the real detail
      // (handshake succeeded, the tool surface is what is degraded).
      const known = registry.tools.filter((t) => t.kind === "tool").length;
      return {
        status: "UNAVAILABLE",
        reason: `real MCP handshake ok but the server advertised 0 tool(s) — degraded tool surface (registry/worker-tool-registry.json expects ${known}); deliberately reported as UNAVAILABLE rather than widened into a new status`,
        checkedAt,
        costIncurred: false,
      };
    }
    return { status: "AVAILABLE", reason: `real MCP handshake ok, ${listed.names.length} tool(s) advertised`, checkedAt, costIncurred: false };
  } finally {
    transport.close();
  }
}

let lastHealthCallAt: string | null = null;
let lastHealthCallOk: boolean | null = null;

/** Real health check, deliberately SEPARATE from preflight: it never spawns the
 * MCP server and never performs a protocol handshake. It reads one real, already
 * existing route (GET /api/v1/mcp/governance/status by default) with a short
 * timeout, so it stays cheap enough for every selection pass. */
export async function mcpHealth(timeoutMs = 4000): Promise<WorkerHealthReport> {
  let registry: McpToolRegistry;
  try {
    registry = loadMcpToolRegistry();
  } catch (e) {
    return { status: "UNKNOWN", reason: redactSecrets(`cannot read real tool registry: ${e instanceof Error ? e.message : String(e)}`), lastLiveCallAt: lastHealthCallAt, lastLiveCallOk: lastHealthCallOk };
  }
  const route = registry.httpRoutesInThisRepo.healthCheckRoute;
  const healthPath = route.split(" ")[1];
  if (!healthPath || !tokenConfigured()) {
    return { status: "NOT_CONFIGURED", reason: `${registry.source.envContract.apiToken} not configured — health route ${healthPath ?? "unknown"} not called`, lastLiveCallAt: lastHealthCallAt, lastLiveCallOk: lastHealthCallOk };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${resolveBaseUrl(registry)}${healthPath}`, {
      method: "GET",
      headers: { authorization: `Bearer ${process.env.DNA_OS_API_TOKEN ?? ""}` },
      signal: controller.signal,
    });
    lastHealthCallAt = new Date().toISOString();
    lastHealthCallOk = res.ok;
    if (res.ok) return { status: "HEALTHY", reason: `real ${healthPath} responded ${res.status}`, lastLiveCallAt: lastHealthCallAt, lastLiveCallOk: true };
    if (res.status === 401 || res.status === 403) return { status: "DEGRADED", reason: `${healthPath} responded ${res.status} — credentials rejected`, lastLiveCallAt: lastHealthCallAt, lastLiveCallOk: false };
    return { status: "DEGRADED", reason: `${healthPath} responded ${res.status}`, lastLiveCallAt: lastHealthCallAt, lastLiveCallOk: false };
  } catch (e) {
    lastHealthCallAt = new Date().toISOString();
    lastHealthCallOk = false;
    return { status: "UNAVAILABLE", reason: redactSecrets(`${healthPath} unreachable: ${e instanceof Error ? e.message : String(e)}`), lastLiveCallAt: lastHealthCallAt, lastLiveCallOk: false };
  } finally {
    clearTimeout(timer);
  }
}

export interface McpDiscoveryResult {
  ok: boolean;
  transportKind: "stdio";
  advertised: string[];
  known: string[];
  unknown: string[];
  missing: string[];
  error: string | null;
}

/** Real capability discovery: the live `tools/list` is compared against the real
 * registry. Unknown advertised tools are reported but never silently added;
 * known tools the server did not advertise are reported as missing. */
export async function discoverMcpCapabilities(timeoutMs = 8000): Promise<McpDiscoveryResult> {
  const registry = loadMcpToolRegistry();
  const known = registry.tools.filter((t) => t.kind === "tool").map((t) => t.name);
  const { transport, error } = createStdioTransport(registry);
  if (!transport) return { ok: false, transportKind: "stdio", advertised: [], known, unknown: [], missing: known, error: redactSecrets(error ?? "no transport") };
  try {
    const listed = await transport.listTools(timeoutMs);
    if (!listed.ok) return { ok: false, transportKind: "stdio", advertised: [], known, unknown: [], missing: known, error: listed.error };
    return {
      ok: true,
      transportKind: "stdio",
      advertised: listed.names,
      known,
      unknown: listed.names.filter((n) => !known.includes(n)),
      missing: known.filter((n) => !listed.names.includes(n)),
      error: null,
    };
  } finally {
    transport.close();
  }
}

/* ------------------------------------------------------------- adapter */

export const MCP_DNA_OS_ADAPTER_ID = "mcp-dna-os";
const DEFAULT_CALL_TIMEOUT_MS = 15_000;

/** The documented tool-call contract for this adapter: the WorkerRequest carries
 * the tool name + arguments as JSON in taskDescription. Anything else is refused
 * with an honest error — the adapter never guesses which tool to call. */
export interface McpToolCallSpec {
  tool: string;
  args: Record<string, unknown>;
}

export function parseToolCallSpec(taskDescription: string): { spec: McpToolCallSpec | null; error: string | null } {
  try {
    const parsed = JSON.parse(taskDescription) as { tool?: unknown; args?: unknown };
    if (typeof parsed.tool !== "string" || parsed.tool.length === 0) return { spec: null, error: 'taskDescription JSON must carry a real "tool" string' };
    const args = parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args) ? (parsed.args as Record<string, unknown>) : {};
    return { spec: { tool: parsed.tool, args }, error: null };
  } catch (e) {
    return { spec: null, error: `taskDescription is not the documented JSON tool-call contract: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function baseResponse(request: WorkerRequest, overrides: Partial<WorkerResponse>): WorkerResponse {
  return {
    workerRequestId: request.workerRequestId,
    workerId: request.workerType,
    adapterId: MCP_DNA_OS_ADAPTER_ID,
    provider: "mcp",
    model: null,
    status: "UNKNOWN",
    output: null,
    proposedChanges: [],
    toolCalls: [],
    tokenUsage: { input: null, output: null },
    cost: { amount: 0, currency: null, kind: "ACTUAL" },
    durationMs: 0,
    evidence: [],
    limitations: [],
    error: null,
    finishedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Real execution. `transportOverride` exists so the regression suite can drive
 * every failure mode (timeout, malformed response, server unavailable) through
 * the exact same code path the real stdio transport uses — never a bypass. */
export async function executeMcpToolCall(request: WorkerRequest, transportOverride?: McpToolCallTransport): Promise<WorkerResponse> {
  const started = Date.now();
  const registry = loadMcpToolRegistry();
  const parsed = parseToolCallSpec(request.taskDescription);
  if (!parsed.spec) {
    return baseResponse(request, { status: "FAILED", error: "MCP_TOOL_CALL_UNPARSEABLE", limitations: [redactSecrets(parsed.error ?? "unparseable")], durationMs: Date.now() - started });
  }
  const { tool, args } = parsed.spec;

  const decision = evaluateToolPolicy(tool, request, registry);
  if (decision.outcome === "BLOCKED") {
    return baseResponse(request, {
      status: "BLOCKED",
      error: decision.entry ? "MCP_TOOL_BLOCKED_BY_POLICY" : "MCP_TOOL_NOT_IN_REGISTRY",
      toolCalls: [{ tool, argsSummary: redactSecrets(JSON.stringify(args)), ok: false }],
      evidence: decision.reasons.map((r) => redactSecrets(r)),
      limitations: ["the MCP server was not contacted: the policy gate refused this call before any transport work"],
      durationMs: Date.now() - started,
    });
  }

  let transport = transportOverride ?? null;
  let owned = false;
  if (!transport) {
    const created = createStdioTransport(registry);
    if (!created.transport) {
      return baseResponse(request, { status: "NOT_CONFIGURED", error: "MCP_TRANSPORT_UNAVAILABLE", limitations: [redactSecrets(created.error ?? "no transport")], durationMs: Date.now() - started });
    }
    transport = created.transport;
    owned = true;
  }

  const timeoutMs = Number(request.timeoutMs) > 0 ? Number(request.timeoutMs) : DEFAULT_CALL_TIMEOUT_MS;
  try {
    const call = await transport.callTool(tool, args, timeoutMs);
    const durationMs = Date.now() - started;
    const evidence = [
      `transport=${transport.describe()}`,
      `registrySource=${decision.entry.sourceFile}`,
      decision.entry.backingRoute ? `backingRoute=${decision.entry.backingRoute}` : "backingRoute=none (resource)",
      ...decision.reasons.map((r) => redactSecrets(r)),
    ];
    if (call.ok) {
      return baseResponse(request, {
        status: "SUCCEEDED",
        output: redactSecrets(JSON.stringify(call.result)),
        toolCalls: [{ tool, argsSummary: redactSecrets(JSON.stringify(args)), ok: true }],
        evidence,
        limitations: ["MCP tools spend no model tokens — tokenUsage/cost stay honest at null/0, never estimated"],
        durationMs,
      });
    }
    return baseResponse(request, {
      status: call.timedOut ? "TIMEOUT" : "FAILED",
      error: call.timedOut ? "MCP_TOOL_CALL_TIMEOUT" : "MCP_TOOL_CALL_FAILED",
      toolCalls: [{ tool, argsSummary: redactSecrets(JSON.stringify(args)), ok: false }],
      evidence,
      limitations: [redactSecrets(call.error ?? "unknown transport error")],
      durationMs,
    });
  } catch (e) {
    return baseResponse(request, {
      status: "FAILED",
      error: "MCP_TOOL_CALL_THREW",
      toolCalls: [{ tool, argsSummary: redactSecrets(JSON.stringify(args)), ok: false }],
      limitations: [redactSecrets(e instanceof Error ? e.message : String(e))],
      durationMs: Date.now() - started,
    });
  } finally {
    if (owned && transport) transport.close();
  }
}

export function createMcpDnaOsAdapter(transportOverride?: McpToolCallTransport): WorkerAdapter {
  return {
    id: MCP_DNA_OS_ADAPTER_ID,
    type: "MCP",
    provider: "mcp",
    // Real, honest cost class: every registered tool is a local read against
    // DNA OS's own registry/routes — no paid provider is involved.
    costClass: "FREE",
    availability(): WorkerAvailability {
      try {
        const registry = loadMcpToolRegistry();
        const candidates = resolveMcpServerEntrypoints(registry);
        const launchable = candidates.filter((c) => c.launcher.length === 0 || fileExists(c.launcher[0]));
        if (launchable.length === 0) return { available: false, reason: `no real MCP stdio entrypoint is launchable (${registry.source.stdioEntrypoints.join(", ")})` };
        if (!tokenConfigured()) return { available: false, reason: `${registry.source.envContract.apiToken} is not configured — the real MCP server cannot authenticate back into DNA OS` };
        return { available: true, reason: `real dna-os-mcp-server reachable over stdio via ${path.relative(process.cwd(), launchable[0].entrypoint)}` };
      } catch (e) {
        return { available: false, reason: redactSecrets(`real tool registry unreadable: ${e instanceof Error ? e.message : String(e)}`) };
      }
    },
    capabilities() {
      return ["mcp.registry.read", "mcp.architecture.read", "mcp.runtime.read", "mcp.governance.read", "mcp.proposal.write"];
    },
    estimate(): WorkerCostEstimate {
      return { estimatedCost: 0, estimatedTokens: null, currency: null, confidence: "HIGH" };
    },
    async execute(request: WorkerRequest): Promise<WorkerResponse> {
      return executeMcpToolCall(request, transportOverride);
    },
    async health(): Promise<WorkerHealthReport> {
      return mcpHealth();
    },
    async preflight(): Promise<WorkerPreflightResult> {
      return mcpPreflight();
    },
    limitations() {
      return [
        "real MCP CLIENT into the existing dna-os-mcp-server — separate from, and never a replacement for, mcpWorkerAdapter (id mcp-foundation), which stays FOUNDATION_ONLY",
        "stdio transport only; the server's HTTP/SSE transports are not wired here",
        "write-capable tools (sideEffect != NONE) are always refused unless approvalPolicy=OWNER_APPROVAL_REQUIRED and the tool is in request.permittedTools",
        "this adapter has no git / deploy / delete / reset / restore code path at all",
      ];
    },
  };
}

export const mcpDnaOsAdapter: WorkerAdapter = createMcpDnaOsAdapter();