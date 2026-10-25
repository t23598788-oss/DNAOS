/**
 * Public price table (2026-10-24) — columns required by the owner:
 * จังหวัด | อำเภอ | ประเภทวัสดุ | ชื่อสินค้า | ราคา/หน่วย | ความพร้อม | อัปเดตล่าสุด | ติดต่อ
 *
 * Every cell is a published field from services/public-catalog/reader (which
 * consults publication_records first). Nothing is invented:
 *  - no price row → the cell says "ขอใบเสนอราคา", never 0 / never a guess
 *  - stock → only when the source carries stock evidence, else "สอบถามความพร้อม"
 *  - province/district → parsed from the supplier's own published address text
 *    by core/public-catalog/geography (the same rule /admin/pits uses), so a
 *    record with no parseable address renders "—" and never matches a filter
 *  - พิกัด → ONLY when the publication row whitelisted `coordinates`; a pit's
 *    GPS is internal operational data and is blank here by default
 *  - contact → LINE OA when a real OA URL is configured, otherwise the LINE
 *    column links to the record page (no fake LINE id)
 */
import Link from "next/link"
import LineContactButton from "@/components/public/LineContactButton"
import type { CatalogFacets, CatalogType, PublicCatalogView } from "@/core/public-catalog/policy"

const TYPE_LABEL: Record<CatalogType, string> = {
  material: "วัสดุก่อสร้าง",
  transport: "บริการขนส่ง",
  equipment: "เครื่องจักร",
}

const READINESS_LABEL: Record<string, string> = {
  in_stock: "พร้อมจำหน่าย",
  made_to_order: "ผลิตตามสั่ง",
  sourced_on_request: "จัดหาตามคำขอ",
  quote_required: "สอบถามความพร้อม",
}

export interface PublicPriceTableProps {
  items: PublicCatalogView[]
  filters: { q?: string; province?: string; district?: string; type?: string }
  /** options come from the PUBLISHED set only (reader.buildFacets) */
  facets?: CatalogFacets | null
  notice: string | null
}

function baht(amount: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

export default function PublicPriceTable({ items, filters, facets, notice }: PublicPriceTableProps) {
  // A datalist (not a <select>) keeps free text working while still showing
  // only provinces that actually have published rows.
  const provinceOptions = facets?.provinces.map((f) => f.value) ?? []
  const districtOptions = facets?.districts.map((f) => f.value) ?? []
  return (
    <section id="prices" className="bg-[#FDFBF8] border-y border-[#E9E1D6]">
      <div className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-stone-900">ตารางราคาสาธารณะ</h2>
            <p className="mt-1 text-sm text-stone-600">
              ราคาจากผู้ประกอบการที่อนุญาตเผยแพร่ — อ้างอิงรายการต้นทางและวันที่อัปเดตจริง
            </p>
          </div>
          <Link href="/products/catalog" className="text-sm text-[#1e6fa8] hover:underline">
            เปิดแคตตาล็อกเต็ม →
          </Link>
        </div>

        {/* Province / district / type filters — plain GET, works without JS */}
        <form action="/" method="get" className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input type="hidden" name="v" value="prices" />
          <div>
            <label htmlFor="province" className="block text-xs font-semibold text-stone-500 mb-1">จังหวัด</label>
            <input
              id="province"
              name="province"
              list="public-province-options"
              defaultValue={filters.province ?? ""}
              placeholder="เช่น จันทบุรี"
              className="w-full rounded-lg bg-[#F7F4EF] border border-[#E3DACE] px-3 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-[#B49C7C] focus:bg-white"
            />
            <datalist id="public-province-options">
              {provinceOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="district" className="block text-xs font-semibold text-stone-500 mb-1">อำเภอ</label>
            <input
              id="district"
              name="district"
              list="public-district-options"
              defaultValue={filters.district ?? ""}
              placeholder="เช่น ท่าใหม่"
              className="w-full rounded-lg bg-[#F7F4EF] border border-[#E3DACE] px-3 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-[#B49C7C] focus:bg-white"
            />
            <datalist id="public-district-options">
              {districtOptions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="type" className="block text-xs font-semibold text-stone-500 mb-1">ประเภทสินค้า</label>
            <select
              id="type"
              name="type"
              defaultValue={filters.type ?? ""}
              className="w-full rounded-lg bg-[#F7F4EF] border border-[#E3DACE] px-3 py-2.5 text-sm text-stone-800 focus:outline-none focus:border-[#B49C7C] focus:bg-white"
            >
              <option value="">ทุกประเภท</option>
              <option value="material">วัสดุก่อสร้าง</option>
              <option value="transport">บริการขนส่ง</option>
              <option value="equipment">เครื่องจักร</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-[#B49C7C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a48d6e] transition-colors"
            >
              กรองผล
            </button>
            <Link
              href="/"
              className="rounded-lg border border-[#E3DACE] px-4 py-2.5 text-sm text-stone-600 hover:bg-[#F7F4EF] transition-colors"
            >
              ล้าง
            </Link>
          </div>
        </form>

        {notice && (
          <div className="mt-5 rounded-xl border border-[#E9E1D6] bg-[#F7F4EF] px-4 py-3 text-sm text-stone-600">
            {notice}
          </div>
        )}

        <div className="mt-5 -mx-4 sm:mx-0 sm:rounded-xl sm:border sm:border-[#E9E1D6] overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-[#F7F4EF] text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-4 py-3 font-semibold whitespace-nowrap">จังหวัด</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">อำเภอ</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">พิกัด</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">ประเภทวัสดุ</th>
                <th className="px-4 py-3 font-semibold">ชื่อสินค้า</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">ราคา/หน่วย</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">ความพร้อม</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">อัปเดตล่าสุด</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">ติดต่อ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E1D6]">
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-stone-500">
                    ยังไม่มีรายการที่ได้รับอนุญาตเผยแพร่ในขณะนี้
                    <div className="mt-2 text-xs text-stone-400">
                      ข้อมูลจะปรากฏเมื่อผู้ประกอบการเผยแพร่รายการจากตารางจัดการของตนเอง
                    </div>
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.slug} className="bg-white hover:bg-[#FDFBF8]">
                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap" title={item.service_area?.join(", ") ?? undefined}>
                    {item.province ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap" title={item.service_area?.join(", ") ?? undefined}>
                    {item.district ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-500 tabular-nums text-xs whitespace-nowrap">
                    {item.coordinates
                      ? `${item.coordinates.lat.toFixed(4)}, ${item.coordinates.lng.toFixed(4)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{TYPE_LABEL[item.type]}</td>
                  <td className="px-4 py-3">
                    <Link href={`/products/${item.slug}`} className="font-medium text-stone-900 hover:text-[#1e6fa8]">
                      {item.name}
                    </Link>
                    {item.supplier && <div className="text-xs text-stone-500 mt-0.5">{item.supplier.name}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {item.price ? (
                      <>
                        <span className="font-semibold text-stone-900">฿{baht(item.price.amount)}</span>
                        <span className="text-stone-500">{item.unit ? ` / ${item.unit}` : ""}</span>
                        <div className="text-[11px] text-stone-400">
                          {item.price.verified ? "ยืนยันราคาแล้ว" : "ยังไม่ยืนยันราคา"}
                        </div>
                      </>
                    ) : (
                      <span className="text-stone-500">ขอใบเสนอราคา</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                    {READINESS_LABEL[item.procurement] ?? "สอบถามความพร้อม"}
                  </td>
                  <td className="px-4 py-3 text-stone-500 whitespace-nowrap">{item.updated_at.slice(0, 10)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <LineContactButton variant="inline" reference={item.slug} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
