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
  const shell = document.querySelector(".dna-admin-shell")
  const nav = document.querySelector("nav.dna-tool-access")
  const cs = content ? getComputedStyle(content) : null
  return {
    hasShell: !!shell, hasNav: !!nav, hasContent: !!content,
    navParentClass: nav?.parentElement?.className ?? null,
    contentParentClass: content?.parentElement?.className ?? null,
    paddingLeft: cs?.paddingLeft ?? null,
    matchesRule: content ? content.matches(".dna-admin-shell:not(:has(#dna-frame)) > .dna-admin-content") : null,
    hasFrame: !!document.querySelector("#dna-frame"),
  }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
