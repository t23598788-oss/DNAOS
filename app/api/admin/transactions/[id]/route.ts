import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getTransactionById } from "@/services/supabase/queries"
import { getTransactionDetail } from "@/services/canonical/transaction-detail"

type Params = { params: Promise<{ id: string }> }

// PHASE C7 — canonical read model behind a response-compatible envelope.
// The legacy keys (transaction/events/documents) keep their shape so no UI change
// is required, but money/project/company values now come from the canonical views
// instead of null. The full canonical payload is attached as `canonical`.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  try {
    const [legacy, canonical] = await Promise.all([getTransactionById(id), getTransactionDetail(id)])
    if (!canonical) return NextResponse.json({ error: "ไม่พบ transaction" }, { status: 404 })

    const sum = canonical.financial_summary
    return NextResponse.json({
      ...legacy,
      // legacy keys, now backed by the canonical model (was null before)
      transaction: {
        ...legacy.transaction,
        tx_type: (canonical.transaction?.tx_type as string) ?? legacy.transaction.tx_type,
        net_amount: sum.outstanding,
        paid_amount: sum.paid_amount,
        vat_amount: sum.vat_amount,
        project_name: (canonical.project?.name as string) ?? (canonical.project?.project_name as string) ?? null,
      },
      documents: canonical.generated_documents.map((d, i) => ({
        id: d.document_id,
        document_type: d.document_type,
        document_number: d.document_no,
        status: d.document_status?.toLowerCase() ?? null,
        net_amount: sum.by_document[i]?.gross_amount ?? sum.by_document[i]?.total_amount_persisted ?? null,
        issue_date: null,
        created_at: null,
        subtotal: sum.by_document[i]?.subtotal ?? null,
        vat_amount: sum.by_document[i]?.vat_amount ?? null,
        outstanding: sum.by_document[i]?.outstanding ?? null,
        data_completeness: sum.by_document[i]?.data_completeness ?? null,
        current_version_no: d.current_version_no,
      })),
      events: canonical.business_events,
      canonical,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ไม่พบ transaction" }, { status: 404 })
  }
}


// customer_orders ไม่มีคอลัมน์ title/net_amount (ไม่ใช่ตารางการเงิน — ยอดเงินคำนวณจาก invoices ที่ผูกอยู่)
// แก้ไขได้เฉพาะฟิลด์ที่มีจริงในตาราง
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json()
  const { delivery_note, requested_delivery_at } = body

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (delivery_note !== undefined) update.delivery_note = delivery_note
  if (requested_delivery_at !== undefined) update.requested_delivery_at = requested_delivery_at

  const { data, error } = await supabase()
    .from("customer_orders")
    .update(update)
    .eq("id", id)
    .select("id, order_no, status, delivery_note, requested_delivery_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ transaction: data })
}

// ไม่มีคอลัมน์ deleted_at บน customer_orders — "ลบ" = เปลี่ยนสถานะเป็น CANCELLED (ตรงกับที่
// app/api/admin/pulse/route.ts ใช้ CANCELLED เป็นสถานะปิดงานอยู่แล้ว)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const { error } = await supabase()
    .from("customer_orders")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
