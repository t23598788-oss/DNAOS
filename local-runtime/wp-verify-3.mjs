// VERIFY PASS 3 (owner 2026-10-17): ตรวจซ้ำ 1 รอบบน production /workspace
// - จับ payload ชุดแรกที่ backend /api/chat จริงส่งกลับ (full JSON, unmodified)
// - บันทึกทุกครั้ง re-render ของบับสถานะ/ข้อความในกรอบเดิม (MutationObserver จริงใน DOM)
//   พร้อม arg ที่ผ่านเข้าแต่ละ frame (ข้อความสถานะที่วาดจริง ณ ขณะนั้น)
// - screenshot live viewport (การจับภาพหน้าจอจริง ก่อน/ระหว่าง/หลัง)
// ผลรันใช้เป็น "actual payload" ให้เขียน test เทียบทีหลัง (ไม่เดา contract)
import { chromium } from "playwright"
import { readFileSync, writeFileSync } from "node:fs"

const BASE = (process.env.E2E_BASE ?? "https://dna-os-deadboard-production.up.railway.app").replace(/\/+$/, "")
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const MSG = process.argv[2] ?? "งานที่กำลังทำตอนนี้มีอะไร"

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()

// ── บันทึกทุก re-render ของกรอบเดิม (ขอบเขตเดียว: #dna-frame) ──
await page.addInitScript(() => {
  window.__frames = []
  window.__bootFrames = () => {
    const frame = document.querySelector("#dna-frame")
    if (!frame || window.__obs) return
    window.__obs = new MutationObserver((muts) => {
      const stage = frame.querySelector(".canvas .content")
      const text = (stage?.innerText ?? frame.innerText).slice(0, 120)
      window.__frames.push({
        t: Date.now(), muts: muts.length,
        added: muts.reduce((n, m) => n + m.addedNodes.length, 0),
        charDelta: text.length - (window.__lastLen ?? 0),
        text: text.replace(/\s+/g, " ").slice(0, 110),
      })
      window.__lastLen = text.length
    })
    window.__obs.observe(frame, { childList: true, subtree: true, characterData: true })
  }
})

await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(2500)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForSelector("#dna-frame", { timeout: 30000 })
await page.waitForTimeout(5000)
await page.evaluate(() => window.__bootFrames())
await page.waitForTimeout(300)
// baseline = frames ก่อนส่ง (idle) — เก็บแยกไว้ให้รู้จุดเริ่ม แต่ต้อง "ไม่" นับเป็น
// ความคืบหน้าแรกของรอบนี้ (ที่มาของค่า -1ms รอบก่อน: find ตัวแรกก่อนส่ง)
const baselineFrames = await page.evaluate(() => window.__frames ?? [])
await page.evaluate(() => { window.__framesBeforeSend = (window.__frames ?? []).length; window.__sentAtPage = null })
await page.screenshot({ path: "local-runtime/wpv3-0-before.png" })

const ta = page.locator("#dna-frame textarea")
const send = page.locator("#dna-frame .row .send")
await ta.click(); await ta.fill(MSG)
const sentAt = Date.now()
// ประทับ sentAt ฝั่งหน้าเดิมที่ตอน re-render เพื่อเทียบ frames ให้เที่ยงตรงกัน (clock เดียว)
await page.evaluate((t) => { window.__sentAtPage = t }, sentAt)

const [resp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/chat") && r.request().method() === "POST", { timeout: 180000 }),
  send.click(),
])
// payload ชุดแรกจาก backend — เก็บดิบ (first payload from the backend, no post-processing)
const firstPayload = await resp.json().catch(() => null)
const responseAt = Date.now()
if (!firstPayload || typeof firstPayload !== "object") {
  console.error("FATAL: ไม่ได้ payload ชุดแรกจาก backend — ห้ามบันทึกหลักฐานลอย ๆ")
  process.exit(1)
}
await page.waitForTimeout(3000)
const allFrames = await page.evaluate(() => window.__frames ?? [])
const framesBeforeSend = await page.evaluate(() => window.__framesBeforeSend ?? 0)
const frames = allFrames.slice(framesBeforeSend) // เฉพาะ frames "หลัง" ตั้งใจส่ง
await page.screenshot({ path: "local-runtime/wpv3-1-after.png" })

const httpStatus = resp.status()
const timeToFirstPayloadMs = responseAt - sentAt
// ความคืบหน้าแรก หลังส่ง = frame หลัง sentAt เป็นต้นไปที่เนื้อหาเปลี่ยนจริง (ไม่ใช่ baseline idle)
const firstVisible = frames.find((f) => f.charDelta >= 0) ?? frames[0] ?? null
const timeToFirstVisibleFeedbackMs = firstVisible ? firstVisible.t - sentAt : null

const out = {
  input: MSG, http: httpStatus,
  timeToFirstPayloadMs, timeToFirstVisibleFeedbackMs,
  frames: { count: frames.length, baselineBeforeSend: baselineFrames.length, firstFrames: frames.slice(0, 12), lastFrame: frames.at(-1) ?? null },
  backend_first_payload: firstPayload,
}
writeFileSync("local-runtime/wpv3-result.json", JSON.stringify(out, null, 1))
console.log("HTTP", httpStatus, "| TTFB(payload)", timeToFirstPayloadMs, "ms | first visible(feedback)", timeToFirstVisibleFeedbackMs, "ms | frames(หลังส่ง)", frames.length)
console.log("FIRST PAYLOAD KEYS:", firstPayload && typeof firstPayload === "object" ? Object.keys(firstPayload).join(",") : typeof firstPayload)
if (firstPayload?.layers) console.log("layers keys:", Object.keys(firstPayload.layers).join(","))
if (firstPayload?.result) console.log("result keys:", Object.keys(firstPayload.result).join(","), "| type:", firstPayload.result?.type)
await browser.close()
console.log("VERIFY3 DONE")
