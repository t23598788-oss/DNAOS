import { chromium } from "playwright"

// CONTROL — 2 บททดสอบในไฟล์เดียว:
//  (1) REAL BLEED: เติม class `stage--bleed` ลงบน .stage จริง (เงื่อนไข embed เต็มรูปแบบ
//      เหมือนหน้า relationships ที่ฝัง frame) → ต้องได้ความกว้างเท่ากัน (fix ใหม่ครอบแล้ว)
//  (2) NEGATIVE CONTROL: บังคับ width:auto !important (จำลอง CSS ก่อน fix ที่ไม่มี rule
//      ให้ความกว้างใน bleed) → ต้อง "ไม่เท่ากัน" เพื่อพิสูจน์ว่า test นี้จับบั๊กได้จริง
//      ไม่ใช่ผ่านอยู่แล้วโดยไม่เกี่ยวกับ fix
const BASE = process.argv[2] || "http://localhost:3123"
const LONG =
  "สภาพคล่องสดของสัปดาห์นี้ลดลงเมื่อเทียบกับสัปดาห์ก่อนหน้า เนื่องจากมีการจ่ายค่าวัสดุล่วงหน้าให้แก่ผู้ผลิตหลายรายก่อนรอบสิ้นเดือน และค่าขนส่งที่สูงขึ้นจากเส้นทางหลักที่อยู่ระหว่างซ่อมบำรุง ทีมบัญชีตรวจสอบใบแจ้งหนี้ค้างชำระทั้งหมดแล้วพบว่ามีสามบริษัทเลยกำหนดชำระเกินสิบสี่วัน"

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

async function measure({ addBleedClass, breakWidth }) {
  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector(".content", { timeout: 45000 })
  await page.evaluate((bleed) => {
    const stage = document.querySelector("#dna-frame .stage")
    if (stage && bleed) stage.classList.add("stage--bleed")
  }, addBleedClass)
  if (breakWidth) await page.addStyleTag({ content: "#dna-frame .msg-col{width:auto !important}" })
  return page.evaluate((longText) => {
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
    const out = { short: box(s.querySelector(".bubble-dna")), long: box(l.querySelector(".bubble-dna")) }
    s.remove(); l.remove(); list.remove()
    return out
  }, LONG)
}

const realBleed = await measure({ addBleedClass: true, breakWidth: false })
const realBleedEqual = realBleed.short === realBleed.long
console.log(`(1) REAL BLEED + fix ใหม่: short=${realBleed.short} long=${realBleed.long} → ${realBleedEqual ? "เท่ากัน ✓" : "ไม่เท่ากัน ✗ (fix ยังครอบไม่ถึง)"}`)

const broken = await measure({ addBleedClass: true, breakWidth: true })
const brokenUnequal = broken.short !== broken.long
console.log(`(2) NEGATIVE (width ถูกถอด = CSS ก่อน fix): short=${broken.short} long=${broken.long} → ${brokenUnequal ? `ไม่เท่ากัน ✓ (test จับบั๊กได้จริง)` : "เท่ากัน ✗ (test จับบั๊กไม่ได้!)"}`)

await browser.close()
const pass = realBleedEqual && brokenUnequal
console.log(pass ? "PASS: fix ครอบ bleed mode + test มีความสามารถ discriminate" : "FAIL")
process.exit(pass ? 0 : 1)

