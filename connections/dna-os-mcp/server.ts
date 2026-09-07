/**
 * หน้าที่: the DNA OS Canonical MCP Server — External Agent Boundary only.
 * Builds one `McpServer` (from the current MCP TypeScript SDK,
 * `@modelcontextprotocol/sdk`) registering the tools in
 * ./tool-registry.ts, and serves it over two transports: Streamable HTTP
 * (canonical remote transport, `POST /mcp`) and stdio (for a local
 * Agent host process). No deprecated HTTP+SSE transport is used.
 *
 * Every tool handler reaches DNA OS only through
 * ./adapters/dna-os-http-client.ts, which itself only calls DNA OS's own
 * already-canonical HTTP transport (transport/owner-command-http/server.ts,
 * default http://127.0.0.1:8791). This file introduces no new decision
 * engine, registry, dispatcher, or credential system — it is purely a
 * protocol adapter in front of what already exists.
 *
 * Input: HTTP POST /mcp (Streamable HTTP, MCP JSON-RPC framing), or stdio
 * when launched with `--stdio`.
 * Output: MCP protocol responses only.
 * Dependency ที่อนุญาต: ./tool-registry.ts, ./adapters/dna-os-http-client.ts,
 * @modelcontextprotocol/sdk.
 * สิ่งที่ห้ามแตะ: never import anything from software/registry-database/,
 * control/agent-gateway/, permissions/, or credentials/ directly here —
 * every real DNA OS capability is reached only through the HTTP client,
 * never a direct in-process import. Never bind the HTTP transport to a
 * non-loopback host by default.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canDiscover, canInvoke, policyFor, type CallerContext } from "./export-policy";
import { callerContextFromHttp, callerContextFromStdio, UNAUTHENTICATED_CONTEXT } from "./caller-context";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DNA_OS_MCP_TOOLS } from "./tool-registry";
import { DnaOsHttpClient } from "./adapters/dna-os-http-client";

/**
 * EXPORT POLICY (Owner, 2026-09-05) — ประตูเพิ่ม ไม่ใช่ตัวแทนของด่านเดิม
 *
 * เดิม server ลงทะเบียนทั้งเจ็ดเครื่องมือให้ client ทุกตัวเท่ากันหมด รวมถึง
 * `submit_command` which is Owner command execution.
 *
 * สองด่านแยกกัน:
 * - DISCOVER กรองตอน registerTool เครื่องมือที่ผู้เรียกไม่มีสิทธิ์เห็นจะไม่ถูก
 *   ลงทะเบียน จึงไม่โผล่ใน tools/list และเรียกไม่ได้ในตัว
 * - INVOKE ตรวจอีกครั้งก่อนเข้า handler เพราะสิทธิ์เห็นกับสิทธิ์เรียกไม่เท่ากัน
 *   และ session อาจหมดอายุระหว่างสองจังหวะนี้
 *
 * ด่านเดิมที่อยู่ใน handler (permission/write/policy gates) ยังทำงานต่อครบถ้วน
 * ที่นี่ไม่ได้แทนอะไรเลย
 */
export function createDnaOsMcpServer(
  client: DnaOsHttpClient = new DnaOsHttpClient(),
  caller: CallerContext = UNAUTHENTICATED_CONTEXT,
): McpServer {
  const server = new McpServer({ name: "dna-os-mcp", version: "1.0.0" });
  for (const tool of DNA_OS_MCP_TOOLS) {
    if (!canDiscover(tool.metadata.name, caller).allowed) continue;
    server.registerTool(
      tool.metadata.name,
      {
        title: tool.metadata.title,
        description: tool.metadata.description,
        inputSchema: tool.inputShape,
        annotations: {
          title: tool.metadata.title,
          readOnlyHint: tool.metadata.read_write === "read",
          destructiveHint: false,
          idempotentHint: tool.metadata.read_write === "read",
          openWorldHint: false,
        },
        _meta: {
          permission_scope: tool.metadata.permission_scope,
          evidence_behavior: tool.metadata.evidence_behavior,
          dna_os_capability_id: tool.metadata.dna_os_capability_id,
        },
      },
      async (args) => {
        // กั้นก่อนถึง handler — ปฏิเสธแล้วต้องไม่มีผลข้างเคียงใด ๆ เกิดขึ้น
        const gate = canInvoke(tool.metadata.name, caller);
        if (!gate.allowed) {
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({
            denied: true, reason_code: gate.reason_code, tool_name: tool.metadata.name,
            policy_class: policyFor(tool.metadata.name).export_class }) }] } as never;
        }
        return tool.handler((args ?? {}) as Record<string, unknown>, client);
      },
    );
  }
  return server;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

function startHttp(port: number, client: DnaOsHttpClient): void {
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && req.url === "/mcp") {
      void (async () => {
        // Stateless mode: a fresh McpServer + transport pair per request —
        // no session state, matching this tool set's own fully stateless
        // adapter calls (every DNA OS round trip is already self-contained).
        // ตัวตนผู้เรียกมาจาก header ของ transport จริงเท่านั้น ไม่ใช่จาก body
        // stateless: สร้าง server ใหม่ต่อ request จึงได้แคตตาล็อกตรงตามสิทธิ์ของ
        // ผู้เรียกคนนั้นเสมอ และไม่มี cache ข้ามผู้เรียก (Owner ข้อ 9)
        const caller = callerContextFromHttp(req.headers as Record<string, string | string[] | undefined>);
        const mcpServer = createDnaOsMcpServer(client.bindOwnerSession(caller.owner_session_id ?? null), caller);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => { void transport.close(); void mcpServer.close(); });
        try {
          const body = await readJsonBody(req);
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
        } catch (error) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        }
      })();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`dna-os-mcp Streamable HTTP listening on http://127.0.0.1:${port}/mcp`);
  });
}

async function startStdio(client: DnaOsHttpClient): Promise<void> {
  /**
   * stdio ไม่ใช่ช่องทางที่เชื่อถือได้โดยอัตโนมัติ (Owner ข้อ 7) — พิสูจน์ที่มาของ
   * โปรเซสไม่ได้ด้วยกลไกที่มีตอนนี้ สิ่งใดที่รันด้วยสิทธิ์ของเจ้าของก็ตั้ง env
   * เดียวกันได้ จึงต้องส่ง session ที่ยืนยันแล้วมาเหมือนช่องทางอื่น
   */
  const caller = callerContextFromStdio(process.env.DNA_OS_OWNER_SESSION_ID ?? null);
  const mcpServer = createDnaOsMcpServer(client.bindOwnerSession(caller.owner_session_id ?? null), caller);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("dna-os-mcp stdio transport connected");
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const client = new DnaOsHttpClient({ baseUrl: process.env.DNA_OS_HTTP_BASE_URL ?? "http://127.0.0.1:8791" });
  if (process.argv.includes("--stdio")) {
    void startStdio(client);
  } else {
    startHttp(Number(process.env.PORT ?? 8793), client);
  }
}
