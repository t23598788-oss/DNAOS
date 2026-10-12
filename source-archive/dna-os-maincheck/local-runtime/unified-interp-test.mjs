// DNA-000230 unified interpretation test: human input → interpreter (cline-pass) → real dispatch
import { spawnSync } from "node:child_process"
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BIN = "/Users/tam/.nvm/versions/node/v22.23.2/lib/node_modules/cline/node_modules/@cline/cli-darwin-arm64/bin/cline"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const ALLOWED = ["partner.find", "partner.list", "partner.profile", "partner.timeline", "document.list", "invoice.list", "invoice.latest", "invoice.find", "invoice.items", "debt.list", "debt.all", "debt.current", "draft.list", "job.list", "job.active", "document.preview", "invoice.payments", "expense.list", "bank.statement", "receipt.list", "receipt.latest", "receipt.get"]
const interpPrompt = `คุณคือตัวแปลคำสั่งของ DNA OS — แปลคำสั่งภาษาคนเป็น JSON เท่านั้น ห้ามแต่งข้อมูลธุรกิจใด ๆ (คุณไม่มีข้อมูลและห้ามเดา)
คำสั่งที่แปลได้ (ใช้ชื่อนี้เป๊ะ): ${ALLOWED.join(", ")}
รูปผล: {"command":"<ชื่อคำสั่ง>","payload":{...},"ask":null} — payload ที่ใช้บ่อย: partner_id, keyword, verification, document_id, receipt_id
กติกา: ถ้าคำสั่งมีชื่อบริษัท/คู่ค้า/คน ให้ใส่ชื่อนั้นใน payload.keyword เสมอ — ห้ามถามชื่อซ้ำ
ตัวอย่างคำภาษาคน: "บริษัทไหนค้างเงิน" → {"command":"debt.all","payload":{},"ask":null}
"ใครเคยซื้อทรายจากเรา" → {"command":"partner.list","payload":{},"ask":null}
"หาเบอร์โทร ธวัชชัย" → {"command":"partner.find","payload":{"keyword":"ธวัชชัย"},"ask":null}
"หาโรงงานคอนกรีตแถวขอนแก่น" → {"command":"partner.find","payload":{"keyword":"คอนกรีต"},"ask":null}
"แสดงรายการรับเงินที่ยืนยันแล้ว" → {"command":"receipt.list","payload":{"verification":"verified"},"ask":null}
ask ใช้เฉพาะเมื่อกำกวมจริง ๆ · ตอบ JSON เท่านั้น`
const CASES = ["ช.ธวัชชัยการช่าง", "หาโรงงานคอนกรีตแถวขอนแก่น", "ใครเคยซื้อทรายจากเรา", "บริษัทไหนค้างเงิน", "หาเบอร์คนที่เคยติดต่อทาง LINE", "แสดงเอกสารของบริษัทนี้", "หาโรงโม่หินใกล้หน้างาน", "แสดงหลักฐานรับเงินล่าสุด"]

const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })

for (const q of CASES) {
  const r = spawnSync(BIN, [`${q} `, "--provider", "cline-pass", "--json", "-t", "60", "-s", interpPrompt], { encoding: "utf8", timeout: 90000 })
  let text = ""
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue
    try { const m = JSON.parse(line); if (m.type === "run_result") text = m.text } catch {}
  }
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim()
  let parsed = null
  try { parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) } catch {}
  let tools = "-", dataSrc = "-", result = "-"
  if (parsed?.command && ALLOWED.includes(parsed.command)) {
    const d = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: parsed.command, payload: parsed.payload ?? {} }, timeout: 60000 })).json()
    tools = parsed.command
    dataSrc = parsed.command.split(".")[0] + " table"
    const arr = d?.data && typeof d.data === "object" ? Object.values(d.data).find((v) => Array.isArray(v)) : null
    result = d?.ok ? (Array.isArray(arr) ? `rows=${arr.length}` : (d.data ? "ok(data)" : "ok-empty")) : "ERR:" + String(d?.violations?.[0] ?? "").slice(0, 30)
  } else if (parsed?.ask) {
    result = "ASK:" + String(parsed.ask).slice(0, 40)
  } else {
    result = "INTENT_UNKNOWN(parse-fail)"
  }
  console.log("INPUT:", q)
  console.log("  INTENT:", parsed ? `${parsed.command ?? "-"} ${JSON.stringify(parsed.payload ?? {})}` : "PARSE-FAIL")
  console.log("  TOOLS:", tools, "| SRC:", dataSrc, "| RESULT:", result)
}
await browser.close()
