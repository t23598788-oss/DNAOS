// API สินค้ารายตัว — อ่าน/แก้/ลบ (GET/PATCH/DELETE)
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

const ALLOWED_STATUS = ["AVAILABLE", "OUT_OF_STOCK", "CUSTOM_ORDER"] as const

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null

async function platformCheck(auth: Awaited<ReturnType<typeof requireAuth>>) {
  if (auth instanceof NextResponse) return auth
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "ต้องใช้สิทธิ์ระดับแพลตฟอร์ม" }, { status: 403 })
  }
  return null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER)
  const bad = await platformCheck(auth)
  if (bad) return bad
  const { id } = await params
  const { data, error } = await supabase()
    .from("products")
    .select("id, catalog_id, business_id, name, specs, price, status, created_at")
    .eq("id", id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "ไม่พบสินค้า" }, { status: 404 })
  return NextResponse.json({ product: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER)
  const bad = await platformCheck(auth)
  if (bad) return bad
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if (body?.name !== undefined) {
    const n = strOrNull(body.name)
    if (!n) return NextResponse.json({ error: "name ว่างไม่ได้" }, { status: 400 })
    patch.name = n
  }
  if (body?.price !== undefined) patch.price = numOrNull(body.price)
  if (body?.status !== undefined) {
    const s = String(body.status)
    if (!ALLOWED_STATUS.includes(s as (typeof ALLOWED_STATUS)[number])) {
      return NextResponse.json({ error: `status ต้องเป็น ${ALLOWED_STATUS.join(", ")}` }, { status: 400 })
    }
    patch.status = s
  }
  if (body?.specs !== undefined) patch.specs = body.specs && typeof body.specs === "object" ? body.specs : {}
  if (body?.catalog_id !== undefined) patch.catalog_id = body.catalog_id ? String(body.catalog_id) : null
  if (body?.business_id !== undefined) {
    const b = strOrNull(body.business_id)
    if (!b) return NextResponse.json({ error: "business_id ว่างไม่ได้" }, { status: 400 })
    patch.business_id = b
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "ไม่มีฟิลด์ที่จะอัปเดต" }, { status: 400 })
  }
  const { data, error } = await supabase()
    .from("products")
    .update(patch)
    .eq("id", id)
    .select("id, catalog_id, business_id, name, specs, price, status, created_at")
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: "ไม่พบสินค้า" }, { status: 404 })
  return NextResponse.json({ product: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER)
  const bad = await platformCheck(auth)
  if (bad) return bad
  const { id } = await params
  const { error } = await supabase().from("products").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
