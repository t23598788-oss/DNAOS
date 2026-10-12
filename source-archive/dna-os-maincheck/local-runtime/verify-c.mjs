import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
const v = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "receipt.list", payload: { verification: "verified", limit: 10 } } })).json()
console.log("verified-filter data path: ok:", v?.ok, "| total:", v?.data?.total, "| rows:", v?.data?.receipts?.length, "| all verified:", v?.data?.receipts?.every((r: any) => r.payment_verified === true))
const g = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "receipt.get", payload: { receipt_id: v?.data?.receipts?.[0]?.id } } })).json()
console.log("receipt.get prod: ok:", g?.ok, "| verified:", g?.data?.receipt?.payment_verified, "| amount:", g?.data?.receipt?.amount)
await browser.close()
