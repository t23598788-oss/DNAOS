// Production /workspace browser E2E (2026-10-17) — ทดสอบหน้าจอ /workspace เท่านั้น
// ส่งข้อความจริงผ่าน textarea ของ #dna-frame → POST /api/chat → AI Gateway → Ollama
// เก็บหลักฐาน: request_id (local_ai_request_id), HTTP status, ข้อความ AI ที่ปรากฏบนจอ + screenshot
// (ไม่แตะ source; ทำงานผ่าน Browser จริงเหมือน local-runtime/qa-local-ai-chat.mjs ของระบบเดิม)
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = (process.env.E2E_BASE ?? "https://dna-os-deadboard-production.up.railway.app").replace(/\/+$/, "")
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const MESSAGE = process.env.E2E_MESSAGE ?? "มีงานอะไรค้างอยู่บ้าง ขอดูแบบสั้น ๆ"

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()

// 1) login ผ่าน magic-link confirm (flow เดิมของระบบ app/auth/confirm)
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(2500)
console.log("landed:", page.url())
await ctx.request.get(`${BASE}/api/admin/system-reality`, { failOnStatusCode: false }) // warm-up (no-op)

// 2) เข้า /workspace ตรง ๆ
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForSelector("#dna-frame", { timeout: 30000 })
await page.waitForTimeout(5000) // ให้ React hydrate ครบก่อนกด
console.log("screen:", page.url())

page.on("console", (m) => console.log("CONSOLE>", m.type(), m.text().slice(0, 200)))
page.on("pageerror", (e) => console.log("PAGEERROR>", String(e).slice(0, 300)))
page.on("request", (r) => { if (r.method() === "POST") console.log("REQ>>", r.url().replace(BASE, "")) })
page.on("response", (r) => { if (r.request().method() === "POST") console.log("RESP<<", r.status(), r.url().replace(BASE, "")) })

// 3) กดพิมพ์ + ส่งจริงผ่าน UI
const ta = page.locator("#dna-frame textarea")
await ta.click()
await ta.fill(MESSAGE)
await page.screenshot({ path: "local-runtime/workspace-prod-before-send.png", fullPage: false })
let resp
try {
  ;[resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/chat") && r.request().method() === "POST", { timeout: 180000 }),
    page.locator("#dna-frame .row .send").click(),
  ])
} catch (err) {
  console.log("SEND_CLICK_FALLBACK", err?.name ?? err)
  const state = await page.evaluate(() => ({
    msgRows: document.querySelectorAll("#dna-frame .msg-row").length,
    sending: document.body.innerText.includes("กำลังประมวลผล"),
    taValue: document.querySelector("#dna-frame textarea")?.value ?? null,
    disabled: document.querySelector("#dna-frame textarea")?.disabled ?? null,
  }))
  console.log("STATE_AFTER_CLICK", JSON.stringify(state))
  await ta.click()
  ;[resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/chat") && r.request().method() === "POST", { timeout: 180000 }),
    ta.press("Enter"),
  ])
}
console.log("HTTP_STATUS", resp.status())
const data = await resp.json().catch(() => ({}))
console.log("EXCHANGE", JSON.stringify({
  ai_status: data.ai_status ?? null,
  local_ai_request_id: data.local_ai_request_id ?? null,
  local_ai_command: data.local_ai_command ?? null,
  layers: data.layers ?? null,
  result_type: data.result?.type ?? null,
  text: typeof data.text === "string" ? data.text.slice(0, 160) : null,
}))

// 4) หลักฐานการแสดงผลบนหน้าจอเดียวกัน: รอข้อความ AI/system ปรากฏ แล้วกลางจอ + screenshot
await page.waitForTimeout(3500)
const bubbles = await page.locator("#dna-frame .msg-row, #dna-frame [class*='bubble'], #dna-frame .stage > *").allTextContents()
console.log("SCREEN_TEXT_ВСЕ", JSON.stringify(bubbles.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean)).slice(0, 4000))
await page.screenshot({ path: "local-runtime/workspace-prod-after-reply.png", fullPage: false })
console.log("E2E_BASE", BASE)
await page.waitForTimeout(1000)
await browser.close()
console.log("DONE")
