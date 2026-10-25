import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3123"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
mkdirSync("local-runtime/qa-bubble-width", { recursive: true })

const LONG_PARA =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างการซ่อมบำรุง ทีมบัญชีได้ตรวจสอบใบแจ้งหนี้ที่ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทที่เลยกำหนดชำระเกินสิบสี่วัน และหนึ่งในนั้นมีมูลค่าเกินเกณฑ์ที่ต้องติดตามเร่งรัดเป็นพิเศษ จึงเสนอให้จัดส่งหนังสือเตือนโดยอัตโนมัติพร้อมสำเนาใบแจ้งหนี้เดิมแนบไปด้วย เพื่อให้ฝ่ายลูกค้าสามารถตรวจสอบได้ทันทีโดยไม่ต้องรอให้ทีมการเงินรวบรวมเอกสารเอง"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(1200)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(2000)

const CASES = [
  ["A_short", "ขอรายละเอียดเพิ่มเติมครับ"],
  ["B_long_para", LONG_PARA],
]

const all = {}
for (const [key, text] of CASES) {
  const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
  await ta.fill(text)
  await ta.press("Enter")
  // DNA OS ตอบกลับด้วย AI interpreter จริง (~10-60s) — รอ bubble DNA ใหม่โผล่
  const before = await page.locator(".msg-row-dna .bubble-dna, .msg-row-dna .result-block").count()
  await page
    .waitForFunction(
      (n) => document.querySelectorAll(".msg-row-dna .bubble-dna, .msg-row-dna .result-block").length > n,
      before,
      { timeout: 90000 },
    )
    .catch(() => {})
  await page.waitForTimeout(1200)
  all[key] = await page.evaluate(() => {
    const row = document.querySelectorAll(".msg-row-dna")[document.querySelectorAll(".msg-row-dna").length - 1]
    if (!row) return null
    const col = row.querySelector(".msg-col")
    const bubble = row.querySelector(".bubble-dna") || row.querySelector(".result-block")
    const r = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right), h: Math.round(el.getBoundingClientRect().height) } : null)
    return { row: r(row), col: r(col), bubble: r(bubble), textLen: (bubble?.textContent || "").length }
  })
  console.log(key, JSON.stringify(all[key]))
}
console.log("ALL", JSON.stringify(all))
await browser.close()
