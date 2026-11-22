import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { loadAuthorityContext } from "@/engines/authority/load"
import { applyMaterialPrice } from "@/engines/canonical/material-price-write"
import { invalidatePublicCatalog } from "@/services/public-catalog/reader"

type Params = { params: Promise<{ pitId: string }> }

// Owner-reported gap 2026-07-11: /admin/pits was a read-only report — เฮีย
// could SEE that 91 of 96 pits had no price set (the real reason the LINE
// bot and admin ask-AI box can't answer price questions), but had no way to
// actually enter one. This is that missing write path.
//
// WAVE 3 CHANGE 2026-10-25 — this route is no longer a price writer.
// It used to write pit_materials and then audit_logs as two separate writes
// (compensation only, and the audit vocabulary differed from the canonical
// one). Now it is exactly one call into the ONE price authority:
//
//   admin route (auth) → engines/canonical/material-price-write.ts#applyMaterialPrice
//     → core/authority/resolve.ts (Actor → Organization → Resource → Grant → Action)
//     → Postgres apply_material_price_atomic (price + audit in one transaction)
//
// Consequences that are intentional, not regressions:
//   · A global profile role alone no longer authorises a price change. The fine decision is the
//     resolver. A non-owner without a grant is refused (fail-closed) — the
//     admin UI surfaces the machine reason instead of silently succeeding.
//   · The public catalog is invalidated only after a committed change.
//   · While migration 20261025000001 is not applied the command fails closed
//     with PRICE_ATOMIC_RPC_MISSING (503) instead of falling back to a
//     non-atomic two-write sequence.

const errorStatus = (message: string): number => {
  if (message.startsWith("PRICE_FORBIDDEN")) return 403
  if (message.startsWith("PRICE_INVALID") || message.startsWith("PIT_NOT_FOUND")) return 400
  if (message.startsWith("PRICE_ATOMIC_RPC_MISSING")) return 503
  return 500
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const { pitId } = await params
  const body = await req.json().catch(() => ({}))
  const materialTypeId = typeof body?.material_type_id === "string" ? body.material_type_id : ""
  const price = Number(body?.price)
  const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key : null

  if (!materialTypeId) return NextResponse.json({ error: "ขาด material_type_id" }, { status: 400 })
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: "ราคาต้องเป็นตัวเลขมากกว่า 0" }, { status: 400 })

  // The real profile id, never the raw auth id / LINE id (Identity Layer).
  // STEP 1: organization scope comes from the verified session only — the
  // loader refuses it when the profile was matched by email, when the session
  // account differs, or when the email is unconfirmed.
  const profileId = auth.canonicalProfileId ?? auth.id
  const { actor, grants } = await loadAuthorityContext({
    profileId,
    role: auth.role,
    sessionAccountId: auth.id,
    resolvedBy: auth.resolvedBy ?? null,
    emailConfirmed: auth.emailConfirmed === true,
  })

  try {
    const result = await applyMaterialPrice({
      pit_id: pitId,
      material_type_id: materialTypeId,
      price,
      actor,
      grants,
      source: "admin:pits-materials",
      idempotency_key: idempotencyKey,
    })

    if (result.changed) {
      // ONE invalidation point (existing writer): reader memo (this process) +
      // rendered pages. Another instance keeps its own memo until the TTL —
      // bounded staleness, not real-time.
      invalidatePublicCatalog()
      revalidatePath("/products", "layout")
    }

    return NextResponse.json({
      ok: true,
      id: result.price_id,
      changed: result.changed,
      audit_written: Boolean(result.audit_id),
      authority: result.authority,
      revalidated: result.changed,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(message) })
  }
}
