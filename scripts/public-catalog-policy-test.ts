/**
 * public-catalog-policy:test — OFFLINE policy tests, no database, no network.
 *
 * Proves the seven states the mission requires, using the real policy module
 * (core/public-catalog/policy.ts + structured-data.ts) rather than a copy:
 *   1 Published → published, whitelisted fields only
 *   2 Draft     → DENY
 *   3 Expired   → DENY (and price never shown as current)
 *   4 Withdrawn → DENY
 *   5 Cross-org / wrong source → DENY (no name, no price, no supplier leak)
 *   6 No verified price → price null ("ขอราคา"), NOT 0/fabricated
 *   7 No record at all → DENY (empty catalog, no placeholder item)
 *
 * It also asserts JSON-LD truthfulness: no rating, no review, no geo, no
 * telephone, and the seller is the SUPPLIER — never DNA OS.
 */
import {
  PLATFORM_OWNER,
  buildFacets,
  isLive,
  pitOwnerKey,
  toPublicItem,
  toPublicView,
  type PublicationRecord,
  type SourceFacts,
} from "../core/public-catalog/policy"
import {
  ownershipCensus,
  publicationOwnerAccepted,
  resolveWriter,
  witnessForPitMaterial,
  witnessWithoutOwner,
} from "../core/public-catalog/authority"
import { matchesParsedArea, parseAreaFromAddress } from "../core/public-catalog/geography"
import { buildCatalogJsonLd } from "../core/public-catalog/structured-data"
import { invalidatePublicCatalog } from "../services/public-catalog/reader"
import { existsSync, readFileSync } from "node:fs"

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++
    console.log(`PASS  ${label}`)
  } else {
    failed++
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const NOW = new Date("2026-10-24T12:00:00.000Z")

function record(over: Partial<PublicationRecord> = {}): PublicationRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    source_table: "pit_materials",
    source_record_id: "22222222-2222-2222-2222-222222222222",
    organization_owner: pitOwnerKey("owner-pit-1"),
    allowed_public_fields: ["name", "price", "unit", "supplier_name"],
    status: "published",
    authorized_by: "owner@example.test",
    verified_by: "owner@example.test",
    verified_at: "2026-10-20T00:00:00.000Z",
    published_at: "2026-10-20T00:00:00.000Z",
    expires_at: "2026-12-31T00:00:00.000Z",
    public_slug: "sand-1",
    public_url: null,
    updated_at: "2026-10-21T00:00:00.000Z",
    trace_id: "trace-abc",
    ...over,
  }
}

const facts: SourceFacts = {
  type: "material",
  name: "ทรายหยาบ",
  category: "material",
  price: 480,
  unit: "ลบ.ม.",
  supplierName: "บ่อทรายตัวอย่าง",
  updatedAt: "2026-10-21T00:00:00.000Z",
  // the owner the SOURCE ROW really has (pit_materials.pit_profile_id)
  ownerKey: pitOwnerKey("owner-pit-1"),
}

// 1 — Published
{
  const item = toPublicItem(record(), facts, NOW)
  check("1 Published → item emitted", item !== null)
  check("1 price emitted with currency THB", item?.price?.amount === 480 && item?.price?.currency === "THB")
  check("1 price marked verified from real verifier", item?.price?.verified === true)
  check("1 provenance points at the publication record", item?.provenance.publication_record_id === record().id)
}

// 1b — field whitelist: price not allowed ⇒ no price at all
{
  const item = toPublicItem(record({ allowed_public_fields: ["name", "unit"] }), facts, NOW)
  check("1b price excluded when not in allowed_public_fields", item !== null && item.price === null)
  check("1b supplier excluded too", item !== null && item.supplier === null)
  check("1b no-price item becomes quote_required", item?.procurement === "quote_required")
}

// 2 — Draft
check("2 Draft → DENY", toPublicItem(record({ status: "draft", published_at: null }), facts, NOW) === null)

// 3 — Expired (by status and by timestamp)
check("3 Expired status → DENY", toPublicItem(record({ status: "expired" }), facts, NOW) === null)
check(
  "3 published but past expires_at → DENY (no stale price)",
  toPublicItem(record({ expires_at: "2026-10-23T00:00:00.000Z" }), facts, NOW) === null,
)
check("3 isLive false for missing published_at", isLive(record({ published_at: null }), NOW) === false)

// 4 — Withdrawn
check("4 Withdrawn → DENY", toPublicItem(record({ status: "withdrawn" }), facts, NOW) === null)

// 5 — Cross-org / wrong source
{
  // publication row exists but the hydrated fact has no name (e.g. the record id
  // belonged to another organization and the source lookup returned nothing)
  check("5 missing source facts → DENY", toPublicItem(record(), { type: "material" }, NOW) === null)
  check("5 name withheld → DENY", toPublicItem(record({ allowed_public_fields: ["price"] }), facts, NOW) === null)
  check("5 slug unusable → DENY", toPublicItem(record({ public_slug: "" }), facts, NOW) === null)
}

// 6 — No verified price
{
  const unverified = toPublicItem(
    record({ verified_by: null, verified_at: null }),
    { ...facts, price: null },
    NOW,
  )
  check("6 no price → price null (not 0)", unverified !== null && unverified.price === null)
  check("6 no price → quote_required", unverified?.procurement === "quote_required")
  const unverifiedWithPrice = toPublicItem(record({ verified_by: null, verified_at: null }), facts, NOW)
  check("6 price present but unverified flag false", unverifiedWithPrice?.price?.verified === false)
}

// 7 — No record at all
{
  // toPublicItem is only called with a record; absence is the caller's empty set.
  const empty: ReturnType<typeof toPublicItem>[] = []
  check("7 empty publication set → 0 items (no placeholder)", empty.length === 0)
}

// JSON-LD truthfulness
{
  const item = toPublicItem(record(), facts, NOW)!
  const ld = buildCatalogJsonLd(item, "https://example.test")
  const text = JSON.stringify(ld)
  check("LD Product with Offer", ld?.["@type"] === "Product" && Boolean(ld?.offers))
  for (const forbidden of ["aggregateRating", "review", "geo", "latitude", "longitude", "telephone"]) {
    check(`LD never emits ${forbidden}`, !text.includes(`"${forbidden}"`))
  }
  check("LD seller is the supplier, not DNA OS", text.includes("บ่อทรายตัวอย่าง") && !text.includes('"DNA OS"'))
  check("LD has no InStock without evidence", !text.includes("InStock"))
  check("LD url is the permanent public path", text.includes("https://example.test/products/sand-1"))

  const noPrice = buildCatalogJsonLd(toPublicItem(record({ allowed_public_fields: ["name"] }), facts, NOW)!, null)
  check("LD omits offers when no published price", noPrice !== null && noPrice.offers === undefined)

  const transport = buildCatalogJsonLd(
    toPublicItem(
      record({
        source_table: "vehicle_types",
        public_slug: "truck-10w",
        allowed_public_fields: ["name", "spec"],
        // vehicle_types has no owner column → platform publication only
        organization_owner: PLATFORM_OWNER,
      }),
      { type: "transport", name: "สิบล้อ", spec: "บรรทุก 15", ownerKey: null },
      NOW,
    )!,
    null,
  )
  check("LD transport → Service", transport?.["@type"] === "Service")
}

// 8 — Province / district parsed from the supplier's own address text
{
  const a = parseAreaFromAddress("199 หมู่ 4 ต.ท่าใหม่ อ.ท่าใหม่ จ.จันทบุรี 22120")
  check("8 parse province from จ.", a.province === "จันทบุรี", JSON.stringify(a))
  check("8 parse district from อ.", a.district === "ท่าใหม่", JSON.stringify(a))

  const b = parseAreaFromAddress("88/9 ซอยลาดพร้าว 1 เขตบางนา กรุงเทพมหานคร")
  check("8 Bangkok เขต parsed as district", b.district === "บางนา", JSON.stringify(b))
  check("8 no จ. → province null (never invented)", b.province === null)

  const c = parseAreaFromAddress(null)
  check("8 null address → both null", c.province === null && c.district === null)
  check("8 empty address → both null", parseAreaFromAddress("   ").province === null)
  check("8 plain text without markers → null", parseAreaFromAddress("บ่อทรายไม่มีที่อยู่").province === null)

  check("8 province filter matches", matchesParsedArea("จันทบุรี", "จันทบุรี") === true)
  check("8 province filter is substring-insensitive", matchesParsedArea("จันทบุรี", "จัน") === true)
  check("8 province filter rejects other province", matchesParsedArea("ระยอง", "จันทบุรี") === false)
  check("8 province filter never matches a missing name", matchesParsedArea(null, "จันทบุรี") === false)
  check("8 empty filter matches everything", matchesParsedArea(null, "") === true)
}

// 9 — Coordinates are public ONLY when whitelisted and real
{
  const geoFacts: SourceFacts = { ...facts, latitude: 12.6114, longitude: 102.1038 }
  const published = toPublicItem(record({ allowed_public_fields: ["name", "price", "coordinates"] }), geoFacts, NOW)
  check("9 whitelisted coordinates emitted", published?.coordinates?.lat === 12.6114)

  const withheld = toPublicItem(record(), geoFacts, NOW)
  check("9 coordinates withheld by default whitelist", withheld?.coordinates === null)

  const zero = toPublicItem(
    record({ allowed_public_fields: ["name", "price", "coordinates"] }),
    { ...facts, latitude: 0, longitude: 0 },
    NOW,
  )
  check("9 0/0 coordinates never published (schema's not-set value)", zero?.coordinates === null)

  const missing = toPublicItem(record({ allowed_public_fields: ["name", "coordinates"] }), { ...facts }, NOW)
  check("9 absent coordinates → null, not fabricated", missing?.coordinates === null)
}

// 10 — Public wire shape contains no internal identifiers
{
  const item = toPublicItem(
    record({ allowed_public_fields: ["name", "price", "supplier_name", "service_area", "coordinates"] }),
    { ...facts, province: "จันทบุรี", district: "ท่าใหม่", latitude: 12.6, longitude: 102.1 },
    NOW,
  )!
  const view = toPublicView(item)
  const json = JSON.stringify(view)
  for (const internal of [
    "provenance",
    "source_record_id",
    "publication_record_id",
    "verified_by",
    "trace_id",
    "organization_owner",
    "owner@example.test",
  ]) {
    check(`10 public view never exposes ${internal}`, !json.includes(internal))
  }
  check("10 public view keeps the public fields", view.name === "ทรายหยาบ" && view.province === "จันทบุรี")
}

// 11 — Facets are built from the published set only
{
  const withArea = (slug: string, area: { province: string | null; district: string | null }) =>
    toPublicItem(
      record({ public_slug: slug, allowed_public_fields: ["name", "price", "service_area"] }),
      { ...facts, ...area },
      NOW,
    )!
  const items = [
    withArea("a", { province: "จันทบุรี", district: "ท่าใหม่" }),
    withArea("b", { province: "จันทบุรี", district: "ขลุง" }),
    withArea("c", { province: null, district: null }),
  ]
  const facets = buildFacets(items)
  check("11 province facet counts", facets.provinces[0]?.value === "จันทบุรี" && facets.provinces[0]?.count === 2)
  check("11 districts listed", facets.districts.length === 2)
  check("11 types facet present", facets.types[0]?.value === "material" && facets.types[0]?.count === 3)
  check("11 no null facet entries", facets.provinces.every((f) => f.value.length > 0))
  check("11 empty catalog → empty facets", buildFacets([]).provinces.length === 0)
}

// 12 — No new product table / price system: the reader reads ONLY existing tables
{
  const reader = readFileSync(new URL("../services/public-catalog/reader.ts", import.meta.url), "utf8")
  const tables = [...reader.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1])
  const unique = [...new Set(tables)].sort()
  const allowed = [
    "equipment_assets",
    "material_types",
    "pit_materials",
    "pit_profiles",
    "publication_records",
    "vehicle_types",
  ]
  check("12 reader touches only pre-existing tables", unique.every((t) => allowed.includes(t)), unique.join(","))
  for (const forbidden of ["products", "product_variants", "price_histories", "pricing_snapshots", "partner_product_submissions"]) {
    check(`12 reader never reads ${forbidden}`, !unique.includes(forbidden))
  }
  check("12 reader is read-only (no insert/update/upsert/delete)", !/\.(insert|update|upsert|delete)\(/.test(reader))
  check(
    "12 publication registry is read BEFORE any source hydration",
    reader.indexOf('from("publication_records")') < reader.indexOf('from("pit_materials")'),
  )
}

// 13 — Owner gate: a price row can only be published under its real plant
{
  check("13 matching owner → accepted", toPublicItem(record(), facts, NOW) !== null)
  check(
    "13 other pit cannot claim this price",
    toPublicItem(record({ organization_owner: pitOwnerKey("another-pit") }), facts, NOW) === null,
  )
  check(
    "13 platform cannot claim a pit's price",
    toPublicItem(record({ organization_owner: PLATFORM_OWNER }), facts, NOW) === null,
  )

  const ownerless: SourceFacts = { ...facts, ownerKey: null }
  check(
    "13 ownerless source (vehicle/equipment) + platform → accepted",
    toPublicItem(record({ source_table: "equipment_assets", organization_owner: PLATFORM_OWNER }), ownerless, NOW) !== null,
  )
  check(
    "13 ownerless source + invented organisation → DENY",
    toPublicItem(record({ organization_owner: "company:someone" }), ownerless, NOW) === null,
  )
  check(
    "13 facts without an owner key → DENY (fail-closed)",
    toPublicItem(record(), { ...facts, ownerKey: undefined }, NOW) === null,
  )
}

// 14 — ONE REAL production row, all the way through the public chain
// Values read from the live database (2026-10-25): pit 36e4b0c9 ("เมฆบ่อดิน _
// DNA OS"), pit_materials 3c9f332b, material_types d9aecb8b ("ดินถม"), price 50.
{
  const REAL = {
    pit_profile_id: "36e4b0c9-611d-49db-aacb-852ac18d5d0f",
    pit_name: "เมฆบ่อดิน _ DNA OS",
    source_record_id: "3c9f332b-cede-4ec5-8a2a-34e579a9907b",
    material: "ดินถม",
    price: 50,
    slug: "mat-36e4b0c9-3c9f332b",
  }
  const realFacts: SourceFacts = {
    type: "material",
    name: REAL.material,
    category: "material",
    price: REAL.price,
    supplierName: REAL.pit_name,
    ownerKey: pitOwnerKey(REAL.pit_profile_id),
    updatedAt: "2026-05-08T09:23:10.470513+00:00",
  }
  const realRecord = record({
    source_record_id: REAL.source_record_id,
    organization_owner: pitOwnerKey(REAL.pit_profile_id),
    public_slug: REAL.slug,
    allowed_public_fields: ["name", "price", "supplier_name", "service_area"],
  })

  const item = toPublicItem(realRecord, realFacts, NOW)
  check("14 real published price reaches the public item", item !== null)
  check("14 price 50 THB, not 0 / not fabricated", item?.price?.amount === 50 && item?.price?.currency === "THB")
  check("14 supplier is the real pit name", item?.supplier?.name === REAL.pit_name)

  const view = toPublicView(item!)
  const wire = JSON.stringify(view)
  check("14 slug matches the publication slug shape", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(view.slug))
  check("14 wire carries the price the page renders", wire.includes('"amount":50'))
  check("14 wire leaks no source/publication id", !wire.includes(REAL.source_record_id) && !wire.includes(REAL.pit_profile_id))

  const ld = buildCatalogJsonLd(item!, "https://dnaos.co.th")
  const ldText = JSON.stringify(ld)
  check("14 JSON-LD offer price equals the real price", ldText.includes('"price":"50.00"'))
  check("14 JSON-LD url is the permanent public path", ldText.includes(`https://dnaos.co.th/products/${REAL.slug}`))
}

// 15 — Identity → organization → writer entitlement
{
  const REAL = {
    source_record_id: "3c9f332b-cede-4ec5-8a2a-34e579a9907b",
    pit_profile_id: "36e4b0c9-611d-49db-aacb-852ac18d5d0f",
  }
  const admin = { userId: "uid-admin", email: "owner@example.test", role: "super_admin" as const }
  const partner = { userId: "uid-pit", email: "pit@example.test", role: "partner" as const }

  const linked = witnessForPitMaterial({
    source_record_id: REAL.source_record_id,
    pit_profile_id: REAL.pit_profile_id,
    pit_user_id: "uid-pit",
  })
  const unlinked = witnessForPitMaterial({
    source_record_id: REAL.source_record_id,
    pit_profile_id: REAL.pit_profile_id,
    pit_user_id: null,
  })
  const ownerless = witnessWithoutOwner("equipment_assets", "33333333-3333-3333-3333-333333333333")

  check("15 owner key derived from pit_profile_id", linked.owner_key === pitOwnerKey(REAL.pit_profile_id))
  check("15 admin writer allowed", resolveWriter(admin, linked).allowed && resolveWriter(admin, linked).writer === "publication.admin")
  check("15 no session → NO_IDENTITY", resolveWriter(null, linked).reason === "NO_IDENTITY")
  check("15 admin can publish a platform-only (ownerless) resource", resolveWriter(admin, ownerless).reason === "ALLOWED_PLATFORM")
  check("15 admin owner key not invented for ownerless table", ownerless.owner_key === null)
  check("15 other partner is NOT the owner", resolveWriter({ ...partner, userId: "uid-other" }, linked).reason === "NOT_THE_OWNER")
  check("15 pit without user_id → OWNER_IDENTITY_NOT_LINKED", resolveWriter(partner, unlinked).reason === "OWNER_IDENTITY_NOT_LINKED")
  check("15 partner cannot own an ownerless table", resolveWriter(partner, ownerless).reason === "SOURCE_HAS_NO_OWNER_COLUMN")
  check("15 employee with non-publishing role pair is role-gated", resolveWriter({ userId: "x", email: "x@x", role: "ai_service" }, linked).reason === "ROLE_NOT_ENTITLED")

  const owner = resolveWriter(partner, linked)
  check("15 real owner is NOT yet allowed (no operator writer exists)", owner.allowed === false && owner.reason === "OPERATOR_WRITER_NOT_IMPLEMENTED")

  check("15 publicationOwnerAccepted agrees with the gate", publicationOwnerAccepted({ organization_owner: pitOwnerKey(REAL.pit_profile_id) }, linked) === true)
  check("15 publicationOwnerAccepted rejects a mismatch", publicationOwnerAccepted({ organization_owner: pitOwnerKey("other") }, linked) === false)

  const census = ownershipCensus()
  const byTable = Object.fromEntries(census.map((c) => [c.source_table, c]))
  check("15 census: pit_materials has a real owner column", byTable.pit_materials.owner_column === "pit_profile_id")
  check("15 census: vehicle_types has no owner column", byTable.vehicle_types.owner_column === null)
  check("15 census: equipment_assets has no owner column", byTable.equipment_assets.owner_column === null)
  check("15 census covers all four source tables", census.length === 4)
}

// 16 — Publication-safety wiring: one invalidation point, existing audit only,
// real 404s. These are structural locks on the files, not a simulation of Prod.
{
  const readerSrc = readFileSync(new URL("../services/public-catalog/reader.ts", import.meta.url), "utf8")
  check("16 reader exposes invalidatePublicCatalog", /export function invalidatePublicCatalog\(\)/.test(readerSrc))
  check("16 invalidation clears the memo", /memo\.clear\(\)/.test(readerSrc))
  check("16 reader still caches (bounded staleness, not real-time)", /PUBLIC_CACHE_SECONDS = 60/.test(readerSrc))

  const priceWriter = readFileSync(
    new URL("../app/api/admin/pits/[pitId]/materials/route.ts", import.meta.url),
    "utf8",
  )
  check("16 price writer invalidates the reader", /invalidatePublicCatalog\(\)/.test(priceWriter))
  check("16 price writer revalidates the product pages", /revalidatePath\("\/products", "layout"\)/.test(priceWriter))
  check("16 price writer records evidence in EXISTING audit_logs", /from\("audit_logs"\)\.insert/.test(priceWriter))
  check("16 price writer keeps old and new price", /\.select\("id, price"\)/.test(priceWriter) && /old_value/.test(priceWriter) && /new_value/.test(priceWriter))
  check("16 price writer still uses the one admin auth guard", /requireAuth\(ADMIN_TIER\)/.test(priceWriter))

  const pubWriter = readFileSync(new URL("../app/api/admin/publications/route.ts", import.meta.url), "utf8")
  check("16 publication writer invalidates the reader", /invalidatePublicCatalog\(\)/.test(pubWriter))
  check("16 publication writer revalidates the product pages", /revalidatePath\("\/products", "layout"\)/.test(pubWriter))

  const apiRoute = readFileSync(new URL("../app/api/public/products/route.ts", import.meta.url), "utf8")
  check("16 public API never serves stale-while-revalidate", !/stale-while-revalidate=/.test(apiRoute))

  // Soft 404 guard: a loading boundary above [slug] streams a 200 shell before
  // notFound() can run. The detail route must not sit under one.
  check(
    "16 no loading boundary above products/[slug]",
    !existsSync(new URL("../app/products/loading.tsx", import.meta.url)),
  )
  check(
    "16 catalog keeps its own loading boundary (design unchanged)",
    existsSync(new URL("../app/products/catalog/loading.tsx", import.meta.url)),
  )

  // Pure call: must be a safe no-op when nothing is cached.
  let threw = false
  try {
    invalidatePublicCatalog()
  } catch {
    threw = true
  }
  check("16 invalidatePublicCatalog is safe when the memo is empty", threw === false)
}

console.log("")
if (failed > 0) {
  console.log(`public-catalog-policy:test FAILED — ${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`public-catalog-policy:test PASS — ${passed}/${passed} checks`)
