import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3000"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
mkdirSync("local-runtime/qa-cline-ui", { recursive: true })

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1000)
await page.goto(`${BASE}/workspace`, { waitUntil: "networkidle", timeout: 60000 })
await page.waitForTimeout(1500)

const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
await ta.fill("ดูเอกสารล่าสุดของ ช.ธวัชชัยการช่าง")
await ta.press("Enter")
// รอให้ result block โผล่ (表格/document/timeline) — cline ใช้เวลา ~10-60s
await page.waitForTimeout(45000)
await page.screenshot({ path: "local-runtime/qa-cline-ui/workspace-cline-result.png", fullPage: false })
const bodyText = await page.textContent("body").catch(() => "")
const hasResult = /เลขที่เอกสาร|เอกสารล่าสุด|ช\.ธวัชชัย/.test(bodyText ?? "")
console.log("UI inline result visible:", hasResult)
await browser.close()
process.exit(hasResult ? 0 : 1)
