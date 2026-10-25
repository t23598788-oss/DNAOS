import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { readPublicItem, PUBLIC_CACHE_SECONDS } from "@/services/public-catalog/reader"
import { buildCatalogJsonLd } from "@/core/public-catalog/structured-data"
import { appBaseUrl } from "@/config/system-links"

/**
 * /products/[slug] — public detail page, SERVER RENDERED, no login.
 *
 * Only publishable records resolve: readPublicItem applies the same three gates
 * as the API (live publication row → not expired → field whitelist), so a
 * draft/expired/withdrawn slug returns 404 rather than a page with holes.
 *
 * JSON-LD (Product/Service + Offer) is emitted ONLY from the item returned by
 * that gate — no rating, no geo, no phone, no InStock without evidence, and the
 * seller/provider is the real supplier, never DNA OS.
 *
 * If the source is unreachable the page fails closed (error boundary state)
 * instead of rendering cached/guessed values.
 */
// literal on purpose: Next requires segment config to be statically analyzable
// (must match PUBLIC_CACHE_SECONDS = 60 in services/public-catalog/reader.ts)
export const revalidate = 60

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  try {
    const item = await readPublicItem(slug)
    if (!item) return { title: "ไม่พบรายการ | DNA OS" }
    return {
      title: `${item.name}${item.supplier ? ` — ${item.supplier.name}` : ""} | DNA OS`,
      description: [
        item.spec,
        item.price ? `ราคา ฿${item.price.amount.toFixed(2)} ${item.price.currency}` : "ราคาต้องขอใบเสนอราคา",
        item.province ? `จังหวัด${item.province}` : null,
        item.district ? `อำเภอ${item.district}` : null,
        item.service_area ? `พื้นที่ให้บริการ ${item.service_area.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      alternates: { canonical: `/products/${item.slug}` },
    }
  } catch {
    return { title: "แคตตาล็อกยังไม่พร้อม | DNA OS" }
  }
}

export default async function PublicProductPage({ params }: Props) {
  const { slug } = await params

  // Fail closed but not crash: an unreachable source (or a missing service key)
  // must NOT surface a 500 stack trace, and must never fall back to a cached or
  // guessed listing. Show an honest "not available" state instead.
  let item: Awaited<ReturnType<typeof readPublicItem>> = null
  try {
    item = await readPublicItem(slug)
  } catch {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-200">
        <div className="max-w-3xl mx-auto px-6 py-14">
          <Link href="/products/catalog" className="text-xs text-stone-500 hover:text-stone-300">
            ← กลับแคตตาล็อก
          </Link>
          <div className="mt-8 rounded-xl border border-stone-800 bg-stone-900 px-5 py-4 text-sm text-stone-300">
            ยังแสดงรายการนี้ไม่ได้ในขณะนี้ (แหล่งข้อมูลหรือสิทธิ์เผยแพร่ยังไม่พร้อม)
          </div>
        </div>
      </main>
    )
  }
  if (!item) notFound()

  const jsonLd = buildCatalogJsonLd(item, appBaseUrl())

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200">
      {jsonLd && (
        <script
          type="application/ld+json"
          // Built by a pure function from the gated item only — no user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div className="max-w-3xl mx-auto px-6 py-14">
        <Link href="/products/catalog" className="text-xs text-stone-500 hover:text-stone-300">
          ← กลับแคตตาล็อก
        </Link>

        <h1 className="mt-6 text-2xl font-semibold text-white">{item.name}</h1>
        <dl className="mt-6 space-y-3 text-sm">
          {item.spec && (
            <div className="flex gap-3">
              <dt className="w-36 text-stone-500">ขนาด/คุณสมบัติ</dt>
              <dd className="text-stone-200">{item.spec}</dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-36 text-stone-500">ราคา</dt>
            <dd className="text-stone-200">
              {item.price ? (
                <>
                  ฿{item.price.amount.toFixed(2)} {item.price.currency}
                  {item.unit ? ` / ${item.unit}` : ""}
                  <span className="ml-2 text-[11px] text-stone-500">
                    {item.price.verified
                      ? `ยืนยันราคาเมื่อ ${item.price.verified_at?.slice(0, 10)}`
                      : "ยังไม่ได้รับการยืนยันราคา"}
                  </span>
                </>
              ) : (
                "ราคาต้องขอใบเสนอราคา"
              )}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-36 text-stone-500">รูปแบบจัดหา</dt>
            <dd className="text-stone-200">
              {item.procurement === "in_stock"
                ? "มีสต็อก"
                : item.procurement === "made_to_order"
                  ? "ผลิตตามสั่ง"
                  : item.procurement === "sourced_on_request"
                    ? "จัดหาตามคำขอ"
                    : "ขอราคาก่อนสั่งซื้อ"}
            </dd>
          </div>
          {item.supplier && (
            <div className="flex gap-3">
              <dt className="w-36 text-stone-500">ผู้ประกอบการ</dt>
              <dd className="text-stone-200">{item.supplier.name}</dd>
            </div>
          )}
          {item.province && (
            <div className="flex gap-3">
              <dt className="w-36 text-stone-500">จังหวัด</dt>
              <dd className="text-stone-200">{item.province}</dd>
            </div>
          )}
          {item.district && (
            <div className="flex gap-3">
              <dt className="w-36 text-stone-500">อำเภอ</dt>
              <dd className="text-stone-200">{item.district}</dd>
            </div>
          )}
          {item.coordinates && (
            <div className="flex gap-3">
              <dt className="w-36 text-stone-500">พิกัด</dt>
              <dd className="text-stone-200 tabular-nums">
                {item.coordinates.lat.toFixed(4)}, {item.coordinates.lng.toFixed(4)}
                <span className="ml-2 text-[11px] text-stone-500">เผยแพร่โดยเจ้าของรายการ</span>
              </dd>
            </div>
          )}
          {item.service_area && (
            <div className="flex gap-3">
              <dt className="w-36 text-stone-500">พื้นที่ให้บริการ</dt>
              <dd className="text-stone-200">{item.service_area.join(", ")}</dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-36 text-stone-500">อัปเดตล่าสุด</dt>
            <dd className="text-stone-200">{item.updated_at.slice(0, 10)}</dd>
          </div>
        </dl>

        {/* No source ids, verifier identity or trace id here: those are internal
            audit data and never leave the server (reader returns toPublicView). */}
        <p className="mt-10 text-xs text-stone-600">
          ข้อมูลนี้เผยแพร่โดยความยินยอมของผู้ประกอบการเจ้าของรายการ · เผยแพร่เมื่อ{" "}
          {item.published_at.slice(0, 10)}
        </p>
      </div>
    </main>
  )
}
