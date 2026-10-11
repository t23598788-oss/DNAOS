// Receipt Reconciliation Sweep (owner, 2026-07-24): "ทำไมไม่ทำให้มันอัปเดต
// ตัวเองแบบ real-time" — the inline path (line-webhook-v2/handlers/image.ts's
// tryAutoConfirmPayment, fired the moment a slip arrives) only ever catches
// evidence that was ALREADY complete at ingestion time. Real incident
// (บจก. เคที คอนสตรัคชั่น, ฿5,000 slip, 2026-07-24) got stuck for a different
// reason — a classification bug (payment_advice vs transfer_slip) skipped
// company-matching entirely, so it never had the chance to auto-confirm even
// though the underlying evidence (amount/sender/time) was always complete.
//
// This is the self-healing half: runs on a schedule (see migration
// 20260724000003), finds every receipt_documents row that's still Pending
// Review but has complete evidence, backfills company-matching if that's
// the only thing missing (canonical Connect identity lookup — same
// resolveExternalIdentity contract every other consumer uses, never a guess), then reuses the EXACT SAME reconcile path
// (tryAutoConfirmPayment → Connect payment-confirm bridge → confirmPayment,
// P4/D2=ก 2026-09-24) as the inline
// path — one reconciliation engine, two triggers (event-driven + swept),
// not two separate implementations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { tryAutoConfirmPayment } from "../line-webhook-v2/engines/auto-confirm-payment.ts"
import { resolveExternalIdentity } from "../_shared/connect-identity.ts"
import {
  evaluateStatementEvidence,
  claimStatementRow,
  releaseStatementClaim,
} from "../_shared/bank-evidence.ts"

Deno.serve(async (req) => {
  // Rule 103 check done: RECONCILE_CRON_SECRET already exists, shared by
  // line-profile-reconcile/trigger-complete/quotation-queue-nudge/trigger-
  // auto-build. NOT reused here on purpose — Supabase secrets are write-only
  // via the CLI (only a hash is visible, never the plaintext), so there is
  // no safe way to know its real value without rotating it, and rotating a
  // secret shared by 4 already-scheduled functions would silently break any
  // of their existing pg_cron jobs (the old value is baked into each job's
  // stored net.http_post call — Rule 108, no silent config override). A
  // dedicated secret for this one function avoids that blast radius.
  const expected = Deno.env.get("RECEIPT_RECONCILE_CRON_SECRET")
  const got = req.headers.get("x-reconcile-secret")
  if (!expected || got !== expected) {
    return new Response("unauthorized", { status: 401 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: pending, error } = await supabase
    .from("receipt_documents")
    .select("id, document_type, amount, sender_name, transaction_datetime, document_date, reference_number, customer_company_id, line_event_id")
    .in("document_type", ["transfer_slip", "payment_advice"])
    .eq("status", "ai_read")
    .not("amount", "is", null)
    .not("sender_name", "is", null)
    .not("transaction_datetime", "is", null)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results: Record<string, string> = {}

  for (const doc of pending ?? []) {
    let companyId = doc.customer_company_id as string | null

    // Backfill company-matching — canonical Connect identity resolution
    // (resolveExternalIdentity → connect_identity_current), never a guess.
    // This is what actually unblocks the KT Construction slip: it was
    // eligible all along, just never matched because of the classification
    // bug fixed alongside this.
    let lineUserId: string | null = null
    if (doc.line_event_id) {
      const { data: lineEvent } = await supabase
        .from("line_events").select("line_user_id").eq("id", doc.line_event_id).maybeSingle()
      lineUserId = (lineEvent as any)?.line_user_id ?? null
    }
    if (!companyId && lineUserId) {
      // Connect identity cutover (BATCH 28): canonical Connect read
      // (connect_identity_current) — never the legacy company_line_links
      // projection. Unknown identity => null => "needs a human" below (fail-closed).
      const identity = await resolveExternalIdentity(supabase, "line", lineUserId)
      companyId = identity?.companyId ?? null
      if (companyId) {
        await supabase.from("receipt_documents").update({ customer_company_id: companyId }).eq("id", doc.id)
      }
    }

    if (!companyId || !lineUserId) {
      results[doc.id] = "skipped — still no matched company/LINE contact, needs a human"
      continue
    }

    // A2 (mission — owner rule 2026-07-27 "เงินเข้าจริงต้องเห็นจากธนาคาร"):
    // the sweep used to auto-confirm on OCR evidence ALONE (amount + sender +
    // datetime + a company link) because the inline path's bankEmailVerified
    // gate never made it into this sweeper. An OCR-readable slip is NOT bank
    // confirmation. Require at least ONE independent bank-side record before
    // the canonical chain may run:
    //   (a) a real statement row (day + amount ±5 + receiver account + bank
    //       description naming the slip's sender + claimable row), or
    //   (b) a real bank email record (bank_notifications ref + amount ±5).
    // Neither present → PENDING_REVIEW, never AUTO_CONFIRM.
    const occurredDate = (doc.transaction_datetime ?? doc.document_date ?? new Date().toISOString()).slice(0, 10)
    const docDate = new Date(occurredDate + "T00:00:00Z")
    const dd = String(docDate.getUTCDate()).padStart(2, "0")
    const mm = String(docDate.getUTCMonth() + 1).padStart(2, "0")
    const yy = String(docDate.getUTCFullYear()).slice(-2)
    const statementDate = `${dd}-${mm}-${yy}`

    let bankEvidenceOk = false
    let bankEvidenceNote = ""

    const { data: statementCandidates } = await supabase
      .from("bank_statement_transactions")
      .select("id, amount, transaction_date, description, account_number, matched_receipt_document_id")
      .eq("transaction_date", statementDate)
      .in("kind", ["รับโอนเงิน", "ฝากเงินสด"])
      .gte("amount", Number(doc.amount) - 5)
      .lte("amount", Number(doc.amount) + 5)

    const evidence = evaluateStatementEvidence({
      candidates: statementCandidates ?? [],
      senderName: doc.sender_name,
      receiptDocumentId: doc.id,
    })
    let claimedRowId: string | null = null
    if (evidence.kind === "matched") {
      const claimed = await claimStatementRow(supabase, evidence.rowId, doc.id)
      if (claimed) {
        bankEvidenceOk = true
        claimedRowId = evidence.rowId
        bankEvidenceNote = "statement row claimed"
      } else {
        bankEvidenceNote = "pending_review: statement row claimed by another receipt"
      }
    } else if (evidence.kind === "ambiguous") {
      bankEvidenceNote = `pending_review: ${evidence.matches} statement rows match same day+amount — left for human`
    } else if (evidence.kind === "insufficient") {
      bankEvidenceNote = `pending_review: ${evidence.reason}`
    }

    if (!bankEvidenceOk && doc.reference_number) {
      const { data: bankEmail } = await supabase
        .from("bank_notifications")
        .select("id, amount")
        .eq("reference_number", doc.reference_number)
        .limit(1)
        .maybeSingle()
      if (bankEmail && Math.abs(Number(bankEmail.amount) - Number(doc.amount)) <= 5) {
        bankEvidenceOk = true
        bankEvidenceNote = "bank email reference matched"
      }
    }

    if (!bankEvidenceOk) {
      if (claimedRowId) await releaseStatementClaim(supabase, claimedRowId, doc.id)
      results[doc.id] = bankEvidenceNote.startsWith("pending_review")
        ? bankEvidenceNote
        : "pending_review: no independent bank evidence (statement row or bank email) — left for human"
      continue
    }

    const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle()

    const auto = await tryAutoConfirmPayment(supabase, {
      receiptDocumentId: doc.id,
      customerCompanyId: companyId,
      companyName: (company as any)?.name ?? "-",
      amount: Number(doc.amount),
      occurredAt: occurredDate,
      referenceNumber: doc.reference_number ?? null,
      lineUserId,
    })

    // B1: report the REAL outcome — "reconciled" is only allowed when the
    // canonical writer actually accepted the confirmation.
    if (auto.status === "confirmed") {
      results[doc.id] = `reconciled against real bank evidence (${bankEvidenceNote})`
    } else if (auto.status === "already") {
      results[doc.id] = "already confirmed earlier (idempotent)"
    } else {
      if (claimedRowId) await releaseStatementClaim(supabase, claimedRowId, doc.id)
      results[doc.id] = auto.status === "rejected"
        ? `pending_review: canonical writer rejected (${auto.error})`
        : `pending_review: ${auto.reason}`
    }
  }

  return Response.json({ checked: (pending ?? []).length, results })
})
