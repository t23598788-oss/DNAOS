import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างการซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1200)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(2000)

const snap = (tag) =>
  page.evaluate((t) => {
    const rows = Array.from(document.querySelectorAll(".msg-row-dna"))
    const last = rows[rows.length - 1]
    if (!last) return { tag: t, none: true }
    const col = last.querySelector(".msg-col")
    const bub = last.querySelector(".bubble-dna")
    const cs = bub ? getComputedStyle(bub) : null
    const cc = col ? getComputedStyle(col) : null
    const r = (el) => (el ? { x: +el.getBoundingClientRect().x.toFixed(1), w: +el.getBoundingClientRect().width.toFixed(1), right: +el.getBoundingClientRect().right.toFixed(1), h: +el.getBoundingClientRect().height.toFixed(1) } : null)
    return {
      tag: t,
      colDisplay: cc ? cc.display : null,
      colDir: cc ? cc.flexDirection : null,
      colAlign: cc ? cc.alignItems : null,
      colW: cc ? cc.width : null,
      bubExists: !!bub,
      bubDisplay: cs ? cs.display : null,
      bubW: cs ? cs.width : null,
      bubMaxW: cs ? cs.maxWidth : null,
      bubMinW: cs ? cs.minWidth : null,
      col: r(col),
      bub: r(bub),
      colHTML: col ? col.innerHTML.slice(0, 200) : null,
    }
  }, tag)

for (const [key, text] of [["A_short", "ขอรายละเอียดเพิ่มเติมครับ"], ["B_long", LONG]]) {
  const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
  await ta.fill(text)
  await ta.press("Enter")
  const beforeRows = await page.locator(".msg-row-dna").count()
  await page.waitForFunction((n) => document.querySelectorAll(".msg-row-dna").length > n, beforeRows, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(4000)
  console.log("SNAP_" + key, JSON.stringify(await snap(key), null, 1))
}
await browser.close()
