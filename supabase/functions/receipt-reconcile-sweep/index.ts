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
// the only thing missing (same company_line_links lookup every other
// consumer uses, never a guess), then reuses the EXACT SAME reconcile path
// (tryAutoConfirmPayment -> reconcile_receipt_payment RPC) as the inline
// path — one reconciliation engine, two triggers (event-driven + swept),
// not two separate implementations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { tryAutoConfirmPayment } from "../line-webhook-v2/engines/auto-confirm-payment.ts"

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

    // Backfill company-matching — same direct-link-first lookup every other
    // consumer in this codebase uses (company_line_links), never a guess.
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
      const { data: link } = await supabase
        .from("company_line_links").select("company_id").eq("line_user_id", lineUserId).maybeSingle()
      companyId = (link as any)?.company_id ?? null
      if (companyId) {
        await supabase.from("receipt_documents").update({ customer_company_id: companyId }).eq("id", doc.id)
      }
    }

    if (!companyId || !lineUserId) {
      results[doc.id] = "skipped — still no matched company/LINE contact, needs a human"
      continue
    }

    const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle()

    await tryAutoConfirmPayment(supabase, {
      receiptDocumentId: doc.id,
      customerCompanyId: companyId,
      companyName: (company as any)?.name ?? "-",
      amount: Number(doc.amount),
      occurredAt: (doc.transaction_datetime ?? doc.document_date ?? new Date().toISOString()).slice(0, 10),
      referenceNumber: doc.reference_number ?? null,
      lineUserId,
    })
    results[doc.id] = "reconciled (or already was — idempotent)"
  }

  return Response.json({ checked: (pending ?? []).length, results })
})
