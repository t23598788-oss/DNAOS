import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolvePaymentDocumentLink } from "@/engines/transactions/document-link"
import { recordInboundSource, linkInboundSource, type InboundChannel } from "@/engines/canonical/inbound-write"

const ALLOWED_CHANNELS: InboundChannel[] = ["line", "upload", "email", "bank", "drive"]

// PHASE D6/D9 — canonical inbound ingest for the channels the Next app owns
// (manual upload / forwarded email / bank export / drive sync). The LINE webhook
// runs in a Deno edge function and keeps its own writes for now (reported as a
// remaining gap); everything that goes through the app normalises here with real
// provenance — media facts only when provable, linkage only when evidenced.
export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const channel = body.channel as InboundChannel
  if (!ALLOWED_CHANNELS.includes(channel)) {
    return NextResponse.json({ error: `channel ต้องเป็นหนึ่งใน ${ALLOWED_CHANNELS.join(", ")}`, code: "INBOUND_CHANNEL_INVALID" }, { status: 400 })
  }
  if (!body.media_path || typeof body.media_path !== "string") {
    return NextResponse.json({ error: "ต้องระบุ media_path ของต้นฉบับจริง", code: "INBOUND_MEDIA_REQUIRED" }, { status: 400 })
  }
  if (!body.document_type || typeof body.document_type !== "string") {
    return NextResponse.json({ error: "ต้องระบุ document_type", code: "INBOUND_TYPE_REQUIRED" }, { status: 400 })
  }

  // UNIFIED FINANCE ADMIN hardening (2026-10-11): ระบุคู่ค้าต้องเป็นบริษัท/บุคคล
  // ที่มีอยู่จริง — กัน id ปลอมหลุดเข้าแถวหลักฐานแล้วไป fail ลึกกว่าเดิมตอนยืนยัน
  const companyId =
    typeof body.customer_company_id === "string" && body.customer_company_id.trim()
      ? body.customer_company_id.trim()
      : null
  if (companyId) {
    const { data: company } = await supabase().from("companies").select("id").eq("id", companyId).maybeSingle()
    if (!company) {
      return NextResponse.json(
        { error: "ไม่พบบริษัท/บุคคลนี้ในระบบ — เลือกรายการที่มีอยู่เท่านั้น", code: "INBOUND_COMPANY_NOT_FOUND" },
        { status: 400 },
      )
    }
  }

  try {
    const created = await recordInboundSource({
      channel,
      media_path: body.media_path,
      document_type: body.document_type,
      received_at: body.received_at ?? null,
      media_size_bytes: typeof body.media_size_bytes === "number" ? body.media_size_bytes : null,
      media_mime_type: typeof body.media_mime_type === "string" ? body.media_mime_type : null,
      media_sha256: typeof body.media_sha256 === "string" ? body.media_sha256 : null,
      raw_ocr_text: body.raw_ocr_text ?? null,
      amount: typeof body.amount === "number" ? body.amount : null,
      sender_name: body.sender_name ?? null,
      sender_bank: body.sender_bank ?? null,
      sender_account_number: body.sender_account_number ?? null,
      transaction_datetime: body.transaction_datetime ?? null,
      confidence: typeof body.confidence === "number" ? body.confidence : null,
      customer_company_id: companyId,
      provider_message_id: body.provider_message_id ?? null,
      // UNIFIED FINANCE ADMIN (2026-10-11) — fields ที่ inbound writer
      // รองรับอยู่แล้วแต่ route เคยไม่ส่งต่อ (หลักฐานบนเอกสารจริง:
      // วันที่บนเอกสาร · เลขอ้างอิง · รายละเอียด · ชื่อผู้ขาย)
      document_date: typeof body.document_date === "string" && body.document_date.trim() ? body.document_date.trim() : null,
      reference_number: typeof body.reference_number === "string" && body.reference_number.trim() ? body.reference_number.trim() : null,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      vendor_name: typeof body.vendor_name === "string" && body.vendor_name.trim() ? body.vendor_name.trim() : null,
      actor: auth.email,
      provenance: { channel, received_via: "app:receipt-documents" },
    })

    // link to a document only when the caller supplies real evidence of the link
    if (body.link && body.link.document_kind && body.link.document_id && body.link.evidence_ref) {
      await linkInboundSource({
        receipt_document_id: created.receipt_document_id,
        document_kind: body.link.document_kind,
        document_id: body.link.document_id,
        actor: auth.email,
        evidence_ref: body.link.evidence_ref,
      })
    }

    return NextResponse.json({ receipt_document: created }, { status: 201 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "บันทึกต้นฉบับขาเข้าไม่สำเร็จ"
    return NextResponse.json({ error: message }, { status: message.startsWith("INBOUND_") ? 400 : 500 })
  }
}

// Payment Verification Queue — list (owner, 2026-07-24): the OCR slip pipeline
// (supabase/functions/line-webhook-v2/handlers/image.ts) has been writing
// transfer_slip rows into receipt_documents since 2026-07-17, and the confirm
// endpoint (./[id]/confirm/route.ts) has existed since 2026-07-18 — but
// nothing ever listed these rows for a human to see. This is that missing
// read side, wired to the same resolvePaymentDocumentLink() pure function
// that already decides full vs. partial payment (engines/transactions/
// document-link.ts), so the preview shown here is the exact same
// classification confirm will act on, not a separate guess.
export async function GET(_req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  // Real incident found 2026-07-24 (บจก. เคที คอนสตรัคชั่น, ฿5,000 slip):
  // ocr-classify.ts treats "payment_advice" as an equally real incoming-
  // payment type alongside "transfer_slip" (same business_category/workflow
  // in its own DOCUMENT_TYPE_PROFILE) — this list only showed transfer_slip,
  // so a real payment classified as payment_advice never appeared here at
  // all, invisible to any human review.
  const { data: docs, error } = await db
    .from("receipt_documents")
    .select("id, amount, transaction_datetime, document_date, customer_company_id, sender_name, reference_number, status, verification_level, created_at, error_th")
    .in("document_type", ["transfer_slip", "payment_advice"])
    .eq("status", "ai_read")
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const companyIds = [...new Set((docs ?? []).map((d) => d.customer_company_id).filter(Boolean))] as string[]
  const { data: companies } = companyIds.length
    ? await db.from("companies").select("id, name").in("id", companyIds)
    : { data: [] as { id: string; name: string }[] }
  const companyById = new Map((companies ?? []).map((c) => [c.id, c.name]))

  const { data: snapshots } = companyIds.length
    ? await db.from("debt_snapshots").select("customer_company_id, total_outstanding").in("customer_company_id", companyIds)
    : { data: [] as { customer_company_id: string; total_outstanding: number }[] }
  const outstandingByCompany = new Map((snapshots ?? []).map((s) => [s.customer_company_id, Number(s.total_outstanding ?? 0)]))

  const items = (docs ?? []).map((d) => {
    const partnerName = d.customer_company_id ? companyById.get(d.customer_company_id) : undefined
    const outstanding = d.customer_company_id ? outstandingByCompany.get(d.customer_company_id) ?? 0 : 0
    const link = d.amount
      ? resolvePaymentDocumentLink({
          amount: Number(d.amount),
          transactionOutstanding: outstanding,
          transactionId: d.customer_company_id,
          partnerName,
          reference: d.reference_number ?? undefined,
        })
      : null
    return {
      id: d.id,
      amount: d.amount,
      sender_name: d.sender_name,
      reference_number: d.reference_number,
      transaction_datetime: d.transaction_datetime ?? d.document_date,
      verification_level: d.verification_level,
      customer_company_id: d.customer_company_id,
      partner_name: partnerName ?? null,
      outstanding_before: outstanding,
      payment_preview: link
        ? { kind: link.kind, title: link.document.title, note: link.document.note }
        : null,
      error_th: d.error_th ?? null,
    }
  })

  // Debtor picker options (BATCH 33): existing companies/person rows only —
  // the manual assignment dropdown never offers anything that is not already
  // in the registry (people are companies with is_individual=true).
  const { data: allCompanies } = await db
    .from("companies")
    .select("id, name, type, is_individual")
    .order("name")
    .limit(300)

  return NextResponse.json({
    items,
    available_companies: (allCompanies ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      is_individual: Boolean(c.is_individual),
    })),
  })
}
