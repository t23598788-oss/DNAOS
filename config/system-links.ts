const SUPABASE_PROJECT_REF = "xeytcavxejhyzxwevgto"

function supabaseTableQuery(table: string) {
  const sql = `select * from public.${table} order by 1 desc limit 100;`
  return `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/sql/new?content=${encodeURIComponent(sql)}`
}

export interface SystemLinkItem {
  label: string
  url: string
  note?: string
}

export interface SystemLinkGroup {
  id: string
  title: string
  account: string
  items: SystemLinkItem[]
}

// ตารางจริงที่ระบบใช้งานอยู่ (grep จาก .from() ทั่ว core/, engines/, cognitive/, services/, plugins/ กับ app/)
// Exported (owner, 2026-08-05) for the IDE shell's Database tool
// (app/api/admin/workspace/database/route.ts) to reuse — same real list,
// not a second copy.
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

export const SYSTEM_LINKS: SystemLinkGroup[] = [
  {
    id: "supabase",
    title: "Supabase — คอนเนกเตอร์ฐานข้อมูล DNA OS",
    account: "dnaos.tech@gmail.com",
    items: [
      { label: "Table Editor (รายการตารางทั้งหมด)", url: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/editor` },
      { label: "SQL Editor", url: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/sql/new` },
      { label: "Project Settings — API Keys", url: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/settings/api` },
      ...SUPABASE_TABLES.map((table) => ({
        label: `ตาราง: ${table}`,
        url: supabaseTableQuery(table),
      })),
    ],
  },
  {
    id: "railway",
    title: "Railway — คอนเนกเตอร์โฮสต์ DNA OS",
    account: "t23598788-oss",
    items: [
      { label: "Production site", url: "https://dnaos.dev" },
      { label: "Service Dashboard", url: "https://railway.com/project/ffe589bf-58fb-4e3e-8969-4a75915fda1a/service/c08254e4-9679-4984-b388-402f7909bf47?environmentId=4d28eafa-9735-4405-a585-55ea354bafab" },
    ],
  },
  {
    id: "vercel",
    title: "Vercel — คอนเนกเตอร์",
    account: "t23598788-3511 (t23598788@gmail.com)",
    items: [
      { label: "Project Dashboard", url: "https://vercel.com/t23598788-3511s-projects/dna-os-deadboard" },
      { label: "Deployments", url: "https://vercel.com/t23598788-3511s-projects/dna-os-deadboard/deployments" },
      { label: "Environment Variables", url: "https://vercel.com/t23598788-3511s-projects/dna-os-deadboard/settings/environment-variables" },
    ],
  },
  {
    id: "github",
    title: "GitHub — โค้ดจริง",
    account: "t23598788-oss",
    items: [
      { label: "Repository", url: "https://github.com/t23598788-oss/---------------DNA-OS" },
      { label: "Commits", url: "https://github.com/t23598788-oss/---------------DNA-OS/commits" },
      { label: "Actions", url: "https://github.com/t23598788-oss/---------------DNA-OS/actions" },
    ],
  },
  {
    id: "n8n",
    title: "n8n — ระบบออโตเมชั่น (self-hosted)",
    account: "t23598788@gmail.com",
    items: [
      { label: "n8n instance (Hostinger VPS)", url: "https://n8n.srv1740014.hstgr.cloud" },
      { label: "n8n Community (DNA_OS_Co_Ltd)", url: "https://community.n8n.io" },
    ],
  },
  {
    id: "make",
    title: "Make.com — ระบบออโตเมชั่น",
    account: "t23598788@gmail.com",
    items: [
      { label: "Scenarios (org 952732)", url: "https://eu1.make.com/952732/scenarios" },
    ],
  },
  {
    id: "hostinger",
    title: "Hostinger — คอนเนกเตอร์โดเมนและ VPS",
    account: "t23598788@gmail.com",
    items: [
      { label: "hPanel", url: "https://hpanel.hostinger.com" },
    ],
  },
]
