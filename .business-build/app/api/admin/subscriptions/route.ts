import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Subscription Cost Observer (owner, 2026-08-03): "ให้ระบบเป็นผู้สังเกต
// (Observer) ไม่ใช่ให้คนเป็นผู้ไล่เช็กเอง" — serves subscription_services
// (populated by supabase/functions/subscription-email-sync) to the admin
// infrastructure dashboard.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  const { data, error } = await db
    .from("subscription_services")
    .select("*")
    .order("amount", { ascending: false, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ services: data })
}
