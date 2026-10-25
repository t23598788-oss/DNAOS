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

for (const [key, text] of [["A_short", "ขอรายละเอียดเพิ่มเติมครับ"], ["B_long", LONG]]) {
  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(2500)
  const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
  await ta.fill(text)
  await ta.press("Enter")
  const before = await page.locator(".msg-row-dna").count()
  await page.waitForFunction((n) => document.querySelectorAll(".msg-row-dna").length > n, before, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(5000)

  const info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".msg-row-dna"))
    const r = rows[rows.length - 1]
    const col = r && r.querySelector(".msg-col")
    const bub = r && r.querySelector(".bubble-dna")
    const box = (el) => (el ? { x: +el.getBoundingClientRect().x.toFixed(1), w: +el.getBoundingClientRect().width.toFixed(1), right: +el.getBoundingClientRect().right.toFixed(1), h: +el.getBoundingClientRect().height.toFixed(1) } : null)
    const cs = bub ? getComputedStyle(bub) : null
    const cc = col ? getComputedStyle(col) : null
    const cr = r ? getComputedStyle(r) : null
    return {
      rowCount: rows.length,
      isError: !!(r && r.querySelector(".bubble-error")),
      errText: r && r.querySelector(".bubble-error") ? r.querySelector(".bubble-error").textContent.slice(0, 60) : null,
      html: col ? col.innerHTML.slice(0, 220) : null,
      rowDisplay: cr ? cr.display : null,
      rowDir: cr ? cr.flexDirection : null,
      rowAlign: cr ? cr.alignItems : null,
      colDisplay: cc ? cc.display : null,
      colDir: cc ? cc.flexDirection : null,
      colAlign: cc ? cc.alignItems : null,
      bubDisplay: cs ? cs.display : null,
      bubW: cs ? cs.width : null,
      bubMaxW: cs ? cs.maxWidth : null,
      boxCol: box(col),
      boxBub: box(bub),
      boxErr: box(r && r.querySelector(".bubble-error")),
    }
  })
  console.log("== " + key, JSON.stringify(info, null, 1))
}
await browser.close()
