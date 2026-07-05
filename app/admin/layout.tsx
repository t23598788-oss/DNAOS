import Link from "next/link"
import { getDocumentTypeCounts } from "@/lib/supabase/queries"
import { DOCUMENT_TYPE_META, type DocumentType } from "@/lib/documents/document-editor"
import SettingsDrawer from "@/components/settings/SettingsDrawer"
import LogoutButton from "@/components/auth/LogoutButton"

export const dynamic = "force-dynamic"

const DOCUMENT_CENTER_TYPES: { type: DocumentType; dot: string }[] = [
  { type: "invoice", dot: "bg-blue-500" },
  { type: "purchase_order", dot: "bg-green-500" },
  { type: "delivery_order", dot: "bg-amber-500" },
  { type: "payment_voucher", dot: "bg-purple-500" },
  { type: "receipt", dot: "bg-orange-500" },
  { type: "debt_notice", dot: "bg-rose-500" },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { counts, otherCount } = await getDocumentTypeCounts()

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white border-r border-stone-200 flex flex-col">
        <div className="px-4 pt-5 pb-3 border-b border-stone-100">
          <Link href="/" className="text-xs text-stone-400 hover:text-stone-600 transition">
            ← Control Center
          </Link>
          <div className="mt-2 font-bold text-stone-800 text-sm tracking-tight">DNA OS</div>
          <div className="text-[10px] text-stone-400">Admin</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">

          {/* Job Center — Primary Hub */}
          <div>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1">
              Job Center
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/admin/jobs/create"
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 transition"
                >
                  <span className="text-stone-400">+</span>
                  สร้างงานใหม่
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/jobs"
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-indigo-500" />
                  งานทั้งหมด
                </Link>
              </li>
            </ul>
          </div>

          {/* Document Center */}
          <div>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1">
              ศูนย์เอกสาร
            </div>
            <ul className="space-y-0.5">
              {DOCUMENT_CENTER_TYPES.map(({ type, dot }) => {
                const meta = DOCUMENT_TYPE_META[type]
                const count = counts[type] ?? 0
                return (
                  <li key={type}>
                    <Link
                      href={meta.route}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                      <span className="flex-1 truncate">{meta.fullTitle} {meta.prefix}</span>
                      <span className="text-[10px] text-stone-400 tabular-nums shrink-0">{count} รายการ</span>
                    </Link>
                  </li>
                )
              })}
              {otherCount > 0 && (
                <li>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-400">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-stone-300" />
                    <span className="flex-1 truncate">เอกสารอื่นๆ</span>
                    <span className="text-[10px] text-stone-400 tabular-nums shrink-0">{otherCount} รายการ</span>
                  </div>
                </li>
              )}
            </ul>
          </div>

          {/* Transaction Flow */}
          <div>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1">
              Transaction Flow
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/admin/pending"
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-rose-500" />
                  งานค้าง (Pending)
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/transactions"
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-blue-500" />
                  ทุก Transaction
                </Link>
              </li>
            </ul>
          </div>

          {/* Relationship Center */}
          <div>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1">
              ความสัมพันธ์
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/admin/partners"
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-sky-500" />
                  Business Timeline
                </Link>
              </li>
            </ul>
          </div>

          {/* Quick actions */}
          <div>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1">
              เอกสาร
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/admin/create-document"
                  className="block px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                >
                  + สร้างเอกสาร
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/debt-tracking"
                  className="block px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                >
                  ติดตามหนี้
                </Link>
              </li>
            </ul>
          </div>

          {/* System */}
          <div>
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-1 mb-1">
              ระบบ
            </div>
            <ul className="space-y-0.5">
              {[
                { href: "/admin/backup",          dot: "bg-teal-500",   label: "สำรองข้อมูล" },
                { href: "/admin/dbd",             dot: "bg-violet-500", label: "DBD Center" },
                { href: "/admin/brain",           dot: "bg-cyan-400",   label: "DNA Brain" },
                { href: "/admin/build",          dot: "bg-green-400",  label: "Build" },
                { href: "/admin/deploy",          dot: "bg-sky-400",    label: "Deploy" },
                { href: "/admin/architecture",    dot: "bg-violet-400", label: "Dashboard" },
                { href: "/admin/api-explorer",    dot: "bg-blue-400",   label: "API" },
                { href: "/admin/reader",          dot: "bg-amber-400",  label: "Reader" },
                { href: "/admin/graph",           dot: "bg-pink-400",   label: "Graph" },
                { href: "/admin/traces",          dot: "bg-orange-400", label: "Traces" },
                { href: "/admin/dna",             dot: "bg-teal-400",   label: "DNA" },
                { href: "/admin/api-tokens",      dot: "bg-emerald-400",label: "🔌 API Tokens" },
                { href: "/observer",              dot: "bg-sky-300",    label: "🔭 Observer (AI)" },
              ].map(({ href, dot, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="px-3 py-3 border-t border-stone-100 space-y-1">
          <SettingsDrawer />
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
