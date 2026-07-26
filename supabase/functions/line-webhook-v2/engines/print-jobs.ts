// Photocopy-shop-via-LINE (owner, 2026-07-25): "ลูกค้าถ่ายรูปบัตรประชาชน/
// ทะเบียนบ้านมา ระบบสแกน ลูกค้าโอนตังค์เข้ามา ระบบปริ้นรับเงินปั๊บแล้วส่งข้อความ
// บอกให้ลูกค้ามารับได้เลย". Reuses the existing "government_document"
// Document Profile type (ocr-classify.ts) rather than adding a new one —
// a government_document photo from a LINE customer is a print-shop
// candidate, not a business bill. Bridges to the real physical printer via
// print_jobs (see supabase/migrations/20260725000002_print_jobs.sql) — this
// edge function runs in Deno on Supabase's servers and has no way to reach
// a printer on the owner's home WiFi; a local watcher script on the owner's
// Mac (print-watcher.mjs) polls this table and does the actual printing.
//
// Known gap (honest, not hidden): copies defaults to 1 — there is no text-
// message-to-photo correlation yet to pick up "พิมพ์ห้าแผ่น" sent as a
// separate message.
//
// Real pricing (owner, 2026-07-25): 5 บาท/แผ่น ปกติ, ลดเหลือ 2.50 บาท/แผ่น
// ถ้าสั่ง 5 แผ่นขึ้นไป.
function pricePerPage(copies: number): number {
  return copies >= 5 ? 2.5 : 5
}
function expectedAmount(copies: number): number {
  return copies * pricePerPage(copies)
}
// Small slack for rounding/QR-fee differences a real bank transfer can add —
// not a placeholder guess anymore now that real per-page pricing exists.
const PRINT_JOB_AMOUNT_TOLERANCE = 2

// Single automatic round (owner, 2026-07-25): "ถามอัตโนมัติรอบเดียวเลย...
// ไม่มีอะไรยากซับซ้อน" — one quick-reply round asking copies, right after
// the document photo arrives. No AI-generated preview of the document
// itself (that would risk altering a real ID/house-registration document);
// the customer just confirms against the real photo already saved.
const COPY_OPTIONS = [1, 2, 3, 5]

export async function maybeCreatePrintJob(
  supabase: any,
  params: { lineUserId: string; mediaPath: string; documentType: string },
): Promise<void> {
  if (params.documentType !== "government_document") return
  if (!params.lineUserId) return

  const { data: job } = await supabase.from("print_jobs").insert({
    line_user_id: params.lineUserId,
    media_path: params.mediaPath,
    document_kind: params.documentType,
    copies: 1,
    status: "pending_payment",
  }).select("id").single()

  if (!job) return

  // Local-AI pipeline (owner, 2026-07-25): classification now happens on
  // the owner's Mac via Ollama, asynchronously (ai_tasks queue) — by the
  // time this runs, the original replyToken from when the photo arrived is
  // long expired (LINE reply tokens die in ~1 minute). Push instead —
  // works regardless of how long classification took.
  const { ResponseGateway } = await import("./response.ts")
  await ResponseGateway.pushWithQuickReply(
    params.lineUserId,
    "ได้รับเอกสารแล้วครับ ต้องการพิมพ์กี่แผ่น?",
    COPY_OPTIONS.map((n) => ({
      type: "action",
      action: { type: "postback", label: `${n} แผ่น`, data: `PRINT_COPIES:${job.id}:${n}` },
    })),
  )
}

export async function handlePrintCopiesSelected(
  supabase: any,
  params: { jobId: string; copies: number; replyToken: string | null },
): Promise<void> {
  const amount = expectedAmount(params.copies)
  await supabase.from("print_jobs")
    .update({ copies: params.copies, amount_expected: amount })
    .eq("id", params.jobId)
  if (!params.replyToken) return

  const { ResponseGateway } = await import("./response.ts")
  await ResponseGateway.replyWithQuickReply(
    params.replyToken,
    `รับทราบ ${params.copies} แผ่นครับ รวม ${amount} บาท (${pricePerPage(params.copies)} บาท/แผ่น) จะชำระเงินแบบไหน?`,
    [
      { type: "action", action: { type: "postback", label: "เงินสด (จ่ายตอนรับ)", data: `PRINT_PAY:${params.jobId}:cash` } },
      { type: "action", action: { type: "postback", label: "โอนเงิน", data: `PRINT_PAY:${params.jobId}:transfer` } },
    ],
  )
}

export async function handlePrintPaymentMethodSelected(
  supabase: any,
  params: { jobId: string; method: "cash" | "transfer"; replyToken: string | null },
): Promise<void> {
  const { ResponseGateway } = await import("./response.ts")

  if (params.method === "cash") {
    // Owner instruction (2026-07-25): "ถ้าลูกค้าบอกว่าเดี๋ยวเงินสด โอเคก็
    // ดำเนินการเลย" — cash skips payment verification entirely and goes
    // straight to print; money is collected on pickup, not before.
    const { data: job } = await supabase.from("print_jobs")
      .update({ payment_method: "cash", status: "paid", paid_at: new Date().toISOString() })
      .eq("id", params.jobId)
      .select("amount_expected")
      .single()
    if (params.replyToken) {
      const amountText = job?.amount_expected ? ` (${job.amount_expected} บาท)` : ""
      await ResponseGateway.replyText(params.replyToken, `รับทราบครับ กำลังดำเนินการพิมพ์ เก็บเงินสด${amountText}ตอนมารับนะครับ`)
    }
    return
  }

  await supabase.from("print_jobs").update({ payment_method: "transfer" }).eq("id", params.jobId)
  if (params.replyToken) {
    await ResponseGateway.replyText(params.replyToken, "โอนเงินแล้วส่งรูปสลิปมาในแชทนี้ได้เลยครับ ระบบจะตรวจสอบแล้วดำเนินการพิมพ์ทันที")
  }
}

// Called from the transfer_slip/payment_advice branch of handlers/image.ts,
// alongside (not instead of) the existing company invoice-payment matching —
// a village customer paying 5-10 baht for a photocopy is a different money
// flow than a business partner paying a gravel invoice, so this never
// touches customer_company_id or debt_events.
export async function matchPaymentToPrintJob(
  supabase: any,
  params: { lineUserId: string; amount: number },
): Promise<void> {
  if (!params.lineUserId || !params.amount) return

  // Only jobs where the customer already picked "transfer" and a real
  // amount_expected exists (copies were already chosen) are candidates —
  // a job still waiting on the copies/payment-method quick-reply has no
  // real expected amount yet, so it can't be matched.
  const { data: pending } = await supabase
    .from("print_jobs")
    .select("id, amount_expected")
    .eq("line_user_id", params.lineUserId)
    .eq("status", "pending_payment")
    .eq("payment_method", "transfer")
    .not("amount_expected", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!pending) return
  if (Math.abs(Number(pending.amount_expected) - params.amount) > PRINT_JOB_AMOUNT_TOLERANCE) return

  await supabase.from("print_jobs")
    .update({ status: "paid", amount_paid: params.amount, paid_at: new Date().toISOString() })
    .eq("id", pending.id)
}
