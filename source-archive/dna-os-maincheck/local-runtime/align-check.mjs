import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
mkdirSync("local-runtime/qa-align", { recursive: true })

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1200)

const ROUTES = ["/admin/create-document", "/admin/debt-tracking", "/admin/materials", "/admin/jobs"]
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const name = route.replace(/\//g, "_")
  await page.screenshot({ path: `local-runtime/qa-align/${name}.png`, fullPage: false })

  const m = await page.evaluate(() => {
    const box = (el) => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) } : null }
    const launcher = document.querySelector("nav.dna-tool-access button") 
    const title = document.querySelector("nav.dna-tool-access .dna-tool-title") ?? document.querySelector(".dna-tool-title") 
    const content = document.querySelector(".dna-admin-content") 
    const contentChildren = content ? Array.from(content.querySelectorAll("*")) : []
    // หัวข้อ/ข้อความหลักของหน้า (h1/h2/ป้ายยอดหนี้)
    const headings = Array.from(document.querySelectorAll(".dna-admin-content h1, .dna-admin-content h2, .dna-admin-content [class*='text-2xl'], .dna-admin-content [class*='text-xl']")).slice(0, 6).map((el) => ({ text: (el.textContent || "").trim().slice(0, 40), box: box(el) }))
    // ตารางแรก (ถ้ามี)
    const table = document.querySelector(".dna-admin-content table")
    const th = table?.getBoundingClientRect()
    const tableInfo = th ? { x: Math.round(th.x), w: Math.round(th.width), right: Math.round(th.right), y: Math.round(th.y), h: Math.round(th.height) } : null
    const doc = document.documentElement
    const contentPadLeft = content ? getComputedStyle(content).paddingLeft : null
    const contentRect = content ? { x: Math.round(content.getBoundingClientRect().x), w: Math.round(content.getBoundingClientRect().width) } : null
    // ฟอร์ม input/textarea ตัวแรกในหน้า create-document
    const formEl = document.querySelector(".dna-admin-content input, .dna-admin-content textarea, .dna-admin-content select")
    return {
      launcher: box(launcher), title: box(title),
      titleText: (title?.textContent || "").trim(),
      content: box(content), contentPadLeft, contentRect, table: tableInfo, headings,
      formFirst: box(formEl),
      hScroll: { scrollW: doc.scrollWidth, clientW: doc.clientWidth, overflowX: doc.scrollWidth > doc.clientWidth + 1 },
      contentScrollW: content ? { scrollW: content.scrollWidth, clientW: content.clientWidth } : null,
    }
  })
  console.log(route, JSON.stringify(m, null, 1))
}
await browser.close()
