import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })

const find = async (kw) => {
  const r = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "partner.find", payload: { keyword: kw } }, timeout: 60000 })).json()
  return { ok: r?.ok, n: Array.isArray(r?.data) ? r.data.length : "-", names: Array.isArray(r?.data) ? r.data.slice(0, 3).map((x) => x.name) : r }
}
console.log("1 exact        :", JSON.stringify(await find("ช.ธวัชชัยการช่าง")))
console.log("2 partial      :", JSON.stringify(await find("ธวัชชัย")))
console.log("3 spacing      :", JSON.stringify(await find("ช. ธวัชชัยการช่าง")))
console.log("4 extra-space  :", JSON.stringify(await find("ช.ธวัชชัย การช่าง")))
console.log("5 none         :", JSON.stringify(await find("ไม่มีอยู่จริงxyz")))
console.log("6 multi        :", JSON.stringify(await find("สถานีบริการน้ำมัน")))

const pf = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "partner.profile", payload: { partner_id: "1191a3c2-e636-4916-8459-03fbe3cceab5" } } })).json()
console.log("7 profile callable:", pf?.ok, "| name:", pf?.data?.name)
const tl = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "partner.timeline", payload: { partner_id: "1191a3c2-e636-4916-8459-03fbe3cceab5" } } })).json()
console.log("8 timeline callable:", tl?.ok, "| events:", Array.isArray(tl?.data?.timeline) ? tl.data.timeline.length : "-")

// workspace phrases (owner-style)
const sk = "comp-search-" + Date.now()
const ask = async (m) => {
  const b = await (await page.request.post(BASE + "/api/chat", { data: { message: m, sessionKey: sk }, timeout: 300000 })).json()
  return String(b.text ?? JSON.stringify(b.result ?? {})).slice(0, 90)
}
console.log("WS exact     :", await ask("เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง"))
console.log("WS spacing   :", await ask("เปิดข้อมูลบริษัท ช. ธวัชชัยการช่าง"))
console.log("WS partial   :", await ask("ค้นหาบริษัท ธวัชชัย"))
console.log("WS missing   :", await ask("ค้นหาบริษัท วันสแตมป์คอนกรีต"))
await browser.close()
