/**
 * GET /api/admin/users — list every user + role (TASK-001 Role/Permission Registry)
 * super_admin only — see registry/permissions.json
 */

import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { SUPER_ADMIN_ONLY } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

export async function GET() {
  const auth = await requireAuth(SUPER_ADMIN_ONLY)
  if (auth instanceof NextResponse) return auth

  const { data, error } = await supabase()
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ users: data ?? [] })
}