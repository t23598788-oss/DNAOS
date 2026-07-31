import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(req.url)
  const pendingOnly = searchParams.get("pending") === "1"
  const partnerId = searchParams.get("partner_id")
  const txType = searchParams.get("tx_type")

  let query = supabase()
    .from("customer_orders")
    .select("id, order_no, status, customer_company_id, project_id, created_at, updated_at, companies!customer_orders_customer_company_id_fkey(id, name, phone)")
    .order("updated_at", { ascending: false })

  if (pendingOnly) query = query.neq("status", "PAID")
  if (partnerId) query = query.eq("customer_company_id", partnerId)

  const { data, error } = await query
  if (error) {
    console.error("[transactions] list query failed:", error.message)
    return NextResponse.json({ transactions: [] })
  }

  const transactions = (data ?? []).map((t: any) => ({
    id: t.id,
    title: t.order_no ?? "คำสั่งซื้อ",
    tx_type: txType ?? "sale",
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

  return NextResponse.json({ transactions })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json()
  const { partner_id, title, tx_type = "sale", site_id } = body

  if (!partner_id) {
    return NextResponse.json({ error: "ต้องระบุ partner_id" }, { status: 400 })
  }
  if (!site_id) {
    return NextResponse.json({ error: "ต้องระบุไซต์งาน (site_id) — งานทุกงานต้องผูกกับสถานที่จัดส่งจริง" }, { status: 400 })
  }

  const db = supabase()
  const { data: site, error: siteError } = await db
    .from("customer_sites")
    .select("id, customer_company_id")
    .eq("id", site_id)
    .maybeSingle()

  if (siteError) return NextResponse.json({ error: siteError.message }, { status: 500 })
  if (!site || site.customer_company_id !== partner_id) {
    return NextResponse.json({ error: "ไซต์งานนี้ไม่ตรงกับคู่ค้าที่เลือก" }, { status: 400 })
  }

  const stamp = Date.now().toString().slice(-6)
  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "")
  const jobTitle = title?.trim() || "งานใหม่"

  // customer_orders needs a project + document_group first (schema chain) —
  // create them here in sequence so "สร้างงาน" works as one real action
  // instead of requiring three separate screens the owner would have to
  // click through manually every time.
  const { data: project, error: projectError } = await db
    .from("projects")
    .insert({
      project_no: `PRJ-${dateStr}-${stamp}`,
      customer_company_id: partner_id,
      customer_site_id: site_id,
      title: jobTitle,
      status: "ACTIVE",
      updated_at: new Date().toISOString(),
    })
    .select("id, project_no")
    .single()

  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 })

  const { data: docGroup, error: docGroupError } = await db
    .from("document_groups")
    .insert({
      group_no: `DG-${dateStr}-${stamp}`,
      project_id: project.id,
      project_no: project.project_no,
      customer_company_id: partner_id,
      title: jobTitle,
      status: "OPEN",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (docGroupError) return NextResponse.json({ error: docGroupError.message }, { status: 500 })

  const orderNo = `ORD-${dateStr}-${stamp}`

  const { data, error } = await db
    .from("customer_orders")
    .insert({
      order_no: orderNo,
      project_id: project.id,
      document_group_id: docGroup.id,
      customer_company_id: partner_id,
      customer_site_id: site_id,
      status: "DRAFT",
      updated_at: new Date().toISOString(),
    })
    .select("id, order_no, status, customer_company_id, created_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    transaction: {
      id: data.id,
      title: jobTitle,
      tx_type,
      state: data.status,
      state_changed_at: data.created_at,
      net_amount: null,
      created_at: data.created_at,
      partner_id: data.customer_company_id,
    },
  }, { status: 201 })
}
