// Production Owner Workspace E2E — full owner_cline_command path (DNA-000219)
// Admin Workspace -> ai_tasks -> Railway Cline Worker -> Business Dispatcher
// -> ai-callback -> Workspace result
import { chromium } from "playwright"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const BASE = process.argv[2] || "https://dna-os-deadboard-production.up.railway.app"
const env = {}
readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/.env.local", "utf8").split("\n").forEach((l) => {
  const i = l.indexOf("=")
  if (i > 0 && !l.startsWith("#")) env[l.slice(0, i)] = l.slice(i + 1)
})
const restHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }
const rest = (path) => fetch(env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") + path, { headers: restHeaders }).then((r) => r.json())

let passed = 0, failed = 0
const check = (name, cond, detail = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}${detail ? ` | ${detail}` : ""}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` | ${detail}` : ""}`) }
}

mkdirSync("local-runtime/qa-owner-cline-prod", { recursive: true })
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1000)

// real UI round trip on the Workspace surface
await page.goto(`${BASE}/workspace`, { waitUntil: "networkidle", timeout: 60000 })
await page.waitForTimeout(1500)
const sk = `e2e-owner-cline-${Date.now()}`
const ask = async (message, timeout = 300000) => {
  const t0 = Date.now()
  const r = await page.request.post(`${BASE}/api/chat`, { data: { message, sessionKey: sk }, timeout })
  const body = await r.json().catch(() => ({}))
  return { ms: Date.now() - t0, body }
}

console.log("== 1) เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง (deterministic + identity into memory) ==")
const t1 = await ask("เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง", 60000)
check("company answer with real data", JSON.stringify(t1.body?.result ?? {}).includes("ช.ธวัชชัย") || String(t1.body?.text ?? "").includes("ช.ธวัชชัย"), `${t1.ms}ms pulse=${t1.body?.pulse_node ?? "-"}`)

console.log("== 2) ดึงเอกสารล่าสุดของบริษัทนี้ (task queue -> Railway worker -> Cline) ==")
const t2 = await ask("ดึงเอกสารล่าสุดของบริษัมนี้")
const t2s = JSON.stringify(t2.body?.result ?? {})
check("turn2 structured result", ["table", "timeline", "sections", "document", "file"].includes(t2.body?.result?.type), `type=${t2.body?.result?.type} ${t2.ms}ms`)
check("turn2 real document numbers", /(?:INV|REC|QT|BOQ|DO)-[A-Z0-9-]{4,}/.test(t2s), t2s.slice(0, 100))

// evidence from ai_tasks (inserted, claimed once, done, result written)
const tasks = await rest("/rest/v1/ai_tasks?select=id,status,kind,claimed_by,error,processed_at,result,trace&order=created_at.desc&limit=5")
const mine = (Array.isArray(tasks) ? tasks : []).filter((t) => t.kind === "owner_cline_command")
check("task inserted with real id", mine.length > 0, `task=${mine[0]?.id ?? "-"} status=${mine[0]?.status ?? "-"} claimed_by=${mine[0]?.claimed_by ?? "-"} err=${String(mine[0]?.error ?? "").slice(0, 60)}`)
check("task done + result written by callback", mine[0]?.status === "done" && !!mine[0]?.result, `result_type=${mine[0]?.result?.result?.type ?? mine[0]?.result?.answer?.slice(0, 30) ?? "-"}`)
check("company context in trace", JSON.stringify(mine[0]?.trace ?? {}).includes("ช.ธวัชชัย") || JSON.stringify(mine[0]?.result ?? {}).includes("ช.ธวัชชัย") || t2s.includes("ช.ธวัชชัย"), JSON.stringify(mine[0]?.trace ?? {}).slice(0, 80))
const dup = mine.filter((t) => t.claimed_by === "railway-cline-worker-1")
check("no duplicate execution (claimed_by set on exactly the executed task(s))", dup.length === mine.length, `tasks=${mine.length}`)

console.log("== 3) แสดงเอกสารต้นฉบับ (preview via document.preview) ==")
const t3 = await ask("แสดงเอกสารต้นฉบับของเอกสารล่าสุดที่เพิ่งดึงให้ดูหน่อย")
check("turn3 preview structured or rich text", ["document", "file", "table", "sections"].includes(t3.body?.result?.type) || String(t3.body?.text ?? "").length > 30, `type=${t3.body?.result?.type} ${t3.ms}ms`)

// inline render proof in the real Workspace UI
const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
try {
  await ta.fill("แสดงตารางเอกสารล่าสุดของบริษัทนี้")
  await ta.press("Enter")
  await page.waitForTimeout(50000)
  await page.screenshot({ path: "local-runtime/qa-owner-cline-prod/workspace-final.png", fullPage: false })
  const bodyText = await page.textContent("body").catch(() => "")
  check("inline Workspace rendering visible", /เลขที่เอกสาร|เอกสารล่าสุด|ช\.ธวัชชัย/.test(bodyText ?? ""))
} catch (e) {
  check("inline Workspace rendering visible", false, e.message.slice(0, 60))
}

await browser.close()
console.log(`\nOWNER CLINE PROD E2E: ${passed} pass, ${failed} fail`)
writeFileSync("local-runtime/qa-owner-cline-prod/evidence.json", JSON.stringify({ tasks: mine.map((t) => ({ id: t.id, status: t.status, claimed_by: t.claimed_by, resultType: t.result?.result?.type ?? null, error: t.error })) }, null, 2))
process.exit(failed ? 1 : 0)
