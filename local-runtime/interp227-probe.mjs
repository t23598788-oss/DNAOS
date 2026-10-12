// DNA-000227 INSPECT: raw interpreter output สำหรับคำสั่ง receipt (prompt จริงจาก worker)
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
const BIN = "/Users/tam/.nvm/versions/node/v22.23.2/lib/node_modules/cline/node_modules/@cline/cli-darwin-arm64/bin/cline"
const ALLOWED = ["partner.find", "partner.list", "partner.profile", "partner.timeline", "document.list", "invoice.list", "invoice.latest", "invoice.find", "invoice.items", "debt.list", "debt.all", "debt.current", "draft.list", "job.list", "job.active", "document.preview", "invoice.payments", "expense.list", "bank.statement", "receipt.list", "receipt.latest", "receipt.get"]
const prompt = (who) => `คุณคือตัวแปลคำสั่งของ DNA OS — แปลคำสั่งภาษาคนเป็น JSON เท่านั้น ห้ามแต่งข้อมูลธุรกิจใด ๆ (คุณไม่มีข้อมูลและห้ามเดา)
${who ? `บริบท: กำลังคุยกับคู่ค้า "${who}" — ถ้าคำสั่งบอกว่า "ของบริษัทนี้/ของคู่ค้านี้" ให้ใช้คู่ค้าชื่อนี้` : ""}
คำสั่งที่แปลได้ (ใช้ชื่อนี้เป๊ะ): ${ALLOWED.join(", ")}
รูปผล: {"command":"<ชื่อคำสั่ง>","payload":{...},"ask":null} — payload ที่ใช้บ่อย: partner_id, keyword, document_id, receipt_id, verification, document_kind ("invoice"|"standalone_document")
กติกา: ถ้าคำสั่งมีชื่อบริษัท/คู่ค้า/คน ให้ใส่ชื่อนั้น (ตัดคำลงท้าย เช่น ครับ/ค่ะ ออก) ใน payload.keyword เสมอ — ห้ามถามเรื่องชื่อซ้ำ ระบบจะแปลงชื่อเป็นรหัสให้เอง
ask ใช้เฉพาะเมื่อไม่มีชื่อและบริบทก็ว่างจริง ๆ · ตอบ JSON เท่านั้น${RECEIPT_RULES}`
const RECEIPT_RULES = `
กติกา receipt: payload.verification ใช้ได้เฉพาะ "verified" | "unverified" | "all" เท่านั้น (ห้ามใช้คำอื่น เช่น confirmed)
ตัวอย่าง: "แสดงรายการรับเงินที่ยืนยันแล้ว" → {"command":"receipt.list","payload":{"verification":"verified"},"ask":null}
ตัวอย่าง: "แสดงรายการรับเงินที่ยังไม่ยืนยัน" → {"command":"receipt.list","payload":{"verification":"unverified"},"ask":null}
ตัวอย่าง: "แสดงหลักฐานรับเงินทั้งหมด" → {"command":"receipt.list","payload":{},"ask":null}
ตัวอย่าง: "เปิดรายละเอียดหลักฐานล่าสุด" หรือ "เปิดรายละเอียดหลักฐานหนึ่งรายการ" → {"command":"receipt.get","payload":{},"ask":null} (ระบบจะ resolve ให้เองจากบริบท)`

const CASES = [
  ["แสดงหลักฐานรับเงินทั้งหมด", null],
  ["แสดงรายการรับเงินที่ยืนยันแล้ว", null],
  ["แสดงรายการรับเงินที่ยังไม่ยืนยัน", null],
  ["แสดงหลักฐานรับเงินล่าสุด", null],
  ["เปิดรายละเอียดหลักฐานล่าสุด", null],
  ["เปิดรายละเอียดหลักฐานของบริษัทนี้", "ช.ธวัชชัยการช่าง"],
]
for (const [msg, who] of CASES) {
  const r = spawnSync(BIN, [`${msg} `, "--provider", "cline-pass", "--json", "-t", "60", "-s", prompt(who)], { encoding: "utf8", timeout: 90000 })
  let text = ""
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue
    try { const m = JSON.parse(line); if (m.type === "run_result") text = m.text } catch {}
  }
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim()
  const st = cleaned.indexOf("{"), en = cleaned.lastIndexOf("}")
  let parsed = null
  try { parsed = JSON.parse(cleaned.slice(st, en + 1)) } catch {}
  console.log("Q:", msg, who ? `(who=${who})` : "")
  console.log("  →", parsed ? JSON.stringify(parsed) : "PARSE-FAIL: " + cleaned.slice(0, 100))
}
