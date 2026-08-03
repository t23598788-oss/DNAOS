/**
 * Remote (Streamable HTTP) transport entrypoint. Mirrors stdio.ts's role —
 * this is the ONLY file that knows the transport is HTTP. It calls the same
 * createDnaOsMcpServer(config) from server.ts, unmodified, so every tool's
 * behavior (and its "no internal imports, no fs, HTTP-only to DNA OS"
 * guarantee) is identical across both transports.
 *
 * Requires a bearer access token to open the MCP session at all — this is
 * distinct from DNA_OS_API_TOKEN (which gates runtime.query's call into DNA
 * OS specifically). Refuses to start with no access token configured,
 * rather than silently defaulting to open access.
 *
 * NOT deployed anywhere by this code — running this starts a local HTTP
 * listener only. Putting it behind a public URL is a separate, explicit
 * deploy step this file does not perform.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { loadConfig, tokenStatus } from "./config.js"
import { loadHttpTransportConfig } from "./httpTransportConfig.js"
import { createDnaOsMcpServer } from "./server.js"

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function isAuthorized(req: IncomingMessage, accessToken: string): boolean {
  const header = req.headers.authorization ?? ""
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
  return presented.length > 0 && timingSafeEqual(presented, accessToken)
}

export async function startHttpServer(): Promise<void> {
  const dnaOsConfig = loadConfig()
  const httpConfig = loadHttpTransportConfig()

  if (!httpConfig.accessToken) {
    console.error(
      "[dna-os-mcp-server][http] Refusing to start: MCP_SERVER_ACCESS_TOKEN is not set. " +
        "The remote transport must not be reachable without an access token."
    )
    process.exit(1)
  }
  const accessToken = httpConfig.accessToken

  console.error(
    `[dna-os-mcp-server][http] dna_os_base_url=${dnaOsConfig.baseUrl} dna_os_token=${tokenStatus(dnaOsConfig)} port=${httpConfig.port} auth=required`
  )

  // One transport (+ MCP server binding) per client session, keyed by the
  // protocol's own mcp-session-id — a shared single transport would reject
  // every second concurrent client with "Server already initialized" (found
  // live during this phase's integration testing). Each session still binds
  // to the same createDnaOsMcpServer(config) / tool implementations; only
  // the transport plumbing is per-session.
  const sessions = new Map<string, StreamableHTTPServerTransport>()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" }).end(
        JSON.stringify({ error: { code: "BAD_REQUEST", message: "Only /mcp is served.", retryable: false } })
      )
      return
    }

    if (!isAuthorized(req, accessToken)) {
      res.writeHead(401, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid Authorization: Bearer <MCP_SERVER_ACCESS_TOKEN>.",
            retryable: false,
          },
        })
      )
      return
    }

    try {
      const sessionIdHeader = req.headers["mcp-session-id"]
      const existingSessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader

      let transport = existingSessionId ? sessions.get(existingSessionId) : undefined

      if (!transport) {
        let body: unknown
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const raw = Buffer.concat(chunks).toString("utf8")
        body = raw ? JSON.parse(raw) : undefined

        if (!isInitializeRequest(body)) {
          res.writeHead(400, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              error: { code: "BAD_REQUEST", message: "No active session and request is not an initialize request.", retryable: false },
            })
          )
          return
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            sessions.set(sessionId, transport as StreamableHTTPServerTransport)
          },
        })
        transport.onclose = () => {
          if (transport?.sessionId) sessions.delete(transport.sessionId)
        }

        const mcpServer = createDnaOsMcpServer(dnaOsConfig)
        await mcpServer.connect(transport)

        await transport.handleRequest(req, res, body)
        return
      }

      await transport.handleRequest(req, res)
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            error: {
              code: "UPSTREAM_ERROR",
              message: err instanceof Error ? err.message : "Internal transport error",
              retryable: true,
            },
          })
        )
      }
    }
  })

  httpServer.listen(httpConfig.port, () => {
    console.error(`[dna-os-mcp-server][http] listening on http://localhost:${httpConfig.port}/mcp (local only)`)
  })
}
