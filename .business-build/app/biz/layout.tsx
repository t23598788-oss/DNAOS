import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"
import AdminSidebarNav from "@/components/admin/AdminSidebarNav"
import { DocumentActionsProvider } from "@/components/documents/DocumentActionsContext"
import BizNav from "./_lib/BizNav"
import { BIZ_SECTIONS } from "./_lib/sections"

/**
 * BUSINESS WORKSPACE ใหม่ — /biz (owner 2026-10-13 — FINAL BUSINESS UI COMPLETION)
 *
 * โครงเรื่งหน้าจอ (ตาม rules: LEFT SIDEBAR เดิม 1 แถบ + TOP TAB BAR เดิม 1 แถบ · ไม่มีแถบล่าง · ไม่มี tab ซ้อน):
 *  - LEFT SIDEBAR = "ของเดิม" AdminSidebarNav (components/admin/AdminSidebarNav.tsx) — reuse เต็มตัว
 *    ป้อนด้วย BIZ_SECTIONS (href=/biz/* จริงทุกแถบ ไม่มี link ตาย) — เมนูธุรกิจที่ ADMIN_TIER เดิมทุกบรรทัด
 *    (ไม่ใช้ resolveNavItems เพราะคืน /admin/dashboard ที่ไม่มีหน้าจริง — เป็น mismatch ของ shared infra
 *     ที่กระทบ /business ด้วย จึงไม่แก้ core/navigation และไม่ป้อนมาที่นี่)
 *  - TOP TAB BAR = "ของเดิม" BizNav (แท็บ section ย่อย) — แถวเดียว ไม่มี tab bar ซ้อน
 *  - ไม่มี preview toolbar ระดับใหม่ · ไม่ลบหน้าจอเดิม (/admin/*)
 */
const SECTION_ICONS: Record<string, string> = {
  resources: "Database", quarry: "Database", sand: "Database", soil: "Database", factory: "Cpu",
  "create-document": "Puzzle", documents: "BookOpen", receipt: "BookOpen", receipts: "BookOpen",
  finance: "LayoutGrid", transactions: "LayoutGrid", "debt-tracking": "LayoutGrid",
  partners: "Shield", relationships: "Network",
  "line-customers": "LineChat", "line-profiles": "LineChat",
}

export default async function BizLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthPage("/biz", ADMIN_TIER)
  const navItems = BIZ_SECTIONS.map((s) => ({
    href: `/biz/${s.key}`,
    label: s.label,
    icon: SECTION_ICONS[s.key] ?? "Puzzle",
  }))

  return (
    <div className="dna-admin-shell bg-stone-50" style={{ display: "flex" }}>
      <AdminSidebarNav
        navItems={navItems}
        headerLabel="ธุรกิจ"
        headerIcon="LayoutGrid"
        userEmail={user.email}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <DocumentActionsProvider>
          <BizNav />
          <div className="dna-admin-content" style={{ flex: 1, minHeight: 0 }}>{children}</div>
        </DocumentActionsProvider>
      </div>
    </div>
  )
}


