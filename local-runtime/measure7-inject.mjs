import { chromium } from "playwright"
import { writeFileSync, mkdirSync } from "node:fs"

// measure7 — INJECTION TEST: ไม่พึ่ง login/AI ฉีด bubble เข้า DOM ตรง ๆ แล้ววัดความกว้าง
// พิสูจน์ hypothesis ของ fix (DNA-000243/WorkspaceFrame): bubble สั้น vs ยาว ต้องได้ความกว้าง "เท่ากัน"
const BASE = process.argv[2] || "http://localhost:3123"
const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
// dev server compile route แบบ on-demand — รอ .msg-list จริง (ไม่ใช่ fixed sleep)
await page.waitForSelector(".msg-list", { timeout: 45000 }).catch(() => {})
await page.waitForTimeout(800)

const result = await page.evaluate((longText) => {
  // .msg-list มีแค่เมื่อมีข้อความจริง (messages.length > 0) — สร้างโครงเดียวกับ JSX เองใน .content
  const content = document.querySelector("#dna-frame .content, .content")
  if (!content) return { error: "ไม่พบ .content", url: location.href }
  let list = document.querySelector(".msg-list")
  const createdList = !list
  if (!list) {
    list = document.createElement("div")
    list.className = "msg-list"
    content.appendChild(list)
  }
  const box = (el) => (el ? +el.getBoundingClientRect().width.toFixed(1) : null)
  const row = (cls, html) => {
    const div = document.createElement("div")
    div.className = "msg-row msg-row-dna"
    div.innerHTML = `<div class="msg-col"><div class="msg-sender">DNA OS</div>${cls
      .split(" ")
      .map((c) => `<div class="${c}">${html}</div>`)
      .join("")}</div>`
    list.appendChild(div)
    return div
  }
  const shortBubble = row("bubble-dna", "OK")
  const longBubble = row("bubble-dna", longText)
  const shortResult = row("result-block", '<div class="result-title">สรุป</div>')
  const longResult = row("result-block", `<div class="result-title">สรุป</div><div class="result-notes">${longText}</div>`)
  const measure = (rowEl) => ({
    col: box(rowEl.querySelector(".msg-col")),
    content: box(rowEl.querySelector(".bubble-dna, .result-block")),
  })
  const out = {
    viewport: { w: innerWidth },
    bubble_short: measure(shortBubble),
    bubble_long: measure(longBubble),
    result_short: measure(shortResult),
    result_long: measure(longResult),
  }
  shortBubble.remove(); longBubble.remove(); shortResult.remove(); longResult.remove()
  if (createdList) list.remove()
  return out
}, LONG)

await browser.close()

const bEqual = result.bubble_short?.content === result.bubble_long?.content
const rEqual = result.result_short?.content === result.result_long?.content
const pass = !result.error && bEqual && rEqual
const report = { script: "measure7-inject", at: new Date().toISOString(), base: BASE, pass, ...result, checks: { bubble_equal: bEqual, result_equal: rEqual } }
mkdirSync(new URL("./qa-bubble-width/", import.meta.url), { recursive: true })
writeFileSync(new URL("./qa-bubble-width/inject-result.json", import.meta.url), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))
console.log(pass ? "PASS: bubble สั้น/ยาว กว้างเท่ากัน" : "FAIL: ความกว้างไม่เท่ากัน")
process.exit(pass ? 0 : 1)
