import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1200)
await page.goto(`${BASE}/admin/materials`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const nav = document.querySelector("nav.dna-tool-access")
  const content = document.querySelector(".dna-admin-content")
  return {
    navHTML: nav ? nav.innerHTML.slice(0, 600) : null,
    navChildren: nav ? Array.from(nav.children).map((c) => ({ tag: c.tagName, cls: c.className, text: (c.textContent || "").trim().slice(0, 30) })) : null,
    contentPadLeft: content ? getComputedStyle(content).paddingLeft : null,
    contentX: content ? Math.round(content.getBoundingClientRect().x) : null,
    contentW: content ? Math.round(content.getBoundingClientRect().width) : null,
  }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
