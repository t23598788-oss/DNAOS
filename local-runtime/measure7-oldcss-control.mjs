import { chromium } from "playwright"

// NEGATIVE CONTROL — รัน CSS เดิมก่อน fix (align-items:flex-start) ทับทีหลัง
// ถ้า measure7 จับบั๊กได้จริง สคริปต์นี้ต้องรายงาน "ไม่เท่ากัน"
const BASE = process.argv[2] || "http://localhost:3123"
const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForSelector(".content", { timeout: 45000 })
await page.addStyleTag({ content: "#dna-frame .msg-row-dna{align-items:flex-start !important}" })

const out = await page.evaluate((longText) => {
  const content = document.querySelector("#dna-frame .content, .content")
  const list = document.createElement("div")
  list.className = "msg-list"
  content.appendChild(list)
  const box = (el) => (el ? +el.getBoundingClientRect().width.toFixed(1) : null)
  const row = (cls, html) => {
    const d = document.createElement("div")
    d.className = "msg-row msg-row-dna"
    d.innerHTML = `<div class="msg-col"><div class="msg-sender">DNA OS</div><div class="${cls}">${html}</div></div>`
    list.appendChild(d)
    return d
  }
  const s = row("bubble-dna", "OK")
  const l = row("bubble-dna", longText)
  const m = (r) => box(r.querySelector(".bubble-dna"))
  const out = { bubble_short: m(s), bubble_long: m(l) }
  s.remove(); l.remove(); list.remove()
  return out
}, LONG)

await browser.close()
const eq = out.bubble_short === out.bubble_long
console.log("OLD-CSS (ก่อน fix):", JSON.stringify(out))
console.log(eq ? "old = เท่ากัน → test นี้จับบั๊กไม่ได้ (ปัญหา)" : `old = ไม่เท่ากัน (${out.bubble_short} vs ${out.bubble_long}) → test จับบั๊กได้จริง ✓`)
