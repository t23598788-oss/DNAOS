/**
 * GET /api/admin/users — list every user + role (TASK-001 Role/Permission Registry)
 * super_admin only — see registry/permissions.json
 *
 * Identity Architecture (2026-07-14): merges auth.users' own natively-tracked
 * fields (email_confirmed_at, last_sign_in_at, provider) into the response —
 * no schema migration needed, these already exist on Supabase's own table,
 * just never queried by this route before. "Owner" = the super_admin profile
 * with the earliest created_at (matches the real bootstrap rule: the first-
 * ever signup becomes super_admin automatically) — not a new role, not a new
 * column, computed here from data that already exists.
 */

import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { SUPER_ADMIN_ONLY } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

export async function GET() {
  const auth = await requireAuth(SUPER_ADMIN_ONLY)
  if (auth instanceof NextResponse) return auth

  const { data: profiles, error } = await supabase()
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: authData, error: authError } = await supabase().auth.admin.listUsers()
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  const authById = new Map(authData.users.map((u) => [u.id, u]))
  const ownerId = (profiles ?? []).find((p) => p.role === "super_admin")?.id ?? null

  const users = (profiles ?? []).map((p) => {
    const au = authById.get(p.id)
    return {
      id: p.id,
      email: p.email,
      role: p.role,
      created_at: p.created_at,
      verified: !!au?.email_confirmed_at,
      last_sign_in_at: au?.last_sign_in_at ?? null,
      provider: (au?.app_metadata?.provider as string) ?? "email",
      is_owner: p.id === ownerId,
    }
  })

  return NextResponse.json({ users })
}