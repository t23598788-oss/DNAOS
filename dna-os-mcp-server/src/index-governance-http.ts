import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { loadConfig } from "./config.js"
import { loadHttpTransportConfig } from "./httpTransportConfig.js"
import { createGovernanceMcpServer } from "./governanceServer.js"

function authorized(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization ?? ""
  const presented = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!presented || presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

async function main() {
  const config = loadConfig()
  const transportConfig = loadHttpTransportConfig()
  if (!transportConfig.accessToken) throw new Error("MCP_SERVER_ACCESS_TOKEN is required")
  const sessions = new Map<string, StreamableHTTPServerTransport>()
  const httpServer = createServer(async (req, res) => {
    if (req.url !== "/mcp") return res.writeHead(404).end()
    if (!authorized(req, transportConfig.accessToken!)) return res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }))
    try {
      const existing = req.headers["mcp-session-id"]
      const existingId = Array.isArray(existing) ? existing[0] : existing
      let transport = existingId ? sessions.get(existingId) : undefined
      let body: unknown
      if (!transport) {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        if (!isInitializeRequest(body)) return res.writeHead(400).end(JSON.stringify({ error: "initialize required" }))
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => { sessions.set(id, transport!) } })
        transport.onclose = () => { if (transport?.sessionId) sessions.delete(transport.sessionId) }
        await createGovernanceMcpServer(config).connect(transport)
      }
      await transport.handleRequest(req, res, body)
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  httpServer.listen(transportConfig.port + 1, () => console.error(`[dna-os-governance-mcp] listening on http://localhost:${transportConfig.port + 1}/mcp`))
}

main().catch((error) => { console.error("[dna-os-governance-mcp] fatal", error); process.exit(1) })
