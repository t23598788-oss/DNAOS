/**
 * stdio transport entrypoint. This is the ONLY file that knows the transport
 * is stdio — a future remote transport (e.g. streamable HTTP) is a sibling
 * file that also calls createDnaOsMcpServer(config).connect(transport)
 * without touching server.ts or any tool file.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadConfig, tokenStatus } from "./config.js"
import { createDnaOsMcpServer } from "./server.js"

export async function startStdioServer(): Promise<void> {
  const config = loadConfig()
  // stderr only — stdout is the MCP wire protocol, must never be polluted.
  console.error(
    `[dna-os-mcp-server] base_url=${config.baseUrl} token=${tokenStatus(config)} transport=stdio`
  )

  const server = createDnaOsMcpServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
