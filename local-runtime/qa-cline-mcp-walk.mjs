// OWNER → CLINE → DNA OS MCP → … (read-only walkthrough, Leg A: MCP stdio)
// node local-runtime/qa-cline-mcp-walk.mjs — no Ollama, no new agent, read-only
import { spawn } from "node:child_process"

const INFRA = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE"
const server = spawn(
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/node_modules/.bin/tsx",
  ["--no-cache", "connections/dna-os-mcp/server.ts", "--stdio"],
  { cwd: INFRA, stdio: ["pipe", "pipe", "ignore"] },
)
let buf = ""
const pending = new Map()
let nextId = 1
server.stdout.on("data", (d) => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    try {
      const m = JSON.parse(line)
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    } catch { /* log line */ }
  }
})
function rpc(method, params, timeoutMs = 60000) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)) }, timeoutMs)
    pending.set(id, (m) => { clearTimeout(t); resolve(m) })
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
  })
}
const notify = (method, params) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
const results = []
const mark = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`) }
const text0 = (r) => r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? r).slice(0, 200)

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cline-owner-walkthrough", version: "1.0" } })
notify("notifications/initialized", {})

// A1 — tools discover (Cline sees the catalog)
const t0 = Date.now()
const list = await rpc("tools/list", {})
const tools = list.result?.tools ?? []
mark("A1 tools/list", tools.length > 0, `${tools.length} tools (${Date.now() - t0}ms)`)

// A2 — resources discover (canonical information surface)
const rl = await rpc("resources/list", {})
const resources = rl.result?.resources ?? []
mark("A2 resources/list", resources.length > 0, `${resources.length} resources: ${resources.map((r) => r.uri).join(", ").slice(0, 140)}`)

// A3 — ประวัติกิจกรรมจริง (runtime activity) via canonical resource
const t3 = Date.now()
const act = await rpc("resources/read", { uri: "resource://dna-os/activity" })
const actText = text0(act)
let actRows = 0
try { actRows = JSON.parse(actText).activities?.length ?? 0 } catch { /* raw */ }
mark("A3 activity resource", !act.error && actText.length > 10, `${Date.now() - t3}ms → ${actRows} activities`)

// A4 — ประวัติกิจกรรมจริง via tool (ACTIVITY_VIEW projection)
const t4 = Date.now()
const av = await rpc("tools/call", { name: "dna_os.get_activity_view", arguments: {} })
const avText = text0(av)
mark("A4 get_activity_view", !av.error && /200/.test(avText), `${Date.now() - t4}ms → ${avText.slice(0, 120).replace(/\s+/g, " ")}`)

// A5 — notifications (work/activity feed)
const t5 = Date.now()
const nt = await rpc("tools/call", { name: "dna_os.list_notifications", arguments: {} })
mark("A5 list_notifications", !nt.error, `${Date.now() - t5}ms → ${text0(nt).slice(0, 120).replace(/\s+/g, " ")}`)

// A6 — system activity (recent events)
const t6 = Date.now()
const sa = await rpc("tools/call", { name: "dna_os.get_system_activity", arguments: {} })
mark("A6 get_system_activity", !sa.error, `${Date.now() - t6}ms → ${text0(sa).slice(0, 120).replace(/\s+/g, " ")}`)

// A7 — work context (Owner's current work surface)
const t7 = Date.now()
const wc = await rpc("tools/call", { name: "dna_os.get_current_work_context", arguments: {} })
mark("A7 get_current_work_context", !wc.error, `${Date.now() - t7}ms → ${text0(wc).slice(0, 120).replace(/\s+/g, " ")}`)

// A8 — mutation stays denied/hidden for this caller (no write through this leg)
const mut = await rpc("tools/call", { name: "dna_os.create_scoped_workspace", arguments: { name: "cline-probe-should-not-exist" } })
const mutText = text0(mut)
const blocked = Boolean(mut.error) || /denied|not found|ปฏิเสธ|scope|permission|OWNER/i.test(mutText)
mark("A8 mutation blocked", blocked, `${mutText.slice(0, 130).replace(/\s+/g, " ")}`)

console.log("\nLEG-A RESULT:", results.filter((r) => r.ok).length + "/" + results.length, "PASS")
server.kill()
process.exit(results.every((r) => r.ok) ? 0 : 1)
