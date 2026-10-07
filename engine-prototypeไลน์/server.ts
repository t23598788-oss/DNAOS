import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { CoreBus } from "./core-bus"
import { loadLineConfig } from "./config"
import { RealLineAdapter } from "./line-adapter"
import { MockAiAdapter } from "./mock-adapters"

export function createEngineServer(env: Record<string, string | undefined> = process.env) {
  const config = loadLineConfig(env)
  if (config.mode !== "real") throw new Error("HTTP LINE server requires LINE_MODE=real")
  const bus = new CoreBus()
  const line = new RealLineAdapter(config)
  bus.register(line)
  bus.register(new MockAiAdapter())

  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/webhook/line") {
      response.writeHead(404).end("Not Found")
      return
    }
    const body = await readBody(request)
    const headers = new Headers()
    for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value)
    const result = await line.handleWebhook(new Request("http://engine.local/webhook", {
      // Buffer is not a BodyInit under this repo's lib set; the underlying
      // bytes are, and the view is zero-copy.
      method: "POST", body: new Uint8Array(body), headers,
    }))
    response.writeHead(result.status, Object.fromEntries(result.headers?.entries() ?? []))
    response.end(await result.text())
  })
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
}

if (process.argv[1]?.endsWith("server.ts")) {
  loadLocalEnvironment()
  const server = createEngineServer()
  const port = Number(process.env.PORT ?? 3000)
  server.listen(port, () => console.log(`engine-prototype listening on ${port}`))
}

function loadLocalEnvironment() {
  const envPath = join(dirname(new URL(import.meta.url).pathname), ".env.local")
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2]
  }
}
