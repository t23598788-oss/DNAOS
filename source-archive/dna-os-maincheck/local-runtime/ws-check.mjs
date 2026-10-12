import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1500)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(3000)
const r = await page.evaluate(() => {
  const c = document.querySelector(".dna-admin-content")
  const f = document.querySelector("#dna-frame")
  return {
    contentPadLeft: c ? getComputedStyle(c).paddingLeft : "n/a",
    hasFrame: !!f,
    frameX: f ? Math.round(f.getBoundingClientRect().x) : null,
    frameW: f ? Math.round(f.getBoundingClientRect().width) : null,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    composerVisible: !!document.querySelector('#dna-frame textarea, textarea[placeholder*="พิมพ์"]'),
  }
})
console.log("workspace:", JSON.stringify(r))
await page.screenshot({ path: "local-runtime/qa-align/workspace-after.png", fullPage: false })
await browser.close()
