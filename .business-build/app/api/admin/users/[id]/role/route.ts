/**
 * PATCH /api/admin/users/[id]/role — assign a role to a user (TASK-001)
 * super_admin only — see registry/permissions.json
 *
 * Identity Architecture (2026-07-14): granting super_admin is further
 * restricted to the Owner only (the super_admin profile with the earliest
 * created_at — same definition as GET /api/admin/users). Any other role
 * change (including granting admin/employee/partner/customer/ai_service, or
 * changing a non-owner super_admin's role) is unaffected — this only closes
 * the specific gap where any super_admin could previously mint another.
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

  if (role === "super_admin") {
    const { data: earliestSuperAdmin, error: ownerError } = await supabase()
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (ownerError) return NextResponse.json({ error: ownerError.message }, { status: 500 })

    if (earliestSuperAdmin && earliestSuperAdmin.id !== auth.id) {
      return NextResponse.json(
        { error: "เฉพาะ Owner (super_admin คนแรกสุดของระบบ) เท่านั้นที่ให้สิทธิ์ super_admin คนอื่นได้" },
        { status: 403 }
      )
    }
  }

  const { error } = await supabase()
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}