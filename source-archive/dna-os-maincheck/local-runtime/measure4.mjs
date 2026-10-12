import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างการซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1500)

const grab = () =>
  page.evaluate(() => {
    const box = (el) => (el ? { x: +el.getBoundingClientRect().x.toFixed(1), w: +el.getBoundingClientRect().width.toFixed(1), right: +el.getBoundingClientRect().right.toFixed(1), h: +el.getBoundingClientRect().height.toFixed(1) } : null)
    const cs = (sel, root) => {
      const el = (root || document).querySelector(sel)
      if (!el) return null
      const c = getComputedStyle(el)
      return { display: c.display, width: c.width, maxW: c.maxWidth, minW: c.minWidth, align: c.alignSelf || c.alignItems }
    }
    const rows = Array.from(document.querySelectorAll(".msg-row-dna"))
    const last = rows[rows.length - 1]
    const col = last && last.querySelector(".msg-col")
    const targets = last ? Array.from(last.querySelectorAll(".bubble-dna, .result-block, .bubble-error")) : []
    const list = last && last.querySelector(".msg-list")
    return {
      rowCount: rows.length,
      msgList: box(list),
      msgListCS: cs(".msg-list"),
      row: box(last),
      rowCS: last ? (() => { const c = getComputedStyle(last); return { display: c.display, dir: c.flexDirection, align: c.alignItems } })() : null,
      col: box(col),
      colCS: col ? (() => { const c = getComputedStyle(col); return { display: c.display, dir: c.flexDirection, align: c.alignItems, width: c.width, maxW: c.maxWidth } })() : null,
      children: targets.map((el) => {
        const c = getComputedStyle(el)
        const kids = Array.from(el.children).slice(0, 3).map((k) => { const kc = getComputedStyle(k); return { cls: String(k.className).slice(0, 30), w: kc.width, maxW: kc.maxWidth } })
        return { cls: String(el.className).slice(0, 40), box: box(el), display: c.display, width: c.width, maxW: c.maxWidth, minW: c.minWidth, kids }
      }),
    }
  })

const OUT = {}
for (const [key, text] of [["A_short", "ขอรายละเอียดเพิ่มเติมครับ"], ["B_long", LONG]]) {
  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(2500)
  const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
  await ta.fill(text)
  await ta.press("Enter")
  const before = await page.locator(".msg-row-dna").count()
  await page.waitForFunction((n) => document.querySelectorAll(".msg-row-dna").length > n, before, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(5000)
  OUT[key] = await grab()
}
console.log(JSON.stringify(OUT, null, 1))
await browser.close()
