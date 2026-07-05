import Link from "next/link"
import { getPartnersWithDocumentSummary } from "@/lib/supabase/queries"

export const dynamic = "force-dynamic"

function formatMoney(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })
}

export default async function PartnersPage() {
  const partners = await getPartnersWithDocumentSummary()

  const sorted = [...partners].sort((a, b) => {
    if (!a.last_activity && !b.last_activity) return a.name.localeCompare(b.name, "th")
    if (!a.last_activity) return 1
    if (!b.last_activity) return -1
    return a.last_activity < b.last_activity ? 1 : -1
  })

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="px-6 py-4 bg-white border-b border-stone-200 shrink-0">
        <div className="font-bold text-stone-800 text-sm">คู่ค้า</div>
        <div className="text-[10px] text-stone-400 mt-0.5">
          {partners.length} ราย — คลิกเพื่อดู Business Timeline
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 && (
          <div className="text-center text-sm text-stone-400 py-16">ยังไม่มีคู่ค้าในระบบ</div>
        )}

        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-stone-50 border-b border-stone-200 z-10">
            <tr>
              <th className="text-left px-5 py-2.5 font-semibold text-stone-500">ชื่อ</th>
              <th className="text-left px-3 py-2.5 font-semibold text-stone-500">ประเภท</th>
              <th className="text-right px-3 py-2.5 font-semibold text-stone-500">ยอดแจ้งหนี้</th>
              <th className="text-right px-3 py-2.5 font-semibold text-stone-500">รับแล้ว</th>
              <th className="text-right px-3 py-2.5 font-semibold text-stone-500">คงเหลือ</th>
              <th className="text-right px-3 py-2.5 font-semibold text-stone-500">เอกสาร</th>
              <th className="text-right px-5 py-2.5 font-semibold text-stone-500">กิจกรรมล่าสุด</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sorted.map((p) => (
              <tr key={p.id} className="hover:bg-stone-50 transition">
                <td className="px-5 py-3">
                  <Link
                    href={`/admin/partners/${p.id}`}
                    className="font-semibold text-stone-800 hover:text-blue-600 transition"
                  >
                    {p.name}
                  </Link>
                  {p.phone && (
                    <div className="text-[10px] text-stone-400 mt-0.5">{p.phone}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-stone-500">
                  {p.partner_type_label ?? "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-stone-700">
                  {p.total_invoiced > 0 ? `฿${formatMoney(p.total_invoiced)}` : "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                  {p.total_received > 0 ? `฿${formatMoney(p.total_received)}` : "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {p.outstanding > 0 ? (
                    <span className="text-rose-600 font-semibold">฿{formatMoney(p.outstanding)}</span>
                  ) : p.outstanding < 0 ? (
                    <span className="text-amber-600">฿{formatMoney(p.outstanding)}</span>
                  ) : (
                    <span className="text-stone-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right text-stone-400 tabular-nums">
                  {p.document_count > 0 ? `${p.document_count} ใบ` : "—"}
                </td>
                <td className="px-5 py-3 text-right text-stone-400">
                  {fmtDate(p.last_activity)}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/admin/create-document?partnerId=${p.id}`}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition whitespace-nowrap"
                  >
                    + สร้างเอกสาร
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
