/**
 * Payment acknowledgement test (BATCH 40).
 *
 * A1 gateway/payment-acknowledgement.ts — the pipeline itself:
 *   canonical recipient (connect_external_identities → legacy fallback),
 *   ledger-only summary, select-or-create receipt document through the
 *   canonical writer, delivery evidence in the BATCH 38 shape, idempotency,
 *   canonical audit, fail-soft contract (never throws).
 * A2 the two confirm callers wire it NON-FATALLY (a failed ack can never fail
 *   a confirmed payment) and the manual/retry route carries the admin gate.
 * A3 audit vocabulary extended additively.
 */
import { readFileSync } from "node:fs"

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1
  if (ok) { console.log(`PASS  ${name}`); return }
  failures += 1
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
}
function read(p: string): string { return readFileSync(p, "utf8") }

const ack = read("gateway/payment-acknowledgement.ts")
const ackNoComments = ack.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")

// ── A1 pipeline ───────────────────────────────────────────────────────────────
check("A1a recipient = canonical identity first", ack.includes('from("connect_external_identities")') && ack.includes('.eq("provider", "line")'))
check("A1b legacy company_line_links only as fallback", ack.includes('from("company_line_links")') && ack.indexOf("connect_external_identities") < ack.indexOf('from("company_line_links")'))
check("A1c summary = ledger view company_debt_current", ack.includes('from("company_debt_current")') && ack.includes("ledger_outstanding"))
check("A1d summary never reads invoice AR", !ack.includes('from("invoices")') && !ack.includes("invoice_payment_summary"))
check("A1e receipt document selected-or-created", ack.includes("receipt_document:") && ack.includes("createDocument("))
check("A1f no direct document insert (canonical writer only)", !/from\("standalone_documents"\)[\s\S]{0,160}?\.(insert|upsert)\(/.test(ackNoComments))
check("A1g delivery evidence = batch 38 shape", ack.includes('direction: "out"') && ack.includes("line_message_id: lineRes.messageId") && ack.includes("receipt_document_id: input.receipt_document_id"))
check("A1h idempotency via existing evidence row", ack.includes("already_acknowledged") && ack.includes('.eq("direction", "out")'))
check("A1i canonical audit on success", ack.includes('action: "receipt.acknowledged"') && ack.includes("recordCanonicalAudit"))
check("A1j fail-soft contract (explicit codes, no rethrow)", ack.includes("ACK_SEND_FAILED") && ack.includes("ACK_NO_LINE_RECIPIENT") && !/throw new Error\("ACK_/.test(ackNoComments))
check("A1k single gateway send", ack.includes("sendLineMessage(db, recipient"))

// ── A2 callers wired non-fatal + admin gate ──────────────────────────────────
const confirm = read("app/api/admin/receipt-documents/[id]/confirm/route.ts")
check("A2a manual confirm runs ack in try/catch (non-fatal)", confirm.includes("acknowledgePayment(") && confirm.includes('acknowledgement = { ok: false'))
check("A2b confirm response reports acknowledgement", confirm.includes("acknowledgement,"))
const bridge = read("app/api/internal/connect/payment-confirm/route.ts")
check("A2c bridge runs ack non-fatal, envelope stays additive", bridge.includes("acknowledgePayment(") && bridge.includes("acknowledgement,"))
const route = read("app/api/admin/receipt-documents/[id]/acknowledge/route.ts")
check("A2d manual/retry route carries admin auth gate", route.includes("requireAuth(ADMIN_TIER)"))

// ── A3 audit vocabulary ───────────────────────────────────────────────────────
const audit = read("engines/canonical/audit.ts")
check("A3 audit action vocabulary includes receipt.acknowledged", audit.includes('"receipt.acknowledged"'))

// ── A4 the ONE send gateway keeps its lifecycle gate ─────────────────────────
check("A4 connector Run gate still enforced by the gateway", read("registry/communication.ts").includes("requireConnector"))

console.log(`\npayment-acknowledgement: checks=${checks} passed=${checks - failures} failed=${failures}`)
process.exit(failures === 0 ? 0 : 1)
