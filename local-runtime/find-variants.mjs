import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
for (const kw of ["ช.ธวัชชัยการช่าง", "ธวัชชัย", "ช. ธวัชชัยการช่าง", "ช.ธวัชชัย การช่าง", "ไม่มีอยู่จริงxyz", "สถานีบริการน้ำมัน"]) {
  const r = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "partner.find", payload: { keyword: kw } } })).json()
  console.log(JSON.stringify(kw), "->", Array.isArray(r?.data) ? r.data.length + " ราย" : "ERR " + JSON.stringify(r?.violations ?? r).slice(0, 60))
}
await browser.close()
