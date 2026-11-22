/**
 * POST/GET /api/admin/publications — per-item publication permission.
 *
 * This is the ONLY writer for public.publication_records. It does not copy any
 * business fact: the price still lives in pit_materials, the name in
 * material_types, the supplier in pit_profiles. What it writes is permission —
 * who authorized it, which fields may be shown, until when, and the audit trail.
 *
 * Guard: authenticated session plus verified source-owner proof; no platform role.
 *
 * Ownership is NEVER taken from the request body:
 *   pit_materials      → 'pit:<pit_materials.pit_profile_id>' (read from the row)
 *   vehicle_types,
 *   equipment_assets   → no owner column, so publication is denied.
 * A client cannot publish a price row under another plant.
 *
 * The reader independently re-derives the same owner key and denies any
 * mismatch (core/public-catalog/policy.ownerAccepted), so this route and the
 * public surface cannot drift apart.
 */
import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { randomUUID } from "node:crypto"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED, DISABLED_ROLE_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { invalidatePublicCatalog } from "@/services/public-catalog/reader"
import { PLATFORM_OWNER, pitOwnerKey, type PublicField, type SourceTable } from "@/core/public-catalog/policy"
import {
  publicSlugFor,
  resolveWriter,
  witnessForPitMaterial,
  witnessWithoutOwner,
} from "@/core/public-catalog/authority"

export const dynamic = "force-dynamic"

/** Tables the public reader can actually hydrate into a listing. */
const PUBLISHABLE_TABLES: SourceTable[] = ["pit_materials", "vehicle_types", "equipment_assets"]

/** Field keys the policy understands — anything else is rejected, not stored. */
const KNOWN_FIELDS: PublicField[] = [
  "name",
  "category",
  "spec",
  "unit",
  "price",
  "currency",
  "supplier_name",
  "service_area",
  "coordinates",
  "image_url",
  "contact_url",
  "procurement",
  "updated_at",
]

/** Default per-item permission: the price listing, nothing internal. */
const DEFAULT_FIELDS: PublicField[] = ["name", "price", "supplier_name", "service_area"]

const COLUMNS =
  "id, source_table, source_record_id, organization_owner, allowed_public_fields, status, authorized_by, verified_by, verified_at, published_at, expires_at, public_slug, public_url, updated_at, trace_id"

type Action = "publish" | "withdraw" | "draft"

interface ResolvedSource {
  source_table: SourceTable
  source_record_id: string
  organization_owner: string
  /** stable public slug — same value every time this item is republished */
  public_slug: string
  identity_user_id: string | null
}

/** Read the source row and derive the real owner — never trust the client. */
async function resolveSource(table: SourceTable, recordId: string): Promise<ResolvedSource | null> {
  const db = supabaseAdmin()

  if (table === "pit_materials") {
    const { data: row, error } = await db
      .from("pit_materials")
      .select("id, pit_profile_id, deleted_at")
      .eq("id", recordId)
      .maybeSingle()
    if (error) throw new Error(`PUBLICATION_SOURCE_READ_FAILED: ${error.message}`)
    if (!row || row.deleted_at) return null

    const { data: pit, error: pitError } = await db
      .from("pit_profiles")
      .select("id, user_id, deleted_at")
      .eq("id", row.pit_profile_id)
      .maybeSingle()
    if (pitError) throw new Error(`PUBLICATION_SOURCE_READ_FAILED: ${pitError.message}`)
    if (!pit || pit.deleted_at) return null

    return {
      source_table: table,
      source_record_id: row.id,
      organization_owner: pitOwnerKey(row.pit_profile_id),
      public_slug: publicSlugFor(table, row.id, row.pit_profile_id),
      identity_user_id: pit.user_id ?? null,
    }
  }

  // Ownerless tables: an explicit platform decision, not an invented organisation.
  const tableName = table === "vehicle_types" ? "vehicle_types" : "equipment_assets"
  const { data: row, error } = await db.from(tableName).select("id").eq("id", recordId).maybeSingle()
  if (error) throw new Error(`PUBLICATION_SOURCE_READ_FAILED: ${error.message}`)
  if (!row) return null

  return {
    source_table: table,
    source_record_id: row.id,
    organization_owner: PLATFORM_OWNER,
    public_slug: publicSlugFor(table, row.id, null),
    identity_user_id: null,
  }
}

function publicationTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === "PGRST205" || /publication_records/.test(error.message ?? "")
}

export async function GET() {
  const auth = await requireAuth(DISABLED_ROLE_TIER)
  if (auth instanceof NextResponse) return auth

  const { data, error } = await supabaseAdmin()
    .from("publication_records")
    .select(COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(500)

  if (error) {
    if (publicationTableMissing(error)) {
      return NextResponse.json(
        {
          ok: false,
          migration_pending: true,
          error:
            "ตาราง publication_records ยังไม่มีในฐานข้อมูลจริง — ต้อง apply supabase/migrations/20261024000002_public_publication_registry.sql ก่อน",
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, publications: data ?? [], known_fields: KNOWN_FIELDS })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 })
  }

  const action = body.action as Action
  if (!["publish", "withdraw", "draft"].includes(action)) {
    return NextResponse.json(
      { ok: false, error: "action ต้องเป็น publish | withdraw | draft" },
      { status: 400 },
    )
  }

  const sourceTable = body.source_table as SourceTable
  if (!PUBLISHABLE_TABLES.includes(sourceTable)) {
    return NextResponse.json(
      { ok: false, error: `source_table ต้องเป็นหนึ่งใน: ${PUBLISHABLE_TABLES.join(", ")}` },
      { status: 400 },
    )
  }

  const sourceRecordId = typeof body.source_record_id === "string" ? body.source_record_id.trim() : ""
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(sourceRecordId)) {
    return NextResponse.json({ ok: false, error: "source_record_id ต้องเป็น UUID" }, { status: 400 })
  }

  // Field whitelist — unknown keys are an error, never silently stored.
  let fields: PublicField[] = DEFAULT_FIELDS
  if (body.allowed_public_fields !== undefined) {
    if (!Array.isArray(body.allowed_public_fields)) {
      return NextResponse.json({ ok: false, error: "allowed_public_fields ต้องเป็น array" }, { status: 400 })
    }
    const requested = [...new Set(body.allowed_public_fields.map((f) => String(f)))] as PublicField[]
    const unknown = requested.filter((f) => !KNOWN_FIELDS.includes(f))
    if (unknown.length > 0) {
      return NextResponse.json(
        { ok: false, error: `ฟิลด์ที่เผยแพร่ไม่ได้: ${unknown.join(", ")}` },
        { status: 400 },
      )
    }
    fields = requested
  }
  if (!fields.includes("name")) {
    // policy.toPublicItem denies a nameless listing anyway — reject earlier.
    return NextResponse.json({ ok: false, error: "ต้องมี name อยู่ในรายการฟิลด์ที่เผยแพร่" }, { status: 400 })
  }

  // Expiry: explicit, bounded. A published price without an end date goes stale
  // silently, so the caller must choose (null = no expiry, stated in the UI).
  let expiresAt: string | null = null
  if (body.expires_in_days != null) {
    const days = Number(body.expires_in_days)
    if (!Number.isFinite(days) || days < 1 || days > 730) {
      return NextResponse.json({ ok: false, error: "expires_in_days ต้องอยู่ระหว่าง 1–730" }, { status: 400 })
    }
    expiresAt = new Date(Date.now() + Math.round(days) * 86_400_000).toISOString()
  }

  let source: ResolvedSource | null
  try {
    source = await resolveSource(sourceTable, sourceRecordId)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "อ่านข้อมูลต้นทางไม่สำเร็จ" },
      { status: 502 },
    )
  }
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "ไม่พบรายการต้นทาง (หรือถูกลบแล้ว) — เผยแพร่ไม่ได้" },
      { status: 404 },
    )
  }

  // Writer entitlement (admin tier ⇒ publication.admin). Kept explicit so the
  // operator path is a deliberate decision, not an accident.
  const witness =
    sourceTable === "pit_materials"
      ? witnessForPitMaterial({
          source_record_id: source.source_record_id,
          pit_profile_id: source.organization_owner.startsWith("pit:")
            ? source.organization_owner.slice(4)
            : null,
          pit_user_id: source.identity_user_id,
        })
      : witnessWithoutOwner(sourceTable, source.source_record_id)

  const decision = resolveWriter({ userId: auth.id, email: auth.email, role: auth.role }, witness)
  if (!decision.allowed || decision.writer !== "publication.operator") {
    return NextResponse.json(
      { ok: false, error: decision.detail, reason: decision.reason },
      { status: 403 },
    )
  }

  // Publishing facts asserts they were verified — require an explicit ack so the
  // public "ตรวจสอบแล้ว" badge never appears from a stray click.
  if (action === "publish" && body.confirm_facts !== true) {
    return NextResponse.json(
      { ok: false, error: "ต้องยืนยันว่าตรวจสอบข้อมูล/ราคาแล้วก่อนเผยแพร่ (confirm_facts: true)" },
      { status: 400 },
    )
  }

  const db = supabaseAdmin()
  const now = new Date().toISOString()

  const { data: existing, error: existingError } = await db
    .from("publication_records")
    .select(COLUMNS)
    .eq("source_table", sourceTable)
    .eq("source_record_id", sourceRecordId)
    .maybeSingle()

  if (existingError) {
    if (publicationTableMissing(existingError)) {
      return NextResponse.json(
        {
          ok: false,
          migration_pending: true,
          error:
            "ตาราง publication_records ยังไม่มีในฐานข้อมูลจริง — ต้อง apply supabase/migrations/20261024000002_public_publication_registry.sql ก่อน",
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 })
  }

  const row = {
    source_table: sourceTable,
    source_record_id: sourceRecordId,
    organization_owner: source.organization_owner,
    allowed_public_fields: fields,
    status: action === "publish" ? "published" : action === "withdraw" ? "withdrawn" : "draft",
    authorized_by: existing?.authorized_by ?? auth.email,
    verified_by: action === "publish" ? auth.email : null,
    verified_at: action === "publish" ? now : null,
    published_at: action === "publish" ? (existing?.published_at ?? now) : (existing?.published_at ?? null),
    expires_at: action === "publish" ? expiresAt : null,
    public_slug: existing?.public_slug ?? source.public_slug,
    public_url: existing?.public_url ?? `/products/${existing?.public_slug ?? source.public_slug}`,
    updated_at: now,
    trace_id: randomUUID(),
    evidence: {
      actor: auth.email,
      actor_role: auth.role,
      action,
      owner_source: sourceTable === "pit_materials" ? "pit_materials.pit_profile_id" : "no owner column — platform",
      identity_user_id: source.identity_user_id,
      at: now,
    },
  }

  const slugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/
  if (!slugRe.test(row.public_slug)) {
    return NextResponse.json({ ok: false, error: "public_slug ที่สร้างไม่ถูกต้องตามรูปแบบ" }, { status: 500 })
  }

  const write = existing
    ? await db.from("publication_records").update(row).eq("id", existing.id).select(COLUMNS).single()
    : await db.from("publication_records").insert(row).select(COLUMNS).single()

  if (write.error) {
    if (write.error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "มีรายการเผยแพร่ของข้อมูลนี้อยู่แล้ว (slug/unique ชนกัน) — ลองโหลดหน้าใหม่" },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: false, error: write.error.message }, { status: 500 })
  }

  // The same single invalidation point the price writer uses: a withdraw must
  // disappear from the public surface now, not after the memo TTL — otherwise a
  // just-withdrawn price can stay visible for up to PUBLIC_CACHE_SECONDS.
  invalidatePublicCatalog()
  revalidatePath("/products", "layout")

  // Append-only permission trail. Failure here is reported, never hidden: the
  // live row is already written, so the caller must know the trail is short.
  const event = await db.from("publication_events").insert({
    publication_record_id: write.data.id,
    from_status: existing?.status ?? null,
    to_status: row.status,
    actor: auth.email,
    reason: `admin_publication_${action}`,
    evidence: { allowed_public_fields: fields, expires_at: row.expires_at },
    trace_id: row.trace_id,
  })

  return NextResponse.json({
    ok: true,
    publication: write.data,
    owner: row.organization_owner,
    audit_event_written: !event.error,
    audit_error: event.error?.message ?? null,
  })
}
