// Live AI Queen MCP probe — spawn the REAL dna-os-mcp server over stdio,
// list tools, invoke READ-ONLY tools, prove a mutation tool is DENIED.
// node local-runtime/qa-queen-stdio.mjs   (run from dna-os-maincheck; spawns INFRA server)
import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"

const INFRA = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE"
const server = spawn(
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/node_modules/.bin/tsx",
  ["--no-cache", "connections/dna-os-mcp/server.ts", "--stdio"],
  { cwd: INFRA, stdio: ["pipe", "pipe", "pipe"] },
)

let buf = ""
const pending = new Map()
let stderrTail = ""
server.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-500) })
server.stdout.on("data", (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    } catch { /* non-JSON stdout line (log) */ }
  }
})

let nextId = 1
function rpc(method, params, timeoutMs = 60000) {
  const id = nextId++
  const p = new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)) }, timeoutMs)
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg) })
  })
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
  return p
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
}

const results = []
const mark = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`) }

// handshake
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "ai-queen-qa-probe", version: "1.0" },
})
mark("MCP-initialize", Boolean(init.result?.serverInfo), `server: ${init.result?.serverInfo?.name ?? JSON.stringify(init).slice(0, 120)}`)
notify("notifications/initialized", {})

// tools/list
const t0 = Date.now()
const list = await rpc("tools/list", {})
const tools = list.result?.tools ?? []
mark("MCP-tools-list", tools.length > 0, `${tools.length} tools discoverable (${Date.now() - t0}ms)`)
const queenVisible = tools.filter((t) => t.name.startsWith("dna_os."))
mark("MCP-dnaos-tools", queenVisible.length > 0, `${queenVisible.length} dna_os.* tools`)

// read-only calls (real handlers → DNA_OS_HTTP_BASE_URL → production owner-command-http)
async function callTool(name, args = {}) {
  const start = Date.now()
  const res = await rpc("tools/call", { name, arguments: args })
  const ms = Date.now() - start
  return { ms, res }
}

const r1 = await callTool("get_system_status")
const c1 = r1.res.result?.content?.[0]?.text ?? JSON.stringify(r1.res).slice(0, 200)
mark("READ get_system_status", !r1.res.error && /status|system/i.test(c1), `${r1.ms}ms → ${c1.slice(0, 110)}`)

const r2 = await callTool("dna_os.get_runtime_identity")
const c2 = r2.res.result?.content?.[0]?.text ?? JSON.stringify(r2.res).slice(0, 200)
mark("READ dna_os.get_runtime_identity", !r2.res.error, `${r2.ms}ms → ${c2.slice(0, 110)}`)

const r3 = await callTool("dna_os.get_system_health")
const c3 = r3.res.result?.content?.[0]?.text ?? JSON.stringify(r3.res).slice(0, 200)
mark("READ dna_os.get_system_health", !r3.res.error, `${r3.ms}ms → ${c3.slice(0, 110)}`)

const r4 = await callTool("list_capabilities")
const c4 = r4.res.result?.content?.[0]?.text ?? JSON.stringify(r4.res).slice(0, 200)
mark("READ list_capabilities", !r4.res.error, `${r4.ms}ms → ${c4.slice(0, 110)}`)

// mutation must be DENIED for this stdio external caller (policy gate proof)
const r5 = await callTool("submit_command", { commandText: "qa-probe-should-be-denied" })
const denied = Boolean(r5.res.error) || /denied|ปฏิเสธ|OWNER_ONLY|not allowed|unauthorized/i.test(r5.res.result?.content?.[0]?.text ?? "")
mark("GATE submit_command denied", denied, `${r5.ms}ms → ${(r5.res.result?.content?.[0]?.text ?? JSON.stringify(r5.res.error)).slice(0, 120)}`)

console.log("\nRESULT:", results.filter((r) => r.ok).length + "/" + results.length, "PASS")
if (stderrTail) console.log("server stderr tail:", stderrTail.slice(0, 200))
server.kill()
process.exit(results.every((r) => r.ok) ? 0 : 1)
