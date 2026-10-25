import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1200)
await page.goto(`${BASE}/admin/materials`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(2000)
const info = await page.evaluate(() => {
  const content = document.querySelector(".dna-admin-content")
  const out = { paddingLeft: getComputedStyle(content).paddingLeft, rules: [] }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules
    try { rules = Array.from(sheet.cssRules) } catch { continue }
    for (const r of rules) {
      if (r.selectorText && r.style && r.style.paddingLeft && content.matches(r.selectorText)) {
        out.rules.push({ sel: r.selectorText, padL: r.style.paddingLeft })
      }
    }
  }
  return out
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
