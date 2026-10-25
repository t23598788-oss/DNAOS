// PERFORMANCE E2E (ก่อน/หลังแก้): สนทนาต่อเนื่อง 5 ข้อความ วัดจริงทุกจุด
// - เวลาต่อข้อความ: รับ (คลิกส่ง) → สถานะแรกโผล่ → payload กลับ (res.json) → คำตอบวาดบนจอ
// - OLLAMA_CALL_COUNT ต่อข้อความ: นับจาก audit_logs action=ai.invocation ในช่วงเวลาของข้อความนั้น
// - ข้อความท้าย (ข้อ 5) ต้องอ้างบทสนทนาก่อนหน้าได้ = ตรวจ CONTEXT
import { chromium } from "playwright"
import { readFileSync, writeFileSync } from "node:fs"

const BASE = (process.env.E2E_BASE ?? "https://dna-os-deadboard-production.up.railway.app").replace(/\/+$/, "")
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
const TAG = process.argv[2] ?? "BEFORE"

const CASES = [
  { id: "1-สนทนา", msg: "สวัสดีครับ" },
  { id: "2-ความสามารถ", msg: "คุณทำอะไรได้บ้าง" },
  { id: "3-อธิบายระบบ", msg: "อธิบายระบบ DNA OS อย่างละเอียด" },
  { id: "4-อธิบายAI", msg: "ช่วยอธิบายเรื่อง AI หน่อย" },
  { id: "5-ต่อเนื่อง", msg: "อธิบายเรื่องเมื่อกี้ต่อ" },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(2500)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForSelector("#dna-frame", { timeout: 30000 })
await page.waitForTimeout(5000)

// MutationObserver + จับข้อความ AI 那条 แรกที่เพิ่ม (คำตอบ "มาส่วนแรก" for non-stream UI = ตอบแรกที่วาดบนจอ)
await page.addInitScript(() => {
  window.__ev = []
  const mark = (kind, extra = {}) => window.__ev.push({ kind, t: Date.now(), ...extra })
  window.__markIdle = () => mark("idle")
  const boot = () => {
    const frame = document.querySelector("#dna-frame")
    if (!frame || window.__obs) return
    window.__obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (!(n instanceof HTMLElement)) continue
        const cls = n.className || ""
        if (/msg-row|bubble|result-block/.test(String(cls))) {
          const isAi = /msg-row-dna/.test(String(cls)) || /bubble-dna|result-block/.test(String(cls))
          const body = (n.innerText || "").slice(0, 90).replace(/\s+/g, " ")
          mark(isAi ? "ai_add" : "user_add", { body })
        }
      }
    })
    window.__obs.observe(frame, { childList: true, subtree: true })
  }
  window.__boot2 = boot
  boot()
  setTimeout(boot, 3000)
})

const ta = page.locator("#dna-frame textarea")
const send = page.locator("#dna-frame .row .send")
const report = []
let wallStart = Date.now()
// ตัวนับ OLLAMA CALL จริง: อ่าน log ของเครื่องที่รัน Ollama ก่อน-หลังรอบรัน
const logPath = new URL("./data/ai-relay-worker.out.log", import.meta.url)
const logCalls = () => {
  try { return readFileSync(logPath, "utf8").split("\n").filter((l) => l.includes("OLLAMA_INFERENCE")).length } catch { return null }
}
const logBeforeCount = logCalls()

for (const c of CASES) {
  await page.evaluate(() => { window.__ev = [] })
  await ta.click(); await ta.fill(c.msg)
  const sentAt = Date.now()
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/chat") && r.request().method() === "POST", { timeout: 180000 }),
    send.click(),
  ])
  const payload = await resp.json().catch(() => null)
  const respAt = Date.now()
  await page.waitForTimeout(2500)
  const events = await page.evaluate(() => window.__ev ?? [])
  const idle = events.find((e) => e.kind === "idle")
  const firstFeedback = events.filter((e) => e.t >= sentAt).find((e) => e.kind === "user_add" || /กำลัง/.test(String(e.body)))
  const firstAiAdd = events.filter((e) => e.t >= sentAt).find((e) => e.kind === "ai_add")
  const screen = await page.locator("#dna-frame").innerText().catch(() => "")
  const rec = {
    case: c.id, input: c.msg, http: resp.status(),
    req_id: payload?.local_ai_request_id ?? null,
    ai_status: payload?.ai_status ?? null,
    command: payload?.local_ai_command ?? null,
    sent_at: sentAt, resp_at: respAt,
    first_feedback_ms: firstFeedback ? firstFeedback.t - sentAt : null,
    first_add_ms: firstFeedback ? firstFeedback.t - sentAt : null,
    first_ai_add_ms: firstAiAdd ? firstAiAdd.t - sentAt : null,
    total_ms: respAt - sentAt,
    text_head: typeof payload?.text === "string" ? payload.text.slice(0, 160) : null,
    on_screen: screen.includes(String(payload?.text ?? "").slice(0, 40)) || screen.includes(c.msg.slice(0, 8)),
    win_start: sentAt, win_end: respAt,
  }
  report.push(rec)
  console.log(`[${TAG}] ${c.id} | total=${rec.total_ms}ms | feedback=${rec.first_feedback_ms} | ai_add=${rec.first_ai_add_ms} | req=${rec.req_id} | ai=${rec.ai_status} | cmd=${rec.command}`)
  console.log(`      text_head=${JSON.stringify((rec.text_head ?? "").slice(0, 90))}`)
  await page.screenshot({ path: `local-runtime/dq-${TAG}-${c.id.slice(0, 2)}.png` })
}
await browser.close()

// OLLAMA_CALL_COUNT: (1) Mac log delta ของรอบรันนี้ — ต้องเห็น OLLAMA_INFERENCE จริงทุกตัว
// (2) audit_logs ใช้ created_at ขยาย +120s — เพราะ occurredAt/created_at ต่างไทม์โซนจาก sentAt ฝั่งเบราว์เซอร์
const logAfterCount = logCalls()
const callsLogDelta = logAfterCount != null && logBeforeCount != null ? logAfterCount - logBeforeCount : null
console.log(`[${TAG}] OLLAMA_CALL_COUNT_LOG_DELTA=${callsLogDelta} (log เริ่ม=${logBeforeCount}, log จบ=${logAfterCount})${callsLogDelta == null ? " — up log อ่านไม่ได้ ให้รายงาน null ตามจริง" : ""}`)
const rows = await fetch(`${SB}/rest/v1/audit_logs?action=eq.ai%2Einvocation&select=id,entity_id,created_at,new_value&order=created_at.desc&limit=120`, { headers: { apikey: K, Authorization: "Bearer " + K } }).then((r) => r.json()).catch(() => null)
const counts = []
for (const rec of report) {
  const hits = (Array.isArray(rows) ? rows : []).filter((r) => {
    try { const at = Date.parse(r.created_at); return at >= rec.win_start - 3000 && at <= rec.win_end + 120000 } catch { return false }
  })
  const detail = hits.map((r) => {
    try { const ev = JSON.parse(r.new_value) ?? {}; return `${ev.capability ?? "?"}@${ev.origin ?? "?"} ${String(ev.occurredAt ?? "").slice(11, 19)}` } catch { return r.entity_id }
  })
  counts.push({ msg: rec.case, calls_audit: hits.length, detail })
  console.log(`[${TAG}] AUDIT_CALLS ${rec.case}: ${hits.length} -> ${detail.join(" | ")}`)
}
writeFileSync(`local-runtime/dq-${TAG}-report.json`, JSON.stringify({ tag: TAG, report, counts, ollama_log: { before: logBeforeCount, after: logAfterCount, delta: callsLogDelta } }, null, 1))
console.log(`E2E ${TAG} DONE — wall=${Date.now() - wallStart}ms`)
