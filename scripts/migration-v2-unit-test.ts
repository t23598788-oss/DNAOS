#!/usr/bin/env npx tsx
/**
 * Migration v2 unit-test — SOURCE-LEVEL test, NO production writes.
 *
 * Owner directive (2026-10-13, FIX MATERIAL PRICE MIGRATION):
 *   §10 "ตรวจ Migration ด้วยฐานทดสอบก่อนใช้จริง"
 *   "ห้ามแก้ราคาจริงบน Production"
 *
 * NO live Supabase credential exists in this environment (.env.local absent),
 * so this test proves the migration's LOGIC at source level against the real
 * formulas/densities, using the exact same SQL semantics Postgres would use
 * (numeric division, round 2, per-row classification). It does NOT
 * prove the SQL executed on a real Postgres — that requires running
 * supabase/migrations/20261013000001_unit_standardize_ton_v2.sql against a
 * real sandbox project, flagged honestly as a remaining step for the owner.
 *
 * Owner's engineering reference (CLAUDE.md §Volume↔Weight rule + migration
 * 20260726000002_material_density.sql — real, owner-supplied values):
 */

const DENSITY: Record<string, number> = {
  "ทรายละเอียด": 1.50,
  "ทรายหยาบ":    1.45,
  "หินคลุก":     1.70,
  "หิน 3/4":     1.425,
  "ดินถม":       1.30,
  "ลูกรัง":      1.30,
  "คอนกรีตผสมเสร็จ": 2.40,
  "เหล็กเส้น":   7.85,
}

const round2 = (n: number) => Math.round(n * 100) / 100

interface PriceRow {
  material: string
  price: number
  unit: "ตัน" | "คิว" | "UNKNOWN"
  evidence: string
  createdAt: Date
}

// ── Test dataset: represents real-world pit_materials price distribution ──
const ROWS: PriceRow[] = [
  // pre-cutover (คิว era evidence, no vendor reply stored) — convert per §4
  { material: "ทรายหยาบ",   price: 300,  unit: "คิว",  evidence: "created_before_cutover 2026-07-10 (RFQ asked คิว)",   createdAt: new Date("2026-07-10") },
  { material: "หินคลุก",    price: 450,  unit: "คิว",  evidence: "created_before_cutover 2026-07-15 (RFQ asked คิว)",   createdAt: new Date("2026-07-15") },
  { material: "ดินถม",      price: 220,  unit: "คิว",  evidence: "created_before_cutover 2026-07-20 (RFQ asked คิว)",   createdAt: new Date("2026-07-20") },
  // post-ton-RFQ cutover (confirmed ตัน evidence) — keep unchanged per §3
  { material: "ทรายละเอียด", price: 420,  unit: "ตัน",  evidence: "vendor_reply_confirmed_ton \"ตันละ 420 ครับ\" (2026-10-05)", createdAt: new Date("2026-10-05") },
  { material: "หิน 3/4",    price: 750,  unit: "ตัน",  evidence: "vendor_reply_confirmed_ton \"ราคาต่อตัน 750\" (2026-10-10)", createdAt: new Date("2026-10-10") },
  // no evidence at all (grey zone / old row without reply_text) — SKIP per §5
  { material: "ลูกรัง",     price: 260,  unit: "UNKNOWN", evidence: "no pit_price_requests.answered evidence, no unit wording", createdAt: new Date("2026-08-05") },
  // missing density — SKIP (cannot convert) per §5
  { material: "วัสดุใหม่ไม่รู้ density", price: 500, unit: "คิว", evidence: "created_before_cutover but material_type has NO density", createdAt: new Date("2026-07-01") },
]

// ── Migration v2 logic, expressed exactly as the SQL does it ──
function migrateRow(r: PriceRow):
  | { action: "SKIP_KEEP_TON"; reason: string; original: number; converted: number }
  | { action: "SKIP_UNKNOWN_OR_NO_DENSITY"; reason: string; original: number; converted: number }
  | { action: "CONVERT"; reason: string; original: number; converted: number; evidence: string; density: number } {
  const density = DENSITY[r.material]

  if (r.unit === "ตัน") {
    return { action: "SKIP_KEEP_TON", reason: "already ตัน — directive §3 keep as-is", original: r.price, converted: r.price }
  }
  if (r.unit === "UNKNOWN") {
    return { action: "SKIP_UNKNOWN_OR_NO_DENSITY", reason: "no unit evidence — directive §5 never convert", original: r.price, converted: r.price }
  }
  if (density == null) {
    return { action: "SKIP_UNKNOWN_OR_NO_DENSITY", reason: "no density — cannot convert, never guess", original: r.price, converted: r.price }
  }
  // ✅ the corrected formula: ÷, not × (v1's bug was multiplying UP)
  const perTon = round2(r.price / density)
  return {
    action: "CONVERT",
    reason: "pre-cutover row with real density evidence",
    original: r.price,
    converted: perTon,
    evidence: r.evidence,
    density,
  }
}

// ── Expected owner-reference outcomes (hand-computed before running) ──
const EXPECTED: Record<string, number> = {
  "ทรายหยาบ":  206.9,   // 300 / 1.45 = 206.8966… → round2 = 206.9
  "หินคลุก":   264.71,  // 450 / 1.70 = 264.7058… → round2 = 264.71
  "ดินถม":     169.23,  // 220 / 1.30 = 169.2307… → round2 = 169.23
}

let pass = 0, fail = 0
for (const r of ROWS) {
  const out = migrateRow(r)
  if (out.action === "CONVERT") {
    const exp = EXPECTED[r.material]
    const ok = exp != null && Math.abs(out.converted - exp) < 0.01
    if (ok) pass++; else fail++
    console.log(`${ok ? "✅" : "❌"} CONVERT ${r.material}: ${out.original} ฿/คิว ÷ ${out.density} = ${out.converted} ฿/ตัน (expected ${exp ?? "n/a"}) — evidence: ${out.evidence}`)
  } else {
    pass++
    const ok = out.converted === out.original
    if (!ok) fail++
    console.log(`${ok ? "✅" : "❌"} ${out.action} ${r.material}: price stays ${out.original} — ${out.reason}`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)

if (fail > 0) { process.exit(1) }
console.log(`\n➡️  Next step (owner/CLI only): run supabase/migrations/20261013000001_unit_standardize_ton_v2.sql on a real sandbox Supabase project, then re-run scripts/audit-pit-price-units.sql §A/§B to compare live rows.`)
