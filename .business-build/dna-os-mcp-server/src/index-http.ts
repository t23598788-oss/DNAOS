import { startHttpServer } from "./http.js"

startHttpServer().catch((err) => {
  console.error("[dna-os-mcp-server][http] fatal:", err)
  process.exit(1)
})
