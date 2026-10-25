import { startStdioServer } from "./stdio.js"

startStdioServer().catch((err) => {
  console.error("[dna-os-mcp-server] fatal:", err)
  process.exit(1)
})
