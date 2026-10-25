import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างการซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน"

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const dump = (tag) =>
  page.evaluate((t) => {
    const box = (el) => (el ? { x: +el.getBoundingClientRect().x.toFixed(1), w: +el.getBoundingClientRect().width.toFixed(1), right: +el.getBoundingClientRect().right.toFixed(1), h: +el.getBoundingClientRect().height.toFixed(1) } : null)
    const rows = Array.from(document.querySelectorAll(".msg-row-dna"))
    const last = rows[rows.length - 1]
    const col = last && last.querySelector(".msg-col")
    const kids = col ? Array.from(col.children).map((el) => { const c = getComputedStyle(el); return { cls: String(el.className).slice(0, 30), box: box(el), display: c.display, width: c.width, maxW: c.maxWidth, align: c.alignSelf } }) : []
    const cc = col ? getComputedStyle(col) : null
    return {
      tag: t,
      cookiePresent: document.cookie.includes("sb-"),
      rowCount: rows.length,
      col: box(col),
      colCS: cc ? { display: cc.display, dir: cc.flexDirection, align: cc.alignItems, width: cc.width, maxW: cc.maxWidth } : null,
      kids,
    }
  }, tag)

const OUT = {}
for (const [key, text] of [["A_short", "ขอรายละเอียดเพิ่มเติมครับ"], ["B_long", LONG]]) {
  // login ใหม่ทุกครั้งก่อนวัด เพื่อไม่ให้ session หมดอายุระหว่างทาง
  const lp = await ctx.newPage()
  await lp.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
  await lp.waitForTimeout(2000)
  await lp.close()

  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(2500)
  const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
  await ta.fill(text)
  await ta.press("Enter")
  const before = await page.locator(".msg-row-dna").count()
  await page.waitForFunction((n) => document.querySelectorAll(".msg-row-dna").length > n, before, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(6000)
  OUT[key] = await dump(key)
}
console.log(JSON.stringify(OUT, null, 1))
await browser.close()
