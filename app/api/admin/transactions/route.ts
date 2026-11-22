import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { getTransactionMoneySummaries } from "@/services/canonical/transaction-list"
import { createTransaction } from "@/engines/canonical/transaction-write"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds && ctx.companyIds.size === 0) return NextResponse.json({ transactions: [] })

  const { searchParams } = new URL(req.url)
  const pendingOnly = searchParams.get("pending") === "1"
  const partnerId = searchParams.get("partner_id")
  const txType = searchParams.get("tx_type")

  // A partner filter is a request, not a permission: it can only narrow.
  if (partnerId && !isCompanyVisible(ctx, partnerId)) return NextResponse.json({ transactions: [] })

  let query = supabase()
    .from("customer_orders")
    .select("id, order_no, status, customer_company_id, project_id, created_at, updated_at, companies!customer_orders_customer_company_id_fkey(id, name, phone)")
    .order("updated_at", { ascending: false })

  if (pendingOnly) query = query.neq("status", "PAID")
  if (partnerId) query = query.eq("customer_company_id", partnerId)
  if (ctx.companyIds) query = query.in("customer_company_id", [...ctx.companyIds])

  const { data, error } = await query
  if (error) {
    console.error("[transactions] list query failed:", error.message)
    return NextResponse.json({ transactions: [] })
  }

  const transactions = (data ?? []).map((t: any) => ({
    id: t.id,
    title: t.order_no ?? "คำสั่งซื้อ",
    tx_type: (t.tx_type as string) ?? txType ?? "sale",
    state: t.status ?? "DRAFT",
    state_changed_at: t.updated_at ?? t.created_at,
    net_amount: null,
    paid_amount: null,
    vat_amount: null,
    project_name: null,
    created_at: t.created_at,
    partner_id: t.customer_company_id,
    supplier_id: null,
    supplier_name: null,
    partners: t.companies ?? null,
    suppliers: null,
  }))

  // PHASE C7 — money/project values come from the canonical model (were null before).
  const money = await getTransactionMoneySummaries(transactions.map((t: { id: string }) => t.id))
  const enriched = transactions.map((t: any) => {
    const m = money.get(t.id)
    return {
      ...t,
      net_amount: m?.outstanding ?? null,
      paid_amount: m?.paid_amount ?? null,
      vat_amount: m?.vat_amount ?? null,
      document_count: m?.document_count ?? 0,
      gross_amount: m?.gross_amount ?? null,
      data_completeness: m?.data_completeness ?? null,
    }
  })

  return NextResponse.json({ transactions: enriched })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied

  const body = await req.json()
  const { partner_id, title, tx_type = "sale", site_id, idempotency_key } = body

  if (!partner_id) {
    return NextResponse.json({ error: "ต้องระบุ partner_id" }, { status: 400 })
  }
  if (!site_id) {
    return NextResponse.json({ error: "ต้องระบุไซต์งาน (site_id) — งานทุกงานต้องผูกกับสถานที่จัดส่งจริง" }, { status: 400 })
  }
  if (!isCompanyVisible(ctx, partner_id)) return notFound()

  // PHASE D3/D9 — one canonical chain builder: company → site → project →
  // document_group → order, validated against real rows before anything is written.
  let created
  try {
    created = await createTransaction(
      {
        customer_company_id: partner_id,
        customer_site_id: site_id,
        tx_type,
        title: typeof title === "string" ? title : null,
      },
      auth.email,
      // WAVE 2 — a client-supplied key makes the create command replay-safe.
      { idempotencyKey: typeof idempotency_key === "string" ? idempotency_key : null },
    )
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "สร้างงานไม่สำเร็จ"
    return NextResponse.json(
      { error: message, code: message.startsWith("TRANSACTION_CONTEXT_INCOMPLETE") ? "TRANSACTION_CONTEXT_INCOMPLETE" : "TRANSACTION_CREATE_FAILED" },
      { status: message.startsWith("TRANSACTION_CONTEXT_INCOMPLETE") ? 400 : 500 },
    )
  }

  const order = created.order as Record<string, unknown>
  return NextResponse.json(
    {
      transaction: {
        id: order.id,
        title: (typeof title === "string" && title.trim()) || "งานใหม่",
        tx_type,
        state: order.status,
        state_changed_at: order.created_at,
        net_amount: null,
        created_at: order.created_at,
        partner_id: order.customer_company_id,
        project_id: created.project_id,
        document_group_id: created.document_group_id,
        site_id: site_id,
      },
    },
    { status: 201 },
  )
}
