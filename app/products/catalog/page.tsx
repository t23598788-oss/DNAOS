import type { Metadata } from "next"
import Link from "next/link"
import { readPublicCatalog } from "@/services/public-catalog/reader"
import type { CatalogFacets, CatalogType, PublicCatalogView } from "@/core/public-catalog/policy"

/**
 * /products/catalog — public listing, SERVER RENDERED, no login.
 *
 * Reads through the exact same function the public API uses
 * (services/public-catalog/reader.readPublicCatalog), so page and API can never
 * diverge in what they consider publishable. A record without a live
 * publication_records row does not exist here.
 *
 * Empty state is a first-class result: when nothing is published (or the
 * source is unreachable) the page says so. It never renders a placeholder
 * product, price or supplier name.
 */
// literal on purpose: Next requires segment config to be statically analyzable
// (must match PUBLIC_CACHE_SECONDS = 60 in services/public-catalog/reader.ts)
export const revalidate = 60

export const metadata: Metadata = {
  title: "แคตตาล็อกวัสดุก่อสร้างและบริการขนส่ง | DNA OS",
  description: "รายการวัสดุ ราคา และบริการขนส่งที่ผู้ประกอบการอนุญาตเผยแพร่ พร้อมวันที่อัปเดต",
  alternates: { canonical: "/products/catalog" },
}

const TYPE_LABEL: Record<CatalogType, string> = {
  material: "วัสดุก่อสร้าง",
  transport: "บริการขนส่ง",
  equipment: "เครื่องจักร",
}

function baht(amount: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

function PriceBlock({ item }: { item: PublicCatalogView }) {
  if (!item.price) {
    return <span className="text-sm text-stone-400">ราคาต้องขอใบเสนอราคา</span>
  }
  return (
    <span className="text-sm text-white">
      ฿{baht(item.price.amount)}{" "}
      <span className="text-stone-400">
        {item.unit ? `/ ${item.unit}` : ""} · {item.price.currency}
      </span>
      <span className="ml-2 text-[11px] text-stone-500">
        {item.price.verified ? `ยืนยันราคา ${item.price.verified_at?.slice(0, 10)}` : "ยังไม่ยืนยันราคา"}
      </span>
    </span>
  )
}

const VALID_TYPES: CatalogType[] = ["material", "transport", "equipment"]

type Props = {
  searchParams: Promise<{ q?: string; type?: string; area?: string; province?: string; district?: string }>
}

export default async function PublicCatalogPage({ searchParams }: Props) {
  const sp = await searchParams
  const q = (sp.q ?? "").trim()
  const area = (sp.area ?? "").trim()
  const province = (sp.province ?? "").trim()
  const district = (sp.district ?? "").trim()
  const type = VALID_TYPES.includes((sp.type ?? "") as CatalogType) ? (sp.type as CatalogType) : undefined

  let items: PublicCatalogView[] = []
  let facets: CatalogFacets | null = null
  let notice: string | null = null

  try {
    // Same publication gate as GET /api/public/products — one reader, no copy.
    const result = await readPublicCatalog({ type, q, area, province, district, pageSize: 50 })
    items = result.items
    facets = result.facets
    if (result.empty_reason === "no_published_records") {
      notice = "ยังไม่มีรายการที่ได้รับอนุญาตเผยแพร่ในขณะนี้"
    } else if (result.empty_reason === "no_match") {
      notice = q || area || province || district || type ? `ไม่พบรายการที่ตรงกับคำค้นนี้` : "ไม่พบรายการ"
    }
  } catch {
    notice = "ยังแสดงแคตตาล็อกไม่ได้ (แหล่งข้อมูลหรือสิทธิ์เผยแพร่ยังไม่พร้อม)"
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200">
      <div className="max-w-5xl mx-auto px-6 py-14">
        <h1 className="text-2xl font-semibold text-white">แคตตาล็อกวัสดุและบริการขนส่ง</h1>
        <p className="mt-2 text-sm text-stone-400">
          ทุกรายการในหน้านี้ผ่านการอนุญาตเผยแพร่จากผู้ประกอบการเจ้าของข้อมูล และแสดงเฉพาะข้อมูลที่ได้รับอนุญาต
        </p>

        <form action="/products/catalog" method="get" className="mt-6 flex flex-col sm:flex-row gap-3 max-w-2xl">
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="ค้นหาชื่อสินค้า ผู้ประกอบการ หรือประเภท"
            className="flex-1 rounded-xl bg-stone-900 border border-stone-800 px-4 py-3 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-stone-600"
          />
          <input
            name="province"
            type="text"
            list="catalog-province-options"
            defaultValue={province}
            placeholder="จังหวัด"
            className="rounded-xl bg-stone-900 border border-stone-800 px-4 py-3 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-stone-600"
          />
          <datalist id="catalog-province-options">
            {(facets?.provinces ?? []).map((f) => (
              <option key={f.value} value={f.value} />
            ))}
          </datalist>
          <input
            name="district"
            type="text"
            list="catalog-district-options"
            defaultValue={district}
            placeholder="อำเภอ"
            className="rounded-xl bg-stone-900 border border-stone-800 px-4 py-3 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-stone-600"
          />
          <datalist id="catalog-district-options">
            {(facets?.districts ?? []).map((f) => (
              <option key={f.value} value={f.value} />
            ))}
          </datalist>
          <select
            name="type"
            defaultValue={type ?? ""}
            className="rounded-xl bg-stone-900 border border-stone-800 px-4 py-3 text-sm text-stone-200 focus:outline-none focus:border-stone-600"
          >
            <option value="">ทุกประเภท</option>
            <option value="material">วัสดุก่อสร้าง</option>
            <option value="transport">บริการขนส่ง</option>
            <option value="equipment">เครื่องจักร</option>
          </select>
          <button type="submit" className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black hover:bg-emerald-400 transition-colors">
            ค้นหา
          </button>
        </form>
        {(q || area || province || district || type) && (
          <p className="mt-3 text-xs text-stone-500">
            ตัวกรอง: {[
              q ? `คำค้น “${q}”` : null,
              type ? TYPE_LABEL[type] : null,
              province ? `จังหวัด ${province}` : null,
              district ? `อำเภอ ${district}` : null,
              area ? `พื้นที่ ${area}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            <Link href="/products/catalog" className="text-[#7cc4f5] hover:underline">
              ล้างตัวกรอง
            </Link>
          </p>
        )}

        {notice && (
          <div className="mt-8 rounded-xl border border-stone-800 bg-stone-900 px-5 py-4 text-sm text-stone-300">
            {notice}
          </div>
        )}

        <div className="mt-8 divide-y divide-stone-800 border-y border-stone-800">
          {items.map((item) => (
            <Link
              key={item.slug}
              href={`/products/${item.slug}`}
              className="flex flex-col gap-2 py-5 hover:bg-stone-900/50 px-3 -mx-3 rounded-lg transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-white font-medium">{item.name}</div>
                  <div className="text-xs text-stone-500 mt-1">
                    {TYPE_LABEL[item.type]}
                    {item.supplier ? ` · ${item.supplier.name}` : ""}
                    {item.province ? ` · จ.${item.province}` : ""}
                    {item.district ? ` · อ.${item.district}` : ""}
                    {item.coordinates
                      ? ` · พิกัด ${item.coordinates.lat.toFixed(4)}, ${item.coordinates.lng.toFixed(4)}`
                      : ""}
                  </div>
                </div>
                <PriceBlock item={item} />
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-xs text-stone-600">
          อัปเดตล่าสุด: {items[0]?.updated_at?.slice(0, 10) ?? "—"}
        </p>
      </div>
    </main>
  )
}
