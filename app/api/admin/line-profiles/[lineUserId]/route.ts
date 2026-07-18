import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ lineUserId: string }> }

const VALID_ROLES = ["employee", "customer", "supplier", "driver", "owner", "contractor", "accountant", "manager", "admin", "external"]
const VALID_TRUST_LEVELS = ["verified", "unverified", "flagged"]

// Contact Settings Popup (owner, 2026-07-18) — single-contact fetch, feeds
// the categorized popup opened from the chat header. Falls back to defaults
// for a contact with no line_profiles row yet (not an error — most contacts
// are unclassified until an admin sets something).
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const db = supabase()

  const { data: profile, error } = await db
    .from("line_profiles")
    .select("line_user_id, display_name, role, company_id, department, trust_level, notes, permissions, companies(id, name)")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    profile: profile ?? {
      line_user_id: lineUserId,
      display_name: null,
      role: null,
      company_id: null,
      department: null,
      trust_level: "unverified",
      notes: null,
      permissions: {},
      companies: null,
    },
  })
}

// LINE Profile — set/update a contact's role, org link, trust level, and
// permissions (owner, 2026-07-18). A human decision (admin sets this from
// the Contact Settings popup) — never inferred/assumed by AI, per the same
// "no guessing, no unverified fact presented as truth" principle already
// established this session (Consciousness Layer SourceTag rule).
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))

  if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
    return NextResponse.json({ error: `role ไม่ถูกต้อง — ต้องเป็นหนึ่งใน ${VALID_ROLES.join(", ")}` }, { status: 400 })
  }
  if (body.trustLevel !== undefined && !VALID_TRUST_LEVELS.includes(body.trustLevel)) {
    return NextResponse.json({ error: `trustLevel ไม่ถูกต้อง — ต้องเป็นหนึ่งใน ${VALID_TRUST_LEVELS.join(", ")}` }, { status: 400 })
  }

  const db = supabase()

  // Permissions save as a merge (only the edited category's keys change),
  // matching the popup's "กดบันทึกเฉพาะหมวดที่แก้ไข" requirement — read the
  // existing jsonb first rather than overwrite the whole object blindly.
  let mergedPermissions: Record<string, unknown> | undefined
  if (body.permissions !== undefined) {
    const { data: existing } = await db.from("line_profiles").select("permissions").eq("line_user_id", lineUserId).maybeSingle()
    mergedPermissions = { ...(existing?.permissions ?? {}), ...body.permissions }
  }

  const update: Record<string, unknown> = { line_user_id: lineUserId, updated_at: new Date().toISOString() }
  if (body.displayName !== undefined) update.display_name = body.displayName || null
  if (body.role !== undefined) update.role = body.role
  if (body.companyId !== undefined) update.company_id = body.companyId || null
  if (body.department !== undefined) update.department = body.department || null
  if (body.trustLevel !== undefined) update.trust_level = body.trustLevel
  if (body.notes !== undefined) update.notes = body.notes || null
  if (mergedPermissions !== undefined) update.permissions = mergedPermissions

  const { data, error } = await db
    .from("line_profiles")
    .upsert(update, { onConflict: "line_user_id" })
    .select("line_user_id, role, company_id, department, trust_level, notes, permissions, updated_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}
