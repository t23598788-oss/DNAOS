// Real bank-statement reconciliation (owner, 2026-07-27): real trace of a
// live case (บจก. เคที คอนสตรัคชั่น 1988, 5,000 บาท, TRBS260723374064276)
// confirmed a hard architectural fact — the bank-email cross-check (#9,
// bank-email-sync) can NEVER confirm a customer's INCOMING payment,
// because a bank's transfer-confirmation email always goes to whoever
// INITIATED the transfer (the customer, on their own bank app), never the
// recipient. Requiring bankEmailVerified before auto-confirming (#15) was
// correct in principle but means every real incoming customer payment now
// permanently falls to human review — there was never a path back to
// automatic for THIS kind of evidence.
//
// The real, correct independent second source for incoming money is the
// bank's own STATEMENT (bank_statement_transactions, #10 — real "รับโอนเงิน"/
// "ฝากเงินสด" rows from scripts/bank-statement-sync's Playwright
// automation), not email. This function is that reverse-match, called by
// bank-statement-sync right after it inserts new statement rows: for every
// pending receipt_documents claim (payment_advice/transfer_slip, status
// 'ai_read') whose amount and calendar date match a real statement row,
// complete the SAME real downstream chain as any other confirmation source
// — the Connect payment-confirm chain (debt ledger + receipt, P4/D2=ก), or
// the order
// dispatch gate for the quote/order flow — never both silently guessed
// blind: a day with more than one same-amount statement row is treated as
// genuinely ambiguous and left for a human, not auto-matched to either.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { tryAutoConfirmPayment } from "../line-webhook-v2/engines/auto-confirm-payment.ts"
import { ResponseGateway } from "../line-webhook-v2/engines/response.ts"
import { sendConnectEventCommand, CONNECT_PROVIDER } from "../_shared/connect-event.ts"
import {
  evaluateStatementEvidence,
  claimStatementRow,
  releaseStatementClaim,
} from "../_shared/bank-evidence.ts"

Deno.serve(async (req) => {
  const expected = Deno.env.get("BANK_STATEMENT_RECONCILE_SECRET")
  const got = req.headers.get("x-bank-statement-reconcile-secret")
  if (!expected || got !== expected) {
    return new Response("unauthorized", { status: 401 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: pendingDocs } = await supabase
    .from("receipt_documents")
    .select("id, amount, sender_name, transaction_datetime, customer_company_id, document_type, line_event_id")
    .in("document_type", ["transfer_slip", "payment_advice"])
    .eq("status", "ai_read")
    .not("amount", "is", null)

  const results: { receiptDocumentId: string; outcome: string }[] = []

  for (const doc of pendingDocs ?? []) {
    const docDate = doc.transaction_datetime ? new Date(doc.transaction_datetime) : null
    if (!docDate || isNaN(docDate.getTime())) { results.push({ receiptDocumentId: doc.id, outcome: "skip: no real transaction_datetime to match a calendar day against" }); continue }

    // Real statement dates are stored as "DD-MM-YY" strings (see
    // scripts/bank-statement-sync's parser) — build the same format to
    // compare against the slip's own ISO transaction_datetime.
    const dd = String(docDate.getDate()).padStart(2, "0")
    const mm = String(docDate.getMonth() + 1).padStart(2, "0")
    const yy = String(docDate.getFullYear()).slice(-2)
    const statementDate = `${dd}-${mm}-${yy}`

    const { data: statementMatches } = await supabase
      .from("bank_statement_transactions")
      .select("id, amount, transaction_date, description, account_number, matched_receipt_document_id")
      .eq("transaction_date", statementDate)
      .in("kind", ["รับโอนเงิน", "ฝากเงินสด"])
      .gte("amount", Number(doc.amount) - 5)
      .lte("amount", Number(doc.amount) + 5)

    // A1 (mission): date + amount alone is NOT enough. The shared evaluator
    // additionally demands the receiver account, exactly one candidate row, a
    // bank description that names the slip's sender, and a row not already
    // claimed by another receipt. Anything ≠ matched → PENDING_REVIEW.
    const evidence = evaluateStatementEvidence({
      candidates: statementMatches ?? [],
      senderName: doc.sender_name,
      receiptDocumentId: doc.id,
    })
    if (evidence.kind === "no_match") { results.push({ receiptDocumentId: doc.id, outcome: "no matching statement row yet" }); continue }
    if (evidence.kind === "ambiguous") { results.push({ receiptDocumentId: doc.id, outcome: `ambiguous: ${evidence.matches} statement rows match same day+amount — left for human` }); continue }
    if (evidence.kind === "insufficient") { results.push({ receiptDocumentId: doc.id, outcome: `pending_review: ${evidence.reason}` }); continue }
    const statementRowId = evidence.rowId

    const { data: lineEvent } = await supabase
      .from("line_events").select("line_user_id").eq("id", doc.line_event_id).maybeSingle()
    const userId = lineEvent?.line_user_id
    if (!userId) { results.push({ receiptDocumentId: doc.id, outcome: "skip: no line_user_id on the source event" }); continue }

    // C1 (mission): one piece of bank evidence may drive AT MOST ONE downstream
    // state change. Decide which flow — if BOTH the receipt flow and the order
    // flow qualify for this same row, the evidence cannot say which claim the
    // money pays → PENDING_REVIEW, nobody auto-confirms (no double use, no
    // business-state change beyond what the evidence proves).
    const halfAEligible = Boolean(doc.amount && doc.sender_name && doc.customer_company_id)
    const { data: pendingOrder } = await supabase
      .from("business_events")
      .select("id, event_code, quoted_amount")
      .eq("source_line_user_id", userId)
      .eq("status", "awaiting_payment")
      .not("quoted_amount", "is", null)
      .order("created_at", { ascending: true })
      .limit(1).maybeSingle()
    const halfBEligible = Boolean(pendingOrder && Math.abs(Number(pendingOrder.quoted_amount) - Number(doc.amount)) <= 5)

    if (halfAEligible && halfBEligible) {
      results.push({
        receiptDocumentId: doc.id,
        outcome: "pending_review: same bank evidence matches BOTH an open receipt claim and a pending order — which claim it pays is ambiguous, left for human",
      })
      continue
    }

    // C2: claim the statement row BEFORE confirming so no other pending receipt
    // can use the same bank transaction while this attempt runs.
    const claimed = await claimStatementRow(supabase, statementRowId, doc.id)
    if (!claimed) {
      results.push({ receiptDocumentId: doc.id, outcome: "pending_review: statement row was claimed by another receipt between match and confirm — left for human" })
      continue
    }

    let outcomeText: string

    if (halfAEligible) {
      // Half A: cash/company invoice flow — full evidence + real company link,
      // confirmed against the real bank statement through the canonical chain.
      const { data: company } = await supabase
        .from("companies").select("name").eq("id", doc.customer_company_id).maybeSingle()
      const auto = await tryAutoConfirmPayment(supabase, {
        receiptDocumentId: doc.id,
        customerCompanyId: doc.customer_company_id,
        companyName: company?.name ?? "-",
        amount: Number(doc.amount),
        occurredAt: docDate.toISOString().slice(0, 10),
        referenceNumber: null,
        lineUserId: userId,
      })
      if (auto.status === "confirmed" || auto.status === "already") {
        // claim stays — this receipt now owns that statement row
        outcomeText = auto.status === "confirmed"
          ? "confirmed against real bank statement"
          : "already confirmed earlier (idempotent) — statement row linked"
      } else {
        await releaseStatementClaim(supabase, statementRowId, doc.id)
        outcomeText = auto.status === "rejected"
          ? `pending_review: canonical writer rejected (${auto.error})`
          : `pending_review: ${auto.reason}`
      }
    } else if (halfBEligible) {
      // Half B: order/quote dispatch flow — the SAME claim/release discipline.
      const transition = await sendConnectEventCommand("business_event.transition", {
        event_id: pendingOrder!.id,
        from_status: "awaiting_payment",
        status: "payment_confirmed",
      }, `system:${CONNECT_PROVIDER}:bank-confirm`)
      if (transition.ok) {
        // B2: only tell the customer the dispatch is confirmed when the
        // canonical transition actually succeeded.
        await ResponseGateway.pushMessage(
          userId,
          `✅ ตรวจสอบกับใบแจ้งยอดธนาคารแล้ว ยอด ${Number(doc.amount).toLocaleString()} บาท ตรงกับใบเสนอราคา ${pendingOrder!.event_code} ครับ เดี๋ยวจัดรถให้เลยนะครับ`,
        )
        outcomeText = "order transitioned to payment_confirmed against real bank statement"
      } else {
        await releaseStatementClaim(supabase, statementRowId, doc.id)
        outcomeText = `pending_review: order transition failed (${transition.error ?? "unknown"}) — no customer message sent`
      }
    } else {
      await releaseStatementClaim(supabase, statementRowId, doc.id)
      outcomeText = "matched statement row but no downstream flow applied (missing evidence fields)"
    }

    results.push({ receiptDocumentId: doc.id, outcome: outcomeText })
  }

  return Response.json({ ok: true, checked: pendingDocs?.length ?? 0, results })
})
