import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Cost/infrastructure dashboard (owner, 2026-08-03): "หน้าจอค่าใช้จ่าย...
// ขึ้นมาแสดงผลในค่าใช้จ่ายและตัวประมวลผลต่างๆ". registry/infrastructure.json
// already tracked every real external service + cost — this just serves it
// to the admin UI (Rule 103: reuse before build, no new data source).
//
// Extended 2026-08-04 (owner: "Add Infrastructure Health... Add Runtime
// Verification") to also merge in system_health_status — the real,
// periodically-refreshed table system-health-check writes to (migration
// 20260804000001). No new table: the health data is read here, not
// duplicated, and the Active/Warning/Critical status below is computed at
// request time from real fields already present, never stored as a
// separate guess.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const filePath = path.join(process.cwd(), "registry", "infrastructure.json")
  const raw = JSON.parse(await readFile(filePath, "utf-8"))

  const db = supabase()
  const { data: healthRows } = await db.from("system_health_status").select("*")
  const healthByKey = new Map((healthRows ?? []).map((r: any) => [r.service_key, r]))

  const now = Date.now()
  for (const [key, service] of Object.entries<any>(raw.services ?? {})) {
    const direct = healthByKey.get(key)
    const cronChecks = (service.dependency_graph?.edge_functions ?? [])
      .map((fn: string) => healthByKey.get(`cron:${fn}`))
      .filter(Boolean)

    // "Active/Warning/Critical" computed honestly from real signals only —
    // never fabricated. Precedence: a confirmed degraded runtime check
    // outranks a stale config field, an expiration deadline outranks
    // "looks fine right now".
    let health_status: "active" | "warning" | "critical" = "active"
    const reasons: string[] = []

    if (service.status === "pending_credential") { health_status = "warning"; reasons.push("รอ credential") }
    if (direct?.status === "degraded") { health_status = "critical"; reasons.push(`${direct.check_kind} ล้มเหลว ${direct.consecutive_failures} ครั้งติด`) }
    for (const c of cronChecks) {
      if (c.status === "degraded") { health_status = "critical"; reasons.push(`cron ${c.service_key} ล้มเหลว`) }
    }
    if (service.expiration) {
      const daysLeft = Math.floor((new Date(service.expiration).getTime() - now) / 86400000)
      if (daysLeft <= 14 && health_status !== "critical") { health_status = "warning"; reasons.push(`หมดอายุใน ${daysLeft} วัน`) }
    }
    if (service.status === "removed") { health_status = "active"; reasons.length = 0 } // not tracked, not alarming

    service.health = {
      status: health_status,
      reasons,
      last_verified_at: direct?.last_check_at ?? null,
      checks: [direct, ...cronChecks].filter(Boolean).map((c: any) => ({
        service_key: c.service_key, check_kind: c.check_kind, status: c.status, last_check_at: c.last_check_at, detail: c.detail,
      })),
    }
  }

  return NextResponse.json(raw)
}
