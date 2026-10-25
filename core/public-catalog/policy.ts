/**
 * Public catalog policy — PURE functions, no I/O, no database access.
 *
 * This is the ONE place that decides whether a business record may appear on
 * the public website. It is intentionally independent from authentication:
 * "is this person logged in" is a different question from "has this record
 * been authorized for publication" (mission §03: separate the two).
 *
 * DEFAULT DENY, four independent gates (all must pass):
 *   1. a publication_records row exists for (source_table, source_record_id)
 *   2. that row is status='published' AND not past expires_at
 *   3. the source row really belongs to the owner the row names (ownerAccepted)
 *   4. each emitted field is listed in allowed_public_fields
 *
 * Nothing here fabricates a value. A missing price yields `price: null` (the
 * page renders "ขอราคา"), never 0, never a guess. Stock/availability is only
 * emitted when the source record carries explicit evidence.
 *
 * Verified against the real schema (2026-10-24):
 *   material_types  id, name                                       20260710000001:10
 *   pit_materials   id, pit_profile_id, material_type_id, price    20260710000008:41
 *   pit_profiles    id, pit_name, phone, address, lat/lng, is_open 20260710000008:11
 *   vehicle_types   id, name, load_capacity, fuel_consumption_rate 20260710000008:51
 *   equipment_assets id, asset_code, name, sim_number, imei,
 *                    box_password, current_status, total_engine_hours
 *                                                                  20260724000004:16
 * None of them has a currency, unit, stock, publication or org column — which
 * is exactly why those values are only emitted when explicitly allowed.
 */

export type PublicationStatus = "draft" | "published" | "expired" | "withdrawn"

export type SourceTable = "pit_materials" | "material_types" | "vehicle_types" | "equipment_assets"

export type PublicField =
  | "name"
  | "category"
  | "spec"
  | "unit"
  | "price"
  | "currency"
  | "supplier_name"
  | "service_area"
  | "coordinates"
  | "image_url"
  | "contact_url"
  | "procurement"
  | "updated_at"

export type ProcurementMode = "in_stock" | "made_to_order" | "sourced_on_request" | "quote_required"

export type CatalogType = "material" | "transport" | "equipment"

export interface PublicationRecord {
  id: string
  source_table: SourceTable
  source_record_id: string
  organization_owner: string
  allowed_public_fields: string[]
  status: PublicationStatus
  authorized_by: string
  verified_by: string | null
  verified_at: string | null
  published_at: string | null
  expires_at: string | null
  public_slug: string
  public_url: string | null
  updated_at: string
  trace_id: string | null
}

/**
 * The only two shapes `organization_owner` may take, both derived from real
 * columns (see core/public-catalog/authority.ts for the column census):
 *   pit:<pit_profiles.id>  a price row owned by the plant it belongs to
 *   platform               a resource whose table has NO owner column at all
 *                          (vehicle_types, equipment_assets — verified 2026-10-25)
 * A publication row claiming any other owner is not accepted.
 */
export const PLATFORM_OWNER = "platform" as const

export function pitOwnerKey(pitProfileId: string): string {
  return `pit:${pitProfileId}`
}

/** Normalised facts read from the source table — every field optional. */
export interface SourceFacts {
  type: CatalogType
  name?: string | null
  /**
   * The owner key the SOURCE ROW really has — computed by the reader from the
   * source columns (`pit:<pit_profile_id>` for a price, null when the source
   * table has no owner column). Never taken from the publication row, never
   * from client input. When absent, publication is denied (fail-closed).
   */
  ownerKey?: string | null
  category?: string | null
  spec?: string | null
  unit?: string | null
  price?: number | null
  supplierName?: string | null
  serviceArea?: string[] | null
  imageUrl?: string | null
  contactUrl?: string | null
  procurement?: ProcurementMode | null
  stockQty?: number | null
  updatedAt?: string | null
  /** province / district NAME, parsed from the supplier's own address text
   *  (core/public-catalog/geography.ts). null when the text has none. */
  province?: string | null
  district?: string | null
  /** real GPS from the source row; 0/0 means "not set" in this schema */
  latitude?: number | null
  longitude?: number | null
}

export interface PublicPrice {
  amount: number
  currency: "THB"
  /** true only when the publication row carries a real verifier + timestamp */
  verified: boolean
  verified_at: string | null
  valid_until: string | null
}

export interface PublicCatalogItem {
  slug: string
  type: CatalogType
  name: string
  category: string | null
  spec: string | null
  unit: string | null
  price: PublicPrice | null
  procurement: ProcurementMode
  /** only when procurement evidence exists — never assumed */
  availability: "in_stock" | null
  supplier: { name: string } | null
  service_area: string[] | null
  /** parsed from the supplier's own published address text, else null */
  province: string | null
  district: string | null
  /** emitted only when the publication row whitelists `coordinates` */
  coordinates: { lat: number; lng: number } | null
  image_url: string | null
  contact_url: string | null
  published_at: string
  updated_at: string
  expires_at: string | null
  /** INTERNAL — never serialize this into a public response or page. */
  provenance: {
    source_table: SourceTable
    source_record_id: string
    publication_record_id: string
    verified_by: string | null
    trace_id: string | null
  }
}

/**
 * The public wire/DOM shape. Built by `toPublicView` and nothing else, so a
 * future field added to PublicCatalogItem cannot leak by default.
 *
 * Deliberately absent: provenance (source/record ids, verifier email, trace
 * id), organization_owner, raw address text, phone, line_user_id, deleted_at.
 */
export interface PublicCatalogView {
  slug: string
  type: CatalogType
  name: string
  category: string | null
  spec: string | null
  unit: string | null
  price: PublicPrice | null
  procurement: ProcurementMode
  availability: "in_stock" | null
  supplier: { name: string } | null
  service_area: string[] | null
  province: string | null
  district: string | null
  coordinates: { lat: number; lng: number } | null
  image_url: string | null
  contact_url: string | null
  published_at: string
  updated_at: string
  expires_at: string | null
}

export interface CatalogFacet {
  value: string
  count: number
}

export interface CatalogFacets {
  provinces: CatalogFacet[]
  districts: CatalogFacet[]
  types: CatalogFacet[]
}

/** The business operates in THB; no source table declares a currency column. */
export const DEFAULT_CURRENCY = "THB" as const

export function isLive(record: PublicationRecord, now: Date = new Date()): boolean {
  if (record.status !== "published") return false
  if (!record.published_at) return false
  if (record.expires_at) {
    const expires = Date.parse(record.expires_at)
    if (!Number.isFinite(expires)) return false
    if (expires <= now.getTime()) return false
  }
  return true
}

export function hasField(record: PublicationRecord, field: PublicField): boolean {
  return record.allowed_public_fields.includes(field)
}

/**
 * Owner gate — the publication row may only describe a resource that belongs to
 * the owner it names. A price row hydrated from pit X cannot be published under
 * pit Y, and an ownerless table (vehicle/equipment) can only be published as
 * `platform` (the platform owner decides), never as a pretend organisation.
 */
export function ownerAccepted(record: PublicationRecord, facts: SourceFacts): boolean {
  const realOwner = facts.ownerKey ?? null
  if (realOwner === null) return record.organization_owner === PLATFORM_OWNER
  return record.organization_owner === realOwner
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Build the public DTO. Returns null whenever publication is not fully proven
 * (not live, no name, slug unusable) — callers must treat null as DENY.
 */
export function toPublicItem(
  record: PublicationRecord,
  facts: SourceFacts,
  now: Date = new Date(),
): PublicCatalogItem | null {
  if (!isLive(record, now)) return null
  if (!facts.type) return null
  if (!nonEmpty(record.public_slug)) return null
  // OWNER GATE: the source row must belong to the owner the publication names.
  if (!ownerAccepted(record, facts)) return null

  const name = nonEmpty(facts.name)
  if (!name) return null // a nameless listing is not publishable
  if (!hasField(record, "name")) return null

  const priceAmount =
    hasField(record, "price") && typeof facts.price === "number" && Number.isFinite(facts.price) && facts.price > 0
      ? Math.round(facts.price * 100) / 100
      : null

  const price: PublicPrice | null =
    priceAmount === null
      ? null
      : {
          amount: priceAmount,
          currency: DEFAULT_CURRENCY,
          verified: Boolean(record.verified_by && record.verified_at),
          verified_at: record.verified_at,
          valid_until: record.expires_at,
        }

  const procurement: ProcurementMode =
    hasField(record, "procurement") && facts.procurement
      ? facts.procurement
      : price
        ? "sourced_on_request"
        : "quote_required"

  const availability: "in_stock" | null =
    procurement === "in_stock" &&
    typeof facts.stockQty === "number" &&
    Number.isFinite(facts.stockQty) &&
    facts.stockQty > 0
      ? "in_stock"
      : null

  return {
    slug: record.public_slug,
    type: facts.type,
    name,
    category: hasField(record, "category") ? nonEmpty(facts.category) : null,
    spec: hasField(record, "spec") ? nonEmpty(facts.spec) : null,
    unit: hasField(record, "unit") ? nonEmpty(facts.unit) : null,
    price,
    procurement,
    availability,
    supplier:
      hasField(record, "supplier_name") && nonEmpty(facts.supplierName)
        ? { name: nonEmpty(facts.supplierName) as string }
        : null,
    service_area:
      hasField(record, "service_area") && Array.isArray(facts.serviceArea) && facts.serviceArea.length > 0
        ? facts.serviceArea.map((a) => String(a).trim()).filter((a) => a.length > 0)
        : null,
    // Province/district are the SUPPLIER's own published text, parsed by the
    // same rule the admin control room uses (geography.ts). Never synthesised
    // from ids, never bucketed into a default province.
    province: hasField(record, "service_area") ? nonEmpty(facts.province) : null,
    district: hasField(record, "service_area") ? nonEmpty(facts.district) : null,
    // Coordinates are internal operational data. They are published ONLY when
    // the owner whitelisted `coordinates` for this record AND the source row
    // carries a real, non-zero pair (0/0 = "not set" in pit_profiles).
    coordinates:
      hasField(record, "coordinates") &&
      typeof facts.latitude === "number" &&
      Number.isFinite(facts.latitude) &&
      typeof facts.longitude === "number" &&
      Number.isFinite(facts.longitude) &&
      facts.latitude !== 0 &&
      facts.longitude !== 0
        ? { lat: facts.latitude, lng: facts.longitude }
        : null,
    image_url: hasField(record, "image_url") ? nonEmpty(facts.imageUrl) : null,
    contact_url: hasField(record, "contact_url") ? nonEmpty(facts.contactUrl) : null,
    published_at: record.published_at as string,
    updated_at: nonEmpty(facts.updatedAt) ?? record.updated_at,
    expires_at: record.expires_at,
    provenance: {
      source_table: record.source_table,
      source_record_id: record.source_record_id,
      publication_record_id: record.id,
      verified_by: record.verified_by,
      trace_id: record.trace_id,
    },
  }
}

/** Case/whitespace-insensitive free-text match used by the public search. */
export function matchesQuery(item: PublicCatalogItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    item.name,
    item.category,
    item.spec,
    item.unit,
    item.supplier?.name,
    item.province,
    item.district,
    ...(item.service_area ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}

/**
 * Free-text area filter (the `area` query param). It searches the published
 * service area AND the parsed province/district, because a pit publication no
 * longer carries the raw address as service area.
 */
export function matchesArea(item: PublicCatalogItem, area: string): boolean {
  const a = area.trim().toLowerCase()
  if (!a) return true
  const candidates = [...(item.service_area ?? []), item.province, item.district].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  )
  return candidates.some((s) => s.toLowerCase().includes(a))
}

export function sortByNewest(items: PublicCatalogItem[]): PublicCatalogItem[] {
  return [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
}

/**
 * Strip everything internal from an item before it goes on the wire or into a
 * DOM. This is the ONE place the public payload is shaped; the page and the API
 * both call it, so "what is public" cannot drift between them.
 */
export function toPublicView(item: PublicCatalogItem): PublicCatalogView {
  return {
    slug: item.slug,
    type: item.type,
    name: item.name,
    category: item.category,
    spec: item.spec,
    unit: item.unit,
    price: item.price,
    procurement: item.procurement,
    availability: item.availability,
    supplier: item.supplier,
    service_area: item.service_area,
    province: item.province,
    district: item.district,
    coordinates: item.coordinates,
    image_url: item.image_url,
    contact_url: item.contact_url,
    published_at: item.published_at,
    updated_at: item.updated_at,
    expires_at: item.expires_at,
  }
}

/**
 * Filter options derived from the PUBLISHED set (not from the private source
 * tables), so a dropdown can never reveal a province that has nothing public.
 */
export function buildFacets(items: PublicCatalogItem[]): CatalogFacets {
  const count = (values: (string | null | undefined)[]) => {
    const m = new Map<string, number>()
    for (const v of values) {
      const s = nonEmpty(v)
      if (!s) continue
      m.set(s, (m.get(s) ?? 0) + 1)
    }
    return [...m.entries()]
      .map(([value, n]) => ({ value, count: n }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "th"))
  }

  return {
    provinces: count(items.map((i) => i.province)),
    districts: count(items.map((i) => i.district)),
    types: count(items.map((i) => i.type)),
  }
}
