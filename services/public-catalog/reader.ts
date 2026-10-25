/**
 * Public catalog reader — the ONLY server-side path that turns business rows
 * into public listings.
 *
 * It reads the central registry (public.publication_records) FIRST and hydrates
 * from the canonical source tables afterwards, so a source row can never leak on
 * its own. Hydration also derives each row's REAL owner key from its own columns
 * (pit_materials.pit_profile_id) — policy.ownerAccepted() then refuses any
 * publication row that names a different owner. Hydration uses the existing admin service client
 * (services/supabase/queries.supabaseAdmin) because those tables are
 * service_role_only by design (20260710000008:69-72, 20260724000004:44-45).
 *
 * What this module deliberately does NOT do:
 *   - no `select *` on any business table (see HYDRATION below for the exact
 *     column list): equipment_assets in particular holds sim_number, imei and
 *     box_password (20260724000004:20-23) — never selected here;
 *   - no price arithmetic, no currency conversion, no stock inference;
 *   - no write path of any kind.
 *
 * Cache: 60 seconds, expressed through the HTTP Cache-Control header at the
 * route layer AND a tiny in-process memo here so a burst of crawler requests
 * cannot hammer the database. Both are intentionally short; the mission requires
 * a "clear cache period", not a long-lived stale price.
 */
import { supabaseAdmin } from "@/services/supabase/queries"
import {
  buildFacets,
  isLive,
  matchesArea,
  matchesQuery,
  pitOwnerKey,
  sortByNewest,
  toPublicItem,
  toPublicView,
  type CatalogFacets,
  type CatalogType,
  type PublicCatalogItem,
  type PublicCatalogView,
  type PublicationRecord,
  type SourceFacts,
} from "@/core/public-catalog/policy"
import { matchesParsedArea, parseAreaFromAddress } from "@/core/public-catalog/geography"

export interface PublicCatalogQuery {
  type?: CatalogType
  q?: string
  area?: string
  /** จังหวัด / อำเภอ filters. Matched against the province/district parsed from
   *  the supplier's own published address text (core/public-catalog/geography). */
  province?: string
  district?: string
  page?: number
  pageSize?: number
}

export interface PublicCatalogResult {
  /** ALREADY SANITISED (toPublicView): no source ids, no verifier email, no org. */
  items: PublicCatalogView[]
  total: number
  page: number
  pageSize: number
  generated_at: string
  /** filter options, built from the published set only */
  facets: CatalogFacets
  /** honest, machine-readable signal that nothing is published yet */
  empty_reason: "no_published_records" | "no_match" | null
}

export const PUBLIC_CACHE_SECONDS = 60

/**
 * Drop this process's memo.
 *
 * The EXISTING writers that change published data (price writer
 * app/api/admin/pits/[pitId]/materials and the publication writer
 * app/api/admin/publications) call this after a successful write, together with
 * revalidatePath for the rendered pages — one invalidation point, no second
 * writer and no new price system.
 *
 * Scope, stated honestly: the memo is per PROCESS. Clearing it removes the
 * stale window for the instance that handled the write; another instance (or a
 * cold start) keeps its own copy until PUBLIC_CACHE_SECONDS elapses. So the
 * cross-instance upper bound is still the TTL — this is bounded staleness, not
 * real-time, and is measured before it is claimed.
 */
export function invalidatePublicCatalog(): void {
  memo.clear()
}
const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 20

const PUBLICATION_COLUMNS =
  "id, source_table, source_record_id, organization_owner, allowed_public_fields, status, authorized_by, verified_by, verified_at, published_at, expires_at, public_slug, public_url, updated_at, trace_id"

const memo = new Map<string, { at: number; result: PublicCatalogResult }>()

/**
 * services/supabase/queries.supabaseAdmin() falls back to the ANON key when
 * SUPABASE_SERVICE_ROLE_KEY is absent (queries.ts:18). For this reader that
 * fallback is dangerous in a subtle way: publication_records has RLS enabled
 * with NO anon policy, so PostgREST answers [] instead of an error — the public
 * catalog would silently claim "nothing is published" while in truth the key is
 * missing. Refuse to answer in that state instead (the route turns this into a
 * 503 and the pages render an honest "not available" notice).
 */
function assertServiceRole(): void {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "PUBLIC_CATALOG_SERVICE_ROLE_MISSING: SUPABASE_SERVICE_ROLE_KEY is not set on this server — publication data cannot be read safely",
    )
  }
}

function normalizePaging(query: PublicCatalogQuery) {
  const page = Number.isFinite(query.page) && (query.page as number) > 0 ? Math.floor(query.page as number) : 1
  const rawSize = Number.isFinite(query.pageSize) ? Math.floor(query.pageSize as number) : DEFAULT_PAGE_SIZE
  const pageSize = Math.min(Math.max(rawSize, 1), MAX_PAGE_SIZE)
  return { page, pageSize }
}

/** Live publication rows, in one query (status+expiry filtered server-side too). */
async function loadLiveRecords(now: Date): Promise<PublicationRecord[]> {
  assertServiceRole()
  const db = supabaseAdmin()
  const { data, error } = await db
    .from("publication_records")
    .select(PUBLICATION_COLUMNS)
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(500)

  if (error) throw new Error(`PUBLIC_CATALOG_PUBLICATION_READ_FAILED: ${error.message}`)

  return ((data ?? []) as PublicationRecord[]).filter((row) => isLive(row, now))
}

/**
 * HYDRATION — one query per source table, explicit columns only, indexed by id.
 * Nothing is joined through PostgREST because pit_materials → material_types
 * and pit_materials → pit_profiles are two independent lookups and keeping them
 * separate avoids pulling PII columns (phone/address/lat/lng) by accident.
 */
async function hydrate(records: PublicationRecord[]): Promise<Map<string, SourceFacts>> {
  const db = supabaseAdmin()
  const facts = new Map<string, SourceFacts>()

  const byTable = (table: PublicationRecord["source_table"]) =>
    records.filter((r) => r.source_table === table)

  const materialPrices = byTable("pit_materials")
  if (materialPrices.length > 0) {
    const ids = materialPrices.map((r) => r.source_record_id)
    const { data: prices, error } = await db
      .from("pit_materials")
      .select("id, pit_profile_id, material_type_id, price, updated_at")
      .in("id", ids)
      .is("deleted_at", null)
    if (error) throw new Error(`PUBLIC_CATALOG_SOURCE_READ_FAILED: ${error.message}`)

    const materialTypeIds = [...new Set((prices ?? []).map((p) => p.material_type_id).filter(Boolean))]
    const pitIds = [...new Set((prices ?? []).map((p) => p.pit_profile_id).filter(Boolean))]

    const [{ data: materials }, { data: pits }] = await Promise.all([
      materialTypeIds.length
        ? db.from("material_types").select("id, name").in("id", materialTypeIds).is("deleted_at", null)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      // The address text is read ONLY to derive จังหวัด/อำเภอ via the same rule
      // the admin control room already uses (geography.ts). The raw address is
      // no longer emitted as `service_area`: street numbers are not public
      // data, and the filters only ever need the province/district names.
      pitIds.length
        ? db
            .from("pit_profiles")
            .select("id, pit_name, is_open, address, formatted_address, latitude, longitude")
            .in("id", pitIds)
            .is("deleted_at", null)
        : Promise.resolve({
            data: [] as {
              id: string
              pit_name: string
              is_open: boolean
              address: string | null
              formatted_address: string | null
              latitude: number | null
              longitude: number | null
            }[],
          }),
    ])

    const materialName = new Map((materials ?? []).map((m) => [m.id as string, m.name as string]))
    const pit = new Map((pits ?? []).map((p) => [p.id as string, p]))

    for (const row of prices ?? []) {
      // The plant is the owner. If it is gone (soft-deleted / missing), the
      // price has nobody it can honestly be attributed to: no facts ⇒ the
      // publication is denied rather than published without a supplier.
      const owner = pit.get(row.pit_profile_id)
      if (!owner) continue
      const area = parseAreaFromAddress(owner.formatted_address ?? owner.address ?? null)
      facts.set(row.id, {
        type: "material",
        name: materialName.get(row.material_type_id) ?? null,
        category: "material",
        // OWNER: derived from the price row's own pit_profile_id, never from
        // the publication row. policy.ownerAccepted() denies a mismatch.
        ownerKey: pitOwnerKey(row.pit_profile_id),
        price: typeof row.price === "number" ? row.price : Number(row.price),
        supplierName: owner.pit_name ?? null,
        // is_open=false means the plant is not currently supplying; surfaced
        // honestly by downgrading procurement instead of hiding the record.
        procurement: owner.is_open === false ? "quote_required" : null,
        // no raw address, no ids — only the parsed names are carried forward
        serviceArea: null,
        province: area.province,
        district: area.district,
        latitude: owner.latitude != null ? Number(owner.latitude) : null,
        longitude: owner.longitude != null ? Number(owner.longitude) : null,
        updatedAt: row.updated_at ?? null,
      })
    }
  }

  const vehicles = byTable("vehicle_types")
  if (vehicles.length > 0) {
    const { data, error } = await db
      .from("vehicle_types")
      .select("id, name, load_capacity, updated_at")
      .in("id", vehicles.map((r) => r.source_record_id))
      .is("deleted_at", null)
    if (error) throw new Error(`PUBLIC_CATALOG_SOURCE_READ_FAILED: ${error.message}`)

    for (const row of data ?? []) {
      facts.set(row.id, {
        type: "transport",
        name: row.name ?? null,
        category: "transport",
        // vehicle_types has no owner column (verified 2026-10-25) → platform only
        ownerKey: null,
        spec: row.load_capacity ? `บรรทุก ${row.load_capacity}` : null,
        updatedAt: row.updated_at ?? null,
      })
    }
  }

  const equipment = byTable("equipment_assets")
  if (equipment.length > 0) {
    // explicit columns only — sim_number / imei / box_password stay private
    const { data, error } = await db
      .from("equipment_assets")
      .select("id, asset_code, name, updated_at")
      .in("id", equipment.map((r) => r.source_record_id))
    if (error) throw new Error(`PUBLIC_CATALOG_SOURCE_READ_FAILED: ${error.message}`)

    for (const row of data ?? []) {
      facts.set(row.id, {
        type: "equipment",
        name: row.name ?? null,
        category: "equipment",
        // equipment_assets has no owner column (verified 2026-10-25) → platform only
        ownerKey: null,
        spec: row.asset_code ?? null,
        updatedAt: row.updated_at ?? null,
      })
    }
  }

  return facts
}

export async function readPublicCatalog(query: PublicCatalogQuery = {}): Promise<PublicCatalogResult> {
  const now = new Date()
  const { page, pageSize } = normalizePaging(query)
  const cacheKey = JSON.stringify({
    type: query.type ?? null,
    q: query.q ?? null,
    area: query.area ?? null,
    province: query.province ?? null,
    district: query.district ?? null,
    page,
    pageSize,
  })

  const cached = memo.get(cacheKey)
  if (cached && now.getTime() - cached.at < PUBLIC_CACHE_SECONDS * 1000) {
    return cached.result
  }

  const records = await loadLiveRecords(now)
  const facts = records.length > 0 ? await hydrate(records) : new Map<string, SourceFacts>()

  const all: PublicCatalogItem[] = []
  for (const record of records) {
    const source = facts.get(record.source_record_id)
    if (!source) continue // source row deleted/soft-deleted → publication DENY
    const item = toPublicItem(record, source, now)
    if (item) all.push(item)
  }

  const filtered = sortByNewest(all).filter(
    (item) =>
      (!query.type || item.type === query.type) &&
      matchesQuery(item, query.q ?? "") &&
      matchesArea(item, query.area ?? "") &&
      matchesParsedArea(item.province, query.province ?? "") &&
      matchesParsedArea(item.district, query.district ?? ""),
  )

  const total = filtered.length
  const start = (page - 1) * pageSize
  const result: PublicCatalogResult = {
    // sanitised at the reader boundary — callers cannot accidentally serialize
    // provenance/source ids, because they are not present here at all.
    items: filtered.slice(start, start + pageSize).map(toPublicView),
    total,
    page,
    pageSize,
    generated_at: now.toISOString(),
    facets: buildFacets(all),
    empty_reason:
      all.length === 0 ? "no_published_records" : filtered.length === 0 ? "no_match" : null,
  }

  memo.set(cacheKey, { at: now.getTime(), result })
  return result
}

export async function readPublicItem(slug: string): Promise<PublicCatalogView | null> {
  const clean = slug.trim().toLowerCase()
  if (!clean) return null
  assertServiceRole()
  const db = supabaseAdmin()
  const now = new Date()

  const { data, error } = await db
    .from("publication_records")
    .select(PUBLICATION_COLUMNS)
    .eq("public_slug", clean)
    .eq("status", "published")
    .maybeSingle()

  if (error) throw new Error(`PUBLIC_CATALOG_PUBLICATION_READ_FAILED: ${error.message}`)
  if (!data) return null

  const record = data as PublicationRecord
  if (!isLive(record, now)) return null

  const facts = await hydrate([record])
  const source = facts.get(record.source_record_id)
  if (!source) return null
  const item = toPublicItem(record, source, now)
  return item ? toPublicView(item) : null
}

/** Simple per-instance sliding window limiter (no shared store exists in repo). */
const hits = new Map<string, number[]>()
export function allowRequest(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  return true
}
