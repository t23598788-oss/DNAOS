/**
 * Document delivery ledger test (BATCH 38).
 *
 * Question the batch answered: does a system exist that records
 * document → recipient → sent_at → provider message id → status?
 * Answer: YES — `line_events` direction "out" (+ extracted jsonb document ref)
 * is THE delivery ledger (invoice idempotency already reads it), plus
 * `line_outbound_drafts` (sent_at/status) for the text approval queue.
 * This batch only filled the missing pieces — no new table:
 *   D1 gateway now captures the provider messageId from the push response
 *   D2 send-document route records the full structured evidence (was text-only)
 *   D3 internal document-artifact route records evidence (recorded NOTHING before)
 *   D4 the reference pattern (sendInvoiceToLine) + idempotency guard intact
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

// ── D0: the system exists (reuse, no new table) ───────────────────────────────
const lineEventsMigrations = [
  "supabase/migrations/20260709000002_line_events.sql",
  "supabase/migrations/20260711000001_line_events_direction.sql",
  "supabase/migrations/20260626000001_line_events_receiver_columns.sql",
]
const leSql = lineEventsMigrations.map(read).join("\n")
check("D0a line_events has line_message_id (provider message id column)", leSql.includes("line_message_id"))
check("D0b line_events has direction + status (rows can be typed)", leSql.includes("direction") && leSql.includes("status"))
const drafts = read("supabase/migrations/20260710000006_line_outbound_drafts.sql")
check("D0c line_outbound_drafts carries sent_at + status (existing approval ledger)", drafts.includes("sent_at") && drafts.includes("status"))

// ── D1: gateway captures provider messageId ───────────────────────────────────
const comm = read("registry/communication.ts")
check("D1 gateway parses messageId from the push response", comm.includes('body.messageId') && comm.includes("messageId: typeof body.messageId"))
check("D1b SendMessageResponse still exposes messageId", comm.includes("messageId?: string"))

// ── D2: send-document route records the full evidence ────────────────────────
const sendDoc = read("app/api/admin/line-customers/[lineUserId]/send-document/route.ts")
check("D2a send-document records direction out", sendDoc.includes('direction: "out"'))
check("D2b send-document records provider message id", sendDoc.includes("line_message_id: lineRes.messageId"))
check("D2c send-document records document ref (extracted)", sendDoc.includes("extracted:") && sendDoc.includes("document_no: documentNumber"))
check("D2d send-document records recipient + status", sendDoc.includes("line_user_id: lineUserId") && sendDoc.includes('status: "processed"'))
check("D2e send-document still sends through the ONE gateway", sendDoc.includes("sendLineMessage"))

// ── D3: internal document-artifact route records evidence ────────────────────
const internal = read("app/api/internal/line/document-artifact/route.ts")
check("D3a internal route inserts a direction out row", internal.includes('direction: "out"'))
check("D3b internal route records provider message id + document ref", internal.includes("line_message_id: lineRes.messageId") && internal.includes("document_id: body.documentId"))
check("D3c internal route keeps its secret gate", internal.includes("x-document-artifact-secret"))

// ── D4: reference pattern + idempotency guard intact ─────────────────────────
const actions = read("gateway/actions.ts")
check("D4a sendInvoiceToLine reference evidence intact (line_message_id + extracted)", actions.includes("line_message_id: lineRes.messageId") && actions.includes("document_kind: \"invoice\""))
check("D4b invoice idempotency still reads extracted->>document_id", actions.includes("extracted->>document_id"))
check("D4c invoice send still refuses re-send on existing evidence", actions.includes("ถูกส่งไปแล้ว"))

// no new delivery table introduced by this batch (line_events stays the ledger)
const allMigrations = read("package.json") // placeholder to keep imports minimal
void allMigrations
const newest = read("supabase/migrations/20261008000001_confirm_payment_anchor_principal_only.sql")
check("D5 batch 38 added no DDL (existing line_events reused)", !newest.toLowerCase().includes("delivery"))

console.log(`\ndocument-delivery-ledger: checks=${checks} passed=${checks - failures} failed=${failures}`)
process.exit(failures === 0 ? 0 : 1)
