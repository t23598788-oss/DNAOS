// Local-AI pipeline (owner, 2026-07-25): everything downstream of "we now
// know what this image is" — unchanged business logic, just extracted from
// handlers/image.ts so it can run from two places: nowhere synchronously
// anymore (no ANTHROPIC_API_KEY, confirmed via `supabase secrets list` —
// this was never actually reachable in production), and from
// functions/ai-callback/index.ts once the owner's Mac finishes local
// classification via Ollama and posts the result back. Classification
// itself lives outside this repo's Deno runtime now (Ollama on the Mac);
// this file is the one real place all the resulting business decisions
// still happen, so it is not duplicated between two languages.
import type { ClassifiedReceipt } from "./ocr-classify.ts"
import { tryAutoConfirmPayment } from "./auto-confirm-payment.ts"
import { maybeCreatePrintJob, matchPaymentToPrintJob } from "./print-jobs.ts"

export async function processClassifiedImage(
  supabase: any,
  params: {
    classified: ClassifiedReceipt | null
    mediaPath: string
    lineEventId: string
    userId: string
  },
): Promise<void> {
  const { classified, mediaPath, lineEventId, userId } = params

  // Payment Verification Engine — Phase 1 (owner, 2026-07-18): a slip alone
  // is Pending Review, never auto-Verified. Matching the company here so a
  // reviewer doesn't have to do it manually.
  let customerCompanyId: string | null = null
  if ((classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice") && userId) {
    const { data: link } = await supabase
      .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
    customerCompanyId = (link as any)?.company_id ?? null
  }

  // Replayed-slip fraud gate (owner, 2026-07-26 — real trace of EV260726-0006
  // surfaced a bigger issue than that one case): "สลิปเก่าๆ...ไม่มีความหมาย
  // กับการทำธุรกิจจริงแต่มีความหมายกับมิจฉาชีพ" — a slip is a photo of one
  // real bank transaction. The SAME real transaction (same reference_number)
  // being presented a second time to confirm a DIFFERENT debt/order is
  // exactly how a screenshot of an old real payment gets reused to get a
  // truck dispatched for free. Neither existing safeguard catches this: the
  // ±5-baht amount match above only checks the number matches, not whether
  // this exact transaction already paid for something else; and
  // reconcile_receipt_payment()'s idempotency check (auto-confirm-payment.ts)
  // only guards against reprocessing the SAME receipt_documents row twice,
  // not a different row carrying the same real bank reference_number. This
  // closes that gap: if this reference_number was already used on a
  // CONFIRMED payment before, no auto-confirm path may fire, no matter what
  // the amount says — a human must look at it. Deliberately not revealed to
  // the customer (see reply text below) — telling a fraudster "we caught
  // your reused slip" just teaches them to try a different one next time.
  let reusedSlipWarning: string | null = null
  if (
    classified?.reference_number &&
    (classified.document_type === "transfer_slip" || classified.document_type === "payment_advice")
  ) {
    const { data: reused } = await supabase
      .from("receipt_documents")
      .select("id")
      .eq("reference_number", classified.reference_number)
      .eq("status", "confirmed")
      .limit(1).maybeSingle()
    if (reused) {
      reusedSlipWarning = `⚠ เลขที่รายการ ${classified.reference_number} เคยถูกใช้ยืนยันการชำระเงินไปแล้วก่อนหน้านี้ (receipt_documents id: ${reused.id}) — อาจเป็นสลิปเก่าที่ถูกนำมาใช้ซ้ำ ห้าม auto-confirm ต้องให้เจ้าหน้าที่ตรวจสอบก่อนเสมอ`
    }
  }

  // Implausible-date sanity gate (owner, 2026-07-26 — real case found live,
  // receipt_documents b717a143-...): a real slip actually said "3 พ.ค. 69"
  // (3 May 2569 BE = 2026 CE) but the local OCR model recorded
  // transaction_datetime as 2016-05-03 — a real 10-year misread. Nothing
  // ever compared the extracted date against "now" to notice this reads as
  // a transaction from a decade ago being presented today. Same principle
  // as material-density.ts's validateDensity(): a value can be perfectly
  // well-formed and still be obviously wrong — the code must check
  // plausibility, not just presence. Owner's own framing: "ถ้าเป็นคนจริงๆ
  // ก็บอกว่า...วันที่ก็ไม่ตรง...ถ้าเป็นมนุษย์จะรู้ทันที" — unlike the reused-
  // reference case, an implausible date is safe to state to the customer
  // directly (a wrong photo/misread is a normal honest mistake, not proof
  // of fraud), so this one DOES get mentioned in the reply.
  let staleSlipWarning: string | null = null
  const txnDateRaw = classified?.transaction_datetime ?? classified?.document_date ?? null
  if (
    txnDateRaw &&
    (classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice")
  ) {
    const txnDate = new Date(txnDateRaw)
    if (!isNaN(txnDate.getTime())) {
      const ageDays = (Date.now() - txnDate.getTime()) / 86_400_000
      if (ageDays > 7) {
        staleSlipWarning = `วันที่/เวลาโอนบนสลิป (${txnDateRaw}) ห่างจากตอนนี้ ${Math.round(ageDays)} วัน ผิดปกติมาก — อาจเป็นสลิปเก่า หรือ AI อ่านวันที่ผิด (พบเคสจริง 2026-07-26: อ่าน พ.ศ.69 เป็น ค.ศ.2016)`
      } else if (ageDays < -1) {
        staleSlipWarning = `วันที่/เวลาโอนบนสลิป (${txnDateRaw}) เป็นวันที่ในอนาคต ผิดปกติ`
      }
    }
  }

  // Payment Verification Engine — Level 3, real (owner, 2026-07-26): Rule
  // 115 always documented Level 3 (bank notification email) as "ยังไม่มีใน
  // ระบบวันนี้" — bank_notifications (populated by bank-email-sync, real
  // Gmail API read of the owner's own K BIZ transfer-confirmation emails)
  // is that real, independent evidence source now. A fraudster can fake a
  // slip photo but cannot fake a real email arriving in the owner's inbox.
  // A genuine match here is real confirmation the transaction actually
  // happened — strong enough to override the OCR-date staleness heuristic
  // (Gmail's own record is ground truth, not a guess at what the slip
  // photo says), but NOT the reused-reference gate above: a real bank email
  // confirms the transaction happened ONCE, it doesn't grant permission to
  // use that same transaction to pay two different debts.
  let bankEmailVerified = false
  if (classified?.reference_number && classified?.amount) {
    const { data: bankMatch } = await supabase
      .from("bank_notifications")
      .select("id, amount")
      .eq("reference_number", classified.reference_number)
      .limit(1).maybeSingle()
    if (bankMatch && Math.abs(Number(bankMatch.amount) - Number(classified.amount)) <= 5) {
      bankEmailVerified = true
      if (!reusedSlipWarning) staleSlipWarning = null
    }
  }

  const insertRow = classified
    ? {
        line_event_id: lineEventId,
        media_path: mediaPath,
        document_type: classified.document_type,
        vendor_name: classified.vendor_name,
        amount: classified.amount,
        document_date: classified.document_date,
        raw_ocr_text: classified.raw_ocr_text,
        confidence: classified.confidence,
        status: "ai_read",
        sender_name: classified.sender_name,
        sender_bank: classified.sender_bank,
        reference_number: classified.reference_number,
        transaction_datetime: classified.transaction_datetime,
        customer_company_id: customerCompanyId,
        verification_level: bankEmailVerified ? 3 : 2,
        error_th: [reusedSlipWarning, staleSlipWarning].filter(Boolean).join(" | ") || null,
      }
    : {
        line_event_id: lineEventId,
        media_path: mediaPath,
        document_type: "other",
        status: "ai_read",
        error_th: "AI จำแนกเอกสารไม่สำเร็จ — รูปต้นฉบับยังดูได้ปกติ",
        verification_level: 2,
      }
  const { data: insertedDoc } = await supabase
    .from("receipt_documents").insert(insertRow).select("id").single()

  if (bankEmailVerified && insertedDoc && classified?.reference_number) {
    await supabase.from("bank_notifications")
      .update({ matched_receipt_document_id: insertedDoc.id })
      .eq("reference_number", classified.reference_number)
  }

  // Photocopy-shop-via-LINE (owner, 2026-07-25) — see engines/print-jobs.ts
  if (classified?.document_type === "government_document" && userId) {
    await maybeCreatePrintJob(supabase, {
      lineUserId: userId,
      mediaPath,
      documentType: classified.document_type,
    })
  }
  if (
    (classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice") &&
    userId && classified?.amount
  ) {
    await matchPaymentToPrintJob(supabase, { lineUserId: userId, amount: Number(classified.amount) })

    // Real payment gate before dispatch (owner, 2026-07-26): "ระบบต้องเห็น
    // สลิปจริงก่อนถึงสั่งรถ" — match this slip against the oldest order this
    // customer already confirmed (status "awaiting_payment") whose real
    // quoted_amount is close to what the slip actually shows. Only a real
    // match moves it to "payment_confirmed" — the one status that means
    // it's actually safe to dispatch.
    const amount = Number(classified.amount)
    const { data: pendingOrder } = await supabase
      .from("business_events")
      .select("id, event_code, quoted_amount")
      .eq("source_line_user_id", userId)
      .eq("status", "awaiting_payment")
      .not("quoted_amount", "is", null)
      .order("created_at", { ascending: true })
      .limit(1).maybeSingle()

    if (reusedSlipWarning && pendingOrder) {
      // Deliberately the same generic wording as a real amount mismatch —
      // never tell the customer specifically "this slip was reused," that
      // only teaches a fraudster to try a different old slip next time.
      const { ResponseGateway } = await import("./response.ts")
      await ResponseGateway.pushMessage(
        userId,
        `รับสลิปแล้วครับ รบกวนรอเจ้าหน้าที่ตรวจสอบก่อนดำเนินการต่อนะครับ`,
      )
    } else if (staleSlipWarning && pendingOrder) {
      // Unlike reusedSlipWarning, an implausible date is safe to state
      // plainly — a genuine customer sending the wrong old screenshot is a
      // normal mistake, not something a fraud-flag reveal would help hide.
      const { ResponseGateway } = await import("./response.ts")
      await ResponseGateway.pushMessage(
        userId,
        `รับสลิปแล้วครับ แต่วันที่/เวลาโอนบนสลิปดูไม่ตรงกับตอนนี้เลย รบกวนเช็คว่าส่งสลิปถูกใบไหมครับ ถ้าถูกใบแล้วรอเจ้าหน้าที่ตรวจสอบอีกทีนะครับ`,
      )
    } else if (pendingOrder && Math.abs(Number(pendingOrder.quoted_amount) - amount) <= 5) {
      await supabase.from("business_events")
        .update({ status: "payment_confirmed" }).eq("id", pendingOrder.id)
      const { ResponseGateway } = await import("./response.ts")
      await ResponseGateway.pushMessage(
        userId,
        `✅ ตรวจสอบสลิปแล้ว ยอด ${amount.toLocaleString()} บาท ตรงกับใบเสนอราคา ${pendingOrder.event_code} ครับ เดี๋ยวจัดรถให้เลยนะครับ`,
      )
    } else if (pendingOrder) {
      // Real gap found live 2026-07-26 (owner-directed trace of a real
      // stuck case, EV260726-0006): a mismatched slip amount correctly
      // never auto-confirmed (Rule 72/73 — no silent financial state
      // change), but the code silently did nothing else either — the
      // customer got zero reply, no idea their payment needs review.
      // Same "silence feels dead" principle as the text-fallback fix
      // (2026-07-25) applies here: state the real mismatch honestly, don't
      // pretend it's handled, don't guess which number is right — a human
      // still resolves it (via /admin/receipts), this only closes the gap
      // where the customer never found out there was a problem.
      const { ResponseGateway } = await import("./response.ts")
      await ResponseGateway.pushMessage(
        userId,
        `รับสลิปแล้วครับ แต่ยอด ${amount.toLocaleString()} บาท ไม่ตรงกับใบเสนอราคา ${pendingOrder.event_code} ที่ยืนยันไว้ (ยอดที่ต้องชำระ ${Number(pendingOrder.quoted_amount).toLocaleString()} บาท) รบกวนรอเจ้าหน้าที่ตรวจสอบและติดต่อกลับอีกทีนะครับ`,
      )
    }
  }

  // Autonomous Payment Confirmation (owner, 2026-07-24) — cash/company
  // invoice flow, unchanged from the original synchronous version.
  const isPaymentDoc = classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice"
  const hasCompleteEvidence = Boolean(
    classified?.amount && classified?.sender_name && classified?.transaction_datetime && customerCompanyId,
  )
  if (isPaymentDoc && hasCompleteEvidence && !reusedSlipWarning && !staleSlipWarning && insertedDoc && userId) {
    const { data: company } = await supabase
      .from("companies").select("name").eq("id", customerCompanyId).maybeSingle()
    await tryAutoConfirmPayment(supabase, {
      receiptDocumentId: insertedDoc.id,
      customerCompanyId: customerCompanyId!,
      companyName: company?.name ?? "-",
      amount: Number(classified!.amount),
      occurredAt: (classified!.transaction_datetime ?? classified!.document_date ?? new Date().toISOString()).slice(0, 10),
      referenceNumber: classified!.reference_number ?? null,
      lineUserId: userId,
    })
  }
}
