/**
 * /api/admin/god-view — the owner's "God View" snapshot.
 *
 * One round trip that answers the three questions the owner asked the
 * dashboard to answer without typing to anyone:
 *
 *   1. Flow การไหลของงาน   → orders by status + truck jobs by stage
 *   2. สถานะรถวิ่ง           → truck_jobs now + the newest truck_events
 *   3. ยอดเงินเข้า-ออก      → invoices / standalone documents / resource cost
 *   +) เคสที่ต้องOverride   → stuck jobs, stalled orders, failed rule runs
 *
 * Read-only: this route never mutates business data. Overrides happen on the
 * record's own screen (/admin/transactions, /api/admin/truck…), not here.
 *
 * Every block is scoped by the caller's admin read scope (WAVE 2 convention,
 * same as /api/admin/pulse) so the "everything" view is really "everything
 * this caller may see".
 */
import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

/** Orders whose flow is still moving (never shown as "in flight" once closed). */
const CLOSED_ORDER_STATUSES = ["PAID", "CANCELLED", "DELIVERED"]

const STUCK_JOB_MS = 60 * 60 * 1000 // BROADCASTED with no acceptance for 1h
const STALLED_ORDER_MS = 48 * 60 * 60 * 1000 // confirmed order with no progress for 48h

interface MoneyBucket {
  billed: number
  paid: number
  open: number
}

function emptyMoney(): MoneyBucket {
  return { billed: 0, paid: 0, open: 0 }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const ctx = await resolveAdminReadScope(auth)
    const denied = denyUnscoped(ctx)
    if (denied) return denied

    const db = supabase()
    const scopeCompanyIds = ctx.companyIds
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const ordersQuery = db
      .from("customer_orders")
      .select("id, order_no, status, created_at, updated_at, customer_company_id, companies!customer_orders_customer_company_id_fkey(id, name)")
      .order("updated_at", { ascending: false })
      .limit(200)

    const invoicesQuery = db
      .from("invoices")
      .select("id, invoice_no, invoice_status, total_amount, invoice_date, customer_company_id")
      .gte("created_at", since)
      .limit(500)

    const costsQuery = db
      .from("resource_transactions")
      .select("id, total_cost, total_price, created_at")
      .gte("created_at", since)
      .limit(500)

    const jobsQuery = db
      .from("truck_jobs")
      .select("id, order_id, assigned_truck_id, assigned_driver_id, current_status, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100)

    const eventsQuery = db
      .from("truck_events")
      .select("id, job_id, event_type, actor_id, created_at")
      .order("created_at", { ascending: false })
      .limit(20)

    const ruleRunsQuery = db
      .from("event_rule_runs")
      .select("id, rule_code, event_type, mode, matched, status, error, created_at")
      .order("created_at", { ascending: false })
      .limit(10)

    const [ordersRes, invoicesRes, costsRes, jobsRes, eventsRes, ruleRunsRes] = await Promise.all([
      scopeCompanyIds ? ordersQuery.in("customer_company_id", [...scopeCompanyIds]) : ordersQuery,
      scopeCompanyIds ? invoicesQuery.in("customer_company_id", [...scopeCompanyIds]) : invoicesQuery,
      costsQuery,
      jobsQuery,
      eventsQuery,
      ruleRunsQuery,
    ])

    for (const [label, res] of [
      ["customer_orders", ordersRes],
      ["invoices", invoicesRes],
      ["resource_transactions", costsRes],
      ["truck_jobs", jobsRes],
      ["truck_events", eventsRes],
      ["event_rule_runs", ruleRunsRes],
    ] as const) {
      if (res.error) console.error(`[god-view] ${label} read failed:`, res.error.message)
    }

    const orders = (ordersRes.data ?? []) as Array<{
      id: string
      order_no: string | null
      status: string | null
      created_at: string
      updated_at: string | null
      customer_company_id: string | null
      companies: { id: string; name: string } | { id: string; name: string }[] | null
    }>

    const companyName = (row: (typeof orders)[number]) => {
      const company = Array.isArray(row.companies) ? row.companies[0] : row.companies
      return company?.name ?? null
    }

    // ── 1. Flow: orders by status ──────────────────────────────────────────
    const orderStatusCounts: Record<string, number> = {}
    for (const order of orders) {
      const status = order.status ?? "UNKNOWN"
      orderStatusCounts[status] = (orderStatusCounts[status] ?? 0) + 1
    }

    const activeOrders = orders
      .filter((o) => !CLOSED_ORDER_STATUSES.includes(o.status ?? ""))
      .slice(0, 12)
      .map((o) => ({
        id: o.id,
        orderNo: o.order_no,
        status: o.status,
        customer: companyName(o),
        updatedAt: o.updated_at ?? o.created_at,
        ageHours: Math.floor((Date.now() - new Date(o.updated_at ?? o.created_at).getTime()) / 3_600_000),
      }))

    // ── 2. Trucks ──────────────────────────────────────────────────────────
    const jobs = (jobsRes.data ?? []) as Array<{
      id: string
      order_id: string
      assigned_truck_id: string | null
      assigned_driver_id: string | null
      current_status: string
      created_at: string
      updated_at: string | null
    }>

    const truckStatusCounts: Record<string, number> = {}
    for (const job of jobs) {
      truckStatusCounts[job.current_status] = (truckStatusCounts[job.current_status] ?? 0) + 1
    }

    const orderById = new Map(orders.map((o) => [o.id, o]))
    const inFlight = jobs
      .filter((j) => j.current_status !== "DELIVERED")
      .slice(0, 12)
      .map((j) => ({
        jobId: j.id,
        orderNo: orderById.get(j.order_id)?.order_no ?? null,
        customer: orderById.has(j.order_id) ? companyName(orderById.get(j.order_id)!) : null,
        truckId: j.assigned_truck_id,
        driverId: j.assigned_driver_id,
        status: j.current_status,
        updatedAt: j.updated_at ?? j.created_at,
        ageMinutes: Math.floor((Date.now() - new Date(j.updated_at ?? j.created_at).getTime()) / 60_000),
      }))

    const recentTruckEvents = ((eventsRes.data ?? []) as Array<{
      id: string
      job_id: string
      event_type: string
      actor_id: string
      created_at: string
    }>).map((e) => ({
      id: e.id,
      jobId: e.job_id,
      eventType: e.event_type,
      actor: e.actor_id,
      createdAt: e.created_at,
    }))

    // ── 3. Money (last 30 days) ────────────────────────────────────────────
    const invoices = (invoicesRes.data ?? []) as Array<{
      id: string
      invoice_no: string | null
      invoice_status: string | null
      total_amount: number | string | null
      invoice_date: string | null
      customer_company_id: string | null
    }>

    const money = emptyMoney()
    for (const invoice of invoices) {
      const amount = Number(invoice.total_amount ?? 0)
      const status = (invoice.invoice_status ?? "").toUpperCase()
      if (status === "VOID" || status === "CANCELLED") continue
      money.billed += amount
      if (status === "PAID") money.paid += amount
      else money.open += amount
    }

    const costs = (costsRes.data ?? []) as Array<{ total_cost: number | string | null; total_price: number | string | null }>
    const costOut = costs.reduce((sum, row) => sum + Number(row.total_cost ?? 0), 0)
    const costIn = costs.reduce((sum, row) => sum + Number(row.total_price ?? 0), 0)

    // ── 4. Exceptions — what the owner must override ───────────────────────
    const now = Date.now()
    const exceptions: Array<{ kind: string; label: string; detail: string; refId: string; href: string }> = []

    for (const job of jobs) {
      if (job.current_status !== "BROADCASTED") continue
      const age = now - new Date(job.created_at).getTime()
      if (age > STUCK_JOB_MS) {
        exceptions.push({
          kind: "STUCK_BROADCAST",
          label: `งาน ${orderById.get(job.order_id)?.order_no ?? job.order_id} ไม่มีรถรับ`,
          detail: `ประกาศงานมา ${Math.floor(age / 3_600_000)} ชม. ยังไม่มีผู้ขนส่งกดรับ`,
          refId: job.id,
          href: "/admin/transactions",
        })
      }
    }

    for (const order of orders) {
      if (CLOSED_ORDER_STATUSES.includes(order.status ?? "")) continue
      const age = now - new Date(order.updated_at ?? order.created_at).getTime()
      if (age > STALLED_ORDER_MS) {
        exceptions.push({
          kind: "STALLED_ORDER",
          label: `ออเดอร์ ${order.order_no ?? order.id} ค้างที่ ${order.status}`,
          detail: `ไม่มีความเคลื่อนไหว ${Math.floor(age / 86_400_000)} วัน`,
          refId: order.id,
          href: "/admin/transactions",
        })
      }
    }

    const failedRuns = ((ruleRunsRes.data ?? []) as Array<{
      id: string
      rule_code: string | null
      event_type: string
      status: string
      error: string | null
      created_at: string
    }>).filter((run) => run.status === "failed" || run.status === "partial")

    for (const run of failedRuns) {
      exceptions.push({
        kind: "RULE_SEND_FAILED",
        label: `ส่งข้อความอัตโนมัติไม่สำเร็จ (${run.rule_code ?? run.event_type})`,
        detail: run.error ?? "ไม่ทราบสาเหตุ",
        refId: run.id,
        href: "/admin/rules",
      })
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      scope: ctx.scope.mode,
      flow: {
        orderStatusCounts,
        activeOrders,
        truckStatusCounts,
        inFlight,
        recentTruckEvents,
      },
      money: {
        windowDays: 30,
        currency: "THB",
        billed: money.billed,
        paid: money.paid,
        open: money.open,
        costOut,
        margin: costIn - costOut,
        invoices: invoices.length,
      },
      exceptions,
      ruleActivity: (ruleRunsRes.data ?? []).slice(0, 10),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[god-view] failed:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
