// DNA-000223B INSPECT: raw interpreter output probe (same prompt as worker)
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
const BIN = "/Users/tam/.nvm/versions/node/v22.23.2/lib/node_modules/cline/node_modules/@cline/cli-darwin-arm64/bin/cline"
const worker = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/cline-worker/worker.mjs", "utf8")
// extract ALLOWED_COMMANDS + interpreterPrompt by evaluating the pieces manually
const ALLOWED = ["partner.find", "partner.list", "partner.profile", "partner.timeline", "document.list", "document.boq", "document.po", "document.do", "document.receipt", "invoice.list", "invoice.latest", "invoice.find", "invoice.items", "debt.list", "debt.all", "debt.current", "debt.trackings", "draft.list", "job.list", "job.active", "document.preview", "invoice.payments", "expense.list", "bank.statement"]
const prompt = (who) => `คุณคือตัวแปลคำสั่งของ DNA OS — แปลคำสั่งภาษาคนเป็น JSON เท่านั้น ห้ามแต่งข้อมูลธุรกิจใด ๆ (คุณไม่มีข้อมูลและห้ามเดา)
${who ? `บริบท: กำลังคุยกับคู่ค้า "${who}" — ถ้าคำสั่งบอกว่า "ของบริษัทนี้/ของคู่ค้านี้" ให้ใช้คู่ค้าชื่อนี้` : ""}
คำสั่งที่แปลได้ (ใช้ชื่อนี้เป๊ะ): ${ALLOWED.join(", ")}
รูปผล: {"command":"<ชื่อคำสั่ง>","payload":{...},"ask":null} — payload ที่ใช้บ่อย: partner_id, keyword, document_id, document_kind ("invoice"|"standalone_document")
กติกา: ถ้าคำสั่งมีชื่อบริษัท/คู่ค้า/คน ให้ใส่ชื่อนั้น (ตัดคำลงท้าย เช่น ครับ/ค่ะ ออก) ใน payload.keyword เสมอ — ห้ามถามเรื่องชื่อซ้ำ ระบบจะแปลงชื่อเป็นรหัสให้เอง
ตัวอย่าง: "ดึงเอกสารล่าสุดของบริษัท ช.ธวัชชัยการช่าง" → {"command":"document.list","payload":{"keyword":"ช.ธวัชชัยการช่าง"},"ask":null}
ตัวอย่าง: "แสดงเอกสารต้นฉบับของบริษัทนี้" (มีบริบทคู่ค้า) → {"command":"document.preview","payload":{},"ask":null}
ตัวอย่าง: "ดูรายจ่ายบริษัท" → {"command":"expense.list","payload":{},"ask":null}
ask ใช้เฉพาะเมื่อไม่มีชื่อและบริบทก็ว่างจริง ๆ · ตอบ JSON เท่านั้น`

const CASES = [
  ["แสดงเอกสารของบริษัท The One", null],
  ["ค้นหาบริษัท วันสแตมป์คอนกรีต", null],
  ["แสดงรายการเดินบัญชีธนาคาร", null],
  ["แสดงยอดหนี้ค้างชำระทั้งหมด", null],
  ["ดึงเอกสารล่าสุดของบริษัท ช.ธวัชชัยการช่าง", null],
  ["แสดงเอกสารต้นฉบับของบริษัมนี้", "ช.ธวัชชัยการช่าง"],
]
for (const [msg, who] of CASES) {
  const r = spawnSync(BIN, [`${msg} `, "--json", "-t", "60", "-s", prompt(who)], { encoding: "utf8", timeout: 90000 })
  let text = ""
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue
    try { const m = JSON.parse(line); if (m.type === "run_result") text = m.text } catch {}
  }
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim()
  const st = cleaned.indexOf("{"), en = cleaned.lastIndexOf("}")
  let parsed = null
  try { parsed = JSON.parse(cleaned.slice(st, en + 1)) } catch {}
  console.log("Q:", msg)
  console.log("RAW:", cleaned.slice(0, 200))
  console.log("PARSED:", parsed ? JSON.stringify(parsed) : "NULL(parse-fail)")
  console.log("---")
}
