// DOM probe: what is really mounted on production /workspace?
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(2500)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(6000)
console.log("url:", page.url())
const info = await page.evaluate(() => ({
  frames: Array.from(document.querySelectorAll("iframe")).map((f) => ({ src: f.src, w: f.clientWidth, h: f.clientHeight, id: f.id, title: f.title })),
  dnaFrame: !!document.querySelector("#dna-frame"),
  taMain: !!document.querySelector("#dna-frame textarea"),
  sendMain: !!document.querySelector("#dna-frame .row .send"),
  bodyChildren: Array.from(document.body.children).map((e) => e.tagName + "." + (e.id || e.className?.split?.(" ")?.slice(0, 3)?.join(".") || e.className)),
}))
console.log(JSON.stringify(info, null, 2))
for (const f of info.frames) {
  const fr = page.frames().find((x) => x.url() === f.src)
  if (fr) {
    const sub = await fr.evaluate(() => ({
      ta: !!document.querySelector("textarea"),
      tada: Array.from(document.querySelectorAll("textarea")).map((t) => ({ placeholder: t.placeholder, label: t.getAttribute("aria-label") })),
      forms: document.querySelectorAll("form").length,
      composer: !!document.querySelector(".compose"),
      snippet: document.body.innerText.slice(0, 400).replace(/\s+/g, " "),
    }))
    console.log("IFRAME", f.src.replace(BASE, ""), JSON.stringify(sub))
  }
}
await page.screenshot({ path: "local-runtime/workspace-prod-probe.png", fullPage: false })
await browser.close()
console.log("PROBE DONE")
