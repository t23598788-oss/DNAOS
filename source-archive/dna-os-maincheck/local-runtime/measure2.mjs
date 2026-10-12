import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
mkdirSync("local-runtime/qa-bubble-width", { recursive: true })

const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างการซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน หนึ่งในนั้นมีมูลค่าเกินเกณฑ์ที่ต้องติดตามเร่งรัดพิเศษ จึงเสนอให้ส่งหนังสือเตือนอัตโนมัติพร้อมสำเนาใบแจ้งหนี้เดิมแนบไปด้วย เพื่อให้ฝ่ายลูกค้าตรวจสอบได้ทันทีโดยไม่ต้องรอให้ทีมการเงินรวบรวมเอกสารเอง"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1200)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(2000)

const measure = () =>
  page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".msg-row-dna"))
    const out = []
    for (const row of rows) {
      const col = row.querySelector(".msg-col")
      const bubble = row.querySelector(".bubble-dna")
      const rb = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right), h: Math.round(el.getBoundingClientRect().height) } : null)
      const cs = bubble ? getComputedStyle(bubble) : null
      const cc = col ? getComputedStyle(col) : null
      const cr = getComputedStyle(row)
      out.push({
        role: row.className.includes("user") ? "user" : "dna",
        textLen: (bubble?.textContent || "").length,
        row: rb(row),
        col: rb(col),
        bubble: rb(bubble),
        rowDir: cr.flexDirection,
        rowAlign: cr.alignItems,
        colAlign: cc ? cc.alignItems : null,
        colW: cc ? cc.width : null,
        bubbleW: cs ? cs.width : null,
        bubbleMaxW: cs ? cs.maxWidth : null,
      })
    }
    return out
  })

for (const [key, text] of [["A_short", "ขอรายละเอียดเพิ่มเติมครับ"], ["B_long", LONG]]) {
  const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
  await ta.fill(text)
  await ta.press("Enter")
  const before = (await measure()).filter((m) => m.role === "dna").length
  await page
    .waitForFunction((n) => document.querySelectorAll(".msg-row-dna").length > n, before + (await page.locator(".msg-row-user").count()), { timeout: 90000 })
    .catch(() => {})
  await page.waitForTimeout(4000)
  const m = await measure()
  console.log("AFTER_" + key, JSON.stringify(m.filter((x) => x.role === "dna").slice(-2), null, 1))
}
await browser.close()
