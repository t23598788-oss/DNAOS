// DNA-000231 E2E: 12 human requests — interpreter จริงจาก worker source + real dispatch
import { spawnSync } from "node:child_process"
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BIN = "/Users/tam/.nvm/versions/node/v22.23.2/lib/node_modules/cline/node_modules/@cline/cli-darwin-arm64/bin/cline"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const src = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/cline-worker/worker.mjs", "utf8")
const decl = src.slice(src.indexOf("const ALLOWED_COMMANDS"), src.indexOf("function runCline"))
const { ALLOWED_COMMANDS, PROJECTIONS, KNOWN_GAPS, interpreterPrompt } = new Function(`${decl}; return { ALLOWED_COMMANDS, PROJECTIONS, KNOWN_GAPS, interpreterPrompt };`)()

const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })

const CASES = ["หาโรงงานคอนกรีตแถวขอนแก่น", "ใครเคยซื้อทรายจากเรา", "บริษัทไหนค้างเงิน", "หาโรงโม่หินใกล้หน้างาน", "พรุ่งนี้ฝนตกที่ชุมแพไหม", "มีพายุบนเส้นทางขนส่งหรือไม่", "จากบ่อทรายไปหน้างานกี่กิโลเมตร", "น้ำมันวันนี้ราคาเท่าไหร่", "มีรถคันไหนส่งวัสดุทันภายใน 3 ชั่วโมง", "แสดงเอกสารของบริษัทนี้", "แสดงหลักฐานรับเงินล่าสุด", "สภาพอากาศเชียงใหม่พรุ่งนี้"]
for (const q of CASES) {
  const r = spawnSync(BIN, [`${q} `, "--provider", "cline-pass", "--json", "-t", "90", "-s", interpreterPrompt(null)], { encoding: "utf8", timeout: 120000 })
  let text = ""
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue
    try { const m = JSON.parse(line); if (m.type === "run_result") text = m.text } catch {}
  }
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim()
  let parsed = null
  try { parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) } catch {}
  const plan = parsed?.plan ?? {}
  const uncovered = Array.isArray(plan.uncovered) ? plan.uncovered : []
  const steps = Array.isArray(plan.steps) ? plan.steps : (parsed?.command ? [{ command: parsed.command, payload: parsed.payload ?? {} }] : [])
  let final = "-", tools = "-"
  if (uncovered.length > 0 && (!parsed?.command)) {
    final = `CAPABILITY_UNAVAILABLE(ขาด: ${uncovered.slice(0, 2).join(", ")})`
  } else if (steps.length > 0 && ALLOWED_COMMANDS.has(steps[0].command)) {
    tools = steps.map((st) => st.command).join("→")
    const d = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: steps[0].command, payload: steps[0].payload ?? {} }, timeout: 60000 })).json()
    const arr = d?.data && typeof d.data === "object" ? Object.values(d.data).find((v) => Array.isArray(v)) : null
    final = d?.ok ? (Array.isArray(arr) ? (arr.length > 0 ? `SUCCESS rows=${arr.length}` : "ENTITY_NOT_FOUND(ผลว่าง)") : (d.data ? "SUCCESS(data)" : "SUCCESS(empty)")) : "DATA_QUERY_FAILED"
    if (uncovered.length > 0 && final.startsWith("SUCCESS")) final = "PARTIAL_RESULT + ขาด: " + uncovered.slice(0, 2).join(", ")
  } else if (parsed?.ask) {
    final = "ENTITY_AMBIGUOUS(ถาม)"
  } else {
    final = "INTENT_UNKNOWN"
  }
  console.log("REQ:", q)
  console.log("  INTENT:", parsed ? (steps[0] ? `${steps[0].command} ${JSON.stringify(steps[0].payload ?? {})}` : `ask/uncovered`) : "PARSE-FAIL", "| COND:", (plan.conditions ?? []).length, "| UNCOV:", uncovered.length ? uncovered.join(";") : "-")
  console.log("  TOOLS:", tools, "| RESULT:", final)
}
await browser.close()
