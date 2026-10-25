// Continuation E2E: G(compose ใหม่), H(เอกสารพรีวิว), I(NOT_FOUND ยืนยันซ้ำ)
// รวมถึงตรวจ navigate กลับ /workspace หลังแต่ละเคส (สาย display ไม่หลุดจอ)
// + J: ตรวจ Request ID ย้อนหลังจาก audit_logs (กลไก canonical เดิม ที่ deploy 010f1e5b)
import { chromium } from "playwright"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const BASE = (process.env.E2E_BASE ?? "https://dna-os-deadboard-production.up.railway.app").replace(/\/+$/, "")
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY

const CASES = [
  { id: "G-ตาราง(in-progress)", msg: "งานที่กำลังทำตอนนี้มีอะไร" },
  { id: "H-เอกสารพรีวิว", msg: "สร้างใบเสนอราคาให้ บจก. เคที คอนสตรัคชั่น ปูนซีเมนต์ 20 ถุง ราคาถุงละ 95 บาท พรีวิวให้ดูก่อน" },
  { id: "I-NOT_FOUND", msg: "ยอดหนี้ของ ช.ทวัฒชัยการช่าง" },
  { id: "F2-PermissionDenied(ซ้ำยืนยัน)", msg: "โอนเงินให้ลูกหนี้ 5,000 บาท ทันที" },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(2500)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForSelector("#dna-frame", { timeout: 30000 })
await page.waitForTimeout(5000)
const ta = page.locator("#dna-frame textarea")
const send = page.locator("#dna-frame .row .send")
const report = []

for (const c of CASES) {
  // กันเคส navigate หลุดจอ: ก่อนแต่ละเคส ยืนยันอยู่ /workspace ถ้าไม่ใช่กลับเข้ามาก่อน
  if (!page.url().includes("/workspace")) {
    await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
    await page.waitForSelector("#dna-frame", { timeout: 30000 })
    await page.waitForTimeout(4000)
  }
  await ta.click()
  await ta.fill(c.msg)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/chat") && r.request().method() === "POST", { timeout: 180000 }),
    send.click(),
  ])
  const data = await resp.json().catch(() => ({}))
  await page.waitForTimeout(3000)
  const onWorkspace = page.url().includes("/workspace")
  const screen = onWorkspace ? await page.locator("#dna-frame").innerText().catch(() => "") : "(navigated: " + page.url() + ")"
  const rec = {
    input: c.msg, http: resp.status(),
    request_id: data.local_ai_request_id ?? null, ai_status: data.ai_status ?? null,
    command: data.local_ai_command ?? null, result_type: data.result?.type ?? null,
    result_status: data.layers?.result?.status ?? null,
    database: data.layers?.database?.reader ?? null, dispatcher: data.layers?.dispatcher ?? null,
    stayed_on_screen: onWorkspace, display_evidence: onWorkspace && screen.includes(c.msg.slice(0, 10)),
    screen_excerpt: screen.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400),
  }
  rec.final_status = rec.http === 200 && rec.display_evidence && rec.stayed_on_screen ? "DISPLAY_PASS" : "DISPLAY_FAIL"
  report.push({ case: c.id, ...rec })
  console.log(`\n=== ${c.id} | ${rec.final_status} | req=${rec.request_id} | ai=${rec.ai_status} | cmd=${rec.command} | result=${rec.result_type}`)
  console.log("EXE", JSON.stringify(rec.dispatcher).slice(0, 250))
  console.log("SCREEN", rec.screen_excerpt.slice(0, 380))
  await page.screenshot({ path: `local-runtime/wpj2-${c.id.slice(0, 3)}.png`, fullPage: false })
}

await browser.close()
// J — Request ID ย้อนหลังจาก audit_logs (canonical audit เดิม, action ai.invocation)
try {
  const res = await fetch(`${SB}/rest/v1/audit_logs?action=eq.ai%2Einvocation&select=id,entity_type,entity_id,created_at,new_value&order=created_at.desc&limit=12`, { headers: { apikey: K, Authorization: "Bearer " + K } })
  const rows = await res.json()
  console.log("\n=== J: audit_logs ai.invocation rows:", Array.isArray(rows) ? rows.length : "ERR " + JSON.stringify(rows).slice(0, 120))
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 6)) {
    const ev = (() => { try { return JSON.parse(r.new_value).evidence } catch (e) { return null } })() || {}
    console.log(`J row ${r.id} entity=${r.entity_type} request_id=${r.entity_id} cap=${ev.capability} provider=${ev.provider} status=${ev.status} at=${r.created_at}`)
  }
  writeFileSync("local-runtime/wpj2-final-report.json", JSON.stringify({ report, audit_j: rows }, null, 1))
} catch (e) { console.log("J FAILED:", e.message) }
console.log("DONE")
