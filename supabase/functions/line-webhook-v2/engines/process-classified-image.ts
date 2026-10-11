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
import { alertOwnerAnomaly } from "./owner-dispatcher.ts"
import { sendConnectEventCommand, CONNECT_PROVIDER } from "../../_shared/connect-event.ts"
import { sendConnectInboundSource } from "../../_shared/connect-inbound.ts"
import { resolveExternalIdentity } from "../../_shared/connect-identity.ts"
import { sendConnectExpenseCommand } from "../../_shared/connect-expense.ts"

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
  // Connect identity cutover (BATCH 28): company resolution now reads the
  // canonical Connect model (connect_identity_current view via
  // resolveExternalIdentity) — never the legacy company_line_links projection.
  let customerCompanyId: string | null = null
  if ((classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice") && userId) {
    const identity = await resolveExternalIdentity(supabase, "line", userId)
    customerCompanyId = identity?.companyId ?? null
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
  // the payment-confirm idempotency check (auto-confirm-payment.ts →
  // receipt-confirm-flow, P4/D2=ก) only guards against reprocessing the SAME
  // receipt_documents row twice,
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

  // P4b (owner approval 2026-09-24): receipt creation goes through the
  // Connect inbound bridge → recordInboundSource (canonical writer + audit +
  // evidence rules) instead of a direct business-table insert from this
  // provider tier. Fail-closed with no fallback: transport/writer failure
  // leaves insertedDoc = null — every downstream block below is already
  // guarded on insertedDoc, exactly like the old insert-error path, so
  // nothing runs against a record that was not stored.
  const ingestErrorTh = classified
    ? ([reusedSlipWarning, staleSlipWarning].filter(Boolean).join(" | ") || null)
    : "AI จำแนกเอกสารไม่สำเร็จ — รูปต้นฉบับยังดูได้ปกติ"
  const inbound = await sendConnectInboundSource({
    channel: "line",
    media_path: mediaPath,
    document_type: classified ? classified.document_type : "other",
    line_event_id: lineEventId,
    customer_company_id: classified ? customerCompanyId : null,
    raw_ocr_text: classified?.raw_ocr_text ?? null,
    amount: classified?.amount ?? null,
    sender_name: classified?.sender_name ?? null,
    sender_bank: classified?.sender_bank ?? null,
    reference_number: classified?.reference_number ?? null,
    transaction_datetime: classified?.transaction_datetime ?? null,
    document_date: classified?.document_date ?? null,
    vendor_name: classified?.vendor_name ?? null,
    description: classified?.description ?? null,
    confidence: classified?.confidence ?? null,
    verification_level: bankEmailVerified ? 3 : 2,
    error_th: ingestErrorTh,
    actor: "system:auto-ocr",
    provenance: {
      provider: CONNECT_PROVIDER,
      received_via: "edge:line-webhook-v2",
      bank_email_verified: bankEmailVerified,
    },
  })
  if (!inbound.ok) console.error(`[process-classified-image] INBOUND_CONNECT_FAILED: ${inbound.error}`)
  const insertedDoc = inbound.ok && inbound.data ? { id: inbound.data.receipt_document_id } : null

  if (bankEmailVerified && insertedDoc && classified?.reference_number) {
    await supabase.from("bank_notifications")
      .update({ matched_receipt_document_id: insertedDoc.id })
      .eq("reference_number", classified.reference_number)
  }

  // Owner Dispatcher — Anomaly Detection routing (owner, 2026-07-27):
  // reusedSlipWarning used to only sit silently in error_th for a human to
  // find later. A reused reference number is the one gate that's genuinely
  // suspicious (not just a likely OCR misread like staleSlipWarning), so it
  // now also alerts the owner's own chat in real time.
  if (reusedSlipWarning && insertedDoc) {
    await alertOwnerAnomaly(supabase, `${reusedSlipWarning}\n(receipt_documents id: ${insertedDoc.id})`)
  }

  // Internal-Sender Expense Auto-Recording (owner, 2026-07-27): real gap
  // found live — line_profiles.role/trust_level was set correctly (e.g.
  // "พี่หนุ่ม" = manager, verified) but never once read anywhere in this
  // pipeline. A tax_invoice/invoice/receipt/fuel_bill from a verified
  // manager (covers both the owner and real staff) is a real company cost,
  // not a customer payment claim — record it immediately, no human-confirm
  // queue (that queue is for unverified/external claims, Rule 72/115).
  // transfer_slip/payment_advice are deliberately excluded even from a
  // manager — those still mean "money changed hands," which stays gated on
  // the existing payment-verification path regardless of who sent it.
  const EXPENSE_DOCUMENT_TYPES = new Set(["tax_invoice", "invoice", "receipt", "fuel_bill"])
  // Bug found live 2026-07-31 (owner, during LINE/customer isolation review):
  // this only ever checked role === "manager" — the owner's own line_profiles
  // row is role === "owner", so a receipt the owner sent himself was silently
  // never auto-recorded, contradicting this code's own original intent
  // ("covers both the owner and real staff like พี่หนุ่ม," per the migration
  // comment). Code-level gate, not a prompt instruction: still only these
  // two exact roles, still requires verified trust — a customer/supplier/
  // driver role can never reach this regardless of what the AI classifies.
  const INTERNAL_EXPENSE_ROLES = new Set(["owner", "manager"])
  // LANDED (D3 deferred work, owner 2026-09-24): this expense insert now goes
  // through the Connect expense bridge → engines/canonical/expense-write
  // (+ canonical audit) — no direct money write remains in this file.
  if (classified && EXPENSE_DOCUMENT_TYPES.has(classified.document_type) && userId && insertedDoc) {
    const { data: profile } = await supabase
      .from("line_profiles").select("display_name, role, trust_level").eq("line_user_id", userId).maybeSingle()
    if (profile?.role && INTERNAL_EXPENSE_ROLES.has(profile.role) && profile?.trust_level === "verified") {
      // ของเดิม insert error ถูกกลืนเงียบ → log แล้วไปต่อ เหมือนเดิม (fail-closed ไม่มี fallback)
      const expense = await sendConnectExpenseCommand("expense.record", {
        receipt_document_id: insertedDoc.id,
        document_type: classified.document_type,
        amount: Number(classified.amount),
        vendor_name: classified.vendor_name,
        expense_date: classified.document_date,
        submitted_by_line_user_id: userId,
        submitted_by_name: profile.display_name,
        submitted_by_role: profile.role,
      }, "system:auto-ocr")
      if (!expense.ok) console.error(`[process-classified-image] EXPENSE_RECORD_FAILED: ${expense.error}`)
    }
  }

  // Real conversation understanding for product/site photos (owner-reported
  // 2026-07-30, widened same day): "ไม่ต้องมองว่าลูกค้าคือแชทคนคุยกัน...
  // ถามแลกเปลี่ยนเหตุการณ์ เปิดประเด็นต่างๆ ก่อนจะเป็นอิเวนต์ ก่อนจะเป็นการขาย
  // ...ถ้าเราไม่เอารูปภาพเข้าไปเชื่อมโยง แล้วไปเก็บเป็นไฟล์ทำไม" — the first
  // pass of this fix only attached a photo's meaning to a formal
  // business_events row, and only when one already existed with
  // status="awaiting_info" (i.e. only once it had already become a sales
  // flow). That's backwards from what was asked: the photo's meaning belongs
  // to the CONVERSATION it happened in, whether or not that conversation has
  // become a formal "Event" yet — a picture is never just a stored file, it
  // is a specific reply at a specific moment in an ongoing chat.
  //
  // Fix: always record what the photo actually shows directly on ITS OWN
  // line_events row (ai_summary — the real per-message conversation-timeline
  // field every inbound message already has, independent of any
  // business_events row existing at all). This is the one write that always
  // happens, formal Event or not. Separately, if this contact does have a
  // recent business_events row (ANY status, not just awaiting_info — a
  // photo sent while an order is already quoted/awaiting_payment is just as
  // much "part of that conversation" as one sent while still awaiting
  // info), also mirror it there as extra context for whoever's handling that
  // Event — a bonus, not the only place the understanding lives.
  if (
    (classified?.document_type === "product_photo" || classified?.document_type === "site_photo") &&
    classified?.description
  ) {
    await supabase.from("line_events").update({ ai_summary: classified.description }).eq("id", lineEventId)

    if (userId) {
      const { data: recentEvent } = await supabase
        .from("business_events")
        .select("id, context")
        .eq("source_line_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle()
      if (recentEvent) {
        const priorPhotos = Array.isArray(recentEvent.context?.photos) ? recentEvent.context.photos : []
        // Capability D: BUSINESS METADATA (context) through the Connect transport.
        await sendConnectEventCommand("business_event.enrich", {
          event_id: recentEvent.id,
          fields: { context: { ...(recentEvent.context ?? {}), photos: [...priorPhotos, classified.description] } },
        }, `system:${CONNECT_PROVIDER}:process-classified-image`)
      }
      // Owner-reported 2026-07-30 (same conversation as the vehicle-payment
      // gap above): "เค้ากำลังซ่อมรถแม็คโครใช่ไหม เราต้องถามเค้าว่ายังไง
      // รถเป็นอะไรพี่" — an equipment/vehicle photo deserves a real
      // conversational follow-up, not just a flat acknowledgment that
      // silently logs the picture and moves on.
      const looksLikeVehicle = /รถ|แม็คโคร|แมกโค|รถแบคโฮ|เครื่องยนต์|ซ่อม/.test(classified.description)
      const followUp = looksLikeVehicle ? " รถเป็นอะไรครับพี่ พอบอกอาการได้ไหมครับ" : ""
      const { ResponseGateway } = await import("./response.ts")
      await ResponseGateway.pushMessage(userId, `รับรูปแล้วครับ (${classified.description})${followUp}`)
    }
  }

  // Photocopy-shop-via-LINE (owner, 2026-07-25) — see engines/print-jobs.ts
  if (classified?.document_type === "government_document" && userId) {
    await maybeCreatePrintJob(supabase, {
      lineUserId: userId,
      mediaPath,
      documentType: classified.document_type,
    })
  }
  // C1 (mission): one piece of payment evidence may drive AT MOST ONE business
  // flow. Declared here (function scope) because the order-dispatch block below
  // and the receipt auto-confirmation block further down must not BOTH run for
  // the same slip.
  let doubleFlowAmbiguous = false
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
    } else if (pendingOrder && Math.abs(Number(pendingOrder.quoted_amount) - amount) <= 5 && bankEmailVerified) {
      // Tightened 2026-07-27 (owner): "ต้องผูกสองโมเดลนี้เข้าทำงานร่วมกัน...
      // เห็นเงินจากธนาคารเค้าบอกว่าเงินเข้าแล้วหรือยัง" — a real truck only
      // dispatches when the amount matches AND a real bank record
      // (bankEmailVerified, Level 3) independently confirms the transfer
      // happened. Amount-match alone (OCR reading the slip correctly) is
      // no longer sufficient on its own — same principle just applied to
      // receipt-issuance above, extended here at the owner's explicit
      // confirmation since dispatching a real truck carries the same risk.
      //
      // C1 (mission): if this SAME slip would also qualify for the receipt
      // auto-confirmation below (complete OCR evidence + a real company link),
      // one transfer can't honestly both pay off a debt AND confirm an order —
      // ambiguous → neither flow runs, human decides which claim it pays.
      const receiptFlowWouldAlsoRun = Boolean(
        classified.sender_name && classified.transaction_datetime && customerCompanyId && insertedDoc,
      )
      if (receiptFlowWouldAlsoRun) {
        doubleFlowAmbiguous = true
        const { ResponseGateway } = await import("./response.ts")
        await ResponseGateway.pushMessage(
          userId,
          `รับสลิปแล้วครับ รบกวนรอเจ้าหน้าที่ตรวจสอบก่อนดำเนินการต่อนะครับ`,
        )
      } else {
        // Capability D: proven transition awaiting_payment → payment_confirmed
        const transition = await sendConnectEventCommand("business_event.transition", {
          event_id: pendingOrder.id,
          from_status: "awaiting_payment",
          status: "payment_confirmed",
        }, `system:${CONNECT_PROVIDER}:bank-confirm`)
        if (transition.ok) {
          // B2: the customer hears "✅ จัดรถให้เลย" ONLY when the canonical
          // transition actually succeeded — never after a failed transport.
          const { ResponseGateway } = await import("./response.ts")
          await ResponseGateway.pushMessage(
            userId,
            `✅ ตรวจสอบสลิปแล้ว ยอด ${amount.toLocaleString()} บาท ตรงกับใบเสนอราคา ${pendingOrder.event_code} ครับ เดี๋ยวจัดรถให้เลยนะครับ`,
          )
        } else {
          console.log(`[process-classified-image] pending_review: order ${pendingOrder.event_code} transition failed (${transition.error ?? "unknown"}) — no customer message sent`)
        }
      }
    } else if (pendingOrder && Math.abs(Number(pendingOrder.quoted_amount) - amount) <= 5 && !bankEmailVerified) {
      // Owner correction (2026-07-27): "ไม่ต้องบอกให้เค้ารอ...ระบบรับข้อมูล
      // เข้ามาก่อน ประมวลผลเสร็จสรรพในคลังหลังบ้านก่อน แล้วค่อยออกไปเลย" —
      // amount matches the slip's own OCR reading, but no independent bank
      // confirmation exists yet. Deliberately says NOTHING to the customer
      // here — no "please wait" message, since that itself is a premature
      // claim (system hasn't actually finished verifying). Stays silently
      // Pending Review; bank-email-sync's own reverse-match (see its
      // matchPendingOrdersOnNewEmail()) is what actually completes this and
      // sends the real customer message, at the moment real confirmation
      // exists — not before.
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

  // Autonomous Payment Confirmation (owner, 2026-07-24, tightened
  // 2026-07-27): "ถึงแม้ให้ AI ตัวเดียวไปจับสลิปโอนเงินเข้ามาแล้วยืนยัน 100%
  // ว่าเงินเข้าจริง...แต่เงินเข้าหรือยังเห็นจากธนาคารเค้าบอกว่าเงินเข้าแล้ว
  // หรือยัง ถ้ายังไม่เห็นจะมั่นใจได้ยังไง" — real gap found live: this path
  // used to issue a real receipt (tryPushReceiptDocument) whenever the OCR
  // read every FIELD on the slip completely (amount/sender/time/company),
  // never once checking whether the bank itself had independently confirmed
  // the money actually arrived. hasCompleteEvidence alone only proves the
  // slip photo was legible — it is not a second source. bankEmailVerified
  // (computed above, real Gmail bank-notification cross-check) is now a
  // hard requirement here too: no real bank confirmation yet, no auto-
  // issued receipt — it stays Pending Review (/admin/receipts) for a human,
  // exactly the Rule 115 design (payment_verified needs every currently-
  // available level to agree, not just Level 2 OCR alone).
  const isPaymentDoc = classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice"
  const hasCompleteEvidence = Boolean(
    classified?.amount && classified?.sender_name && classified?.transaction_datetime && customerCompanyId,
  )
  // C1: when the order flow already claimed this evidence (or the ambiguity
  // guard fired), the receipt flow must NOT also run for the same slip.
  if (doubleFlowAmbiguous) {
    console.log(`[process-classified-image] pending_review: slip ${insertedDoc?.id ?? lineEventId} qualifies for BOTH receipt confirm and order dispatch — neither ran, left for human`)
  } else if (isPaymentDoc && hasCompleteEvidence && bankEmailVerified && !reusedSlipWarning && !staleSlipWarning && insertedDoc && userId) {
    const { data: company } = await supabase
      .from("companies").select("name").eq("id", customerCompanyId).maybeSingle()
    const auto = await tryAutoConfirmPayment(supabase, {
      receiptDocumentId: insertedDoc.id,
      customerCompanyId: customerCompanyId!,
      companyName: company?.name ?? "-",
      amount: Number(classified!.amount),
      occurredAt: (classified!.transaction_datetime ?? classified!.document_date ?? new Date().toISOString()).slice(0, 10),
      referenceNumber: classified!.reference_number ?? null,
      lineUserId: userId,
    })
    // B1: record the REAL outcome — no silent void, no assumed success.
    if (auto.status !== "confirmed" && auto.status !== "already") {
      console.log(`[process-classified-image] pending_review: receipt ${insertedDoc.id} not confirmed (${auto.status === "rejected" ? auto.error : auto.reason})`)
    }
  }
}
