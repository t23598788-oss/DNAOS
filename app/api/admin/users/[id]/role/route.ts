/**
 * PATCH /api/admin/users/[id]/role — assign a role to a user (TASK-001)
 * super_admin only — see registry/permissions.json
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { SUPER_ADMIN_ONLY, type AppRole } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

const VALID_ROLES: AppRole[] = ["super_admin", "admin", "employee", "partner", "customer", "ai_service"]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(SUPER_ADMIN_ONLY)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const role = body.role as AppRole

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `role ต้องเป็นหนึ่งใน: ${VALID_ROLES.join(", ")}` }, { status: 400 })
  }

  const { error } = await supabase()
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}