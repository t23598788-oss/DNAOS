import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างการซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

// login ครั้งเดียว ใช้ทั้งสองเคส
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(2500)
const cookieOk = await page.evaluate(() => document.cookie.length > 0)
console.log("COOKIE_OK", cookieOk, await page.evaluate(() => location.pathname))

const dump = (tag) =>
  page.evaluate((t) => {
    const box = (el) => (el ? { x: +el.getBoundingClientRect().x.toFixed(1), w: +el.getBoundingClientRect().width.toFixed(1), right: +el.getBoundingClientRect().right.toFixed(1), h: +el.getBoundingClientRect().height.toFixed(1) } : null)
    const rows = Array.from(document.querySelectorAll(".msg-row-dna"))
    const last = rows[rows.length - 1]
    const col = last && last.querySelector(".msg-col")
    const kids = col ? Array.from(col.children).map((el) => { const c = getComputedStyle(el); return { cls: String(el.className).slice(0, 32), box: box(el), display: c.display, width: c.width, maxW: c.maxWidth } }) : []
    const cc = col ? getComputedStyle(col) : null
    const list = document.querySelector(".msg-list")
    return { tag: t, cookieLen: document.cookie.length, rowCount: rows.length, msgList: box(list), col: box(col), colCS: cc ? { display: cc.display, align: cc.alignItems } : null, kids }
  }, tag)

const OUT = {}
for (const [key, text] of [["A_short", "ขอรายละเอียดเพิ่มเติมครับ"], ["B_long", LONG]]) {
  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(2000)
  const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
  await ta.fill(text)
  await ta.press("Enter")
  const before = await page.locator(".msg-row-dna").count()
  await page.waitForFunction((n) => document.querySelectorAll(".msg-row-dna").length > n, before, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(6000)
  OUT[key] = await dump(key)
}
console.log("RESULT " + JSON.stringify(OUT, null, 1))
await browser.close()
