import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

// WORKSPACE DISPLAY STANDARD V1 — REGRESSION TEST (mw docs/WORKSPACE_DISPLAY_STANDARD_V1.md §10)
// Part A = SOURCE LOCK (อ่านไฟล์จริง — ห้ามกลับไปเป็น Chat Bubble)
// Part B = BROWSER (หน้าจอ /workspace?materialSurface=chat จริง — ถามจริง ตอบจริง)
// usage: node workspace-display-standard-v1-test.mjs [BASE_URL|http://localhost:3001]

const BASE = process.argv[2] || "http://localhost:3001"
const HERO = fileURLToPath(new URL("../app/workspace/DNAOSChatEngine.tsx", import.meta.url))
const DOCS = fileURLToPath(new URL("../docs/WORKSPACE_DISPLAY_STANDARD_V1.md", import.meta.url))

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ← ${detail}`}`)
}

// ── Part A: SOURCE LOCK ─────────────────────────────────────────────
let hero
try {
  hero = readFileSync(HERO, "utf8")
} catch (e) {
  console.error("FATAL อ่าน", HERO, e.message)
  process.exit(1)
}
const mustHave = [
  ["Q-TIMELINE structure", /className="q-timeline workspace-content-column"/],
  ["Q-ENTRY structure", /article className="q-entry"/],
  ["Q-HEADING structure", /header className="q-heading"/],
  ["Q-LABEL structure", /span className="q-label"/],
  ["Q-QUESTION structure", /div className="q-question"/],
  ["Q-CONTENT structure", /div className="q-content"/],
  ["Q-EVENTS structure", /div className="q-events"/],
  ["Q-ANSWER structure", /div className="q-answer"/],
  ["COMPOSER tools row", /className="row compose-tools"/],
  ["COMPOSER focus from empty area", /focusComposer/],
  ["CENTER COLUMN 1040px", /max-width:1040px/],
  ["BACKGROUND AUTHORITY = paper", /background:var\(--paper\)/],
  ["TEXT COLOR AUTHORITY = ink", /color:var\(--ink\)/],
  ["DOCUMENT full width class", /className="result-block document-result"/],
  ["AUTO-SCROLL stick rule", /stickToBottom/],
]
for (const [name, re] of mustHave) check(`SRC ${name}`, re.test(hero))
const forbidden = [
  ["no bubble-user", /bubble-user/],
  ["no bubble-dna", /bubble-dna/],
  ["no bubble-error", /bubble-error/],
  ["no msg-row-user", /msg-row-user/],
  ["no msg-row-dna", /msg-row-dna/],
  ["no msg-list", /msg-list/],
  ["no user-right-alignment", /align-items:flex-end/],
  ["no bubble max-width", /max-width:min\(560px,78%\)/],
]
for (const [name, re] of forbidden) check(`SRC ${name}`, !re.test(hero))
check(
  "SRC docs/WORKSPACE_DISPLAY_STANDARD_V1.md exists",
  (() => {
    try { return /Q-TIMELINE/.test(readFileSync(DOCS, "utf8")) } catch { return false }
  })(),
)

// ── Part B: BROWSER ──────────────────────────────────────────────
let browser
try {
  browser = await chromium.launch()
} catch (e) {
  console.error(" playwright launch fail:", e.message)
  report()
}
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${BASE}/workspace?materialSurface=chat`, { waitUntil: "domcontentloaded", timeout: 60000 })
try {
  await page.waitForSelector('form.compose textarea[aria-label="คำสั่ง"]', { timeout: 60000 })
  check("BROWSER compose textarea หาเจอ", true)
} catch {
  check("BROWSER compose textarea หาเจอ", false, "URL " + page.url())
}

// I: ปุ่มแนบไฟล์ ยังเปิด file chooser จริง (ไม่ถูกแย่งคลิกโดย focusComposer)
try {
  const chooser = page.waitForEvent("filechooser", { timeout: 6000 })
  await page.click('form.compose button:has-text("แนบไฟล์")')
  await chooser
    .then(async (c) => { if (typeof c.cancel === "function") await c.cancel(); else await c.setFiles([]) })
    .then(() => check("BROWSER ปุ่มแนบไฟล์ยังทำงาน", true))
} catch {
  check("BROWSER ปุ่มแนบไฟล์ยังทำงาน", false, "ไม่พร้องกับ filechooser")
}
// I: ปุ่มเสียง (ไมค์/speaker) toggle ได้ — onClick ของปุ่มยังถูกเรียกจริง
let voicePressed = false
try {
  const before = await page.getAttribute('form.compose button[aria-pressed]', "aria-pressed")
  await page.click('form.compose button[aria-pressed]')
  voicePressed = (await page.getAttribute('form.compose button[aria-pressed]', "aria-pressed")) !== before
  await page.click('form.compose button[aria-pressed]') // toggle กลับ
  check("BROWSER ปุ่มเสียง toggle ได้", voicePressed)
} catch (e) {
  check("BROWSER ปุ่มเสียง toggle ได้", false, e.message)
}

// H: คลิกพื้นที่ว่างในกรอบ compose แล้ว focus textarea ได้
let focusFocus = false
try {
  const box = await page.locator("form.compose").boundingBox()
  await page.mouse.click(box.x + 8, box.y + 8)
  focusFocus = await page.evaluate(() => document.activeElement === document.querySelector('form.compose textarea'))
  check("BROWSER composer focus from empty area", focusFocus)
} catch (e) {
  check("BROWSER composer focus from empty area", false, e.message)
}
// IME/หลายบรรทัด: พิมพ์ข้อความ 2 บรรทัด — value + ความสูงเกิน min-height (auto-grow)
try {
  await page.fill('form.compose textarea', "จะเขียนใบแจ้งหนี้\n\nรายการทดสอบ IME")
  const evaled = await page.evaluate(() => {
    const el = document.querySelector('form.compose textarea')
    return { value: el.value, height: el.getBoundingClientRect().height }
  })
  // ภาษาไทย/หลายบรรทัด ยังอยู่เต็มใน state (IME ตัดทิ้งได้ทุกอย่างถ้า output ว่าง)
  check("BROWSER textarea 2 บรรทัด/ไทย คงค่าจริง", evaled.value.includes("รายการทดสอบ") && evaled.value.includes("จะเขียนใบแจ้งหนี้"), JSON.stringify(evaled))
  check("BROWSER textarea auto-grow > min-height", evaled.height > 60, String(evaled.height))

  // ส่งคำถามจริงไปโมเดลจริง (Response gateway เดิม)
  await page.click('form.compose button[type="submit"], form.compose .send')
  await page.waitForSelector(".q-answer", { timeout: 120000 })
  await page.waitForTimeout(800)
} catch (e) {
  check("BROWSER ส่งคำถามจริงได้ (โมเดลจริง)", false, e.message)
}

const style = await page.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const all = (s) => Array.from(document.querySelectorAll(s))
  const cs = (el) => (el ? getComputedStyle(el) : null)
  const frame = q("#dna-frame")
  const timeline = q(".q-timeline")
  const questions = all(".q-question")
  const answers = all(".q-answer")
  const entries = all(".q-entry")
  const qcs = cs(questions[0])
  const acs = cs(answers[0])
  const tcs = cs(timeline)
  // ฉีดเอกสาร (document-result) ใน q-content เพื่อวัด full-width ของ document (§06)
  const content = q(".q-content")
  let docMeasure = null
  if (content && timeline) {
    const d = document.createElement("div")
    d.className = "document-result"
    d.innerHTML = '<div class="result-title">ทดสอบเอกสาร</div><p>เนื้อหา A4</p>'
    content.appendChild(d)
    const col = timeline.getBoundingClientRect()
    const box = d.getBoundingClientRect()
    const ccs = getComputedStyle(content)
    // ความกว้างใช้งานจริงของ q-content (document-result อยู่ใน q-content ของ Q เดิมตาม spec §06)
    const expectW = Math.round(
      content.clientWidth - parseFloat(ccs.paddingLeft) - parseFloat(ccs.paddingRight),
    )
    docMeasure = { colWidth: Math.round(col.width), docWidth: Math.round(box.width), expectW }
    d.remove()
  }
  return {
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    bubbles: all(".bubble-user,.bubble-dna,.bubble-error,.msg-row-user,.msg-row-dna").length,
    entries: entries.length,
    questions: questions.length,
    answers: answers.length,
    qText: questions[0] ? questions[0].textContent.trim().slice(0, 60) : null,
    aText: answers[0] ? answers[0].textContent.trim().slice(0, 60) : null,
    frameBG: frame ? getComputedStyle(frame).backgroundColor : null,
    frameColor: frame ? getComputedStyle(frame).color : null,
    timeline: timeline && tcs
      ? {
          w: Math.round(timeline.getBoundingClientRect().width),
          left: Math.round(timeline.getBoundingClientRect().left),
          maxW: tcs.maxWidth,
          gap: tcs.gap,
          direction: tcs.flexDirection,
          alignItems: tcs.alignItems,
        }
      : null,
    qStyle: qcs
      ? { bg: qcs.backgroundColor, bw: qcs.borderWidth, bs: qcs.borderStyle, shadow: qcs.boxShadow, radius: qcs.borderRadius, weight: qcs.fontWeight, color: qcs.color, align: qcs.textAlign }
      : null,
    aStyle: acs
      ? { bg: acs.backgroundColor, bw: acs.borderWidth, bs: acs.borderStyle, shadow: acs.shadow_name ?? acs.boxShadow, radius: acs.borderRadius, maxWidth: acs.maxWidth, color: acs.color }
      : null,
    docMeasure,
    url: location.href,
  }
})

check("BROWSER ไม่เหลือ Chat Bubble (A/B)", style.bubbles === 0, `bubbles=${style.bubbles}`)
check("BROWSER Q-Timeline มีหนึ่ง entry (F)", style.entries === 1 && style.questions === 1, JSON.stringify({ entries: style.entries, questions: style.questions }))
check("BROWSER คำตอบอยู่ใต้ Q เดิม (F)", style.answers >= 1 && style.aText != null && style.qText != null)
check("BROWSER ไม่มีกรอบ/พื้นรอบ Q (C)", style.qStyle && style.qStyle.bg === "rgba(0, 0, 0, 0)" && (style.qStyle.bw === "0px" || style.qStyle.bs === "none") && style.qStyle.shadow === "none" && style.qStyle.radius === "0px", JSON.stringify(style.qStyle))
check("BROWSER ไม่มีกรอบ/พื้นรอบคำตอบ (C)", style.aStyle && style.aStyle.bg === "rgba(0, 0, 0, 0)" && (style.aStyle.bw === "0px" || style.aStyle.bs === "none") && style.aStyle.shadow === "none" && style.aStyle.radius === "0px", JSON.stringify(style.aStyle))
check("BROWSER ไม่มี max-width คำตอบแบบ bubble", style.aStyle && style.aStyle.maxWidth === "none", String(style.aStyle?.maxWidth))
check("BROWSER คำตอบเป็นตัวหนังสือจริง อ่านชัด (E)", style.aStyle && style.aStyle.color === "rgb(54, 51, 47)")
check("BROWSER พื้นหลัง Workspace คงเดิม (D)", style.frameBG === "rgb(253, 251, 248)" && style.frameColor === "rgb(54, 51, 47)", JSON.stringify({ bg: style.frameBG, color: style.frameColor }))
check("BROWSER คอลัมน์กลาง 1040px (05)", style.timeline && style.timeline.w <= 1040 && style.timeline.maxW === "1040px" && style.timeline.direction === "column" && style.timeline.alignItems === "stretch", JSON.stringify(style.timeline))
check("BROWSER Q ชิดซ้ายในคอลัมน์ (A)", style.timeline && style.qStyle.align === "start", JSON.stringify({ left: style.timeline?.left, align: style.qStyle?.align }))
check("BROWSER ไม่มี horizontal overflow (09)", !style.hOverflow)
check("BROWSER URL ไม่เปลี่ยนอัตโนมัติ (L)", style.url.includes("/workspace?materialSurface=chat"), style.url)
if (style.docMeasure) {
  const innerOK = Math.abs(style.docMeasure.docWidth - style.docMeasure.expectW) < 2
  check("BROWSER เอกสารเต็มความกว้างคอลัมน์ (G)", innerOK, JSON.stringify(style.docMeasure))
} else {
  check("BROWSER เอกสารเต็มความกว้างคอลัมน์ (G)", false, "ไม่มี .q-content")
}

// ประวัติไม่หาย (J): กดส่งคำถามที่ 2 → entry เดิมยังอยู่ + entry ใหม่มี Q/คำตอบตัวเอง
try {
  await page.fill('form.compose textarea', "คำถามลึกของประวัติ")
  await page.click('form.compose button[type="submit"], form.compose .send')
  await page.waitForFunction((n) => document.querySelectorAll(".q-entry").length > n, style.entries, { timeout: 90000 })
  const after2 = await page.evaluate(() => ({
    entries: Array.from(document.querySelectorAll(".q-entry")).length,
    firstQ: document.querySelectorAll(".q-question")[0]?.textContent.trim().slice(0, 30) ?? null,
    bubbles: document.querySelectorAll(".bubble-user,.bubble-dna,.bubble-error").length,
  }))
  check("BROWSER ประวัติไม่หาย + คำถามใหม่ = entry ใหม่ (J)", after2.entries === 2 && after2.firstQ != null && after2.bubbles === 0, JSON.stringify(after2))
} catch (e) {
  check("BROWSER ประวัติไม่หาย + คำถามใหม่ = entry ใหม่ (J)", false, e.message)
}

// Responsive + scroll: 3 จุด (desktop/tablet/mobile) ไม่มี hOverflow · compose อยู่ล่าง (§09)
const responsive = {}
for (const [name, vp] of [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 834, height: 1112 }], ["mobile", { width: 390, height: 844 }]]) {
  await page.setViewportSize(vp)
  await page.waitForTimeout(350)
  responsive[name] = await page.evaluate(() => ({
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    composeBottom: (() => { const f = document.querySelector("form.compose"); const b = f?.getBoundingClientRect(); return b ? b.bottom <= innerHeight + 2 : null })(),
    qLeft: (() => { const q = document.querySelector(".q-question"); return q ? Math.round(q.getBoundingClientRect().left) : null })(),
  }))
}
await page.setViewportSize({ width: 1440, height: 900 })
for (const [name, r] of Object.entries(responsive)) {
  check(`BROWSER responsive ${name}: ไม่ overflow + compose อยู่ล่าง + ชิดซ้าย`, r.hOverflow === false && r.composeBottom === true && r.qLeft != null && r.qLeft > 0, JSON.stringify(r))
}

// Streaming: ระหว่างข้อความอยู่ระหว่างไหว้ไม่มี Bubble ใหม่ (K — roused element check)
const streamingNoBubble = await page.evaluate(() => ({
  bubbles: document.querySelectorAll(".bubble-user,.bubble-dna,.bubble-error,.msg-row-user,.msg-row-dna").length,
  events: document.querySelectorAll(".q-events").length,
  answers: document.querySelectorAll(".q-answer").length,
}))
check("BROWSER ไม่มี Bubble ระหว่าง streaming + events/answer อยู่ใต้ q-entry (K/08)", streamingNoBubble.bubbles === 0 && streamingNoBubble.answers >= 2, JSON.stringify(streamingNoBubble))

await browser.close()

report()
function report() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n═══ WORKSPACE DISPLAY STANDARD V1 REGRESSION ═══`)
  console.log(`PASS ${results.length - failed.length} / ${results.length}`)
  for (const r of results) if (!r.ok) console.log(`  FAIL ${r.name}`)
  process.exit(failed.length > 0 ? 1 : 0)
}