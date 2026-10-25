import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Owner approval request listing (Phase 7). Read-only listing of pending
// capability authorization requests. ADMIN_TIER only — approval authority is
// never exposed to an unauthenticated or lower-tier caller.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { data, error } = await supabase()
    .from("pending_authorizations")
    .select("id, capability, resource, subject_type, subject_id, scope, job_id, request_description, status, created_at, expires_at, grant_id")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, requests: data ?? [] })
}
