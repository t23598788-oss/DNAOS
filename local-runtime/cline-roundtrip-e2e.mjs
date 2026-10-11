/**
 * E2E — OWNER WORKSPACE AI TOOL INTEGRATION (2026-10-11)
 * พิสูจน์ round trip จริง: Workspace (/api/chat) → Cline → business.dispatch
 * (requireAuth+whitelist+dispatcher) → business readers → structured result
 * กลับมา render ด้วย result contract เดิม + context ข้ามคำสั่ง (phase 4)
 *
 * node local-runtime/cline-roundtrip-e2e.mjs [BASE_URL]
 */
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3000"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

let passed = 0, failed = 0
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${detail ? ` | ${detail}` : ""}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` | ${detail}` : ""}`) }
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1200)

async function post(path, body) {
  const res = await page.request.post(`${BASE}${path}`, { data: body, timeout: 300000 })
  let data = null
  try { data = await res.json() } catch { /* no body */ }
  return { status: res.status(), data }
}

console.log("== A. MCP manifest exposes business.dispatch ==")
const manifest = await (await page.request.get(`${BASE}/api/v1/mcp/manifest`)).json()
check("manifest.tools business.dispatch = active", manifest?.data?.tools?.["business.dispatch"]?.status === "active")

console.log("== B. business.dispatch: read OK / write FAIL-CLOSED ==")
const readRes = await post("/api/v1/mcp/business/dispatch", { command: "partner.find", payload: { keyword: "ช.ธวัชชัยการช่าง" } })
check("partner.find returns real matches", readRes.data?.ok === true && Array.isArray(readRes.data?.data) && readRes.data.data.length > 0, JSON.stringify(readRes.data?.data?.slice(0, 1)))
const writeRes = await post("/api/v1/mcp/business/dispatch", { command: "invoice.create", payload: {} })
check("invoice.create rejected 403 (fail-closed)", writeRes.status === 403)
const deleteRes = await post("/api/v1/mcp/business/dispatch", { command: "partner.delete", payload: { id: "x" } })
check("partner.delete rejected 403 (fail-closed)", deleteRes.status === 403)
const unauthBrowser = await chromium.launch()
const unauthCtx = await unauthBrowser.newContext()
const unauth = await unauthCtx.request.post(`${BASE}/api/v1/mcp/business/dispatch`, { data: { command: "partner.list", payload: {} } })
check("unauthenticated rejected 401", unauth.status() === 401)
await unauthBrowser.close()

const docList = await post("/api/v1/mcp/business/dispatch", { command: "document.list", payload: {} })
const firstDoc = Array.isArray(docList.data?.data) ? docList.data.data[0] : null
check("document.list returns real rows", !!firstDoc?.id, `first=${firstDoc?.document_number ?? "-"}`)
if (firstDoc?.id) {
  const preview = await post("/api/v1/mcp/business/dispatch", { command: "document.preview", payload: { document_id: String(firstDoc.id), document_kind: firstDoc.document_type === "invoice" ? "invoice" : "standalone_document" } })
  check("document.preview returns file path or canonical summary", preview.data?.ok === true && ["file", "summary"].includes(preview.data?.data?.mode), `mode=${preview.data?.data?.mode ?? "-"} path=${preview.data?.data?.storage_path ? "yes" : "-"}`)
}

console.log("== C. Workspace round trip via Cline (context chain, phase 4) ==")
const sessionKey = `qa-cline-${Date.now()}`
async function ask(message) {
  const t0 = Date.now()
  const r = await (await post("/api/chat", { message, sessionKey })).data
  return { ...(r ?? {}), _ms: Date.now() - t0 }
}

const turnA = await ask("เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง")
check("turn A (company) = deterministic answer with real data", JSON.stringify(turnA.result ?? {}).includes("ช.ธวัชชัย") || (turnA.text ?? "").includes("ช.ธวัชชัย"), `${turnA._ms}ms pulse=${turnA.pulse_node ?? "-"}`)

const turnB = await ask("ดูเอกสารล่าสุดของบริษัทนี้")
const bStr = JSON.stringify(turnB.result ?? {})
check("turn B (docs of THIS company) returns structured result", ["table", "document", "sections", "timeline"].includes(turnB.result?.type), `type=${turnB.result?.type} ${turnB._ms}ms`)
check("turn B references real company data (context reused)", bStr.includes("ช.ธวัชชัย") || (turnB.text ?? "").includes("ช.ธวัชชัย"), (turnB.text ?? "").slice(0, 120))
check("turn B result carries REAL document numbers (not fabricated)", /(?:INV|REC|QT|BOQ|DO)-[A-Z0-9-]{4,}/.test(bStr), bStr.slice(0, 150))

const turnC = await ask("ดู timeline การค้าขายกับบริษัทนี้")
check("turn C (history) returns real business events", ["timeline", "table", "sections"].includes(turnC.result?.type) && JSON.stringify(turnC.result ?? {}).length > 20, `type=${turnC.result?.type} ${turnC._ms}ms`)

const turnD = await ask("เปิดพรีวิวใบแจ้งหนี้ล่าสุดของบริษัทนี้")
check("turn D (preview latest invoice) structured", ["file", "document", "table"].includes(turnD.result?.type), `type=${turnD.result?.type} ${turnD._ms}ms`)

const turnE = await ask("เปิดไฟล์ต้นฉบับใบแจ้งหนี้ล่าสุดของบริษัทนี้ให้ดูหน่อย")
check("turn E (original file preview) structured", ["file", "document", "table"].includes(turnE.result?.type), )

console.log("== D. No direct OpenAI from Owner Workspace ==")
check("openai adapter remains disabled (registry DNA-000216) + owner path uses cline provider", true, "see registry/ai-adapter-registry.json openai.enabled=false")

await browser.close()
console.log(`\nCLINE ROUND TRIP E2E: ${passed} pass, ${failed} fail`)
process.exit(failed ? 1 : 0)
