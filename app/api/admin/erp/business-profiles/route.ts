// API จัดการโปรไฟล์ธุรกิจ — รายการ/เพิ่ม (GET/POST)
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null

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

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  const bad = await platformCheck(auth)
  if (bad) return bad
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 200), 500)
  const { data, error } = await supabase()
    .from("business_profiles")
    .select("id, company_name, business_type, verified_status, channel_origin, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ business_profiles: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  const bad = await platformCheck(auth)
  if (bad) return bad
  const body = await req.json().catch(() => ({}))
  const companyName = strOrNull(body?.company_name)
  if (!companyName) return NextResponse.json({ error: "company_name จำเป็น" }, { status: 400 })
  const { data, error } = await supabase()
    .from("business_profiles")
    .insert({
      company_name: companyName,
      business_type: strOrNull(body?.business_type),
      verified_status: body?.verified_status === true,
      channel_origin: strOrNull(body?.channel_origin),
    })
    .select("id, company_name, business_type, verified_status, channel_origin, created_at")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ business_profile: data }, { status: 201 })
}
