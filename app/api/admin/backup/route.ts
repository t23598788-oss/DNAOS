import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"

const TABLES = [
  "partners",
  "documents",
  "document_items",
  "transactions",
  "business_events",
  "debt_trackings",
  "invoice_debts",
  "invoice_payments",
  "app_configs",
  "material_types",
]

export async function GET() {
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
