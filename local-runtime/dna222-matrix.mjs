// DNA-000222 live read matrix + workspace E2E (one new-source chat command)
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1000)

const dispatch = async (command, payload = {}) => {
  const r = await page.request.post(`${BASE}/api/v1/mcp/business/dispatch`, { data: { command, payload }, timeout: 60000 })
  return { status: r.status(), data: await r.json().catch(() => ({})) }
}

const CMDS = [
  ["partner.list", {}], ["partner.find", { keyword: "ช.ธวัชชัย" }], ["partner.profile", { partner_id: "1191a3c2-e636-4916-8459-03fbe3cceab5" }],
  ["partner.timeline", { partner_id: "1191a3c2-e636-4916-8459-03fbe3cceab5" }],
  ["document.list", {}], ["document.boq", {}], ["document.po", {}], ["document.do", {}], ["document.receipt", {}],
  ["invoice.list", {}], ["invoice.latest", {}],
  ["debt.list", {}], ["debt.all", {}], ["debt.current", { partner_id: "1191a3c2-e636-4916-8459-03fbe3cceab5" }], ["debt.trackings", {}],
  ["draft.list", {}], ["job.list", {}], ["job.active", {}], ["material.list", {}],
  ["invoice.payments", {}], ["expense.list", {}], ["bank.statement", {}],
]
const classify = (c, r) => {
  if (r.status === 403) return "NOT_WHITELISTED"
  if (!r.data?.ok) return "READER_ERROR: " + String(r.data?.violations?.[0] ?? r.data?.error ?? "?").slice(0, 40)
  const d = r.data.data
  const empty = d && typeof d === "object" && Object.values(d).every((v) => Array.isArray(v) && v.length === 0)
  if (empty || d === null) return "NO_SOURCE_RECORD"
  return "LIVE_DATA"
}
for (const [cmd, payload] of CMDS) {
  const r = await dispatch(cmd, payload)
  const rows = r.data?.data && typeof r.data.data === "object"
    ? Object.values(r.data.data).find((v) => Array.isArray(v))?.length ?? "-"
    : "-"
  console.log(cmd.padEnd(18), "→", classify(cmd, r), "| rows:", rows)
}

console.log("== workspace chat: new-source command ==")
const sk = `dna222-${Date.now()}`
const t0 = Date.now()
const chat = await (await page.request.post(`${BASE}/api/chat`, { data: { message: "ดูรายการชำระเงินของใบแจ้งหนี้ล่าสุดของ ช.ธวัชชัยการช่าง", sessionKey: sk }, timeout: 300000 })).json()
console.log("type:", chat.result?.type, "| latency:", Date.now() - t0 + "ms")
console.log("result:", JSON.stringify(chat.result ?? {}).slice(0, 300))
await browser.close()
