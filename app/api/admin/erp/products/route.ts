// API จัดการสินค้า — รายการ/เพิ่ม (GET/POST)
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

const ALLOWED_STATUS = ["AVAILABLE", "OUT_OF_STOCK", "CUSTOM_ORDER"] as const
type ProductStatus = (typeof ALLOWED_STATUS)[number]

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "ต้องใช้สิทธิ์ระดับแพลตฟอร์ม" }, { status: 403 })
  }

  const params = req.nextUrl.searchParams
  const limit = Math.min(Number(params.get("limit") ?? 200), 500)
  const businessId = params.get("business_id")
  const status = params.get("status")
  const q = params.get("q")

  let query = supabase()
    .from("products")
    .select("id, catalog_id, business_id, name, specs, price, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (businessId) query = query.eq("business_id", businessId)
  if (status && ALLOWED_STATUS.includes(status as ProductStatus)) query = query.eq("status", status)
  if (q) query = query.ilike("name", `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "ต้องใช้สิทธิ์ระดับแพลตฟอร์ม" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const name = strOrNull(body?.name)
  const businessId = strOrNull(body?.business_id)
  if (!name) return NextResponse.json({ error: "name จำเป็น" }, { status: 400 })
  if (!businessId || !isUuid(businessId)) {
    return NextResponse.json({ error: "business_id ต้องเป็น UUID ที่มีอยู่" }, { status: 400 })
  }
  const status = body?.status ? String(body.status) : "AVAILABLE"
  if (!ALLOWED_STATUS.includes(status as ProductStatus)) {
    return NextResponse.json({ error: `status ต้องเป็น ${ALLOWED_STATUS.join(", ")}` }, { status: 400 })
  }
  const catalogId = body?.catalog_id ? String(body.catalog_id) : null
  if (catalogId && !isUuid(catalogId)) {
    return NextResponse.json({ error: "catalog_id ต้องเป็น UUID" }, { status: 400 })
  }

  const { data, error } = await supabase()
    .from("products")
    .insert({
      name,
      business_id: businessId,
      catalog_id: catalogId,
      specs: body?.specs && typeof body.specs === "object" ? body.specs : {},
      price: numOrNull(body?.price),
      status,
    })
    .select("id, catalog_id, business_id, name, specs, price, status, created_at")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ product: data }, { status: 201 })
}
