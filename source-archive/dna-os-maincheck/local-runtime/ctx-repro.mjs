import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
const sk = "ctx-fix-" + Date.now()
const ask = async (m) => {
  const b = await (await page.request.post(BASE + "/api/chat", { data: { message: m, sessionKey: sk }, timeout: 300000 })).json()
  return { type: b?.result?.type ?? "-", pulse: b?.pulse_node ?? "-", text: String(b?.text ?? JSON.stringify(b?.result ?? {})).slice(0, 100) }
}
console.log("1 search  :", JSON.stringify(await ask("ค้นหาบริษัท ช.ธวัชชัยการช่าง")))
console.log("2 bare    :", JSON.stringify(await ask("ช.ธวัชชัยการช่าง")))
console.log("3 followup:", JSON.stringify(await ask("ของบริษัทนี้")))
await browser.close()
