/**
 * /api/admin/pulse
 *
 * ดึงข้อมูลสถานะธุรกิจทั้งหมดในครั้งเดียว
 * ใช้โดย dashboard — โหลดรอบเดียว ไม่หลาย round-trip
 */

import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

export async function GET() {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  try {
    const ctx = await resolveAdminReadScope(auth)
    const denied = denyUnscoped(ctx)
    if (denied) return denied

    const today = new Date().toISOString().split("T")[0]

    // Organization scope (WAVE 2): the dashboard's "everything" is really
    // "everything this caller may see". Empty company set ⇒ nothing at all.
    if (ctx.companyIds && ctx.companyIds.size === 0) {
      return NextResponse.json({
        metrics: { todayRevenue: 0, activeJobs: 0, pendingDocs: 0 },
        activeJobs: [],
        pendingDocs: [],
        recentDocs: [],
        generatedAt: new Date().toISOString(),
      })
    }

    const invoicesQuery = supabase()
      .from("invoices")
      .select("id, invoice_no, invoice_status, total_amount, invoice_date, created_at, customer_company_id, companies!invoices_customer_company_id_fkey(id, name)")
      .order("created_at", { ascending: false })
      .limit(30)
    const ordersQuery = supabase()
      .from("customer_orders")
      .select("id, order_no, status, created_at, updated_at, customer_company_id, companies!customer_orders_customer_company_id_fkey(id, name)")
      .not("status", "in", '("PAID","CANCELLED")')
      .order("updated_at", { ascending: false })
      .limit(20)
    const standaloneQuery = supabase()
      .from("standalone_documents")
      .select("id, document_type, document_no, document_date, created_at, customer_company_id, total_amount, companies!standalone_documents_customer_company_id_fkey(id, name)")
      .order("created_at", { ascending: false })
      .limit(20)

    const [invoicesRes, ordersRes, standaloneRes] = await Promise.all([
      ctx.companyIds ? invoicesQuery.in("customer_company_id", [...ctx.companyIds]) : invoicesQuery,
      ctx.companyIds ? ordersQuery.in("customer_company_id", [...ctx.companyIds]) : ordersQuery,
      ctx.companyIds ? standaloneQuery.in("customer_company_id", [...ctx.companyIds]) : standaloneQuery,
    ])

    const invoices = invoicesRes.data ?? []
    const orders = ordersRes.data ?? []
    const standalone = standaloneRes.data ?? []

    // ยอดรายได้วันนี้ (invoices วันนี้ที่ไม่ใช่ cancelled)
    const todayRevenue = invoices
      .filter((i: any) => i.invoice_date === today && i.invoice_status !== "CANCELLED")
      .reduce((sum: number, i: any) => sum + Number(i.total_amount ?? 0), 0)

    // เอกสารรอยืนยัน (draft)
    const draftInvoices = invoices.filter((i: any) =>
      i.invoice_status === "DRAFT" || i.invoice_status === "draft"
    )
    // standalone_documents has no status column (yet) — every row is treated as final/saved,
    // not draft, until a real draft workflow is built for that table.
    const pendingDocs = draftInvoices.map((i: any) => ({
      id: i.id,
      type: "invoice",
      number: i.invoice_no ?? "—",
      partner: (i.companies as any)?.name ?? "—",
      amount: Number(i.total_amount ?? 0),
      date: i.invoice_date ?? i.created_at,
      partner_id: i.customer_company_id,
    })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // งานที่กำลังเดิน
    const activeJobs = orders.map((o: any) => ({
      id: o.id,
      order_no: o.order_no ?? "—",
      status: o.status,
      partner: (o.companies as any)?.name ?? "—",
      partner_id: o.customer_company_id,
      updated_at: o.updated_at ?? o.created_at,
    }))

    // เอกสารล่าสุด (saved/confirmed)
    const recentDocs = [
      ...invoices
        .filter((i: any) => i.invoice_status !== "DRAFT" && i.invoice_status !== "draft")
        .slice(0, 10)
        .map((i: any) => ({
          id: i.id,
          type: "invoice",
          number: i.invoice_no ?? "—",
          partner: (i.companies as any)?.name ?? "—",
          amount: Number(i.total_amount ?? 0),
          date: i.invoice_date ?? i.created_at,
          status: i.invoice_status,
          partner_id: i.customer_company_id,
        })),
      ...standalone
        .slice(0, 5)
        .map((d: any) => ({
          id: d.id,
          type: d.document_type,
          number: d.document_no ?? "—",
          partner: (d.companies as any)?.name ?? "—",
          amount: Number(d.total_amount ?? 0),
          date: d.document_date ?? d.created_at,
          status: "saved",
          partner_id: d.customer_company_id,
        })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10)

    return NextResponse.json({
      metrics: {
        todayRevenue,
        activeJobs: activeJobs.length,
        pendingDocs: pendingDocs.length,
      },
      activeJobs,
      pendingDocs,
      recentDocs,
      generatedAt: new Date().toISOString(),
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" },
      { status: 500 }
    )
  }
}
