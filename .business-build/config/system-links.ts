// ตารางจริงที่ระบบใช้งานอยู่ (grep จาก .from() ทั่ว core/, engines/, cognitive/, services/, plugins/ กับ app/)
// Exported (owner, 2026-08-05) for the Database tool
// (app/api/admin/workspace/database/route.ts) to reuse — same real list,
// not a second copy.
//
// Owner decision 2026-10-20: infrastructure consoles (Supabase dashboard
// SQL/Table Editor/API keys, Railway, Vercel, GitHub, n8n, Make, Hostinger)
// are NOT linked from the Business UI. The former SYSTEM_LINKS groups were
// removed; this file now only carries the table-name list.
export const SUPABASE_TABLES = [
  "companies",
  "partners",
  "transport_jobs",
  "customer_orders",
  "transactions",
  "invoices",
  "invoice_debts",
  "invoice_payments",
  "standalone_documents",
  "documents",
  "debt_trackings",
  "debt_snapshots",
  "products",
  "material_types",
  "vehicle_types",
  "pit_materials",
  "pit_profiles",
  "business_events",
  "api_tokens",
  "app_configs",
  "kv_cache",
]
