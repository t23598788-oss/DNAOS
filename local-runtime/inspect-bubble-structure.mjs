import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1200)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(2500)

// 1) structure ของหน้า workspace ที่มีอยู่แล้ว (ไม่ต้องส่งข้อความ)
const shape = await page.evaluate(() => {
  const frame = document.querySelector("#dna-frame")
  const dump = (el) =>
    el ? { cls: el.className, w: Math.round(el.getBoundingClientRect().width), x: Math.round(el.getBoundingClientRect().x), children: Array.from(el.children).map((c) => c.className || c.tagName) } : null
  const row = document.querySelector(".msg-row-dna")
  return {
    hasFrame: !!frame,
    rowCls: row ? row.className : null,
    rowCount: document.querySelectorAll(".msg-row-dna").length,
    bubbleCount: document.querySelectorAll(".bubble-dna").length,
    row: dump(row),
    col: dump(row && row.querySelector(".msg-col")),
    bubble: dump(row && row.querySelector(".bubble-dna")),
    rowComputed: row ? (() => { const c = getComputedStyle(row); return { display: c.display, dir: c.flexDirection, align: c.alignItems, width: c.width } })() : null,
    colComputed: row && row.querySelector(".msg-col") ? (() => { const c = getComputedStyle(row.querySelector(".msg-col")); return { display: c.display, dir: c.flexDirection, align: c.alignItems, width: c.width, maxW: c.maxWidth } })() : null,
    bubbleComputed: row && row.querySelector(".bubble-dna") ? (() => { const c = getComputedStyle(row.querySelector(".bubble-dna")); return { w: c.width, maxW: c.maxWidth, minW: c.minWidth } })() : null,
    // ทุก descendant ที่มี max-width ไม่เท่ากับ width (ตัวการ shrink-to-fit)
    wide: Array.from(document.querySelectorAll(".msg-col *")).map((el) => { const c = getComputedStyle(el); return { cls: String(el.className).slice(0, 40), w: c.width, maxW: c.maxWidth, minW: c.minWidth } }).slice(0, 12),
  }
})
console.log("SHAPE", JSON.stringify(shape, null, 1))
await browser.close()
