import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { SUPER_ADMIN_ONLY } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

const TABLES = [
  "companies",
  "invoices",
  "invoice_items",
  "standalone_documents",
  "standalone_document_items",
  "customer_orders",
  "debt_snapshots",
  "payments",
  "app_configs",
  "products",
]

export async function GET() {
  const auth = await requireAuth(SUPER_ADMIN_ONLY)
  if (auth instanceof NextResponse) return auth

  // A full export is platform data by definition — an organization-scoped
  // profile must not receive every company's rows just because it can read
  // its own. (Same rule as finance-summary.)
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "การสำรองข้อมูลทั้งระบบต้องใช้สิทธิ์ระดับแพลตฟอร์ม" }, { status: 403 })
  }

  const results: Record<string, unknown[]> = {}
  const errors: string[] = []

  for (const table of TABLES) {
    try {
      const { data, error } = await supabase()
        .from(table)
        .select("*")
        .limit(50000)

      if (error) throw new Error(error.message)
      results[table] = data ?? []
    } catch (err) {
      errors.push(`${table}: ${err instanceof Error ? err.message : String(err)}`)
      results[table] = []
    }
  }

  const manifest = {
    exported_at: new Date().toISOString(),
    tables: Object.keys(results),
    row_counts: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])),
    total_rows: Object.values(results).reduce((s, v) => s + v.length, 0),
    errors: errors.length > 0 ? errors : undefined,
  }

  const payload = { _manifest: manifest, ...results }
  const json = JSON.stringify(payload, null, 2)
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")

  return new NextResponse(json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="dnaos-backup-${ts}.json"`,
    },
  })
}

// สถิติ backup — ไม่ download แค่ดู row counts
export async function POST() {
  const auth = await requireAuth(SUPER_ADMIN_ONLY)
  if (auth instanceof NextResponse) return auth

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "สถิติการสำรองข้อมูลทั้งระบบต้องใช้สิทธิ์ระดับแพลตฟอร์ม" }, { status: 403 })
  }

  const stats: Record<string, number> = {}
  const errors: string[] = []

  for (const table of TABLES) {
    try {
      const { count, error } = await supabase()
        .from(table)
        .select("*", { count: "exact", head: true })

      if (error) throw new Error(error.message)
      stats[table] = count ?? 0
    } catch (err) {
      errors.push(`${table}: ${err instanceof Error ? err.message : String(err)}`)
      stats[table] = -1
    }
  }

  return NextResponse.json({
    tables: stats,
    total_rows: Object.values(stats).filter((v) => v >= 0).reduce((s, v) => s + v, 0),
    errors: errors.length > 0 ? errors : undefined,
    checked_at: new Date().toISOString(),
  })
}
