import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"
import { buildErpBrainSnapshot, ERP_ORGANS, ERP_PROBE_TABLES, type ErpSourceProbe } from "@/engines/erp/brain"
import { fetchProductCatalogStats } from "@/app/api/admin/erp/_lib/stats"

// ERP Summary — มุมแบนของ ERP Brain Core (ใช้ snapshot เดียวกัน ไม่คำนวณซ้ำ)

async function probeTable(db: ReturnType<typeof supabase>, table: string): Promise<ErpSourceProbe> {
  try {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true })
    if (error) return { table, count: null, error: error.message }
    // Supabase ตอบ count=null โดยไม่มี error เมื่อตารางไม่มีจริง → ถือว่าขาด ไม่ใช่ 0
    if (count === null) return { table, count: null, error: "count unavailable — table missing or count not exposed" }
    return { table, count }
  } catch (err) {
    return { table, count: null, error: err instanceof Error ? err.message : "probe failed" }
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds !== null) {
    return NextResponse.json(
      { error: "สรุป ERP เป็นภาพรวมระดับบริษัท ต้องใช้สิทธิ์ระดับแพลตฟอร์ม", reason: ctx.scope.reason },
      { status: 403 },
    )
  }

  const db = supabase()
  const probes = await Promise.all(ERP_PROBE_TABLES.map((table) => probeTable(db, table)))

  // reuse the same stats fetch helper shape (inline)
  const stats = await fetchProductCatalogStats(db)
  const snapshot = buildErpBrainSnapshot(probes, new Date().toISOString(), stats)

  const counts: Record<string, number | null> = {}
  for (const probe of probes) counts[probe.table] = probe.count

  return NextResponse.json({
    ok: true,
    modules: ERP_ORGANS.map((organ) => organ.key),
    counts,
    health: snapshot.health,
    health_score: snapshot.health_score,
    coverage: snapshot.coverage,
    stats: snapshot.stats,
    brain: {
      source: "dna-os-erp-core",
      status: snapshot.health,
      detail: "/api/admin/erp/brain",
    },
  })
}
