/**
 * public-catalog-authority-audit — READ-ONLY inspection of the REAL database.
 *
 * Answers, with evidence instead of assumptions:
 *   1. who can actually be identified (profiles + auth.users)
 *   2. which resources have a real owner edge (pit_materials → pit_profiles)
 *      and which have none at all (vehicle_types, equipment_assets)
 *   3. whether any publication row currently names an owner that the source row
 *      does not have (a leak the reader would have to refuse)
 *
 * Writes nothing. Reads no secret business columns (never equipment sim_number /
 * imei / box_password, never pit phone / bank account).
 *
 * Run:
 *   npx tsx scripts/public-catalog-authority-audit.ts
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment (or .env.local).
 */
import { readFileSync } from "node:fs"
import { supabaseAdmin } from "../services/supabase/queries"
import {
  ownershipCensus,
  publicationOwnerAccepted,
  witnessForPitMaterial,
  witnessWithoutOwner,
} from "../core/public-catalog/authority"
import type { SourceTable } from "../core/public-catalog/policy"

function loadEnvLocal() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m) continue
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    /* no .env.local — the caller must provide the variables */
  }
}

function say(label: string, value: unknown) {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
}

async function main() {
  loadEnvLocal()

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("MISSING: SUPABASE_SERVICE_ROLE_KEY — audit needs it to read RLS-protected tables")
    process.exit(2)
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("MISSING: NEXT_PUBLIC_SUPABASE_URL")
    process.exit(2)
  }

  const db = supabaseAdmin()
  const problems: string[] = []

  // ---- 1. identity -----------------------------------------------------------
  const { data: profiles, error: profileError } = await db.from("profiles").select("id, email, role")
  if (profileError) throw new Error(`profiles: ${profileError.message}`)

  const { data: authPage, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (authError) throw new Error(`auth.users: ${authError.message}`)
  const authIds = new Set((authPage?.users ?? []).map((u) => u.id))

  const roles: Record<string, number> = {}
  for (const p of profiles ?? []) roles[p.role] = (roles[p.role] ?? 0) + 1

  console.log("=== 1. ตัวตน (identity)")
  say("profiles.total", profiles?.length ?? 0)
  say("profiles.by_role", roles)
  say("auth.users.total", authIds.size)

  // ---- 2. ownership edges ---------------------------------------------------
  const { data: pits, error: pitError } = await db
    .from("pit_profiles")
    .select("id, pit_name, user_id, line_user_id, deleted_at")
    .is("deleted_at", null)
  if (pitError) throw new Error(`pit_profiles: ${pitError.message}`)

  const withUser = (pits ?? []).filter((p) => p.user_id)
  const resolvable = withUser.filter((p) => authIds.has(p.user_id as string))
  const mockLine = (pits ?? []).filter((p) => typeof p.line_user_id === "string" && /^U-(Mock|demo)/i.test(p.line_user_id))

  console.log("")
  console.log("=== 2. เจ้าขององค์กร ↔ ทรัพยากรเดิม")
  say("ownership_census", ownershipCensus())
  say("pit_profiles.live", pits?.length ?? 0)
  say("pit_profiles.with_user_id", withUser.length)
  say("pit_profiles.user_id_resolves_to_auth_user", resolvable.length)
  say("pit_profiles.placeholder_line_ids", mockLine.length)
  if (withUser.length > resolvable.length) {
    problems.push(
      `pit_profiles ${withUser.length - resolvable.length} แถวอ้าง user_id ที่ไม่มีใน auth.users — เจ้าของยังตรวจสอบไม่ได้`,
    )
  }

  const tables: SourceTable[] = ["pit_materials", "vehicle_types", "equipment_assets"]
  const counts: Record<string, number> = {}
  for (const table of tables) {
    let query = db.from(table).select("id", { count: "exact", head: true })
    if (table !== "equipment_assets") query = query.is("deleted_at", null)
    const { count, error } = await query
    if (error) throw new Error(`${table}: ${error.message}`)
    counts[table] = count ?? 0
  }
  say("source_rows", counts)

  // ---- 3. publication registry + owner cross-check ---------------------------
  console.log("")
  console.log("=== 3. ตารางเผยแพร่ (publication_records)")

  const { data: pubs, error: pubError } = await db
    .from("publication_records")
    .select("id, source_table, source_record_id, organization_owner, status, allowed_public_fields, public_slug")
    .limit(1000)

  if (pubError) {
    const missing = pubError.code === "PGRST205" || /publication_records/.test(pubError.message)
    say("publication_records", missing ? "MISSING — ยังไม่ได้ apply migration 20261024000002" : pubError.message)
    if (!missing) problems.push(`publication_records อ่านไม่ได้: ${pubError.message}`)
  } else {
    const byStatus: Record<string, number> = {}
    for (const p of pubs ?? []) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1
    say("publication_records.total", pubs?.length ?? 0)
    say("publication_records.by_status", byStatus)

    // Re-derive the owner of every published row and compare.
    for (const pub of pubs ?? []) {
      if (pub.source_table !== "pit_materials") continue
      const { data: pm } = await db
        .from("pit_materials")
        .select("id, pit_profile_id, deleted_at")
        .eq("id", pub.source_record_id)
        .maybeSingle()
      if (!pm) {
        problems.push(`publication ${pub.public_slug}: ไม่พบแถวต้นทาง pit_materials ${pub.source_record_id}`)
        continue
      }
      const { data: pit } = await db
        .from("pit_profiles")
        .select("id, user_id")
        .eq("id", pm.pit_profile_id)
        .maybeSingle()
      const witness = witnessForPitMaterial({
        source_record_id: pm.id,
        pit_profile_id: pm.pit_profile_id,
        pit_user_id: pit?.user_id ?? null,
      })
      if (!publicationOwnerAccepted(pub, witness)) {
        problems.push(
          `publication ${pub.public_slug}: owner "${pub.organization_owner}" ≠ เจ้าของจริง "${witness.owner_key}" — reader จะ DENY`,
        )
      }
    }

    for (const pub of pubs ?? []) {
      if (pub.source_table === "pit_materials") continue
      const witness = witnessWithoutOwner(pub.source_table as SourceTable, pub.source_record_id)
      if (!publicationOwnerAccepted(pub, witness)) {
        problems.push(
          `publication ${pub.public_slug}: ตาราง ${pub.source_table} ไม่มีคอลัมน์เจ้าของ แต่ระบุ "${pub.organization_owner}" (ต้องเป็น platform)`,
        )
      }
    }
  }

  // ---- 4. verdict ------------------------------------------------------------
  console.log("")
  const livePriced = (pits ?? []).filter((p) => p.id).length
  console.log("=== 4. สรุปสิทธิ์ของ Writer")
  console.log(
    `operator writer: ไม่มีผู้ประกอบการที่ตรวจสอบได้ (${resolvable.length} บัญชีผูกกับบ่อจริง) → มีแต่ publication.admin`,
  )
  console.log(`pit พร้อมเผยแพร่ได้จริง: ${livePriced} บ่อ (มีราคา ${counts.pit_materials ?? 0} แถว)`)

  if (problems.length > 0) {
    console.log("")
    console.log(`PROBLEMS (${problems.length}):`)
    for (const p of problems) console.log(`  - ${p}`)
    process.exit(1)
  }
  console.log("")
  console.log("AUDIT PASS — ไม่พบ publication ที่อ้างเจ้าของผิด")
}

main().catch((err) => {
  console.error("AUDIT FAILED:", err instanceof Error ? err.message : err)
  process.exit(1)
})
