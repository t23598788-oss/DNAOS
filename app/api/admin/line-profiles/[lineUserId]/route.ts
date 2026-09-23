import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolveExternalIdentity, linkExternalIdentity } from "@/engines/connect/identity"

type Params = { params: Promise<{ lineUserId: string }> }

/** The provider this route configures. Identity itself is provider-neutral —
 *  this constant is the user's choice of which provider account they are
 *  editing, not a business identity authority. */
const PROVIDER = "line"

const VALID_ROLES = ["employee", "customer", "supplier", "driver", "owner", "contractor", "accountant", "manager", "admin", "external"]
const VALID_TRUST_LEVELS = ["verified", "unverified", "flagged"]

// Contact Settings Popup (owner, 2026-07-18) — single-contact fetch, feeds
// the categorized popup opened from the chat header.
// Capability C (2026-09-23): reads/writes the canonical Connect identity model
// (engines/connect/identity.ts) instead of the provider-shaped line_profiles
// table — which is now a read-only projection of that model.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const db = supabase()

  const identity = await resolveExternalIdentity(db, { provider: PROVIDER, externalSubjectId: lineUserId })
  const profile = identity
    ? {
        line_user_id: identity.externalSubjectId,
        display_name: identity.displayName,
        role: identity.role,
        company_id: identity.companyId,
        department: identity.department,
        trust_level: identity.trustLevel,
        permissions: identity.permissions,
        companies: identity.companyId ? { id: identity.companyId, name: identity.companyName } : null,
      }
    : null

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
  // canonical identity first rather than overwrite the whole object blindly.
  let mergedPermissions: Record<string, unknown> | undefined
  if (body.permissions !== undefined) {
    const existing = await resolveExternalIdentity(db, { provider: PROVIDER, externalSubjectId: lineUserId })
    mergedPermissions = { ...(existing?.permissions ?? {}), ...body.permissions }
  }

  // The canonical writer (linkExternalIdentity) is the ONLY way a provider
  // identity mapping changes; the legacy line_profiles row is projected from it.
  const write = await linkExternalIdentity(db, {
    provider: PROVIDER,
    externalSubjectId: lineUserId,
    ...(body.displayName !== undefined ? { displayName: body.displayName || null } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.companyId !== undefined ? { companyId: body.companyId || null } : {}),
    ...(body.department !== undefined ? { department: body.department || null } : {}),
    ...(body.trustLevel !== undefined ? { trustLevel: body.trustLevel } : {}),
    ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
    ...(mergedPermissions !== undefined ? { permissions: mergedPermissions } : {}),
    actor: auth.email ?? auth.id ?? "admin",
  })
  if (!write.ok) return NextResponse.json({ error: write.error }, { status: 500 })

  const saved = await resolveExternalIdentity(db, { provider: PROVIDER, externalSubjectId: lineUserId })
  if (!saved) return NextResponse.json({ error: "บันทึกแล้วแต่ยังอ่าน identity กลับไม่ได้" }, { status: 500 })
  return NextResponse.json({
    profile: {
      line_user_id: saved.externalSubjectId,
      role: saved.role,
      company_id: saved.companyId,
      department: saved.department,
      trust_level: saved.trustLevel,
      notes: null,
      permissions: saved.permissions,
      updated_at: new Date().toISOString(),
    },
  })
}
