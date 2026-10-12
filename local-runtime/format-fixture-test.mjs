// fixture test: extract formatResult from worker source and run it (no import side effects)
import { readFileSync } from "node:fs"
const src = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/cline-worker/worker.mjs", "utf8")
const tStart = src.indexOf("function tableOf")
const tEnd = src.indexOf("async function executeTask")
const fnSrc = src.slice(tStart, tEnd)
const factory = new Function(`${fnSrc}; return { formatResult, tableOf };`)
const { formatResult } = factory()

const receiptRows = [
  { transaction_datetime: "2026-05-03T10:00:00Z", sender_name: "ร้านอามนาจสโตร์", amount: "169", payment_verified: false, status: "ai_read", document_type: "transfer_slip", partner_name: null, reference_number: null },
  { transaction_datetime: "2026-05-03T11:00:00Z", sender_name: "นายธวัชชัย", amount: "300", payment_verified: false, status: "ai_read", document_type: "transfer_slip", partner_name: null, reference_number: null },
]
const list = formatResult("receipt.list", { receipts: receiptRows, total: 495, limit: 50, offset: 0 })
console.log("format receipt.list:", list?.type, "| title:", list?.title, "| rows:", list?.table?.rows?.length)
const latest = formatResult("receipt.latest", { receipt: { ...receiptRows[0], verification_level: "medium" } })
console.log("format receipt.latest:", latest?.type, "| title:", latest?.title)
const arrDirect = formatResult("document.receipt", [{ id: "1", document_number: "R-1", status: "paid" }])
console.log("format array-direct:", arrDirect?.type, "| rows:", arrDirect?.table?.rows?.length)
const noClaim = !String(list?.title).includes("495 ฉบับทั้งหมด") && String(list?.title).includes("หน้าแรก")
console.log("pagination honesty (no 'all' claim):", noClaim)
