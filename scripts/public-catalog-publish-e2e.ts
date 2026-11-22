/**
 * public-catalog-e2e — ONE real price, from its source row to the public reader.
 *
 *   npx tsx scripts/public-catalog-publish-e2e.ts            # dry run (default)
 *   npx tsx scripts/public-catalog-publish-e2e.ts --apply    # write + verify
 *
 * What it proves when --apply succeeds:
 *   pit_materials (real price) → publication_records (per-item permission)
 *     → services/public-catalog/reader.readPublicItem (the exact function the
 *       website page uses) → the published amount equals the source amount.
 *
 * What it deliberately does NOT do:
 *   - it never creates a table. The registry comes from
 *     supabase/migrations/20261024000002_public_publication_registry.sql, which
 *     the owner applies in an approved window;
 *   - it does not claim the price was verified by a human: verified_by stays
 *     null, so the public page shows the price without the "ตรวจสอบแล้ว" badge
 *     until a real person confirms it in /admin/pits;
 *   - it publishes exactly ONE row and prints it, never a batch.
 */
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { supabaseAdmin } from "../services/supabase/queries"
import { publicSlugFor, witnessForPitMaterial } from "../core/public-catalog/authority"
import { pitOwnerKey } from "../core/public-catalog/policy"
import { readPublicItem } from "../services/public-catalog/reader"

const APPLY = process.argv.includes("--apply")
const argId = (() => {
  const i = process.argv.indexOf("--id")
  return i > -1 ? process.argv[i + 1] : null
})()

/** Who authorized publication — recorded, never invented from the account. */
const AUTHORIZED_BY = (() => {
  const i = process.argv.indexOf("--authorized-by")
  return i > -1 ? process.argv[i + 1] : "public-catalog-e2e"
})()

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    /* caller provides the variables */
  }
}

async function main() {
  loadEnvLocal()
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("MISSING: SUPABASE_SERVICE_ROLE_KEY")
    process.exit(2)
  }

  const db = supabaseAdmin()

  // ---- 1. pick ONE real price row (and its plant) ---------------------------
  let priceQuery = db
    .from("pit_materials")
    .select("id, pit_profile_id, material_type_id, price, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
  if (argId) priceQuery = priceQuery.eq("id", argId)

  const { data: prices, error: priceError } = await priceQuery
  if (priceError) throw new Error(`pit_materials: ${priceError.message}`)
  const price = (prices ?? [])[0]
  if (!price) {
    console.error("ไม่พบแถวราคาจริงใน pit_materials — ไม่มีอะไรให้ทดสอบ")
    process.exit(1)
  }

  const [{ data: pit }, { data: material }] = await Promise.all([
    db.from("pit_profiles").select("id, pit_name, user_id, deleted_at").eq("id", price.pit_profile_id).maybeSingle(),
    db.from("material_types").select("id, name").eq("id", price.material_type_id).maybeSingle(),
  ])
  if (!pit || pit.deleted_at) {
    console.error("บ่อของราคานี้ถูกลบ/ไม่พบ — เผยแพร่ไม่ได้ (เจ้าของหาย)")
    process.exit(1)
  }

  const ownerKey = pitOwnerKey(pit.id)
  const slug = publicSlugFor("pit_materials", price.id, pit.id)
  const witness = witnessForPitMaterial({
    source_record_id: price.id,
    pit_profile_id: pit.id,
    pit_user_id: pit.user_id ?? null,
  })

  console.log("=== 1. ต้นทาง (source)")
  console.log(`  pit_materials   ${price.id}`)
  console.log(`  วัสดุ           ${material?.name ?? "(ไม่พบชื่อ)"}`)
  console.log(`  ราคา            ${price.price} THB (updated_at ${price.updated_at ?? "—"})`)
  console.log(`  บ่อ             ${pit.pit_name} (${pit.id})`)
  console.log(`  owner key       ${ownerKey}`)
  console.log(`  public slug     ${slug}`)
  console.log(
    `  identity        ${witness.identity_user_id ? witness.identity_user_id + " (ยังไม่ยืนยันว่ามีใน auth.users)" : "ไม่มี (pit_profiles.user_id ว่าง)"}`,
  )

  // ---- 2. is the publication registry ready? -------------------------------
  console.log("")
  console.log("=== 2. ทะเบียนเผยแพร่ (publication_records)")
  // A real select (not head:true) — a HEAD request does not surface PostgREST's
  // "table missing" error, which would make this script claim the registry is
  // ready while it does not exist.
  const probe = await db.from("publication_records").select("id").limit(1)
  if (probe.error) {
    const missing = probe.error.code === "PGRST205" || /publication_records/.test(probe.error.message)
    console.log(missing ? "  MISSING — ยังไม่ได้ apply migration" : `  ERROR ${probe.error.message}`)
    console.log("")
    console.log("จะทดสอบ end-to-end จริงได้หลัง apply เฉพาะไฟล์นี้ (additive, rollback = drop table):")
    console.log("  supabase/migrations/20261024000002_public_publication_registry.sql")
    console.log("แล้วรันซ้ำ: npx tsx scripts/public-catalog-publish-e2e.ts --apply")
    process.exit(1)
  }

  if (!APPLY) {
    console.log("  พร้อม — dry run เท่านั้น (ยังไม่เขียนอะไร) ใช้ --apply เพื่อเผยแพร่จริง")
    console.log("")
    console.log("จะเขียน 1 แถว:")
    console.log(
      JSON.stringify(
        {
          source_table: "pit_materials",
          source_record_id: price.id,
          organization_owner: ownerKey,
          allowed_public_fields: ["name", "price", "supplier_name", "service_area"],
          status: "published",
          public_slug: slug,
          verified_by: null,
        },
        null,
        2,
      ),
    )
    return
  }

  // ---- 3. write the ONE permission row -------------------------------------
  const now = new Date().toISOString()
  // One trace id for the whole act: the permission row and its audit event must
  // be joinable after the fact (the publish event used to carry trace_id = null).
  const traceId = randomUUID()
  const row = {
    source_table: "pit_materials",
    source_record_id: price.id,
    organization_owner: ownerKey,
    allowed_public_fields: ["name", "price", "supplier_name", "service_area"],
    status: "published",
    authorized_by: AUTHORIZED_BY,
    verified_by: null,
    verified_at: null,
    published_at: now,
    expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    public_slug: slug,
    public_url: `/products/${slug}`,
    updated_at: now,
    trace_id: traceId,
    evidence: {
      actor: "public-catalog-e2e",
      authorized_by: AUTHORIZED_BY,
      source: "pit_materials",
      price_at_publish: price.price,
      operator_identity_verified: false,
      authority: `verified resource-owner publication — operator identity: ${
        witness.identity_user_id ? `${witness.identity_user_id} (ยังไม่ยืนยันว่ามีใน auth.users)` : "ไม่มีใน pit_profiles.user_id"
      }`,
    },
  }

  const { data: existing } = await db
    .from("publication_records")
    .select("id")
    .eq("source_table", "pit_materials")
    .eq("source_record_id", price.id)
    .maybeSingle()

  const write = existing
    ? await db.from("publication_records").update(row).eq("id", existing.id).select("id").single()
    : await db.from("publication_records").insert(row).select("id").single()

  if (write.error) {
    console.error("เขียน publication_records ไม่สำเร็จ:", write.error.message)
    process.exit(1)
  }
  // Append-only evidence trail — the same shape the admin writer records, so a
  // row created by this acceptance script is not less auditable than one created
  // through /api/admin/publications.
  const event = await db.from("publication_events").insert({
    publication_record_id: write.data.id,
    from_status: existing ? "published" : null,
    to_status: "published",
    actor: AUTHORIZED_BY,
    reason: "public_catalog_e2e_publish",
    evidence: {
      actor: "public-catalog-e2e",
      source: "pit_materials",
      price_at_publish: price.price,
      authorized_by: AUTHORIZED_BY,
    },
    trace_id: traceId,
  })

  console.log("")
  console.log(`=== 3. เขียน permission แล้ว (${write.data.id})`)
  console.log(`  audit event: ${event.error ? `FAILED — ${event.error.message}` : "เขียนแล้ว"}`)

  // ---- 4. read it back through the SAME function the website uses ----------
  const published = await readPublicItem(slug)
  console.log("")
  console.log("=== 4. อ่านกลับผ่าน reader จริง (readPublicItem)")
  if (!published) {
    console.error("  FAIL — reader ไม่คืนรายการนี้ (เจ้าของไม่ตรง / หมดอายุ / ฟิลด์ไม่ครบ)")
    process.exit(1)
  }
  const okPrice = published.price?.amount === Number(price.price)
  const okSupplier = !pit.pit_name || published.supplier?.name === pit.pit_name
  console.log(`  ${okPrice ? "PASS" : "FAIL"} ราคาที่เว็บจะแสดง = ${published.price?.amount} THB (ต้นทาง ${price.price})`)
  console.log(`  ${okSupplier ? "PASS" : "FAIL"} ผู้ขาย = ${published.supplier?.name ?? "—"}`)
  console.log(`  ${published.slug === slug ? "PASS" : "FAIL"} slug = ${published.slug}`)
  console.log(`  URL เว็บ: /products/${published.slug}`)

  if (!okPrice || !okSupplier) process.exit(1)
  console.log("")
  console.log("PASS — ราคาจริง 1 รายการเดินครบเส้นทาง ต้นทาง → สิทธิ์เผยแพร่ → reader สาธารณะ")
}

main().catch((err) => {
  console.error("E2E FAILED:", err instanceof Error ? err.message : err)
  process.exit(1)
})
